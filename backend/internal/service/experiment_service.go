package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	batch "volcano.sh/apis/pkg/apis/batch/v1alpha1"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/dao/query"
	"github.com/raids-lab/orbit/internal/util"
)

const (
	ExperimentAnnotationRunID = "orbit.raids.io/experiment-run-id"
	ExperimentAnnotationID    = "orbit.raids.io/experiment-id"

	EnvOrbitRunID = "ORBIT_RUN_ID"
	//nolint:gosec // This is the environment variable name, not a token value.
	EnvOrbitRunToken  = "ORBIT_RUN_TOKEN"
	EnvOrbitAPIBase   = "ORBIT_API_BASE"
	EnvOrbitOutputDir = "ORBIT_OUTPUT_DIR"

	defaultMetricQueryLimit = 5000
	maxMetricQueryLimit     = 50000
	maxMetricDownsample     = 5000
	maxMetricsPerRequest    = 1000
	runTokenBytes           = 32
)

type ExperimentRunConfig struct {
	ExperimentID uint              `json:"experimentId"`
	RunName      string            `json:"runName"`
	Hyperparams  datatypes.JSONMap `json:"hyperparams"`
	Code         datatypes.JSONMap `json:"code"`
	Data         datatypes.JSONMap `json:"data"`
	Image        datatypes.JSONMap `json:"image"`
	Tags         datatypes.JSONMap `json:"tags"`
}

type CreateExperimentInput struct {
	Name        string
	Description string
	Visibility  model.ExperimentVisibility
	Tags        datatypes.JSONMap
	UserID      uint
	AccountID   uint
}

type UpdateExperimentInput struct {
	Name        *string
	Description *string
	Visibility  *model.ExperimentVisibility
	Tags        *datatypes.JSONMap
}

type CreateRunInput struct {
	ExperimentID       uint
	ParentRunID        *uint
	SourceCheckpointID *uint
	JobName            string
	RunName            string
	UserID             uint
	AccountID          uint
	Hyperparams        datatypes.JSONMap
	CodeSnapshot       datatypes.JSONMap
	DataSnapshot       datatypes.JSONMap
	ImageSnapshot      datatypes.JSONMap
	ResourceSnapshot   datatypes.JSONMap
	CheckpointSnapshot datatypes.JSONMap
	ReproduceSnapshot  datatypes.JSONMap
	Tags               datatypes.JSONMap
}

type CreateRunResult struct {
	Run   *model.ExperimentRun
	Token string
}

type MetricInput struct {
	ID             string            `json:"id"`
	ClientRecordID string            `json:"clientRecordID"`
	Name           string            `json:"name"`
	Value          float64           `json:"value"`
	Step           int64             `json:"step"`
	Timestamp      *time.Time        `json:"timestamp"`
	Context        datatypes.JSONMap `json:"context"`
}

type MetricListQuery struct {
	Names      []string
	StartStep  *int64
	EndStep    *int64
	Limit      int
	Downsample int
}

type ArtifactInput struct {
	ID             string            `json:"id"`
	ClientRecordID string            `json:"clientRecordID"`
	Name           string            `json:"name"`
	Type           string            `json:"type"`
	Path           string            `json:"path"`
	SizeBytes      int64             `json:"sizeBytes"`
	SourceType     string            `json:"sourceType"`
	SourceID       *uint             `json:"sourceID"`
	Metadata       datatypes.JSONMap `json:"metadata"`
}

type CheckpointRestorePlan struct {
	JobName        string `json:"jobName"`
	CheckpointID   uint   `json:"checkpointID"`
	Name           string `json:"name"`
	CheckpointPath string `json:"checkpointPath"`
}

type ReproduceRunResult struct {
	Mode                       string                 `json:"mode"`
	RunID                      uint                   `json:"runID"`
	ExperimentID               uint                   `json:"experimentID"`
	RunName                    string                 `json:"runName"`
	Restore                    *CheckpointRestorePlan `json:"restore,omitempty"`
	CreateJobExperimentPayload ExperimentRunConfig    `json:"createJobExperimentPayload"`
	Snapshots                  datatypes.JSONMap      `json:"snapshots"`
}

type ExperimentService struct {
	db *gorm.DB
}

func NewExperimentService() *ExperimentService {
	return &ExperimentService{db: query.GetDB()}
}

func NewExperimentServiceWithDB(db *gorm.DB) *ExperimentService {
	return &ExperimentService{db: db}
}

func OrbitAPIBase() string {
	if base := strings.TrimSpace(os.Getenv("ORBIT_API_BASE")); base != "" {
		return strings.TrimRight(base, "/")
	}
	if base := strings.TrimSpace(os.Getenv("CRATER_API_BASE")); base != "" {
		return strings.TrimRight(base, "/")
	}
	return "http://orbit-backend:8088/api/v1"
}

func (s *ExperimentService) ListExperiments(
	ctx context.Context,
	token util.JWTMessage,
	limit int,
	offset int,
) ([]model.Experiment, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var total int64
	base := s.db.WithContext(ctx).Model(&model.Experiment{}).
		Where("account_id = ? AND (visibility = ? OR user_id = ?)", token.AccountID, model.ExperimentVisibilityAccount, token.UserID)
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.Experiment
	err := base.Order("updated_at DESC").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (s *ExperimentService) CreateExperiment(
	ctx context.Context,
	input CreateExperimentInput,
) (*model.Experiment, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, fmt.Errorf("experiment name is required")
	}
	visibility := input.Visibility
	if visibility == "" {
		visibility = model.ExperimentVisibilityPrivate
	}
	exp := &model.Experiment{
		Name:        name,
		Description: input.Description,
		UserID:      input.UserID,
		AccountID:   input.AccountID,
		Visibility:  visibility,
		Tags:        safeJSONMap(input.Tags),
	}
	if err := s.db.WithContext(ctx).Create(exp).Error; err != nil {
		return nil, err
	}
	return exp, nil
}

func (s *ExperimentService) GetExperiment(
	ctx context.Context,
	id uint,
	token util.JWTMessage,
) (*model.Experiment, error) {
	var exp model.Experiment
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&exp).Error; err != nil {
		return nil, err
	}
	if !canAccessExperiment(&exp, token) {
		return nil, gorm.ErrRecordNotFound
	}
	return &exp, nil
}

func (s *ExperimentService) UpdateExperiment(
	ctx context.Context,
	id uint,
	token util.JWTMessage,
	input UpdateExperimentInput,
) (*model.Experiment, error) {
	exp, err := s.GetExperiment(ctx, id, token)
	if err != nil {
		return nil, err
	}
	if exp.UserID != token.UserID {
		return nil, fmt.Errorf("only owner can update experiment")
	}
	updates := map[string]any{}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, fmt.Errorf("experiment name is required")
		}
		updates["name"] = name
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.Visibility != nil {
		updates["visibility"] = *input.Visibility
	}
	if input.Tags != nil {
		updates["tags"] = safeJSONMap(*input.Tags)
	}
	if len(updates) > 0 {
		if err := s.db.WithContext(ctx).Model(exp).Updates(updates).Error; err != nil {
			return nil, err
		}
	}
	return s.GetExperiment(ctx, id, token)
}

func (s *ExperimentService) ListRuns(
	ctx context.Context,
	experimentID uint,
	token util.JWTMessage,
) ([]model.ExperimentRun, error) {
	if _, err := s.GetExperiment(ctx, experimentID, token); err != nil {
		return nil, err
	}
	var runs []model.ExperimentRun
	err := s.db.WithContext(ctx).
		Where("experiment_id = ?", experimentID).
		Order("created_at DESC").
		Find(&runs).Error
	return runs, err
}

func (s *ExperimentService) CreateRun(
	ctx context.Context,
	input *CreateRunInput,
) (*CreateRunResult, error) {
	if input == nil {
		return nil, fmt.Errorf("run input is required")
	}
	if input.ExperimentID == 0 {
		return nil, fmt.Errorf("experimentId is required")
	}
	var exp model.Experiment
	if err := s.db.WithContext(ctx).
		Where("id = ? AND account_id = ? AND (visibility = ? OR user_id = ?)",
			input.ExperimentID,
			input.AccountID,
			model.ExperimentVisibilityAccount,
			input.UserID,
		).First(&exp).Error; err != nil {
		return nil, err
	}

	token, tokenHash, err := newRunToken()
	if err != nil {
		return nil, err
	}
	runName := strings.TrimSpace(input.RunName)
	if runName == "" {
		runName = input.JobName
	}
	if runName == "" {
		runName = fmt.Sprintf("run-%d", time.Now().Unix())
	}

	run := &model.ExperimentRun{
		ExperimentID:       input.ExperimentID,
		ParentRunID:        input.ParentRunID,
		SourceCheckpointID: input.SourceCheckpointID,
		JobName:            input.JobName,
		RunName:            runName,
		Status:             model.ExperimentRunStatusPending,
		UserID:             input.UserID,
		AccountID:          input.AccountID,
		RunTokenHash:       tokenHash,
		Hyperparams:        safeJSONMap(input.Hyperparams),
		CodeSnapshot:       safeJSONMap(input.CodeSnapshot),
		DataSnapshot:       safeJSONMap(input.DataSnapshot),
		ImageSnapshot:      safeJSONMap(input.ImageSnapshot),
		ResourceSnapshot:   safeJSONMap(input.ResourceSnapshot),
		CheckpointSnapshot: safeJSONMap(input.CheckpointSnapshot),
		ReproduceSnapshot:  safeJSONMap(input.ReproduceSnapshot),
		Tags:               safeJSONMap(input.Tags),
	}
	if err := s.db.WithContext(ctx).Create(run).Error; err != nil {
		return nil, err
	}
	return &CreateRunResult{Run: run, Token: token}, nil
}

func (s *ExperimentService) MarkRunFailedByID(ctx context.Context, runID uint, message string) error {
	if runID == 0 {
		return nil
	}
	var run model.ExperimentRun
	if err := s.db.WithContext(ctx).Where("id = ?", runID).First(&run).Error; err != nil {
		return err
	}
	updates := map[string]any{
		"status":      model.ExperimentRunStatusFailed,
		"finished_at": time.Now(),
	}
	if message != "" {
		tags := safeJSONMap(run.Tags)
		tags["submitError"] = message
		updates["tags"] = tags
	}
	return s.db.WithContext(ctx).Model(&run).Updates(updates).Error
}

func (s *ExperimentService) GetRun(
	ctx context.Context,
	runID uint,
	token util.JWTMessage,
) (*model.ExperimentRun, error) {
	run, err := s.getAccessibleRun(ctx, runID, token)
	if err != nil {
		return nil, err
	}
	return run, nil
}

func (s *ExperimentService) VerifyRunToken(ctx context.Context, runID uint, token string) (*model.ExperimentRun, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, fmt.Errorf("run token is required")
	}
	var run model.ExperimentRun
	if err := s.db.WithContext(ctx).Where("id = ?", runID).First(&run).Error; err != nil {
		return nil, err
	}
	if run.RunTokenHash != hashRunToken(token) {
		return nil, fmt.Errorf("invalid run token")
	}
	return &run, nil
}

func (s *ExperimentService) LogMetrics(ctx context.Context, runID uint, metrics []MetricInput) error {
	if len(metrics) == 0 {
		return nil
	}
	if len(metrics) > maxMetricsPerRequest {
		return fmt.Errorf("too many metrics in one request")
	}
	now := time.Now()
	rows := make([]model.RunMetric, 0, len(metrics))
	for _, metric := range metrics {
		name := strings.TrimSpace(metric.Name)
		if name == "" {
			continue
		}
		timestamp := now
		if metric.Timestamp != nil {
			timestamp = *metric.Timestamp
		}
		rows = append(rows, model.RunMetric{
			RunID:          runID,
			ClientRecordID: optionalClientRecordID(metric.ID, metric.ClientRecordID),
			Name:           name,
			Step:           metric.Step,
			Value:          metric.Value,
			Timestamp:      timestamp,
			Context:        safeJSONMap(metric.Context),
		})
	}
	if len(rows) == 0 {
		return nil
	}
	clientRows := make([]model.RunMetric, 0, len(rows))
	plainRows := make([]model.RunMetric, 0, len(rows))
	for i := range rows {
		if rows[i].ClientRecordID != nil {
			clientRows = append(clientRows, rows[i])
		} else {
			plainRows = append(plainRows, rows[i])
		}
	}
	db := s.db.WithContext(ctx)
	if len(clientRows) > 0 {
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "run_id"}, {Name: "client_record_id"}},
			DoNothing: true,
		}).Create(&clientRows).Error; err != nil {
			return err
		}
	}
	if len(plainRows) > 0 {
		return db.Create(&plainRows).Error
	}
	return nil
}

func (s *ExperimentService) createArtifact(ctx context.Context, artifact *model.RunArtifact) error {
	if artifact.ClientRecordID != nil {
		return s.db.WithContext(ctx).Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "run_id"}, {Name: "client_record_id"}},
			DoNothing: true,
		}).Create(artifact).Error
	}
	return s.db.WithContext(ctx).Create(artifact).Error
}

func (s *ExperimentService) ListMetrics(
	ctx context.Context,
	runID uint,
	token util.JWTMessage,
	opts ...MetricListQuery,
) ([]model.RunMetric, error) {
	if _, err := s.GetRun(ctx, runID, token); err != nil {
		return nil, err
	}
	metricQuery := MetricListQuery{}
	if len(opts) > 0 {
		metricQuery = opts[0]
	}
	names := normalizeMetricNames(metricQuery.Names)
	limit := normalizeMetricLimit(metricQuery.Limit)
	var metrics []model.RunMetric
	db := s.db.WithContext(ctx).
		Where("run_id = ?", runID)
	if len(names) > 0 {
		db = db.Where("name IN ?", names)
	}
	if metricQuery.StartStep != nil {
		db = db.Where("step >= ?", *metricQuery.StartStep)
	}
	if metricQuery.EndStep != nil {
		db = db.Where("step <= ?", *metricQuery.EndStep)
	}
	if err := db.
		Order("name ASC, step ASC, timestamp ASC").
		Limit(limit).
		Find(&metrics).Error; err != nil {
		return nil, err
	}
	return downsampleMetrics(metrics, normalizeMetricDownsample(metricQuery.Downsample)), nil
}

func (s *ExperimentService) MergeParams(ctx context.Context, runID uint, params datatypes.JSONMap) error {
	return s.mergeRunJSONMap(ctx, runID, "hyperparams", params, func(run *model.ExperimentRun) datatypes.JSONMap {
		return run.Hyperparams
	})
}

func (s *ExperimentService) MergeTags(ctx context.Context, runID uint, tags datatypes.JSONMap) error {
	return s.mergeRunJSONMap(ctx, runID, "tags", tags, func(run *model.ExperimentRun) datatypes.JSONMap {
		return run.Tags
	})
}

func (s *ExperimentService) mergeRunJSONMap(
	ctx context.Context,
	runID uint,
	column string,
	values datatypes.JSONMap,
	current func(*model.ExperimentRun) datatypes.JSONMap,
) error {
	if len(values) == 0 {
		return nil
	}
	var run model.ExperimentRun
	if err := s.db.WithContext(ctx).Where("id = ?", runID).First(&run).Error; err != nil {
		return err
	}
	next := safeJSONMap(current(&run))
	for key, value := range values {
		next[key] = value
	}
	return s.db.WithContext(ctx).Model(&run).Update(column, next).Error
}

func (s *ExperimentService) CreateArtifact(ctx context.Context, runID uint, input *ArtifactInput) (*model.RunArtifact, error) {
	if input == nil {
		return nil, fmt.Errorf("artifact input is required")
	}
	name := strings.TrimSpace(input.Name)
	path := strings.TrimSpace(input.Path)
	if name == "" {
		return nil, fmt.Errorf("artifact name is required")
	}
	if path == "" {
		return nil, fmt.Errorf("artifact path is required")
	}
	artifactType := strings.TrimSpace(input.Type)
	if artifactType == "" {
		artifactType = "file"
	}
	artifact := &model.RunArtifact{
		RunID:          runID,
		ClientRecordID: optionalClientRecordID(input.ID, input.ClientRecordID),
		Name:           name,
		Type:           artifactType,
		Path:           path,
		SizeBytes:      input.SizeBytes,
		SourceType:     strings.TrimSpace(input.SourceType),
		SourceID:       input.SourceID,
		Metadata:       safeJSONMap(input.Metadata),
	}
	if err := s.createArtifact(ctx, artifact); err != nil {
		return nil, err
	}
	return artifact, nil
}

func (s *ExperimentService) UpsertCheckpointArtifact(
	ctx context.Context,
	runID uint,
	checkpoint *model.JobCheckpoint,
) error {
	if runID == 0 || checkpoint == nil || checkpoint.ID == 0 {
		return nil
	}
	metadata := safeJSONMap(checkpoint.Metadata)
	metadata["framework"] = checkpoint.Framework
	metadata["step"] = checkpoint.Step
	metadata["latest"] = checkpoint.Latest
	metadata["storagePath"] = checkpoint.StoragePath
	metadata["modTime"] = checkpoint.ModTime
	metadata["jobName"] = checkpoint.JobName
	artifact := model.RunArtifact{
		RunID:      runID,
		Name:       checkpoint.Name,
		Type:       "checkpoint",
		Path:       checkpoint.Path,
		SizeBytes:  checkpoint.SizeBytes,
		SourceType: "checkpoint",
		SourceID:   &checkpoint.ID,
		Metadata:   metadata,
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "source_type"}, {Name: "source_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name",
			"path",
			"size_bytes",
			"metadata",
			"updated_at",
		}),
	}).Create(&artifact).Error
}

func (s *ExperimentService) ListArtifacts(ctx context.Context, runID uint, token util.JWTMessage) ([]model.RunArtifact, error) {
	if _, err := s.GetRun(ctx, runID, token); err != nil {
		return nil, err
	}
	var artifacts []model.RunArtifact
	err := s.db.WithContext(ctx).
		Where("run_id = ?", runID).
		Order("created_at DESC").
		Find(&artifacts).Error
	return artifacts, err
}

func (s *ExperimentService) ReproduceRun(
	ctx context.Context,
	runID uint,
	token util.JWTMessage,
	nameOverride string,
) (*ReproduceRunResult, error) {
	run, err := s.getAccessibleRun(ctx, runID, token)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(nameOverride)
	if name == "" {
		name = strings.TrimSpace(run.RunName) + "-reproduce"
	}
	if name == "-reproduce" {
		name = fmt.Sprintf("run-%d-reproduce", run.ID)
	}
	result := &ReproduceRunResult{
		Mode:         "snapshot",
		RunID:        run.ID,
		ExperimentID: run.ExperimentID,
		RunName:      name,
		CreateJobExperimentPayload: ExperimentRunConfig{
			ExperimentID: run.ExperimentID,
			RunName:      name,
			Hyperparams:  safeJSONMap(run.Hyperparams),
			Code:         safeJSONMap(run.CodeSnapshot),
			Data:         safeJSONMap(run.DataSnapshot),
			Image:        safeJSONMap(run.ImageSnapshot),
			Tags:         safeJSONMap(run.Tags),
		},
		Snapshots: datatypes.JSONMap{
			"hyperparams": safeJSONMap(run.Hyperparams),
			"code":        safeJSONMap(run.CodeSnapshot),
			"data":        safeJSONMap(run.DataSnapshot),
			"image":       safeJSONMap(run.ImageSnapshot),
			"resource":    safeJSONMap(run.ResourceSnapshot),
			"checkpoint":  safeJSONMap(run.CheckpointSnapshot),
			"reproduce":   safeJSONMap(run.ReproduceSnapshot),
		},
	}
	restore, err := s.checkpointRestorePlanForRun(ctx, run, name)
	if err != nil {
		return nil, err
	}
	if restore != nil {
		result.Mode = "checkpoint-restore"
		result.Restore = restore
	}
	return result, nil
}

func (s *ExperimentService) FinishRun(ctx context.Context, runID uint, status model.ExperimentRunStatus) error {
	switch status {
	case model.ExperimentRunStatusSucceeded,
		model.ExperimentRunStatusFailed,
		model.ExperimentRunStatusTerminated,
		model.ExperimentRunStatusCancelled:
	default:
		return fmt.Errorf("invalid finish status: %s", status)
	}
	return s.db.WithContext(ctx).Model(&model.ExperimentRun{}).
		Where("id = ?", runID).
		Updates(map[string]any{
			"status":      status,
			"finished_at": time.Now(),
		}).Error
}

func (s *ExperimentService) SyncRunForJob(ctx context.Context, job *model.Job) error {
	if job == nil || job.JobName == "" {
		return nil
	}
	status := runStatusFromJobPhase(job.Status)
	updates := map[string]any{
		"job_id":     job.ID,
		"status":     status,
		"updated_at": time.Now(),
	}
	if !job.RunningTimestamp.IsZero() {
		updates["started_at"] = job.RunningTimestamp
	}
	if !job.CompletedTimestamp.IsZero() {
		updates["finished_at"] = job.CompletedTimestamp
	}
	if job.Checkpoint != nil {
		updates["checkpoint_snapshot"] = checkpointInfoToMap(job.Checkpoint.Data())
	}
	return s.db.WithContext(ctx).Model(&model.ExperimentRun{}).
		Where("job_name = ?", job.JobName).
		Updates(updates).Error
}

func normalizeMetricNames(values []string) []string {
	seen := map[string]struct{}{}
	names := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			name := strings.TrimSpace(part)
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			names = append(names, name)
		}
	}
	return names
}

func normalizeMetricLimit(limit int) int {
	if limit <= 0 {
		return defaultMetricQueryLimit
	}
	if limit > maxMetricQueryLimit {
		return maxMetricQueryLimit
	}
	return limit
}

func normalizeMetricDownsample(downsample int) int {
	if downsample <= 0 {
		return 0
	}
	if downsample > maxMetricDownsample {
		return maxMetricDownsample
	}
	return downsample
}

func downsampleMetrics(metrics []model.RunMetric, maxPointsPerMetric int) []model.RunMetric {
	if maxPointsPerMetric <= 0 || len(metrics) <= maxPointsPerMetric {
		return metrics
	}
	grouped := make(map[string][]model.RunMetric)
	order := make([]string, 0)
	for i := range metrics {
		if _, ok := grouped[metrics[i].Name]; !ok {
			order = append(order, metrics[i].Name)
		}
		grouped[metrics[i].Name] = append(grouped[metrics[i].Name], metrics[i])
	}
	result := make([]model.RunMetric, 0, len(metrics))
	for _, name := range order {
		group := grouped[name]
		if len(group) <= maxPointsPerMetric {
			result = append(result, group...)
			continue
		}
		if maxPointsPerMetric == 1 {
			result = append(result, group[len(group)-1])
			continue
		}
		lastIndex := -1
		for i := 0; i < maxPointsPerMetric; i++ {
			index := i * (len(group) - 1) / (maxPointsPerMetric - 1)
			if index == lastIndex {
				continue
			}
			result = append(result, group[index])
			lastIndex = index
		}
	}
	return result
}

func (s *ExperimentService) checkpointRestorePlanForRun(
	ctx context.Context,
	run *model.ExperimentRun,
	name string,
) (*CheckpointRestorePlan, error) {
	if run == nil {
		return nil, nil
	}
	if plan, err := s.checkpointRestorePlanFromArtifacts(ctx, run.ID, name); err != nil || plan != nil {
		return plan, err
	}
	if run.SourceCheckpointID == nil || *run.SourceCheckpointID == 0 {
		return nil, nil
	}
	var checkpoint model.JobCheckpoint
	if err := s.db.WithContext(ctx).
		Where("id = ? AND account_id = ?", *run.SourceCheckpointID, run.AccountID).
		First(&checkpoint).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return checkpointToRestorePlan(&checkpoint, name), nil
}

func (s *ExperimentService) checkpointRestorePlanFromArtifacts(
	ctx context.Context,
	runID uint,
	name string,
) (*CheckpointRestorePlan, error) {
	var artifacts []model.RunArtifact
	if err := s.db.WithContext(ctx).
		Where("run_id = ? AND type = ? AND source_type = ? AND source_id IS NOT NULL", runID, "checkpoint", "checkpoint").
		Order("updated_at DESC").
		Find(&artifacts).Error; err != nil {
		return nil, err
	}
	if len(artifacts) == 0 {
		return nil, nil
	}
	selected := selectCheckpointArtifact(artifacts)
	if selected == nil || selected.SourceID == nil || *selected.SourceID == 0 {
		return nil, nil
	}
	jobName := stringFromJSON(selected.Metadata, "jobName")
	if jobName == "" {
		var checkpoint model.JobCheckpoint
		if err := s.db.WithContext(ctx).Where("id = ?", *selected.SourceID).First(&checkpoint).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, nil
			}
			return nil, err
		}
		return checkpointToRestorePlan(&checkpoint, name), nil
	}
	return &CheckpointRestorePlan{
		JobName:        jobName,
		CheckpointID:   *selected.SourceID,
		Name:           name,
		CheckpointPath: selected.Path,
	}, nil
}

func selectCheckpointArtifact(artifacts []model.RunArtifact) *model.RunArtifact {
	if len(artifacts) == 0 {
		return nil
	}
	selected := 0
	for i := range artifacts {
		if boolFromJSON(artifacts[i].Metadata, "latest") {
			return &artifacts[i]
		}
		if numericFromJSON(artifacts[i].Metadata, "step") > numericFromJSON(artifacts[selected].Metadata, "step") {
			selected = i
		}
	}
	return &artifacts[selected]
}

func checkpointToRestorePlan(checkpoint *model.JobCheckpoint, name string) *CheckpointRestorePlan {
	if checkpoint == nil || checkpoint.ID == 0 || checkpoint.JobName == "" {
		return nil
	}
	return &CheckpointRestorePlan{
		JobName:        checkpoint.JobName,
		CheckpointID:   checkpoint.ID,
		Name:           name,
		CheckpointPath: checkpoint.Path,
	}
}

func stringFromJSON(value datatypes.JSONMap, key string) string {
	raw, ok := value[key]
	if !ok {
		return ""
	}
	text, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func boolFromJSON(value datatypes.JSONMap, key string) bool {
	raw, ok := value[key]
	if !ok {
		return false
	}
	text, ok := raw.(bool)
	return ok && text
}

func numericFromJSON(value datatypes.JSONMap, key string) float64 {
	raw, ok := value[key]
	if !ok {
		return -1
	}
	switch typed := raw.(type) {
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case float64:
		return typed
	case float32:
		return float64(typed)
	default:
		return -1
	}
}

func canAccessExperiment(exp *model.Experiment, token util.JWTMessage) bool {
	if exp.AccountID != token.AccountID {
		return false
	}
	return exp.Visibility == model.ExperimentVisibilityAccount || exp.UserID == token.UserID || token.RolePlatform == model.RoleAdmin
}

func (s *ExperimentService) getAccessibleRun(
	ctx context.Context,
	runID uint,
	token util.JWTMessage,
) (*model.ExperimentRun, error) {
	var run model.ExperimentRun
	if err := s.db.WithContext(ctx).Preload("Experiment").Where("id = ?", runID).First(&run).Error; err != nil {
		return nil, err
	}
	if token.RolePlatform == model.RoleAdmin {
		return &run, nil
	}
	if run.AccountID != token.AccountID || run.Experiment.AccountID != token.AccountID {
		return nil, gorm.ErrRecordNotFound
	}
	if run.UserID == token.UserID || run.Experiment.Visibility == model.ExperimentVisibilityAccount {
		return &run, nil
	}
	return nil, gorm.ErrRecordNotFound
}

func safeJSONMap(value datatypes.JSONMap) datatypes.JSONMap {
	if value == nil {
		return datatypes.JSONMap{}
	}
	return value
}

func optionalClientRecordID(values ...string) *string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return &value
		}
	}
	return nil
}

func newRunToken() (token, tokenHash string, err error) {
	raw := make([]byte, runTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, hashRunToken(token), nil
}

func hashRunToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func runStatusFromJobPhase(phase batch.JobPhase) model.ExperimentRunStatus {
	switch phase {
	case batch.Running, batch.Restarting:
		return model.ExperimentRunStatusRunning
	case batch.Completed:
		return model.ExperimentRunStatusSucceeded
	case batch.Failed:
		return model.ExperimentRunStatusFailed
	case batch.Aborted, batch.Terminated:
		return model.ExperimentRunStatusTerminated
	default:
		return model.ExperimentRunStatusPending
	}
}

func checkpointInfoToMap(info *model.CheckpointInfo) datatypes.JSONMap {
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

func IsRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
