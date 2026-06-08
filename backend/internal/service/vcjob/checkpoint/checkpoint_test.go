package checkpoint

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	batch "volcano.sh/apis/pkg/apis/batch/v1alpha1"

	"github.com/raids-lab/orbit/dao/model"
)

func TestPrepareAppliesPolicyDefaults(t *testing.T) {
	t.Parallel()

	cfg, err := Prepare(PrepareInput{
		Config:      &Config{Enabled: true, Framework: FrameworkHFTrainer},
		RequestName: "qwen-sft",
		AccountName: "llm",
		VolumeMounts: []v1.VolumeMount{
			{Name: "storage", MountPath: "/workspace"},
		},
	})
	if err != nil {
		t.Fatalf("Prepare() error = %v", err)
	}
	if cfg == nil {
		t.Fatal("Prepare() returned nil config")
	}
	wantDir := "/workspace/checkpoints/llm/qwen-sft"
	if cfg.OutputDir != wantDir || cfg.CheckpointDir != wantDir {
		t.Fatalf("Prepare() dirs = (%q, %q), want %q", cfg.OutputDir, cfg.CheckpointDir, wantDir)
	}
	if cfg.SaveSteps != defaultSaveSteps || cfg.MaxToKeep != defaultMaxToKeep {
		t.Fatalf("Prepare() retention = (%d, %d)", cfg.SaveSteps, cfg.MaxToKeep)
	}
}

func TestPrepareRejectsReadOnlyMount(t *testing.T) {
	t.Parallel()

	_, err := Prepare(PrepareInput{
		Config: &Config{
			Enabled:       true,
			CheckpointDir: "/workspace/checkpoints",
			OutputDir:     "/workspace/checkpoints",
		},
		RequestName: "train",
		AccountName: "llm",
		VolumeMounts: []v1.VolumeMount{
			{Name: "storage", MountPath: "/workspace", ReadOnly: true},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "writable volume mount") {
		t.Fatalf("Prepare() error = %v, want writable mount error", err)
	}
}

func TestAppendEnvsOverridesOrbitNamespace(t *testing.T) {
	t.Parallel()

	envs := AppendEnvs([]v1.EnvVar{
		{Name: "ORBIT_CHECKPOINT_DIR", Value: "/tmp"},
		{Name: "USER_ENV", Value: "kept"},
	}, &Config{
		Enabled:        true,
		Framework:      FrameworkCustom,
		ProjectName:    "project",
		ExperimentName: "experiment",
		OutputDir:      "/workspace/out",
		CheckpointDir:  "/workspace/ckpt",
		ResumeMode:     ResumeModeNone,
		SaveSteps:      100,
		MaxToKeep:      2,
	}, "job-name")

	foundUserEnv := false
	for _, env := range envs {
		if env.Name == "ORBIT_CHECKPOINT_DIR" && env.Value != "/workspace/ckpt" {
			t.Fatalf("ORBIT_CHECKPOINT_DIR = %q, want platform value", env.Value)
		}
		if env.Name == "USER_ENV" {
			foundUserEnv = true
		}
	}
	if !foundUserEnv {
		t.Fatal("AppendEnvs() dropped non-ORBIT user env")
	}
}

func TestCheckpointInfoAnnotations(t *testing.T) {
	t.Parallel()

	info := &model.CheckpointInfo{
		Enabled:          true,
		Framework:        FrameworkHFTrainer,
		ProjectName:      "llm",
		ExperimentName:   "qwen-sft",
		OutputDir:        "/workspace/checkpoints/llm/qwen-sft",
		CheckpointDir:    "/workspace/checkpoints/llm/qwen-sft",
		ResumeMode:       ResumeModeManual,
		ResumeFrom:       "/workspace/checkpoints/llm/qwen-sft/checkpoint-1000",
		LatestCheckpoint: "/workspace/checkpoints/llm/qwen-sft/checkpoint-1000",
		SaveSteps:        500,
		MaxToKeep:        3,
	}

	annotations := make(map[string]string)
	if err := ApplyAnnotations(annotations, info); err != nil {
		t.Fatalf("ApplyAnnotations() error = %v", err)
	}

	got, err := ParseAnnotations(annotations)
	if err != nil {
		t.Fatalf("ParseAnnotations() error = %v", err)
	}
	if got == nil {
		t.Fatal("ParseAnnotations() returned nil")
	}
	if got.Framework != info.Framework ||
		got.CheckpointDir != info.CheckpointDir ||
		got.ResumeFrom != info.ResumeFrom ||
		got.SaveSteps != info.SaveSteps ||
		got.MaxToKeep != info.MaxToKeep {
		t.Fatalf("ParseAnnotations() = %#v, want %#v", got, info)
	}
}

func TestCheckpointInfoAnnotationsDisabled(t *testing.T) {
	t.Parallel()

	annotations := make(map[string]string)
	if err := ApplyAnnotations(annotations, &model.CheckpointInfo{}); err != nil {
		t.Fatalf("ApplyAnnotations() error = %v", err)
	}
	if len(annotations) != 0 {
		t.Fatalf("ApplyAnnotations() wrote annotations for disabled checkpoint: %#v", annotations)
	}

	got, err := ParseAnnotations(map[string]string{
		AnnotationKeyEnabled: "false",
	})
	if err != nil {
		t.Fatalf("ParseAnnotations() error = %v", err)
	}
	if got != nil {
		t.Fatalf("ParseAnnotations() = %#v, want nil", got)
	}
}

func TestStepFromNameRecognizesCheckpointFiles(t *testing.T) {
	t.Parallel()

	tests := map[string]int64{
		"checkpoint-0004.pt":       4,
		"checkpoint_42.pth":        42,
		"epoch=0-step_0007.ckpt":   7,
		"global_step1000":          1000,
		"global_step-1000.safetns": 1000,
		"model-final.pt":           unknownCheckpointStep,
	}

	for name, want := range tests {
		if got := stepFromName(name); got != want {
			t.Fatalf("stepFromName(%q) = %d, want %d", name, got, want)
		}
	}
}

func TestValidateServiceScanRequest(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		req     ServiceScanRequest
		wantErr string
	}{
		{
			name: "valid",
			req: ServiceScanRequest{
				CheckpointDir: "/workspace/checkpoints",
				StoragePath:   "users/admin/checkpoints",
			},
		},
		{
			name: "missing storage path",
			req: ServiceScanRequest{
				CheckpointDir: "/workspace/checkpoints",
			},
			wantErr: "storagePath is required",
		},
		{
			name: "missing checkpoint dir",
			req: ServiceScanRequest{
				StoragePath: "users/admin/checkpoints",
			},
			wantErr: "checkpointDir is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			err := ValidateServiceScanRequest(tt.req)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidateServiceScanRequest() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("ValidateServiceScanRequest() error = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

func TestFileSystemScannerScansFrameworkLayouts(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	base := filepath.Join(root, "users", "u-admin", "exp", "checkpoints")
	mustWriteFile(t, filepath.Join(base, "checkpoint-0004.pt"), "pytorch")
	mustWriteFile(t, filepath.Join(base, "epoch=0-step_0007.ckpt"), "lightning")
	mustWriteFile(t, filepath.Join(base, "global_step0010", "mp_rank_00_model_states.pt"), "deepspeed")
	mustWriteFile(t, filepath.Join(base, "_tmp-ignore", "part"), "skip")

	scanner := NewFileSystemScanner(root)
	resp, err := scanner.Scan(context.Background(), ServiceScanRequest{
		Framework:     FrameworkDeepSpeed,
		CheckpointDir: "/home/admin/exp/checkpoints",
		StoragePath:   "users/u-admin/exp/checkpoints",
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}

	got := map[string]int64{}
	for _, item := range resp.Items {
		got[item.Name] = item.Step
		if item.StoragePath == "" || item.Path == "" {
			t.Fatalf("Scan() returned incomplete item: %#v", item)
		}
	}
	if got["checkpoint-0004.pt"] != 4 {
		t.Fatalf("checkpoint-0004.pt step = %d, want 4; items=%#v", got["checkpoint-0004.pt"], resp.Items)
	}
	if got["epoch=0-step_0007.ckpt"] != 7 {
		t.Fatalf("epoch=0-step_0007.ckpt step = %d, want 7; items=%#v", got["epoch=0-step_0007.ckpt"], resp.Items)
	}
	if got["global_step0010"] != 10 {
		t.Fatalf("global_step0010 step = %d, want 10; items=%#v", got["global_step0010"], resp.Items)
	}
	if _, ok := got["_tmp-ignore"]; ok {
		t.Fatalf("temporary checkpoint directory was not skipped: %#v", resp.Items)
	}
}

func TestFileSystemScannerReadsSDKManifest(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	base := filepath.Join(root, "users", "u-admin", "exp", "checkpoints")
	mustWriteFile(t, filepath.Join(base, "custom-final.bin"), "checkpoint")
	mustWriteFile(t, filepath.Join(base, "custom-final.bin.orbit.json"), `{
		"schemaVersion": "1",
		"framework": "pytorch",
		"name": "custom-final",
		"path": "/workspace/checkpoints/custom-final.bin",
		"step": 123,
		"sha256": "abc123",
		"metadata": {"metric": "loss"}
	}`)

	scanner := NewFileSystemScanner(root)
	resp, err := scanner.Scan(context.Background(), ServiceScanRequest{
		Framework:     FrameworkPytorch,
		CheckpointDir: "/workspace/checkpoints",
		StoragePath:   "users/u-admin/exp/checkpoints",
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("Scan() items = %#v, want one manifest-discovered checkpoint", resp.Items)
	}

	item := resp.Items[0]
	if item.Name != "custom-final" || item.Path != "/workspace/checkpoints/custom-final.bin" {
		t.Fatalf("manifest name/path not applied: %#v", item)
	}
	if item.Step != 123 || item.Framework != FrameworkPytorch {
		t.Fatalf("manifest step/framework not applied: %#v", item)
	}
	if item.Metadata["metric"] != "loss" || item.Metadata["manifestSchemaVersion"] != "1" ||
		item.Metadata["sha256"] != "abc123" {
		t.Fatalf("manifest metadata = %#v", item.Metadata)
	}
	if item.ManifestStoragePath != "users/u-admin/exp/checkpoints/custom-final.bin.orbit.json" {
		t.Fatalf("ManifestStoragePath = %q", item.ManifestStoragePath)
	}
}

func TestFileSystemScannerMarksInvalidManifest(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	base := filepath.Join(root, "users", "u-admin", "exp", "checkpoints")
	mustWriteFile(t, filepath.Join(base, "custom-final.bin"), "checkpoint")
	mustWriteFile(t, filepath.Join(base, "custom-final.bin.orbit.json"), `{
		"schemaVersion": "orbit.checkpoint.manifest.v1",
		"framework": "custom",
		"name": "custom-final.bin",
		"path": "/workspace/checkpoints/custom-final.bin",
		"step": 42,
		"sizeBytes": 999,
		"sha256": "bad",
		"runID": "7",
		"jobName": "job-a"
	}`)

	runID := uint(7)
	scanner := NewFileSystemScanner(root)
	resp, err := scanner.Scan(context.Background(), ServiceScanRequest{
		JobName:       "job-a",
		RunID:         &runID,
		Framework:     FrameworkCustom,
		CheckpointDir: "/workspace/checkpoints",
		StoragePath:   "users/u-admin/exp/checkpoints",
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("Scan() items = %#v, want one checkpoint", resp.Items)
	}
	item := resp.Items[0]
	if item.Status != string(model.JobCheckpointStatusInvalid) {
		t.Fatalf("Status = %q, want invalid; item=%#v", item.Status, item)
	}
	if item.Metadata["validationStatus"] != "invalid" {
		t.Fatalf("validation metadata = %#v", item.Metadata)
	}
	if _, ok := item.Metadata["validationErrors"]; !ok {
		t.Fatalf("validationErrors missing: %#v", item.Metadata)
	}
}

func TestFileSystemScannerDeleteRemovesCheckpointManifestAndLatestMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	base := filepath.Join(root, "users", "u-admin", "exp", "checkpoints")
	checkpointPath := filepath.Join(base, "custom-final.bin")
	manifestPath := checkpointPath + checkpointManifestSuffix
	markerPath := filepath.Join(base, latestCheckpointTracker)
	mustWriteFile(t, checkpointPath, "checkpoint")
	mustWriteFile(t, manifestPath, `{"schemaVersion":"orbit.checkpoint.manifest.v1","step":42}`)
	mustWriteFile(t, markerPath, "custom-final.bin")

	scanner := NewFileSystemScanner(root)
	step := int64(42)
	resp, err := scanner.Delete(context.Background(), ServiceDeleteRequest{
		StoragePath: "users/u-admin/exp/checkpoints/custom-final.bin",
		Name:        "custom-final.bin",
		Path:        "/workspace/checkpoints/custom-final.bin",
		Step:        &step,
	})
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if len(resp.Deleted) != 2 {
		t.Fatalf("Delete() deleted = %#v, want checkpoint and manifest", resp.Deleted)
	}
	for _, path := range []string{checkpointPath, manifestPath, markerPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s still exists or stat failed with non-not-exist error: %v", path, err)
		}
	}
}

func TestLatestCheckpointPrefersFrameworkTracker(t *testing.T) {
	t.Parallel()

	items := []model.JobCheckpoint{
		{
			Name:    "global_step0010",
			Path:    "/home/admin/exp/checkpoints/global_step0010",
			Step:    10,
			ModTime: mustParseTime(t, "2026-01-01T00:00:00Z"),
			Status:  model.JobCheckpointStatusReady,
		},
		{
			Name:    "global_step0008",
			Path:    "/home/admin/exp/checkpoints/global_step0008",
			Step:    8,
			ModTime: mustParseTime(t, "2026-01-02T00:00:00Z"),
			Status:  model.JobCheckpointStatusReady,
			Metadata: datatypes.JSONMap{
				"trackedLatest": true,
			},
		},
	}

	latest := latestCheckpoint(items)
	if latest == nil || latest.Name != "global_step0008" {
		t.Fatalf("latestCheckpoint() = %#v, want tracker-marked global_step0008", latest)
	}
}

func TestLatestCheckpointSkipsInvalidItems(t *testing.T) {
	t.Parallel()

	items := []model.JobCheckpoint{
		{
			Name:   "checkpoint-10.pt",
			Path:   "/workspace/checkpoints/checkpoint-10.pt",
			Step:   10,
			Status: model.JobCheckpointStatusInvalid,
			Metadata: datatypes.JSONMap{
				"trackedLatest": true,
			},
		},
		{
			Name:   "checkpoint-8.pt",
			Path:   "/workspace/checkpoints/checkpoint-8.pt",
			Step:   8,
			Status: model.JobCheckpointStatusReady,
		},
	}

	latest := latestCheckpoint(items)
	if latest == nil || latest.Name != "checkpoint-8.pt" {
		t.Fatalf("latestCheckpoint() = %#v, want ready checkpoint-8.pt", latest)
	}
}

func TestFileSystemScannerReportsLatestMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	base := filepath.Join(root, "users", "u-admin", "exp", "checkpoints")
	mustWriteFile(t, filepath.Join(base, "global_step0010", "rank0.pt"), "newer")
	mustWriteFile(t, filepath.Join(base, "global_step0008", "rank0.pt"), "tracked")
	mustWriteFile(t, filepath.Join(base, latestCheckpointTracker), "8")

	scanner := NewFileSystemScanner(root)
	resp, err := scanner.Scan(context.Background(), ServiceScanRequest{
		Framework:     FrameworkVerl,
		CheckpointDir: "/home/admin/exp/checkpoints",
		StoragePath:   "users/u-admin/exp/checkpoints",
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if resp.LatestMarker != "8" {
		t.Fatalf("Scan() LatestMarker = %q, want 8", resp.LatestMarker)
	}
}

func TestNormalizeServiceScannerOptionsReadsLegacyCraterEnv(t *testing.T) {
	t.Setenv("CRATER_CHECKPOINT_SCANNER_ENDPOINT", "http://legacy-scanner:7330/")
	t.Setenv("CRATER_CHECKPOINT_SCANNER_TIMEOUT_SECONDS", "7")

	opts := normalizeServiceScannerOptions(ServiceScannerOptions{})
	if opts.Endpoint != "http://legacy-scanner:7330" {
		t.Fatalf("Endpoint = %q, want legacy endpoint without trailing slash", opts.Endpoint)
	}
	if opts.Timeout != 7*time.Second {
		t.Fatalf("Timeout = %v, want 7s", opts.Timeout)
	}
}

func TestBackgroundScanOptionsReadsEnv(t *testing.T) {
	t.Setenv("ORBIT_CHECKPOINT_SCANNER_INTERVAL_SECONDS", "11")
	t.Setenv("ORBIT_CHECKPOINT_SCANNER_BATCH_SIZE", "7")

	opts := BackgroundScanOptionsFromConfig()
	if opts.Interval != 11*time.Second {
		t.Fatalf("Interval = %v, want 11s", opts.Interval)
	}
	if opts.BatchSize != 7 {
		t.Fatalf("BatchSize = %d, want 7", opts.BatchSize)
	}
}

func TestUpsertCheckpointArtifactUpdatesExistingSource(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.RunArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	runID := uint(7)
	checkpoint := model.JobCheckpoint{
		Model:       gorm.Model{ID: 11},
		RunID:       &runID,
		JobName:     "job-a",
		Framework:   FrameworkPytorch,
		Name:        "checkpoint-4.pt",
		Path:        "/workspace/checkpoints/checkpoint-4.pt",
		StoragePath: "users/u/checkpoint-4.pt",
		Step:        4,
		SizeBytes:   64,
		Latest:      true,
		Metadata:    datatypes.JSONMap{"source": "scan"},
	}
	if err := upsertCheckpointArtifact(context.Background(), db, &checkpoint); err != nil {
		t.Fatalf("upsert checkpoint artifact: %v", err)
	}

	nextRunID := uint(8)
	checkpoint.RunID = &nextRunID
	checkpoint.SizeBytes = 128
	checkpoint.Latest = false
	if err := upsertCheckpointArtifact(context.Background(), db, &checkpoint); err != nil {
		t.Fatalf("second upsert checkpoint artifact: %v", err)
	}

	var artifact model.RunArtifact
	if err := db.Where("source_type = ? AND source_id = ?", "checkpoint", checkpoint.ID).First(&artifact).Error; err != nil {
		t.Fatalf("find artifact: %v", err)
	}
	if artifact.RunID != nextRunID || artifact.SizeBytes != 128 {
		t.Fatalf("artifact = %#v, want updated run and size", artifact)
	}
	if artifact.Metadata["latest"] != false || artifact.Metadata["jobName"] != "job-a" {
		t.Fatalf("artifact metadata = %#v, want latest/jobName metadata", artifact.Metadata)
	}
}

func TestSyncCheckpointArtifactsRemovesStaleArtifacts(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.JobCheckpoint{}, &model.RunArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	runID := uint(7)
	ready := model.JobCheckpoint{
		JobID:       1,
		RunID:       &runID,
		JobName:     "job-a",
		UserID:      1,
		AccountID:   1,
		Framework:   FrameworkPytorch,
		Name:        "checkpoint-4.pt",
		Path:        "/workspace/checkpoints/checkpoint-4.pt",
		StoragePath: "users/u/checkpoint-4.pt",
		Step:        4,
		SizeBytes:   64,
		Status:      model.JobCheckpointStatusReady,
		Latest:      true,
		Metadata:    datatypes.JSONMap{"source": "scan"},
	}
	deleted := model.JobCheckpoint{
		JobID:       1,
		RunID:       &runID,
		JobName:     "job-a",
		UserID:      1,
		AccountID:   1,
		Framework:   FrameworkPytorch,
		Name:        "checkpoint-2.pt",
		Path:        "/workspace/checkpoints/checkpoint-2.pt",
		StoragePath: "users/u/checkpoint-2.pt",
		Step:        2,
		SizeBytes:   32,
		Status:      model.JobCheckpointStatusDeleted,
	}
	if err := db.Create(&ready).Error; err != nil {
		t.Fatalf("create ready checkpoint: %v", err)
	}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatalf("create deleted checkpoint: %v", err)
	}

	deletedSourceID := deleted.ID
	if err := db.Create(&model.RunArtifact{
		RunID:      runID,
		Name:       deleted.Name,
		Type:       "checkpoint",
		Path:       deleted.Path,
		SourceType: "checkpoint",
		SourceID:   &deletedSourceID,
	}).Error; err != nil {
		t.Fatalf("create stale artifact: %v", err)
	}

	if err := SyncCheckpointArtifacts(context.Background(), db, 1); err != nil {
		t.Fatalf("SyncCheckpointArtifacts() error = %v", err)
	}

	var readyArtifact model.RunArtifact
	if err := db.Where("source_type = ? AND source_id = ?", "checkpoint", ready.ID).First(&readyArtifact).Error; err != nil {
		t.Fatalf("ready artifact was not upserted: %v", err)
	}
	if readyArtifact.Metadata["latest"] != true || readyArtifact.Metadata["jobName"] != "job-a" {
		t.Fatalf("ready artifact metadata = %#v", readyArtifact.Metadata)
	}

	var count int64
	if err := db.Model(&model.RunArtifact{}).
		Where("source_type = ? AND source_id = ?", "checkpoint", deleted.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count stale artifact: %v", err)
	}
	if count != 0 {
		t.Fatalf("stale artifact count = %d, want 0", count)
	}
}

func TestScanJobWithKubernetesReportsServiceFailureWithoutFallback(t *testing.T) {
	t.Setenv("ORBIT_CHECKPOINT_SCANNER_ENDPOINT", "http://127.0.0.1:1")
	t.Setenv("ORBIT_CHECKPOINT_SCANNER_TIMEOUT_SECONDS", "1")
	t.Setenv("ORBIT_CHECKPOINT_SCANNER_FALLBACK", "disabled")
	t.Setenv("CRATER_CHECKPOINT_SCANNER_FALLBACK", "disabled")

	record := &model.Job{
		JobName: "scan-service-required",
		Checkpoint: ptrToJSON(&model.CheckpointInfo{
			Enabled:       true,
			Framework:     FrameworkPytorch,
			CheckpointDir: "/workspace/checkpoints",
		}),
		Attributes: datatypes.NewJSONType(&batch.Job{
			ObjectMeta: metav1.ObjectMeta{Namespace: "orbit-workspace"},
			Spec: batch.JobSpec{Tasks: []batch.TaskSpec{{
				Template: v1.PodTemplateSpec{
					Spec: v1.PodSpec{Containers: []v1.Container{{
						VolumeMounts: []v1.VolumeMount{{
							Name:      "storage",
							MountPath: "/workspace",
							SubPath:   "users/u-admin",
						}},
					}}},
				},
			}}},
		}),
	}

	_, err := ScanJobWithKubernetes(context.Background(), record, nil)
	if err == nil {
		t.Fatal("ScanJobWithKubernetes() error = nil, want scanner service call error")
	}
	if !strings.Contains(err.Error(), "call checkpoint scanner service") {
		t.Fatalf("ScanJobWithKubernetes() error = %v, want scanner service call error", err)
	}
	if !strings.Contains(err.Error(), "ORBIT_CHECKPOINT_SCANNER_FALLBACK=local") {
		t.Fatalf("ScanJobWithKubernetes() error = %v, want fallback hint", err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}
}

func mustParseTime(t *testing.T, raw string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatalf("Parse(%q) error = %v", raw, err)
	}
	return parsed
}
