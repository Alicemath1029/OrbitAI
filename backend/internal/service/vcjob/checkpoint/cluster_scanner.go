package checkpoint

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"k8s.io/client-go/kubernetes"

	"github.com/raids-lab/orbit/dao/model"
)

func ScanJobWithKubernetes(
	ctx context.Context,
	record *model.Job,
	_ kubernetes.Interface,
) (*ScanResult, error) {
	result, err := ScanJobWithService(ctx, record, ServiceScannerOptions{})
	if err == nil {
		return result, nil
	}

	if errors.Is(err, errServiceScannerDisabled) ||
		(checkpointScannerFallbackEnabled() && checkpointScannerServiceError(err)) {
		localResult, localErr := ScanJob(ctx, record)
		if localErr == nil {
			return localResult, nil
		}
		if errors.Is(err, errServiceScannerDisabled) {
			return nil, fmt.Errorf("checkpoint scanner service is not configured and local fallback failed: %w", localErr)
		}
		return nil, fmt.Errorf("%w; local fallback also failed: %w", err, localErr)
	}

	if checkpointScannerServiceError(err) {
		return nil, fmt.Errorf("%w; set ORBIT_CHECKPOINT_SCANNER_FALLBACK=local to use backend storage fallback", err)
	}
	return nil, err
}

func checkpointScannerFallbackEnabled() bool {
	return strings.EqualFold(firstNonEmptyEnv(
		"ORBIT_CHECKPOINT_SCANNER_FALLBACK",
		"CRATER_CHECKPOINT_SCANNER_FALLBACK",
	), "local")
}

func checkpointScannerServiceError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "checkpoint scanner service")
}
