package vcjob

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/dao/query"
	"github.com/raids-lab/orbit/internal/resputil"
	"github.com/raids-lab/orbit/pkg/config"
)

const checkpointInternalTokenHeader = "X-Orbit-Internal-Token"

type checkpointInternalIDReq struct {
	CheckpointID uint `uri:"id" binding:"required"`
}

type checkpointInternalEventReq struct {
	CheckpointID uint              `json:"checkpointID"`
	JobName      string            `json:"jobName"`
	RunID        string            `json:"runID"`
	Path         string            `json:"path"`
	StoragePath  string            `json:"storagePath"`
	Status       string            `json:"status"`
	Step         *int64            `json:"step"`
	SizeBytes    *int64            `json:"sizeBytes"`
	Framework    string            `json:"framework"`
	Format       string            `json:"format"`
	Message      string            `json:"message"`
	Metadata     datatypes.JSONMap `json:"metadata"`
}

type checkpointInternalEventResp struct {
	Checkpoint model.JobCheckpoint `json:"checkpoint"`
}

type checkpointInternalEventsResp struct {
	Updated []model.JobCheckpoint `json:"updated"`
}

func RegisterCheckpointInternalRoutes(g *gin.RouterGroup) {
	g.Use(requireCheckpointInternalToken)
	g.POST("events", handleCheckpointInternalEvents)
	g.POST(":id/commit", handleCheckpointInternalCommit)
	g.POST(":id/fail", handleCheckpointInternalFail)
}

func requireCheckpointInternalToken(c *gin.Context) {
	expected := checkpointInternalToken()
	if expected == "" {
		resputil.HTTPError(c, http.StatusForbidden, "checkpoint internal token is not configured", resputil.TokenInvalid)
		c.Abort()
		return
	}
	got := strings.TrimSpace(c.GetHeader(checkpointInternalTokenHeader))
	if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
		resputil.HTTPError(c, http.StatusUnauthorized, "invalid checkpoint internal token", resputil.TokenInvalid)
		c.Abort()
		return
	}
	c.Next()
}

func checkpointInternalToken() string {
	if token := strings.TrimSpace(os.Getenv("ORBIT_CHECKPOINT_INTERNAL_TOKEN")); token != "" {
		return token
	}
	return strings.TrimSpace(config.GetConfig().Checkpoint.Agent.InternalToken)
}

func handleCheckpointInternalEvents(c *gin.Context) {
	var reqs []checkpointInternalEventReq
	data, err := c.GetRawData()
	if err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	if err := json.Unmarshal(data, &reqs); err != nil {
		var single checkpointInternalEventReq
		if bindErr := json.Unmarshal(data, &single); bindErr != nil {
			resputil.BadRequestError(c, err.Error())
			return
		}
		reqs = []checkpointInternalEventReq{single}
	}
	updated := make([]model.JobCheckpoint, 0, len(reqs))
	for i := range reqs {
		checkpoint, err := updateCheckpointFromInternalEvent(c, reqs[i])
		if err != nil {
			resputil.Error(c, err.Error(), resputil.NotSpecified)
			return
		}
		updated = append(updated, *checkpoint)
	}
	resputil.Success(c, checkpointInternalEventsResp{Updated: updated})
}

func handleCheckpointInternalCommit(c *gin.Context) {
	var uri checkpointInternalIDReq
	if err := c.ShouldBindUri(&uri); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	var req checkpointInternalEventReq
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		resputil.BadRequestError(c, err.Error())
		return
	}
	req.CheckpointID = uri.CheckpointID
	req.Status = string(model.JobCheckpointStatusCommitted)
	checkpoint, err := updateCheckpointFromInternalEvent(c, req)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	resputil.Success(c, checkpointInternalEventResp{Checkpoint: *checkpoint})
}

func handleCheckpointInternalFail(c *gin.Context) {
	var uri checkpointInternalIDReq
	if err := c.ShouldBindUri(&uri); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	var req checkpointInternalEventReq
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		resputil.BadRequestError(c, err.Error())
		return
	}
	req.CheckpointID = uri.CheckpointID
	req.Status = string(model.JobCheckpointStatusFailed)
	checkpoint, err := updateCheckpointFromInternalEvent(c, req)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	resputil.Success(c, checkpointInternalEventResp{Checkpoint: *checkpoint})
}

func updateCheckpointFromInternalEvent(c *gin.Context, req checkpointInternalEventReq) (*model.JobCheckpoint, error) {
	status := model.JobCheckpointStatus(strings.TrimSpace(req.Status))
	if status == "" {
		return nil, errors.New("status is required")
	}
	if !validCheckpointInternalStatus(status) {
		return nil, fmt.Errorf("unsupported checkpoint status %q", status)
	}
	if strings.TrimSpace(req.StoragePath) != "" {
		storagePath, err := cleanCheckpointInternalStoragePath(req.StoragePath)
		if err != nil {
			return nil, err
		}
		req.StoragePath = storagePath
	}

	db := query.GetDB().WithContext(c)
	checkpoint, err := findOrCreateInternalCheckpoint(c, req)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{
		"status":     status,
		"updated_at": time.Now(),
	}
	if status != model.JobCheckpointStatusCommitted {
		updates["latest"] = false
	}
	if req.Path != "" {
		updates["path"] = req.Path
	}
	if req.StoragePath != "" {
		updates["storage_path"] = req.StoragePath
	}
	if req.Step != nil {
		updates["step"] = *req.Step
	}
	if req.SizeBytes != nil {
		updates["size_bytes"] = *req.SizeBytes
	}
	if runID := parseCheckpointInternalRunID(req.RunID); runID != nil {
		updates["run_id"] = *runID
	}
	if req.Framework != "" {
		updates["framework"] = strings.ToLower(req.Framework)
	}
	metadata := cloneCheckpointMetadata(checkpoint.Metadata)
	if metadata == nil {
		metadata = datatypes.JSONMap{}
	}
	for key, value := range req.Metadata {
		metadata[key] = value
	}
	if req.Format != "" {
		metadata["format"] = req.Format
	}
	if req.Message != "" {
		metadata["message"] = req.Message
	}
	metadata["lastEventStatus"] = string(status)
	metadata["lastEventAt"] = time.Now().UTC().Format(time.RFC3339)
	updates["metadata"] = metadata

	if err := db.Model(&model.JobCheckpoint{}).
		Where("id = ?", checkpoint.ID).
		Updates(updates).Error; err != nil {
		return nil, err
	}
	if status == model.JobCheckpointStatusCommitted {
		if err := refreshLatestForCheckpointJob(c, checkpoint.JobID); err != nil {
			return nil, err
		}
	}
	if err := db.Where("id = ?", checkpoint.ID).First(checkpoint).Error; err != nil {
		return nil, err
	}
	return checkpoint, nil
}

func cleanCheckpointInternalStoragePath(raw string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	if normalized == "" {
		return "", nil
	}
	if filepath.IsAbs(normalized) {
		return "", fmt.Errorf("storagePath must be relative to checkpoint storage root")
	}
	cleaned := filepath.ToSlash(filepath.Clean(normalized))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("storagePath must stay under checkpoint storage root")
	}
	return strings.TrimLeft(cleaned, "/"), nil
}

func findOrCreateInternalCheckpoint(c *gin.Context, req checkpointInternalEventReq) (*model.JobCheckpoint, error) {
	db := query.GetDB().WithContext(c)
	if req.CheckpointID != 0 {
		var checkpoint model.JobCheckpoint
		if err := db.Where("id = ?", req.CheckpointID).First(&checkpoint).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("checkpoint %d does not exist", req.CheckpointID)
			}
			return nil, err
		}
		return &checkpoint, nil
	}
	jobName := strings.TrimSpace(req.JobName)
	if jobName == "" {
		return nil, errors.New("jobName is required when checkpointID is absent")
	}
	var job model.Job
	if err := db.Where("job_name = ?", jobName).First(&job).Error; err != nil {
		return nil, err
	}
	var checkpoint model.JobCheckpoint
	lookup := db.Where("job_id = ?", job.ID)
	if strings.TrimSpace(req.Path) != "" {
		lookup = lookup.Where("path = ?", req.Path)
	} else if strings.TrimSpace(req.StoragePath) != "" {
		lookup = lookup.Where("storage_path = ?", req.StoragePath)
	} else {
		return nil, errors.New("path or storagePath is required when checkpointID is absent")
	}
	err := lookup.First(&checkpoint).Error
	if err == nil {
		return &checkpoint, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	name := filepath.Base(firstNonEmptyString(req.Path, req.StoragePath))
	step := int64(-1)
	if req.Step != nil {
		step = *req.Step
	}
	checkpoint = model.JobCheckpoint{
		JobID:       job.ID,
		JobName:     job.JobName,
		UserID:      job.UserID,
		AccountID:   job.AccountID,
		Framework:   strings.ToLower(firstNonEmptyString(req.Framework, "custom")),
		Name:        name,
		Path:        firstNonEmptyString(req.Path, req.StoragePath),
		StoragePath: req.StoragePath,
		Step:        step,
		Status:      model.JobCheckpointStatusCreating,
		Source:      "agent",
		ModTime:     time.Now(),
		Metadata:    datatypes.JSONMap{},
	}
	if req.SizeBytes != nil {
		checkpoint.SizeBytes = *req.SizeBytes
	}
	if runID := parseCheckpointInternalRunID(req.RunID); runID != nil {
		checkpoint.RunID = runID
	}
	if err := db.Create(&checkpoint).Error; err != nil {
		return nil, err
	}
	return &checkpoint, nil
}

func validCheckpointInternalStatus(status model.JobCheckpointStatus) bool {
	switch status {
	case model.JobCheckpointStatusCreating,
		model.JobCheckpointStatusStaged,
		model.JobCheckpointStatusUploading,
		model.JobCheckpointStatusCommitted,
		model.JobCheckpointStatusFailed,
		model.JobCheckpointStatusDeleting,
		model.JobCheckpointStatusDeleted,
		model.JobCheckpointStatusMissing,
		model.JobCheckpointStatusInvalid:
		return true
	default:
		return false
	}
}

func cloneCheckpointMetadata(value datatypes.JSONMap) datatypes.JSONMap {
	if value == nil {
		return nil
	}
	next := datatypes.JSONMap{}
	for key, item := range value {
		next[key] = item
	}
	return next
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func parseCheckpointInternalRunID(raw string) *uint {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || parsed == 0 {
		return nil
	}
	value := uint(parsed)
	return &value
}

func refreshLatestForCheckpointJob(c *gin.Context, jobID uint) error {
	if jobID == 0 {
		return nil
	}
	db := query.GetDB().WithContext(c)
	var job model.Job
	if err := db.Where("id = ?", jobID).First(&job).Error; err != nil {
		return err
	}
	resp, err := buildCheckpointListResp(c, &job)
	if err != nil {
		return err
	}
	latestPath := ""
	if resp.Latest != nil {
		latestPath = resp.Latest.Path
	}
	if err := db.Model(&model.JobCheckpoint{}).Where("job_id = ?", jobID).Update("latest", false).Error; err != nil {
		return err
	}
	if resp.Latest != nil {
		if err := db.Model(&model.JobCheckpoint{}).Where("id = ?", resp.Latest.ID).Update("latest", true).Error; err != nil {
			return err
		}
	}
	if job.Checkpoint == nil || job.Checkpoint.Data() == nil {
		return nil
	}
	info := job.Checkpoint.Data()
	info.LatestCheckpoint = latestPath
	return db.Model(&model.Job{}).
		Where("id = ?", jobID).
		Update("checkpoint", datatypes.NewJSONType(info)).Error
}
