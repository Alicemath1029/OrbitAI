package checkpoint

import (
	"context"

	"k8s.io/client-go/kubernetes"

	"github.com/raids-lab/orbit/dao/model"
)

func ScanJobWithKubernetes(
	ctx context.Context,
	record *model.Job,
	_ kubernetes.Interface,
) (*ScanResult, error) {
	return ScanJobWithService(ctx, record, ServiceScannerOptions{})
}
