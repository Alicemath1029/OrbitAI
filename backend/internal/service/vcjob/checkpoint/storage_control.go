package checkpoint

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/datatypes"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/internal/storage"
)

func DeleteCheckpointStorageWithControl(ctx context.Context, checkpoint *model.JobCheckpoint) error {
	err := DeleteCheckpointStorage(ctx, checkpoint, ServiceScannerOptions{})
	if err == nil {
		return nil
	}

	if checkpointScannerFallbackEnabled() &&
		(errors.Is(err, errServiceScannerDisabled) || checkpointScannerServiceError(err)) {
		if localErr := deleteCheckpointStorageLocal(ctx, checkpoint); localErr == nil {
			return nil
		} else if errors.Is(err, errServiceScannerDisabled) {
			return fmt.Errorf("checkpoint scanner service is not configured and local delete fallback failed: %w", localErr)
		} else {
			return fmt.Errorf("%w; local delete fallback also failed: %v", err, localErr)
		}
	}

	if errors.Is(err, errServiceScannerDisabled) {
		return fmt.Errorf("%w; set ORBIT_CHECKPOINT_SCANNER_FALLBACK=local to use backend storage fallback", err)
	}
	if checkpointScannerServiceError(err) {
		return fmt.Errorf("%w; set ORBIT_CHECKPOINT_SCANNER_FALLBACK=local to use backend storage fallback", err)
	}
	return err
}

func deleteCheckpointStorageLocal(ctx context.Context, checkpoint *model.JobCheckpoint) error {
	if checkpoint == nil {
		return errors.New("checkpoint is required")
	}
	storagePath := strings.TrimSpace(checkpoint.StoragePath)
	if storagePath == "" {
		return errors.New("checkpoint has no storage path")
	}
	if err := removeStorageRelativePath(ctx, storagePath); err != nil {
		return err
	}
	if err := removeStorageRelativePath(ctx, manifestPathForCheckpoint(storagePath)); err != nil {
		return err
	}
	return removeMatchingStorageLatestMarker(ctx, checkpoint)
}

func removeStorageRelativePath(ctx context.Context, path string) error {
	if err := storage.RemoveRelativePath(ctx, path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func removeMatchingStorageLatestMarker(ctx context.Context, checkpoint *model.JobCheckpoint) error {
	if checkpoint == nil || strings.TrimSpace(checkpoint.StoragePath) == "" {
		return nil
	}
	markerPath := filepath.ToSlash(filepath.Join(filepath.Dir(checkpoint.StoragePath), latestCheckpointTracker))
	data, err := storage.ReadRelativePath(ctx, markerPath, latestCheckpointTrackerReadLimit)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	item := model.JobCheckpoint{
		Name:        checkpoint.Name,
		Path:        checkpoint.Path,
		StoragePath: checkpoint.StoragePath,
		Step:        checkpoint.Step,
		Metadata:    datatypes.JSONMap{},
	}
	if item.Name == "" {
		item.Name = filepath.Base(checkpoint.StoragePath)
	}
	if checkpointMatchesTracker(&item, strings.TrimSpace(string(data)), latestMarkerStep(string(data))) {
		return removeStorageRelativePath(ctx, markerPath)
	}
	return nil
}
