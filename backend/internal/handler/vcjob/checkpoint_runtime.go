package vcjob

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"
	batch "volcano.sh/apis/pkg/apis/batch/v1alpha1"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/dao/query"
	"github.com/raids-lab/orbit/internal/handler"
	"github.com/raids-lab/orbit/internal/resputil"
	"github.com/raids-lab/orbit/internal/service"
	vcjobservice "github.com/raids-lab/orbit/internal/service/vcjob"
	checkpointsvc "github.com/raids-lab/orbit/internal/service/vcjob/checkpoint"
	"github.com/raids-lab/orbit/internal/util"
	"github.com/raids-lab/orbit/pkg/config"
	"github.com/raids-lab/orbit/pkg/constants"
	"github.com/raids-lab/orbit/pkg/crclient"
	"github.com/raids-lab/orbit/pkg/utils"
)

const (
	defaultCheckpointListTTL = 5 * time.Minute
	restoreCheckpointSuffix  = "-resume"
)

type checkpointActionReq struct {
	JobName      string `uri:"name" binding:"required"`
	CheckpointID uint   `uri:"checkpointID" binding:"required"`
}

type listCheckpointReq struct {
	AutoScan bool `form:"autoScan"`
}

type cleanupCheckpointReq struct {
	KeepLast   *int `json:"keepLast"`
	MaxAgeDays *int `json:"maxAgeDays"`
	DryRun     bool `json:"dryRun"`
}

type restoreCheckpointReq struct {
	Name string `json:"name"`
}

type checkpointListResp struct {
	Items          []model.JobCheckpoint `json:"items"`
	Latest         *model.JobCheckpoint  `json:"latest,omitempty"`
	Total          int64                 `json:"total"`
	TotalSizeBytes int64                 `json:"totalSizeBytes"`
	Quota          checkpointQuotaResp   `json:"quota"`
	LastScannedAt  time.Time             `json:"lastScannedAt,omitempty"`
	Checkpoint     *model.CheckpointInfo `json:"checkpoint,omitempty"`
}

type checkpointQuotaResp struct {
	MaxToKeep    int   `json:"maxToKeep"`
	MaxBytes     int64 `json:"maxBytes"`
	CurrentCount int   `json:"currentCount"`
	ExcessCount  int   `json:"excessCount"`
	ExcessBytes  int64 `json:"excessBytes"`
	CurrentBytes int64 `json:"currentBytes"`
}

type cleanupCheckpointResp struct {
	Deleted        []model.JobCheckpoint `json:"deleted"`
	Failed         []model.JobCheckpoint `json:"failed,omitempty"`
	ReclaimedBytes int64                 `json:"reclaimedBytes"`
	DryRun         bool                  `json:"dryRun"`
}

type restoreCheckpointResp struct {
	JobName         string `json:"jobName"`
	Name            string `json:"name"`
	CheckpointPath  string `json:"checkpointPath"`
	ExperimentRunID uint   `json:"experimentRunID,omitempty"`
}

func (mgr *VolcanojobMgr) ListJobCheckpoints(c *gin.Context) {
	var req JobActionReq
	if err := c.ShouldBindUri(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	var queryReq listCheckpointReq
	_ = c.ShouldBindQuery(&queryReq)

	token := util.GetToken(c)
	job, err := getJob(c, req.JobName, &token)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	if queryReq.AutoScan && shouldAutoScanCheckpoint(job) {
		if _, err := checkpointsvc.ScanJobWithKubernetes(c.Request.Context(), job, mgr.kubeClient); err != nil {
			klog.Warningf("auto scan checkpoints for job %s failed: %v", job.JobName, err)
		} else {
			refreshed, refreshErr := getJob(c, req.JobName, &token)
			if refreshErr == nil {
				job = refreshed
			}
		}
	}

	resp, err := buildCheckpointListResp(c, job)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	resputil.Success(c, resp)
}

func (mgr *VolcanojobMgr) ScanJobCheckpoints(c *gin.Context) {
	var req JobActionReq
	if err := c.ShouldBindUri(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}

	token := util.GetToken(c)
	job, err := getJob(c, req.JobName, &token)
	if err != nil {
		recordCheckpointOperation(c, constants.OpTypeScanCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), nil)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	result, err := checkpointsvc.ScanJobWithKubernetes(c.Request.Context(), job, mgr.kubeClient)
	if err != nil {
		details := checkpointOpDetails(job, nil, map[string]any{})
		recordCheckpointOperation(c, constants.OpTypeScanCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	details := checkpointOpDetails(job, result.Latest, map[string]any{
		"count":          len(result.Items),
		"totalSizeBytes": result.TotalSizeBytes,
		"storagePath":    result.StoragePath,
	})
	recordCheckpointOperation(c, constants.OpTypeScanCheckpoint, req.JobName, constants.OpStatusSuccess, "", details)

	refreshed, refreshErr := getJob(c, req.JobName, &token)
	if refreshErr == nil {
		job = refreshed
	}
	resp, err := buildCheckpointListResp(c, job)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	resputil.Success(c, resp)
}

func (mgr *VolcanojobMgr) RestoreJobFromCheckpoint(c *gin.Context) {
	var uriReq checkpointActionReq
	if err := c.ShouldBindUri(&uriReq); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	var bodyReq restoreCheckpointReq
	if err := c.ShouldBindJSON(&bodyReq); err != nil && err.Error() != "EOF" {
		resputil.BadRequestError(c, err.Error())
		return
	}

	token := util.GetToken(c)
	job, err := getJob(c, uriReq.JobName, &token)
	if err != nil {
		recordCheckpointOperation(c, constants.OpTypeRestoreCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), nil)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	checkpoint, err := getCommittedCheckpoint(c, job, uriReq.CheckpointID)
	if err != nil {
		details := checkpointOpDetails(job, nil, nil)
		recordCheckpointOperation(c, constants.OpTypeRestoreCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	if !mgr.preCheckCreateJob(c, token, resolveScheduleType(job), false) {
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(
			c,
			constants.OpTypeRestoreCheckpoint,
			uriReq.JobName,
			constants.OpStatusFailed,
			"job creation precheck failed",
			details,
		)
		return
	}

	displayNameOverride := strings.TrimSpace(bodyReq.Name)
	restored, displayName, experimentRuntime, err := buildCheckpointRestoreJob(
		c.Request.Context(),
		job,
		checkpoint,
		token,
		displayNameOverride,
	)
	if err != nil {
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(c, constants.OpTypeRestoreCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	if err := mgr.submitJob(c, token, restored); err != nil {
		markExperimentRunSubmitFailed(c.Request.Context(), experimentRuntime, err)
		details := checkpointOpDetails(job, checkpoint, map[string]any{
			"restoredJobName": restored.Name,
		})
		recordCheckpointOperation(c, constants.OpTypeRestoreCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	details := checkpointOpDetails(job, checkpoint, map[string]any{
		"restoredJobName": restored.Name,
		"displayName":     displayName,
		"experimentRunID": experimentRuntimeID(experimentRuntime),
	})
	recordCheckpointOperation(c, constants.OpTypeRestoreCheckpoint, uriReq.JobName, constants.OpStatusSuccess, "", details)
	resputil.Success(c, restoreCheckpointResp{
		JobName:         restored.Name,
		Name:            displayName,
		CheckpointPath:  checkpoint.Path,
		ExperimentRunID: experimentRuntimeID(experimentRuntime),
	})
}

func (mgr *VolcanojobMgr) DeleteJobCheckpoint(c *gin.Context) {
	var req checkpointActionReq
	if err := c.ShouldBindUri(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}

	token := util.GetToken(c)
	job, err := getJob(c, req.JobName, &token)
	if err != nil {
		recordCheckpointOperation(c, constants.OpTypeDeleteCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), nil)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	checkpoint, err := getCommittedCheckpoint(c, job, req.CheckpointID)
	if err != nil {
		details := checkpointOpDetails(job, nil, nil)
		recordCheckpointOperation(c, constants.OpTypeDeleteCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	if err := markCheckpointDeleting(c, checkpoint); err != nil {
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(c, constants.OpTypeDeleteCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	if err := deleteCheckpointDataPlane(c, checkpoint); err != nil {
		if updateErr := markCheckpointDeleteFailed(c, checkpoint, err); updateErr != nil {
			klog.Warningf("failed to mark checkpoint %d delete failure: %v", checkpoint.ID, updateErr)
		}
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(c, constants.OpTypeDeleteCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	if err := markCheckpointDeleted(c, checkpoint); err != nil {
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(c, constants.OpTypeDeleteCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	if err := refreshLatestAfterMutation(c, job); err != nil {
		klog.Warningf("failed to refresh latest checkpoint for job %s: %v", job.JobName, err)
	}
	if err := checkpointsvc.SyncCheckpointArtifacts(c.Request.Context(), query.GetDB().WithContext(c), job.ID); err != nil {
		klog.Warningf("failed to sync checkpoint artifacts for job %s: %v", job.JobName, err)
	}
	details := checkpointOpDetails(job, checkpoint, map[string]any{
		"sizeBytes": checkpoint.SizeBytes,
	})
	recordCheckpointOperation(c, constants.OpTypeDeleteCheckpoint, req.JobName, constants.OpStatusSuccess, "", details)
	checkpoint.Status = model.JobCheckpointStatusDeleted
	checkpoint.Latest = false
	resputil.Success(c, checkpoint)
}

func (mgr *VolcanojobMgr) CleanupJobCheckpoints(c *gin.Context) {
	var req JobActionReq
	if err := c.ShouldBindUri(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	var bodyReq cleanupCheckpointReq
	if err := c.ShouldBindJSON(&bodyReq); err != nil && err.Error() != "EOF" {
		resputil.BadRequestError(c, err.Error())
		return
	}

	token := util.GetToken(c)
	job, err := getJob(c, req.JobName, &token)
	if err != nil {
		recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), nil)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	candidates, err := selectCleanupCheckpoints(c, job, bodyReq)
	if err != nil {
		details := checkpointOpDetails(job, nil, nil)
		recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	reclaimed := int64(0)
	for i := range candidates {
		reclaimed += candidates[i].SizeBytes
	}
	if !bodyReq.DryRun {
		deleted := make([]model.JobCheckpoint, 0, len(candidates))
		failed := make([]model.JobCheckpoint, 0)
		for i := range candidates {
			if err := markCheckpointDeleting(c, &candidates[i]); err != nil {
				details := checkpointOpDetails(job, &candidates[i], nil)
				klog.Warningf("failed to mark checkpoint %d deleting: %v", candidates[i].ID, err)
				recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
				candidates[i].Metadata = checkpointMetadataWithDeleteError(candidates[i].Metadata, err)
				candidates[i].Status = model.JobCheckpointStatusFailed
				failed = append(failed, candidates[i])
				continue
			}
			if err := deleteCheckpointDataPlane(c, &candidates[i]); err != nil {
				if updateErr := markCheckpointDeleteFailed(c, &candidates[i], err); updateErr != nil {
					klog.Warningf("failed to mark checkpoint %d delete failure: %v", candidates[i].ID, updateErr)
				}
				details := checkpointOpDetails(job, &candidates[i], nil)
				recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
				candidates[i].Metadata = checkpointMetadataWithDeleteError(candidates[i].Metadata, err)
				candidates[i].Status = model.JobCheckpointStatusFailed
				failed = append(failed, candidates[i])
				continue
			}
			if err := markCheckpointDeleted(c, &candidates[i]); err != nil {
				details := checkpointOpDetails(job, &candidates[i], nil)
				recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, constants.OpStatusFailed, err.Error(), details)
				candidates[i].Metadata = checkpointMetadataWithDeleteError(candidates[i].Metadata, err)
				candidates[i].Status = model.JobCheckpointStatusFailed
				failed = append(failed, candidates[i])
				continue
			}
			candidates[i].Status = model.JobCheckpointStatusDeleted
			candidates[i].Latest = false
			deleted = append(deleted, candidates[i])
		}
		if err := refreshLatestAfterMutation(c, job); err != nil {
			klog.Warningf("failed to refresh latest checkpoint for job %s: %v", job.JobName, err)
		}
		if err := checkpointsvc.SyncCheckpointArtifacts(c.Request.Context(), query.GetDB().WithContext(c), job.ID); err != nil {
			klog.Warningf("failed to sync checkpoint artifacts for job %s: %v", job.JobName, err)
		}
		candidates = deleted
		deletedBytes := checkpointTotalBytes(deleted)
		details := checkpointOpDetails(job, nil, map[string]any{
			"deletedCount":   len(deleted),
			"failedCount":    len(failed),
			"reclaimedBytes": deletedBytes,
			"dryRun":         bodyReq.DryRun,
		})
		status := constants.OpStatusSuccess
		message := ""
		if len(failed) > 0 {
			status = constants.OpStatusFailed
			message = "some checkpoints failed to delete"
		}
		recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, status, message, details)
		resputil.Success(c, cleanupCheckpointResp{
			Deleted:        deleted,
			Failed:         failed,
			ReclaimedBytes: deletedBytes,
			DryRun:         bodyReq.DryRun,
		})
		return
	}

	details := checkpointOpDetails(job, nil, map[string]any{
		"deletedCount":   len(candidates),
		"reclaimedBytes": reclaimed,
		"dryRun":         bodyReq.DryRun,
	})
	recordCheckpointOperation(c, constants.OpTypeCleanupCheckpoint, req.JobName, constants.OpStatusSuccess, "", details)
	resputil.Success(c, cleanupCheckpointResp{
		Deleted:        candidates,
		ReclaimedBytes: reclaimed,
		DryRun:         bodyReq.DryRun,
	})
}

func buildCheckpointListResp(c *gin.Context, job *model.Job) (checkpointListResp, error) {
	var items []model.JobCheckpoint
	if err := query.GetDB().WithContext(c).
		Where("job_id = ? AND status = ?", job.ID, model.JobCheckpointStatusCommitted).
		Order("latest desc, step desc, mod_time desc, id desc").
		Find(&items).Error; err != nil {
		return checkpointListResp{}, err
	}

	totalSize := int64(0)
	var latest *model.JobCheckpoint
	for i := range items {
		totalSize += items[i].SizeBytes
		if items[i].Latest && latest == nil {
			cp := items[i]
			latest = &cp
		}
	}
	if latest == nil {
		latest = inferLatestFromIndexedItems(items)
	}

	info := checkpointInfoFromJob(job)
	lastScannedAt := time.Time{}
	maxToKeep := 0
	maxBytes := int64(0)
	if info != nil {
		lastScannedAt = info.LastScannedAt
		maxToKeep = info.MaxToKeep
		maxBytes = info.MaxBytes
	}
	excess := 0
	if maxToKeep > 0 && len(items) > maxToKeep {
		excess = len(items) - maxToKeep
	}
	excessBytes := int64(0)
	if maxBytes > 0 && totalSize > maxBytes {
		excessBytes = totalSize - maxBytes
	}
	return checkpointListResp{
		Items:          items,
		Latest:         latest,
		Total:          int64(len(items)),
		TotalSizeBytes: totalSize,
		Quota: checkpointQuotaResp{
			MaxToKeep:    maxToKeep,
			MaxBytes:     maxBytes,
			CurrentCount: len(items),
			ExcessCount:  excess,
			ExcessBytes:  excessBytes,
			CurrentBytes: totalSize,
		},
		LastScannedAt: lastScannedAt,
		Checkpoint:    info,
	}, nil
}

func shouldAutoScanCheckpoint(job *model.Job) bool {
	info := checkpointInfoFromJob(job)
	if info == nil || !info.Enabled {
		return false
	}
	return info.LastScannedAt.IsZero() || time.Since(info.LastScannedAt) > defaultCheckpointListTTL
}

func getCommittedCheckpoint(c *gin.Context, job *model.Job, id uint) (*model.JobCheckpoint, error) {
	var checkpoint model.JobCheckpoint
	err := query.GetDB().WithContext(c).
		Where("id = ? AND job_id = ? AND status = ?", id, job.ID, model.JobCheckpointStatusCommitted).
		First(&checkpoint).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("checkpoint does not exist")
		}
		return nil, err
	}
	return &checkpoint, nil
}

func markCheckpointDeleting(c *gin.Context, checkpoint *model.JobCheckpoint) error {
	if checkpoint.StoragePath == "" {
		return fmt.Errorf("checkpoint has no storage path")
	}
	return query.GetDB().WithContext(c).Model(&model.JobCheckpoint{}).
		Where("id = ?", checkpoint.ID).
		Updates(map[string]any{
			"status":     model.JobCheckpointStatusDeleting,
			"latest":     false,
			"updated_at": time.Now(),
		}).Error
}

func deleteCheckpointDataPlane(c *gin.Context, checkpoint *model.JobCheckpoint) error {
	return checkpointsvc.DeleteCheckpointStorage(c.Request.Context(), checkpoint, checkpointsvc.ServiceScannerOptions{})
}

func markCheckpointDeleted(c *gin.Context, checkpoint *model.JobCheckpoint) error {
	return query.GetDB().WithContext(c).Model(&model.JobCheckpoint{}).
		Where("id = ?", checkpoint.ID).
		Updates(map[string]any{
			"status":     model.JobCheckpointStatusDeleted,
			"latest":     false,
			"updated_at": time.Now(),
		}).Error
}

func markCheckpointDeleteFailed(c *gin.Context, checkpoint *model.JobCheckpoint, cause error) error {
	metadata := checkpointMetadataWithDeleteError(checkpoint.Metadata, cause)
	return query.GetDB().WithContext(c).Model(&model.JobCheckpoint{}).
		Where("id = ?", checkpoint.ID).
		Updates(map[string]any{
			"status":     model.JobCheckpointStatusFailed,
			"latest":     false,
			"metadata":   metadata,
			"updated_at": time.Now(),
		}).Error
}

func checkpointMetadataWithDeleteError(metadata datatypes.JSONMap, cause error) datatypes.JSONMap {
	next := datatypes.JSONMap{}
	for key, value := range metadata {
		next[key] = value
	}
	if cause != nil {
		next["deleteError"] = cause.Error()
		next["deleteFailedAt"] = time.Now().UTC().Format(time.RFC3339)
	}
	return next
}

func selectCleanupCheckpoints(c *gin.Context, job *model.Job, req cleanupCheckpointReq) ([]model.JobCheckpoint, error) {
	var items []model.JobCheckpoint
	if err := query.GetDB().WithContext(c).
		Where("job_id = ? AND status = ?", job.ID, model.JobCheckpointStatusCommitted).
		Order("latest desc, step desc, mod_time desc, id desc").
		Find(&items).Error; err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}

	keepLast := checkpointKeepLast(job, req.KeepLast)
	cutoff := time.Time{}
	if req.MaxAgeDays != nil && *req.MaxAgeDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -*req.MaxAgeDays)
	}

	currentBytes := checkpointTotalBytes(items)
	candidates := retentionCleanupCandidates(items, keepLast, cutoff)
	maxBytes := checkpointMaxBytes(job)
	if maxBytes > 0 && currentBytes > maxBytes {
		candidates = appendMaxBytesCleanupCandidates(items, candidates, currentBytes, maxBytes)
	}
	return candidates, nil
}

func checkpointTotalBytes(items []model.JobCheckpoint) int64 {
	total := int64(0)
	for i := range items {
		total += items[i].SizeBytes
	}
	return total
}

func retentionCleanupCandidates(items []model.JobCheckpoint, keepLast int, cutoff time.Time) []model.JobCheckpoint {
	candidates := make([]model.JobCheckpoint, 0)
	for i := range items {
		overRetention := keepLast > 0 && i >= keepLast
		expired := !cutoff.IsZero() && items[i].ModTime.Before(cutoff)
		if overRetention || expired {
			candidates = append(candidates, items[i])
		}
	}
	return candidates
}

func appendMaxBytesCleanupCandidates(
	items []model.JobCheckpoint,
	candidates []model.JobCheckpoint,
	currentBytes int64,
	maxBytes int64,
) []model.JobCheckpoint {
	selected := make(map[uint]struct{}, len(candidates))
	for i := range candidates {
		selected[candidates[i].ID] = struct{}{}
	}
	for i := len(items) - 1; i >= 0 && currentBytes > maxBytes; i-- {
		if _, ok := selected[items[i].ID]; ok {
			currentBytes -= items[i].SizeBytes
			continue
		}
		candidates = append(candidates, items[i])
		selected[items[i].ID] = struct{}{}
		currentBytes -= items[i].SizeBytes
	}
	return candidates
}

func checkpointKeepLast(job *model.Job, override *int) int {
	if override != nil {
		return *override
	}
	if info := checkpointInfoFromJob(job); info != nil {
		return info.MaxToKeep
	}
	return 0
}

func checkpointMaxBytes(job *model.Job) int64 {
	if info := checkpointInfoFromJob(job); info != nil {
		return info.MaxBytes
	}
	return 0
}

func refreshLatestAfterMutation(c *gin.Context, job *model.Job) error {
	resp, err := buildCheckpointListResp(c, job)
	if err != nil {
		return err
	}
	latestPath := ""
	if resp.Latest != nil {
		latestPath = resp.Latest.Path
	}
	db := query.GetDB().WithContext(c)
	if err := db.Model(&model.JobCheckpoint{}).Where("job_id = ?", job.ID).Update("latest", false).Error; err != nil {
		return err
	}
	if resp.Latest != nil {
		if err := db.Model(&model.JobCheckpoint{}).Where("id = ?", resp.Latest.ID).Update("latest", true).Error; err != nil {
			return err
		}
	}
	info := checkpointInfoFromJob(job)
	if info == nil {
		return nil
	}
	info.LatestCheckpoint = latestPath
	return db.Model(&model.Job{}).Where("id = ?", job.ID).Update("checkpoint", datatypes.NewJSONType(info)).Error
}

func buildCheckpointRestoreJob(
	ctx context.Context,
	record *model.Job,
	checkpoint *model.JobCheckpoint,
	token util.JWTMessage,
	nameOverride string,
) (*batch.Job, string, *experimentRunRuntime, error) {
	restored, err := vcjobservice.RestoreJobFromRecord(record)
	if err != nil {
		return nil, "", nil, err
	}
	jobType := model.JobType(restored.Labels[crclient.LabelKeyTaskType])
	prefix := checkpointJobNamePrefix(jobType)
	if prefix == "" {
		return nil, "", nil, fmt.Errorf("job type %s does not support checkpoint restore", jobType)
	}
	newJobName := utils.GenerateJobName(prefix, token.Username)
	baseURL := restoredBaseURL(prefix, newJobName)
	displayName := nameOverride
	if displayName == "" {
		displayName = record.Name + restoreCheckpointSuffix
	}

	restored.Name = newJobName
	restored.Namespace = config.GetConfig().Namespaces.Job
	restored.CreationTimestamp = metav1.Time{}
	restored.ResourceVersion = ""
	restored.UID = ""
	restored.Status = batch.JobStatus{}
	restored.Labels = cloneStringMap(restored.Labels)
	restored.Annotations = cloneStringMap(restored.Annotations)
	if restored.Labels == nil {
		restored.Labels = map[string]string{}
	}
	if restored.Annotations == nil {
		restored.Annotations = map[string]string{}
	}
	restored.Labels[crclient.LabelKeyTaskUser] = token.Username
	restored.Labels[crclient.LalbeKeyTaskAccount] = token.AccountName
	restored.Labels[crclient.LabelKeyBaseURL] = baseURL
	restored.Annotations[AnnotationKeyTaskName] = displayName
	restored.Annotations[AnnotationKeyUserID] = strconv.FormatUint(uint64(token.UserID), 10)
	restored.Annotations[AnnotationKeyAlertEnabled] = strconv.FormatBool(record.AlertEnabled)
	delete(restored.Annotations, service.ExperimentAnnotationRunID)

	info := checkpointInfoFromJob(record)
	if info == nil {
		return nil, "", nil, fmt.Errorf("source job has no checkpoint config")
	}
	nextInfo := *info
	nextInfo.ResumeMode = checkpointsvc.ResumeModeManual
	nextInfo.ResumeFrom = checkpoint.Path
	nextInfo.LatestCheckpoint = checkpoint.Path
	if restored.Annotations[checkpointsvc.AnnotationKeyConfig] != "" {
		delete(restored.Annotations, checkpointsvc.AnnotationKeyConfig)
	}
	if err := checkpointsvc.ApplyAnnotations(restored.Annotations, &nextInfo); err != nil {
		return nil, "", nil, err
	}

	experimentRuntime, err := createRestoreExperimentRun(ctx, record, checkpoint, token, newJobName, displayName, &nextInfo)
	if err != nil {
		return nil, "", nil, err
	}
	ApplyExperimentAnnotations(restored.Annotations, experimentRuntime)
	if experimentRuntime == nil {
		delete(restored.Annotations, service.ExperimentAnnotationID)
	}
	cfg := checkpointsvc.ConfigFromInfo(&nextInfo)
	for taskIndex := range restored.Spec.Tasks {
		task := &restored.Spec.Tasks[taskIndex]
		task.Template.Labels = cloneStringMap(task.Template.Labels)
		task.Template.Annotations = cloneStringMap(task.Template.Annotations)
		if task.Template.Labels == nil {
			task.Template.Labels = map[string]string{}
		}
		if task.Template.Annotations == nil {
			task.Template.Annotations = map[string]string{}
		}
		task.Template.Labels[crclient.LabelKeyTaskUser] = token.Username
		task.Template.Labels[crclient.LalbeKeyTaskAccount] = token.AccountName
		task.Template.Labels[crclient.LabelKeyBaseURL] = baseURL
		task.Template.Annotations[AnnotationKeyTaskName] = displayName
		task.Template.Annotations[AnnotationKeyUser] = token.Username
		for containerIndex := range task.Template.Spec.Containers {
			container := &task.Template.Spec.Containers[containerIndex]
			container.Env = cleanExperimentEnvs(container.Env)
			container.Env = checkpointsvc.AppendEnvs(container.Env, cfg, newJobName, container.VolumeMounts)
			container.Env = AppendExperimentEnvs(container.Env, experimentRuntime, newJobName, container.VolumeMounts)
		}
		applyCheckpointAgent(&task.Template.Spec, cfg)
	}
	return restored, displayName, experimentRuntime, nil
}

func checkpointJobNamePrefix(jobType model.JobType) string {
	switch jobType {
	case model.JobTypeJupyter:
		return "jpt"
	case model.JobTypeWebIDE:
		return "vsc"
	case model.JobTypePytorch:
		return "pyt"
	case model.JobTypeTensorflow:
		return "tf"
	case model.JobTypeCustom:
		return "sg"
	default:
		return ""
	}
}

func restoredBaseURL(prefix, jobName string) string {
	return strings.TrimPrefix(jobName, prefix+"-")
}

func createRestoreExperimentRun(
	ctx context.Context,
	record *model.Job,
	checkpoint *model.JobCheckpoint,
	token util.JWTMessage,
	newJobName string,
	displayName string,
	checkpointInfo *model.CheckpointInfo,
) (*experimentRunRuntime, error) {
	experimentID := experimentIDFromJob(record)
	if experimentID == 0 {
		return nil, nil
	}
	parentRunID := experimentRunIDFromJob(record)
	tags := datatypes.JSONMap{
		"restoredFromJobName":      record.JobName,
		"restoredFromCheckpointID": checkpoint.ID,
		"restoredFromCheckpoint":   checkpoint.Path,
	}
	if parentRunID != nil {
		tags["restoredFromRunID"] = *parentRunID
	}
	checkpointSnapshot := checkpointSnapshotFromRestore(checkpoint, checkpointInfo)
	result, err := newExperimentService().CreateRun(ctx, &service.CreateRunInput{
		ExperimentID:       experimentID,
		ParentRunID:        parentRunID,
		SourceCheckpointID: &checkpoint.ID,
		JobName:            newJobName,
		RunName:            displayName,
		UserID:             token.UserID,
		AccountID:          token.AccountID,
		CheckpointSnapshot: checkpointSnapshot,
		ReproduceSnapshot: datatypes.JSONMap{
			"mode":                 "checkpoint-restore",
			"sourceJobName":        record.JobName,
			"sourceCheckpointID":   checkpoint.ID,
			"sourceCheckpointPath": checkpoint.Path,
		},
		Tags: tags,
	})
	if err != nil {
		return nil, err
	}
	return &experimentRunRuntime{RunID: result.Run.ID, Token: result.Token}, nil
}

func experimentIDFromJob(job *model.Job) uint {
	if job == nil || job.Attributes.Data() == nil {
		return 0
	}
	if id := parseUintAnnotation(job.Attributes.Data().Annotations, service.ExperimentAnnotationID); id > 0 {
		return id
	}
	return parseUintAnnotation(job.Attributes.Data().Annotations, "crater.raids.io/experiment-id")
}

func experimentRunIDFromJob(job *model.Job) *uint {
	if job == nil || job.Attributes.Data() == nil {
		return nil
	}
	if id := parseUintAnnotation(job.Attributes.Data().Annotations, service.ExperimentAnnotationRunID); id > 0 {
		return &id
	}
	return nil
}

func parseUintAnnotation(annotations map[string]string, key string) uint {
	if annotations == nil {
		return 0
	}
	value, err := strconv.ParseUint(strings.TrimSpace(annotations[key]), 10, 64)
	if err != nil {
		return 0
	}
	return uint(value)
}

func checkpointSnapshotFromRestore(checkpoint *model.JobCheckpoint, info *model.CheckpointInfo) datatypes.JSONMap {
	snapshot := checkpointInfoSnapshot(info)
	if checkpoint != nil {
		snapshot["checkpointID"] = checkpoint.ID
		snapshot["checkpointPath"] = checkpoint.Path
		snapshot["storagePath"] = checkpoint.StoragePath
		snapshot["step"] = checkpoint.Step
		snapshot["latest"] = checkpoint.Latest
	}
	return snapshot
}

func checkpointInfoSnapshot(info *model.CheckpointInfo) datatypes.JSONMap {
	if info == nil {
		return datatypes.JSONMap{}
	}
	return datatypes.JSONMap{
		"enabled":          info.Enabled,
		"framework":        info.Framework,
		"projectName":      info.ProjectName,
		"experimentName":   info.ExperimentName,
		"outputDir":        info.OutputDir,
		"checkpointDir":    info.CheckpointDir,
		"resumeMode":       info.ResumeMode,
		"resumeFrom":       info.ResumeFrom,
		"latestCheckpoint": info.LatestCheckpoint,
		"saveSteps":        info.SaveSteps,
		"maxToKeep":        info.MaxToKeep,
		"maxBytes":         info.MaxBytes,
	}
}

func cleanExperimentEnvs(envs []v1.EnvVar) []v1.EnvVar {
	next := make([]v1.EnvVar, 0, len(envs))
	for _, env := range envs {
		if strings.HasPrefix(env.Name, "ORBIT_RUN_") || env.Name == service.EnvOrbitAPIBase {
			continue
		}
		next = append(next, env)
	}
	return next
}

func experimentRuntimeID(runtime *experimentRunRuntime) uint {
	if runtime == nil {
		return 0
	}
	return runtime.RunID
}

func resolveScheduleType(job *model.Job) model.ScheduleType {
	if job != nil && job.ScheduleType != nil {
		return *job.ScheduleType
	}
	return model.ScheduleTypeNormal
}

func inferLatestFromIndexedItems(items []model.JobCheckpoint) *model.JobCheckpoint {
	if len(items) == 0 {
		return nil
	}
	sorted := append([]model.JobCheckpoint(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Step >= 0 && sorted[j].Step >= 0 && sorted[i].Step != sorted[j].Step {
			return sorted[i].Step > sorted[j].Step
		}
		if sorted[i].Step >= 0 && sorted[j].Step < 0 {
			return true
		}
		if sorted[i].Step < 0 && sorted[j].Step >= 0 {
			return false
		}
		if !sorted[i].ModTime.Equal(sorted[j].ModTime) {
			return sorted[i].ModTime.After(sorted[j].ModTime)
		}
		return sorted[i].Name > sorted[j].Name
	})
	return &sorted[0]
}

func checkpointInfoFromJob(job *model.Job) *model.CheckpointInfo {
	if job == nil || job.Checkpoint == nil {
		return nil
	}
	return job.Checkpoint.Data()
}

func cloneStringMap(src map[string]string) map[string]string {
	if src == nil {
		return nil
	}
	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func checkpointOpDetails(job *model.Job, checkpoint *model.JobCheckpoint, extra map[string]any) map[string]any {
	details := map[string]any{}
	if job != nil {
		details["jobName"] = job.JobName
		details["displayName"] = job.Name
		details["jobID"] = job.ID
	}
	if checkpoint != nil {
		details["checkpointID"] = checkpoint.ID
		details["checkpointPath"] = checkpoint.Path
		details["storagePath"] = checkpoint.StoragePath
		details["step"] = checkpoint.Step
	}
	for key, value := range extra {
		details[key] = value
	}
	return details
}

func recordCheckpointOperation(c *gin.Context, opType, target, status, message string, details map[string]any) {
	handler.RecordOperationLog(c, opType, target, status, message, details)
}
