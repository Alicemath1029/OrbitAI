package checkpoint

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gorm.io/datatypes"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/pkg/config"
)

const defaultServiceScanTimeout = 30 * time.Second

type ServiceScannerOptions struct {
	Endpoint string
	Timeout  time.Duration
}

func ScanJobWithService(ctx context.Context, record *model.Job, opts ServiceScannerOptions) (*ScanResult, error) {
	info, storagePath, err := prepareScan(record)
	if err != nil {
		return nil, err
	}
	opts = normalizeServiceScannerOptions(opts)
	if opts.Endpoint == "" {
		return nil, errServiceScannerDisabled
	}

	resp, err := requestServiceScan(ctx, opts, ServiceScanRequest{
		JobName:       record.JobName,
		RunID:         experimentRunIDFromRecord(record),
		Framework:     info.Framework,
		CheckpointDir: info.CheckpointDir,
		StoragePath:   storagePath,
	})
	if err != nil {
		return nil, err
	}

	candidates := make([]model.JobCheckpoint, 0, len(resp.Items))
	markerStep := latestMarkerStep(resp.LatestMarker)
	for i := range resp.Items {
		checkpoint := serviceScanItemToCheckpoint(record, info, storagePath, &resp.Items[i], resp.LatestMarker, markerStep)
		candidates = append(candidates, checkpoint)
	}
	return finishScan(ctx, record, info, storagePath, candidates)
}

func serviceScanItemToCheckpoint(
	record *model.Job,
	info *model.CheckpointInfo,
	baseStoragePath string,
	item *ServiceScanItem,
	latestMarker string,
	markerStep int64,
) model.JobCheckpoint {
	name := strings.TrimSpace(item.Name)
	if name == "" {
		name = filepath.Base(item.StoragePath)
	}
	path := strings.TrimSpace(item.Path)
	if path == "" {
		path = filepath.ToSlash(filepath.Join(info.CheckpointDir, name))
	}
	itemStoragePath := strings.TrimSpace(item.StoragePath)
	if itemStoragePath == "" {
		itemStoragePath = filepath.ToSlash(filepath.Join(baseStoragePath, name))
	}
	checkpoint := newCheckpointRecord(record, info, name, path, itemStoragePath, item.SizeBytes, item.ModTime)
	applyServiceScanItem(&checkpoint, item)
	if checkpoint.Status == model.JobCheckpointStatusReady && checkpointMatchesTracker(&checkpoint, latestMarker, markerStep) {
		checkpoint.Metadata["trackedLatest"] = true
		checkpoint.Metadata["latestTracker"] = latestCheckpointTracker
	}
	return checkpoint
}

func applyServiceScanItem(checkpoint *model.JobCheckpoint, item *ServiceScanItem) {
	if item.Step >= 0 {
		checkpoint.Step = item.Step
	}
	if framework := strings.TrimSpace(item.Framework); framework != "" {
		checkpoint.Framework = strings.ToLower(framework)
	}
	if status := strings.TrimSpace(item.Status); status != "" {
		checkpoint.Status = model.JobCheckpointStatus(status)
	}
	if checkpoint.Metadata == nil {
		checkpoint.Metadata = datatypes.JSONMap{}
	}
	for key, value := range item.Metadata {
		checkpoint.Metadata[key] = value
	}
	if item.ManifestStoragePath != "" {
		checkpoint.Metadata["manifestStoragePath"] = item.ManifestStoragePath
	}
	checkpoint.Metadata["scanBackend"] = scannerBackendService
}

func DeleteCheckpointStorage(ctx context.Context, checkpoint *model.JobCheckpoint, opts ServiceScannerOptions) error {
	if checkpoint == nil {
		return errors.New("checkpoint is required")
	}
	if strings.TrimSpace(checkpoint.StoragePath) == "" {
		return errors.New("checkpoint has no storage path")
	}
	opts = normalizeServiceScannerOptions(opts)
	if opts.Endpoint == "" {
		return errServiceScannerDisabled
	}
	_, err := requestServiceDelete(ctx, opts, ServiceDeleteRequest{
		StoragePath: checkpoint.StoragePath,
		Name:        checkpoint.Name,
		Path:        checkpoint.Path,
		Step:        &checkpoint.Step,
	})
	return err
}

var errServiceScannerDisabled = fmt.Errorf("checkpoint scanner service endpoint is not configured")

func normalizeServiceScannerOptions(opts ServiceScannerOptions) ServiceScannerOptions {
	if opts.Endpoint == "" {
		opts.Endpoint = firstNonEmptyEnv(
			"ORBIT_CHECKPOINT_SCANNER_ENDPOINT",
			"CRATER_CHECKPOINT_SCANNER_ENDPOINT",
		)
	}
	if opts.Endpoint == "" {
		cfg := config.GetConfig()
		opts.Endpoint = strings.TrimSpace(cfg.CheckpointScanner.Endpoint)
		if opts.Timeout <= 0 && cfg.CheckpointScanner.TimeoutSeconds > 0 {
			opts.Timeout = time.Duration(cfg.CheckpointScanner.TimeoutSeconds) * time.Second
		}
	}
	if opts.Timeout <= 0 {
		if timeoutEnv := firstNonEmptyEnv(
			"ORBIT_CHECKPOINT_SCANNER_TIMEOUT_SECONDS",
			"CRATER_CHECKPOINT_SCANNER_TIMEOUT_SECONDS",
		); timeoutEnv != "" {
			if seconds, err := strconv.Atoi(timeoutEnv); err == nil && seconds > 0 {
				opts.Timeout = time.Duration(seconds) * time.Second
			}
		}
	}
	if opts.Timeout <= 0 {
		opts.Timeout = defaultServiceScanTimeout
	}
	opts.Endpoint = strings.TrimRight(opts.Endpoint, "/")
	return opts
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func requestServiceScan(ctx context.Context, opts ServiceScannerOptions, body ServiceScanRequest) (ServiceScanResponse, error) {
	var scanResp ServiceScanResponse
	if err := requestScannerJSON(ctx, opts, "/scan", body, "checkpoint scanner service", &scanResp); err != nil {
		return ServiceScanResponse{}, err
	}
	if scanResp.Items == nil {
		scanResp.Items = []ServiceScanItem{}
	}
	return scanResp, nil
}

func requestServiceDelete(ctx context.Context, opts ServiceScannerOptions, body ServiceDeleteRequest) (ServiceDeleteResponse, error) {
	var deleteResp ServiceDeleteResponse
	if err := requestScannerJSON(ctx, opts, "/delete", body, "checkpoint scanner service delete", &deleteResp); err != nil {
		return ServiceDeleteResponse{}, err
	}
	if deleteResp.Deleted == nil {
		deleteResp.Deleted = []string{}
	}
	return deleteResp, nil
}

func requestScannerJSON(
	ctx context.Context,
	opts ServiceScannerOptions,
	path string,
	body any,
	label string,
	out any,
) error {
	reqCtx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, opts.Endpoint+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("call %s: %w", label, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		if errResp.Error != "" {
			return fmt.Errorf("%s returned %d: %s", label, resp.StatusCode, errResp.Error)
		}
		return fmt.Errorf("%s returned %d", label, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode %s response: %w", label, err)
	}
	return nil
}
