package checkpoint

import (
	"context"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"k8s.io/client-go/kubernetes"
	"k8s.io/klog/v2"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/pkg/config"
)

const defaultBackgroundScanBatchSize = 100

type BackgroundScanOptions struct {
	Interval  time.Duration
	BatchSize int
}

func BackgroundScanOptionsFromConfig() BackgroundScanOptions {
	interval, intervalSet := backgroundIntervalFromEnv()
	batchSize, batchSizeSet := backgroundBatchSizeFromEnv()

	if !intervalSet || !batchSizeSet {
		cfg := config.GetConfig()
		if !intervalSet {
			interval = time.Duration(cfg.CheckpointScanner.IntervalSeconds) * time.Second
		}
		if !batchSizeSet {
			batchSize = cfg.CheckpointScanner.BatchSize
		}
	}
	if batchSize <= 0 {
		batchSize = defaultBackgroundScanBatchSize
	}
	return BackgroundScanOptions{Interval: interval, BatchSize: batchSize}
}

func backgroundIntervalFromEnv() (time.Duration, bool) {
	if env := firstNonEmptyEnv("ORBIT_CHECKPOINT_SCANNER_INTERVAL_SECONDS", "CRATER_CHECKPOINT_SCANNER_INTERVAL_SECONDS"); env != "" {
		if seconds, err := strconv.Atoi(env); err == nil && seconds > 0 {
			return time.Duration(seconds) * time.Second, true
		} else if err == nil && seconds == 0 {
			return 0, true
		}
	}
	return 0, false
}

func backgroundBatchSizeFromEnv() (int, bool) {
	if env := firstNonEmptyEnv("ORBIT_CHECKPOINT_SCANNER_BATCH_SIZE", "CRATER_CHECKPOINT_SCANNER_BATCH_SIZE"); env != "" {
		if value, err := strconv.Atoi(env); err == nil {
			return value, true
		}
	}
	return 0, false
}

func StartBackgroundScanner(ctx context.Context, db *gorm.DB, kubeClient kubernetes.Interface, opts BackgroundScanOptions) {
	if db == nil || opts.Interval <= 0 {
		return
	}
	if opts.BatchSize <= 0 {
		opts.BatchSize = defaultBackgroundScanBatchSize
	}
	klog.Infof("checkpoint background scanner enabled interval=%s batchSize=%d", opts.Interval, opts.BatchSize)
	go func() {
		timer := time.NewTimer(opts.Interval)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				scanEnabledJobs(ctx, db, kubeClient, opts.BatchSize)
				timer.Reset(opts.Interval)
			}
		}
	}()
}

func scanEnabledJobs(ctx context.Context, db *gorm.DB, kubeClient kubernetes.Interface, batchSize int) {
	var jobs []model.Job
	if err := db.WithContext(ctx).
		Where("checkpoint IS NOT NULL").
		Order("updated_at desc").
		Limit(batchSize).
		Find(&jobs).Error; err != nil {
		klog.Warningf("checkpoint background scanner query failed: %v", err)
		return
	}
	for i := range jobs {
		if err := ctx.Err(); err != nil {
			return
		}
		info := jobCheckpointInfo(&jobs[i])
		if info == nil || !info.Enabled {
			continue
		}
		if _, err := ScanJobWithKubernetes(ctx, &jobs[i], kubeClient); err != nil {
			if !strings.Contains(err.Error(), "checkpoint directory is not accessible") {
				klog.Warningf("checkpoint background scan for job %s failed: %v", jobs[i].JobName, err)
			}
		}
	}
}
