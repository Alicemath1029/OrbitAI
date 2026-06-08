package checkpoint

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/dao/query"
	"github.com/raids-lab/orbit/internal/storage"
)

const (
	unknownCheckpointStep            int64 = -1
	latestCheckpointTracker                = "latest_checkpointed_iteration.txt"
	latestCheckpointTrackerReadLimit       = 1024
)

var stepPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^checkpoint[-_](\d+)(?:$|[-_.])`),
	regexp.MustCompile(`(?i)^global_step[_-]?(\d+)(?:$|[-_.])`),
	regexp.MustCompile(`(?i)(?:^|[-_])step[-_]?(\d+)(?:$|[-_.])`),
}

type ScanResult struct {
	Items          []model.JobCheckpoint `json:"items"`
	Latest         *model.JobCheckpoint  `json:"latest,omitempty"`
	TotalSizeBytes int64                 `json:"totalSizeBytes"`
	ScannedAt      time.Time             `json:"scannedAt"`
	StoragePath    string                `json:"storagePath"`
}

func ScanJob(ctx context.Context, record *model.Job) (*ScanResult, error) {
	info, storagePath, err := prepareScan(record)
	if err != nil {
		return nil, err
	}

	root, err := storage.StatRelativePath(ctx, storagePath)
	if err != nil {
		return nil, fmt.Errorf("checkpoint directory is not accessible: %w", err)
	}

	candidates, err := discoverCheckpoints(ctx, record, info, storagePath, root)
	if err != nil {
		return nil, err
	}

	return finishScan(ctx, record, info, storagePath, candidates)
}

func prepareScan(record *model.Job) (*model.CheckpointInfo, string, error) {
	if record == nil {
		return nil, "", errors.New("job record is required")
	}
	info := jobCheckpointInfo(record)
	if info == nil || !info.Enabled {
		return nil, "", fmt.Errorf("checkpoint is not enabled for job %s", record.JobName)
	}

	storagePath, err := ResolveStoragePath(record, info.CheckpointDir)
	if err != nil {
		return nil, "", err
	}
	return info, storagePath, nil
}

func finishScan(
	ctx context.Context,
	record *model.Job,
	info *model.CheckpointInfo,
	storagePath string,
	candidates []model.JobCheckpoint,
) (*ScanResult, error) {
	latest := latestCheckpoint(candidates)
	for i := range candidates {
		candidates[i].Latest = latest != nil && candidates[i].Path == latest.Path
	}
	if latest != nil {
		latest.Latest = true
	}
	if err := persistScan(ctx, record, info, candidates, latest); err != nil {
		return nil, err
	}

	totalSize := int64(0)
	for i := range candidates {
		totalSize += candidates[i].SizeBytes
	}
	scannedAt := time.Now()
	result := &ScanResult{
		Items:          candidates,
		Latest:         latest,
		TotalSizeBytes: totalSize,
		ScannedAt:      scannedAt,
		StoragePath:    storagePath,
	}
	return result, nil
}

func ResolveStoragePath(record *model.Job, containerPath string) (string, error) {
	if record == nil || record.Attributes.Data() == nil {
		return "", errors.New("job record has no stored template")
	}
	containerPath = filepath.Clean(strings.TrimSpace(containerPath))
	if containerPath == "." || !filepath.IsAbs(containerPath) {
		return "", fmt.Errorf("checkpoint path %q must be absolute", containerPath)
	}

	bestMountPath, bestSubPath := bestWritableMount(record, containerPath)
	if bestMountPath == "" {
		return "", fmt.Errorf("checkpoint path %s is not under a writable persistent mount", containerPath)
	}

	rel, err := filepath.Rel(bestMountPath, containerPath)
	if err != nil {
		return "", err
	}
	if rel == "." {
		return filepath.ToSlash(filepath.Clean(bestSubPath)), nil
	}
	return filepath.ToSlash(filepath.Clean(filepath.Join(bestSubPath, rel))), nil
}

func bestWritableMount(record *model.Job, containerPath string) (mountPath, subPath string) {
	var bestMountPath string
	var bestSubPath string
	tasks := record.Attributes.Data().Spec.Tasks
	for taskIndex := range tasks {
		containers := tasks[taskIndex].Template.Spec.Containers
		for containerIndex := range containers {
			mounts := containers[containerIndex].VolumeMounts
			for mountIndex := range mounts {
				mount := &mounts[mountIndex]
				mountPath := filepath.Clean(strings.TrimSpace(mount.MountPath))
				if mountPath == "." || mount.SubPath == "" || mount.ReadOnly {
					continue
				}
				if !isPathUnderOrEqual(containerPath, mountPath) {
					continue
				}
				if len(mountPath) > len(bestMountPath) {
					bestMountPath = mountPath
					bestSubPath = mount.SubPath
				}
			}
		}
	}
	return bestMountPath, bestSubPath
}

func discoverCheckpoints(
	ctx context.Context,
	record *model.Job,
	info *model.CheckpointInfo,
	storagePath string,
	root storage.Files,
) ([]model.JobCheckpoint, error) {
	if !root.IsDir {
		size, modTime, err := scanTree(ctx, storagePath)
		if err != nil {
			return nil, err
		}
		item := newCheckpointRecord(record, info, filepath.Base(storagePath), info.CheckpointDir, storagePath, size, modTime)
		if manifest, manifestStoragePath, manifestErr := loadStorageCheckpointManifest(ctx, storagePath); manifestErr != nil {
			applyManifestParseErrorToCheckpoint(&item, manifestStoragePath, manifestErr)
		} else if manifest != nil {
			applyManifestToCheckpoint(&item, manifest, manifestStoragePath)
			applyManifestValidationToCheckpoint(&item, validateCheckpointManifest(ctx, manifest, manifestValidationTarget{
				ActualSize: size,
				JobName:    record.JobName,
				RunID:      item.RunID,
			}))
		}
		return []model.JobCheckpoint{item}, nil
	}

	children, err := storage.ListRelativePath(ctx, storagePath)
	if err != nil {
		return nil, err
	}

	items := make([]model.JobCheckpoint, 0, len(children))
	seen := make(map[string]struct{}, len(children))
	for _, child := range children {
		if strings.HasSuffix(child.Name, checkpointManifestSuffix) {
			targetName := strings.TrimSuffix(child.Name, checkpointManifestSuffix)
			if targetName == "" {
				continue
			}
			if _, ok := seen[targetName]; ok {
				continue
			}
			item, err := checkpointFromStoragePath(ctx, record, info, storagePath, targetName)
			if err != nil {
				continue
			}
			items = append(items, item)
			seen[targetName] = struct{}{}
			continue
		}
		if shouldSkipCheckpointChild(child.Name) {
			continue
		}
		if !looksLikeCheckpoint(info.Framework, child) {
			continue
		}
		if _, ok := seen[child.Name]; ok {
			continue
		}
		item, err := checkpointFromStoragePath(ctx, record, info, storagePath, child.Name)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
		seen[child.Name] = struct{}{}
	}
	markLatestFromTracker(ctx, storagePath, items)
	return items, nil
}

func checkpointFromStoragePath(
	ctx context.Context,
	record *model.Job,
	info *model.CheckpointInfo,
	storagePath string,
	name string,
) (model.JobCheckpoint, error) {
	childStoragePath := filepath.ToSlash(filepath.Join(storagePath, name))
	childContainerPath := filepath.ToSlash(filepath.Join(info.CheckpointDir, name))
	stat, err := storage.StatRelativePath(ctx, childStoragePath)
	if err != nil {
		return model.JobCheckpoint{}, err
	}
	size, modTime, err := scanTree(ctx, childStoragePath)
	if err != nil {
		return model.JobCheckpoint{}, err
	}
	if modTime.IsZero() {
		modTime = stat.ModifyTime
	}
	item := newCheckpointRecord(record, info, name, childContainerPath, childStoragePath, size, modTime)
	if manifest, manifestStoragePath, manifestErr := loadStorageCheckpointManifest(ctx, childStoragePath); manifestErr != nil {
		applyManifestParseErrorToCheckpoint(&item, manifestStoragePath, manifestErr)
	} else if manifest != nil {
		applyManifestToCheckpoint(&item, manifest, manifestStoragePath)
		applyManifestValidationToCheckpoint(&item, validateCheckpointManifest(ctx, manifest, manifestValidationTarget{
			ActualSize: size,
			JobName:    record.JobName,
			RunID:      item.RunID,
		}))
	}
	return item, nil
}

func shouldSkipCheckpointChild(name string) bool {
	return name == "" ||
		strings.HasPrefix(name, ".") ||
		strings.HasPrefix(name, "_tmp") ||
		strings.HasSuffix(name, ".tmp") ||
		strings.HasSuffix(name, checkpointManifestSuffix)
}

func looksLikeCheckpoint(framework string, file storage.Files) bool {
	if stepFromName(file.Name) >= 0 {
		return true
	}
	switch strings.ToLower(framework) {
	case FrameworkPytorch, FrameworkLightning, FrameworkFSDP:
		return !file.IsDir && hasCheckpointFileExt(file.Name)
	case FrameworkTensorFlow, FrameworkJAX:
		return file.IsDir || hasCheckpointFileExt(file.Name) || strings.HasSuffix(file.Name, ".pkl")
	case FrameworkCustom:
		return file.IsDir || hasCheckpointFileExt(file.Name)
	default:
		return file.IsDir
	}
}

func hasCheckpointFileExt(name string) bool {
	return strings.HasSuffix(name, ".pt") ||
		strings.HasSuffix(name, ".pth") ||
		strings.HasSuffix(name, ".ckpt")
}

func scanTree(ctx context.Context, root string) (int64, time.Time, error) {
	stat, err := storage.StatRelativePath(ctx, root)
	if err != nil {
		return 0, time.Time{}, err
	}
	if !stat.IsDir {
		return stat.Size, stat.ModifyTime, nil
	}

	children, err := storage.ListRelativePath(ctx, root)
	if err != nil {
		return 0, time.Time{}, err
	}
	size := int64(0)
	modTime := stat.ModifyTime
	for _, child := range children {
		childPath := filepath.ToSlash(filepath.Join(root, child.Name))
		childSize, childModTime, err := scanTree(ctx, childPath)
		if err != nil {
			return 0, time.Time{}, err
		}
		size += childSize
		if childModTime.After(modTime) {
			modTime = childModTime
		}
	}
	return size, modTime, nil
}

func loadStorageCheckpointManifest(ctx context.Context, storagePath string) (*checkpointManifest, string, error) {
	manifestStoragePath := manifestPathForCheckpoint(storagePath)
	data, err := storage.ReadRelativePath(ctx, manifestStoragePath, checkpointManifestReadLimit)
	if err != nil {
		return nil, "", nil
	}
	manifest, err := parseCheckpointManifest(data)
	if err != nil {
		return nil, manifestStoragePath, err
	}
	return manifest, manifestStoragePath, nil
}

func newCheckpointRecord(
	record *model.Job,
	info *model.CheckpointInfo,
	name string,
	path string,
	storagePath string,
	size int64,
	modTime time.Time,
) model.JobCheckpoint {
	runID := experimentRunIDFromRecord(record)
	return model.JobCheckpoint{
		JobID:       record.ID,
		RunID:       runID,
		JobName:     record.JobName,
		UserID:      record.UserID,
		AccountID:   record.AccountID,
		Framework:   info.Framework,
		Name:        name,
		Path:        filepath.ToSlash(filepath.Clean(path)),
		StoragePath: filepath.ToSlash(filepath.Clean(storagePath)),
		Step:        stepFromName(name),
		SizeBytes:   size,
		ModTime:     modTime,
		Status:      model.JobCheckpointStatusReady,
		Source:      "scan",
		Metadata: datatypes.JSONMap{
			"checkpointDir": info.CheckpointDir,
		},
	}
}

func experimentRunIDFromRecord(record *model.Job) *uint {
	if record == nil || record.Attributes.Data() == nil || record.Attributes.Data().Annotations == nil {
		return nil
	}
	raw := strings.TrimSpace(record.Attributes.Data().Annotations["orbit.raids.io/experiment-run-id"])
	if raw == "" {
		return nil
	}
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		return nil
	}
	value := uint(id)
	return &value
}

func stepFromName(name string) int64 {
	for _, pattern := range stepPatterns {
		matches := pattern.FindStringSubmatch(name)
		if len(matches) < 2 {
			continue
		}
		step, err := strconv.ParseInt(matches[1], 10, 64)
		if err == nil {
			return step
		}
	}
	return unknownCheckpointStep
}

func latestCheckpoint(items []model.JobCheckpoint) *model.JobCheckpoint {
	if len(items) == 0 {
		return nil
	}
	sorted := make([]model.JobCheckpoint, 0, len(items))
	for i := range items {
		if items[i].Status == model.JobCheckpointStatusReady {
			sorted = append(sorted, items[i])
		}
	}
	if len(sorted) == 0 {
		return nil
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		iTracked := isTrackerLatest(&sorted[i])
		jTracked := isTrackerLatest(&sorted[j])
		if iTracked != jTracked {
			return iTracked
		}
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

func markLatestFromTracker(ctx context.Context, storagePath string, items []model.JobCheckpoint) {
	if len(items) == 0 {
		return
	}
	trackerPath := filepath.ToSlash(filepath.Join(storagePath, latestCheckpointTracker))
	data, err := storage.ReadRelativePath(ctx, trackerPath, latestCheckpointTrackerReadLimit)
	if err != nil {
		return
	}
	marker := strings.TrimSpace(string(data))
	if marker == "" {
		return
	}
	markerStep := latestMarkerStep(marker)
	for i := range items {
		if items[i].Status != model.JobCheckpointStatusReady {
			continue
		}
		if checkpointMatchesTracker(&items[i], marker, markerStep) {
			if items[i].Metadata == nil {
				items[i].Metadata = datatypes.JSONMap{}
			}
			items[i].Metadata["trackedLatest"] = true
			items[i].Metadata["latestTracker"] = latestCheckpointTracker
			return
		}
	}
}

func checkpointMatchesTracker(item *model.JobCheckpoint, marker string, markerStep int64) bool {
	marker = strings.TrimSpace(marker)
	if item == nil || marker == "" {
		return false
	}
	if item.Name == marker || item.Path == marker || item.StoragePath == marker {
		return true
	}
	if filepath.Base(marker) == item.Name {
		return true
	}
	if markerStep >= 0 && item.Step == markerStep {
		return true
	}
	return false
}

func latestMarkerStep(marker string) int64 {
	marker = strings.TrimSpace(marker)
	if marker == "" {
		return unknownCheckpointStep
	}
	if step := stepFromName(marker); step >= 0 {
		return step
	}
	if step, err := strconv.ParseInt(strings.TrimPrefix(strings.ToLower(marker), "global_step_"), 10, 64); err == nil {
		return step
	}
	return unknownCheckpointStep
}

func isTrackerLatest(item *model.JobCheckpoint) bool {
	if item == nil || item.Metadata == nil {
		return false
	}
	tracked, ok := item.Metadata["trackedLatest"].(bool)
	return ok && tracked
}

func persistScan(
	ctx context.Context,
	record *model.Job,
	info *model.CheckpointInfo,
	items []model.JobCheckpoint,
	latest *model.JobCheckpoint,
) error {
	db := query.GetDB().WithContext(ctx)
	now := time.Now()
	seenPaths := make([]string, 0, len(items))
	for i := range items {
		item := &items[i]
		seenPaths = append(seenPaths, item.Path)
		if err := db.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "job_id"}, {Name: "path"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"job_name",
				"user_id",
				"account_id",
				"framework",
				"name",
				"storage_path",
				"step",
				"size_bytes",
				"mod_time",
				"status",
				"latest",
				"source",
				"metadata",
				"updated_at",
			}),
		}).Create(item).Error; err != nil {
			return err
		}
		if item.RunID != nil {
			if err := db.Model(&model.JobCheckpoint{}).
				Where("job_id = ? AND path = ? AND run_id IS NULL", record.ID, item.Path).
				Update("run_id", *item.RunID).Error; err != nil {
				return err
			}
		}
	}

	missingQuery := db.Model(&model.JobCheckpoint{}).Where("job_id = ? AND status = ?", record.ID, model.JobCheckpointStatusReady)
	if len(seenPaths) > 0 {
		missingQuery = missingQuery.Where("path NOT IN ?", seenPaths)
	}
	if err := missingQuery.Updates(map[string]any{
		"status":     model.JobCheckpointStatusMissing,
		"latest":     false,
		"updated_at": now,
	}).Error; err != nil {
		return err
	}

	info.LastScannedAt = now
	if latest != nil {
		info.LatestCheckpoint = latest.Path
	} else {
		info.LatestCheckpoint = ""
	}
	record.Checkpoint = ptrToJSON(info)
	if err := db.Model(&model.Job{}).Where("id = ?", record.ID).Update("checkpoint", datatypes.NewJSONType(info)).Error; err != nil {
		return err
	}
	return SyncCheckpointArtifacts(ctx, db, record.ID)
}

func SyncCheckpointArtifacts(ctx context.Context, db *gorm.DB, jobID uint) error {
	if jobID == 0 {
		return nil
	}
	var items []model.JobCheckpoint
	if err := db.WithContext(ctx).
		Where("job_id = ?", jobID).
		Find(&items).Error; err != nil {
		return err
	}

	staleSourceIDs := make([]uint, 0)
	for i := range items {
		item := &items[i]
		if item.ID == 0 {
			continue
		}
		if item.Status == model.JobCheckpointStatusReady && item.RunID != nil && *item.RunID != 0 {
			if err := upsertCheckpointArtifact(ctx, db, item); err != nil {
				return err
			}
			continue
		}
		staleSourceIDs = append(staleSourceIDs, item.ID)
	}
	if len(staleSourceIDs) > 0 {
		if err := db.WithContext(ctx).
			Unscoped().
			Where("source_type = ? AND source_id IN ?", "checkpoint", staleSourceIDs).
			Delete(&model.RunArtifact{}).Error; err != nil {
			return err
		}
	}
	return nil
}

func upsertCheckpointArtifact(ctx context.Context, db *gorm.DB, checkpoint *model.JobCheckpoint) error {
	if checkpoint == nil || checkpoint.ID == 0 || checkpoint.RunID == nil || *checkpoint.RunID == 0 {
		return nil
	}
	sourceID := checkpoint.ID
	metadata := cloneJSONMap(checkpoint.Metadata)
	metadata["framework"] = checkpoint.Framework
	metadata["step"] = checkpoint.Step
	metadata["latest"] = checkpoint.Latest
	metadata["storagePath"] = checkpoint.StoragePath
	metadata["modTime"] = checkpoint.ModTime
	metadata["jobName"] = checkpoint.JobName
	artifact := model.RunArtifact{
		RunID:      *checkpoint.RunID,
		Name:       checkpoint.Name,
		Type:       "checkpoint",
		Path:       checkpoint.Path,
		SizeBytes:  checkpoint.SizeBytes,
		SourceType: "checkpoint",
		SourceID:   &sourceID,
		Metadata:   metadata,
	}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "source_type"}, {Name: "source_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"run_id",
			"name",
			"path",
			"size_bytes",
			"metadata",
			"updated_at",
		}),
	}).Create(&artifact).Error
}

func cloneJSONMap(value datatypes.JSONMap) datatypes.JSONMap {
	next := datatypes.JSONMap{}
	for key, item := range value {
		next[key] = item
	}
	return next
}

func jobCheckpointInfo(record *model.Job) *model.CheckpointInfo {
	if record == nil || record.Checkpoint == nil {
		return nil
	}
	return record.Checkpoint.Data()
}

func ptrToJSON(info *model.CheckpointInfo) *datatypes.JSONType[*model.CheckpointInfo] {
	value := datatypes.NewJSONType(info)
	return &value
}
