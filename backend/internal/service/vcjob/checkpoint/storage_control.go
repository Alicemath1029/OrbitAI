package checkpoint

import (
	"context"
	"errors"

	"github.com/raids-lab/orbit/dao/model"
)

func DeleteCheckpointStorageWithControl(ctx context.Context, checkpoint *model.JobCheckpoint) error {
	err := DeleteCheckpointStorage(ctx, checkpoint, ServiceScannerOptions{})
	if err == nil {
		return nil
	}
	if errors.Is(err, errServiceScannerDisabled) {
		return errors.New("checkpoint scanner service is required for checkpoint delete")
	}
	return err
}
