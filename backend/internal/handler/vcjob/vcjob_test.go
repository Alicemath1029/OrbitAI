package vcjob

import (
	"context"
	"strconv"
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
	"github.com/raids-lab/orbit/internal/service"
	checkpointsvc "github.com/raids-lab/orbit/internal/service/vcjob/checkpoint"
	"github.com/raids-lab/orbit/internal/util"
	"github.com/raids-lab/orbit/pkg/config"
	"github.com/raids-lab/orbit/pkg/crclient"
)

func TestResolveDeleteSettlementTime(t *testing.T) {
	t.Parallel()

	recordCompletedAt := time.Date(2026, 4, 15, 9, 30, 0, 0, time.UTC)
	jobTransitionAt := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name   string
		record *model.Job
		job    *batch.Job
		check  func(time.Time) bool
	}{
		{
			name:   "prefers record completed timestamp",
			record: &model.Job{CompletedTimestamp: recordCompletedAt},
			job: &batch.Job{Status: batch.JobStatus{
				State: batch.JobState{LastTransitionTime: metav1.NewTime(jobTransitionAt)},
			}},
			check: func(got time.Time) bool {
				return got.Equal(recordCompletedAt)
			},
		},
		{
			name:   "falls back to job transition timestamp",
			record: &model.Job{},
			job: &batch.Job{Status: batch.JobStatus{
				State: batch.JobState{LastTransitionTime: metav1.NewTime(jobTransitionAt)},
			}},
			check: func(got time.Time) bool {
				return got.Equal(jobTransitionAt)
			},
		},
		{
			name: "falls back to current time when timestamps missing",
			check: func(got time.Time) bool {
				return !got.IsZero()
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := resolveDeleteSettlementTime(tc.record, tc.job)
			if !tc.check(got) {
				t.Fatalf("resolveDeleteSettlementTime() = %v", got)
			}
		})
	}
}

func TestAppendExperimentEnvsInjectsOutputDirWithoutOverridingCheckpoint(t *testing.T) {
	t.Parallel()

	runtime := &experimentRunRuntime{RunID: 7, Token: "token"}
	envs := AppendExperimentEnvs(
		nil,
		runtime,
		"job-a",
		[]v1.VolumeMount{{Name: "storage", MountPath: "/workspace"}},
	)
	values := envValues(envs)

	if values[service.EnvOrbitRunID] != "7" {
		t.Fatalf("ORBIT_RUN_ID = %q, want 7", values[service.EnvOrbitRunID])
	}
	if values[service.EnvOrbitOutputDir] != "/workspace/orbit/outputs/job-a" {
		t.Fatalf("ORBIT_OUTPUT_DIR = %q", values[service.EnvOrbitOutputDir])
	}

	envs = AppendExperimentEnvs(
		[]v1.EnvVar{{Name: service.EnvOrbitOutputDir, Value: "/workspace/out"}},
		runtime,
		"job-a",
		[]v1.VolumeMount{{Name: "storage", MountPath: "/workspace"}},
	)
	values = envValues(envs)
	if values[service.EnvOrbitOutputDir] != "/workspace/out" {
		t.Fatalf("ORBIT_OUTPUT_DIR = %q, want checkpoint output dir", values[service.EnvOrbitOutputDir])
	}
}

func TestAppendExperimentEnvsFallsBackToTmpWhenNoWritableMount(t *testing.T) {
	t.Parallel()

	runtime := &experimentRunRuntime{RunID: 7, Token: "token"}
	envs := AppendExperimentEnvs(
		nil,
		runtime,
		"job-a",
		[]v1.VolumeMount{{Name: "dataset", MountPath: "/data", ReadOnly: true}},
	)
	values := envValues(envs)
	if values[service.EnvOrbitOutputDir] != "/tmp/orbit/outputs/job-a" {
		t.Fatalf("ORBIT_OUTPUT_DIR = %q", values[service.EnvOrbitOutputDir])
	}
}

func TestBuildModelExportRecordNormalizesDefaults(t *testing.T) {
	t.Parallel()

	runID := uint(42)
	job := &model.Job{
		Model:     gorm.Model{ID: 10},
		Name:      "train job",
		JobName:   "sg-train",
		UserID:    1,
		AccountID: 2,
	}
	checkpoint := &model.JobCheckpoint{
		Model:       gorm.Model{ID: 55},
		JobID:       job.ID,
		RunID:       &runID,
		JobName:     job.JobName,
		UserID:      1,
		AccountID:   2,
		Framework:   checkpointsvc.FrameworkPytorch,
		Name:        "checkpoint-42.pt",
		Path:        "/workspace/checkpoints/checkpoint-42.pt",
		StoragePath: "users/u/checkpoints/checkpoint-42.pt",
		Step:        42,
		Metadata: datatypes.JSONMap{
			"format": "state-dict",
		},
	}
	token := util.JWTMessage{UserID: 1, AccountID: 2, Username: "alice"}

	record, err := buildModelExportRecord(job, checkpoint, token, exportCheckpointReq{
		Name: "My Model@v1",
	})
	if err != nil {
		t.Fatalf("buildModelExportRecord() error = %v", err)
	}

	if record.Name != "My-Model-v1" {
		t.Fatalf("Name = %q, want sanitized My-Model-v1", record.Name)
	}
	if record.Format != defaultModelExportFormat {
		t.Fatalf("Format = %q, want %q", record.Format, defaultModelExportFormat)
	}
	if record.Framework != checkpointsvc.FrameworkPytorch {
		t.Fatalf("Framework = %q", record.Framework)
	}
	if record.OutputPath != "public/Models/My-Model-v1" {
		t.Fatalf("OutputPath = %q", record.OutputPath)
	}
	if record.Metadata["source"] != "checkpoint-export" ||
		record.Metadata["sourceCheckpointID"] != checkpoint.ID ||
		record.Metadata["format"] != "state-dict" {
		t.Fatalf("Metadata = %#v", record.Metadata)
	}
	if record.Status != model.ModelExportStatusPending || record.JobName == "" {
		t.Fatalf("Status/JobName = %q/%q", record.Status, record.JobName)
	}
}

func TestBuildModelExportRecordRequiresStoragePath(t *testing.T) {
	t.Parallel()

	_, err := buildModelExportRecord(
		&model.Job{Model: gorm.Model{ID: 10}, Name: "train", JobName: "sg-train"},
		&model.JobCheckpoint{
			Model:     gorm.Model{ID: 55},
			Framework: checkpointsvc.FrameworkPytorch,
			Name:      "checkpoint-42.pt",
			Path:      "/workspace/checkpoints/checkpoint-42.pt",
			Step:      42,
		},
		util.JWTMessage{UserID: 1, AccountID: 2, Username: "alice"},
		exportCheckpointReq{},
	)
	if err == nil || err.Error() != "checkpoint has no storage path" {
		t.Fatalf("buildModelExportRecord() error = %v, want missing storage path", err)
	}
}

func TestBuildModelExportJobMountsStorageAndRunsExporter(t *testing.T) {
	t.Parallel()

	record := &model.ModelExport{
		Model:             gorm.Model{ID: 99},
		UserID:            1,
		Name:              "exported-model",
		Framework:         checkpointsvc.FrameworkDeepSpeed,
		Format:            "pytorch",
		CheckpointStorage: "users/u/checkpoints/global_step42",
		OutputPath:        "public/Models/exported-model",
		JobName:           "mexp-alice-abc",
	}

	job := buildModelExportJob(record)
	if job.Name != record.JobName || job.Labels["app"] != modelExportAppLabel {
		t.Fatalf("job metadata = %#v", job.ObjectMeta)
	}
	if job.Namespace != config.GetConfig().Namespaces.Job {
		t.Fatalf("Namespace = %q", job.Namespace)
	}
	if len(job.Spec.Template.Spec.Containers) != 1 {
		t.Fatalf("containers = %d, want 1", len(job.Spec.Template.Spec.Containers))
	}
	container := job.Spec.Template.Spec.Containers[0]
	if container.Name != modelExportContainerName {
		t.Fatalf("container name = %q", container.Name)
	}
	if container.Image != "orbit/checkpoint-exporter:deepspeed" {
		t.Fatalf("container image = %q, want framework-specific checkpoint exporter image", container.Image)
	}
	if len(container.VolumeMounts) != 1 || container.VolumeMounts[0].MountPath != modelExportMountPath {
		t.Fatalf("volume mounts = %#v", container.VolumeMounts)
	}
	if len(job.Spec.Template.Spec.Volumes) != 1 ||
		job.Spec.Template.Spec.Volumes[0].PersistentVolumeClaim == nil ||
		job.Spec.Template.Spec.Volumes[0].PersistentVolumeClaim.ClaimName == "" {
		t.Fatalf("volumes = %#v", job.Spec.Template.Spec.Volumes)
	}
	command := container.Args[0]
	if !strings.Contains(command, "/orbit/users/u/checkpoints/global_step42") ||
		!strings.Contains(command, "/orbit/public/Models/exported-model") ||
		!strings.Contains(command, "python -m orbit.export") ||
		!strings.Contains(command, "--framework \"$ORBIT_CHECKPOINT_FRAMEWORK\"") {
		t.Fatalf("export command = %s", command)
	}
	if strings.Contains(command, "zero_to_fp32.py") {
		t.Fatalf("export command should delegate framework conversion to SDK exporter: %s", command)
	}
	values := envValues(container.Env)
	if values["ORBIT_EXPORT_ID"] != "99" ||
		values["ORBIT_EXPORT_FORMAT"] != "pytorch" ||
		values["ORBIT_CHECKPOINT_FRAMEWORK"] != checkpointsvc.FrameworkDeepSpeed {
		t.Fatalf("envs = %#v", values)
	}
}

func TestModelExportImageFallsBackToDefaultExporterImage(t *testing.T) {
	t.Parallel()

	if got := modelExportImage(checkpointsvc.FrameworkPytorch); got != defaultModelExportImage {
		t.Fatalf("modelExportImage(pytorch) = %q, want default %q", got, defaultModelExportImage)
	}
}

func TestSanitizeModelExportNameRemovesPathTraversal(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"model/v1":       "model-v1",
		"../../secret":   "secret",
		"  ../model@v2 ": "model-v2",
		"...":            "",
	}
	for input, want := range tests {
		if got := sanitizeModelExportName(input); got != want {
			t.Fatalf("sanitizeModelExportName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBuildCheckpointRestoreJobCreatesRestoreRunAndCleansRuntime(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Experiment{}, &model.ExperimentRun{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	experiment := model.Experiment{
		Model:      gorm.Model{ID: 1},
		Name:       "exp-a",
		UserID:     1,
		AccountID:  2,
		Visibility: model.ExperimentVisibilityPrivate,
	}
	if err := db.Create(&experiment).Error; err != nil {
		t.Fatalf("create experiment: %v", err)
	}
	parentRunID := uint(9)

	oldFactory := newExperimentService
	newExperimentService = func() *service.ExperimentService {
		return service.NewExperimentServiceWithDB(db)
	}
	t.Cleanup(func() {
		newExperimentService = oldFactory
	})
	t.Setenv("ORBIT_API_BASE", "http://orbit.test/api/v1")

	checkpointInfo := &model.CheckpointInfo{
		Enabled:        true,
		Framework:      checkpointsvc.FrameworkPytorch,
		ProjectName:    "proj",
		ExperimentName: "exp-a",
		OutputDir:      "/workspace/checkpoints",
		CheckpointDir:  "/workspace/checkpoints",
		ResumeMode:     checkpointsvc.ResumeModeNone,
		SaveSteps:      100,
		MaxToKeep:      3,
	}
	jobTemplate := restoreSourceJobTemplate(parentRunID)
	record := &model.Job{
		Model:        gorm.Model{ID: 10},
		Name:         "train",
		JobName:      "sg-old",
		UserID:       1,
		AccountID:    2,
		JobType:      model.JobTypeCustom,
		Attributes:   datatypes.NewJSONType(jobTemplate),
		Checkpoint:   ptrCheckpointInfo(checkpointInfo),
		AlertEnabled: true,
	}
	checkpoint := &model.JobCheckpoint{
		Model:       gorm.Model{ID: 55},
		JobID:       record.ID,
		RunID:       &parentRunID,
		JobName:     record.JobName,
		UserID:      1,
		AccountID:   2,
		Framework:   checkpointsvc.FrameworkPytorch,
		Name:        "checkpoint-9.pt",
		Path:        "/workspace/checkpoints/checkpoint-9.pt",
		StoragePath: "users/u/checkpoint-9.pt",
		Step:        9,
		Status:      model.JobCheckpointStatusReady,
		Latest:      true,
	}
	token := util.JWTMessage{
		UserID:      1,
		AccountID:   2,
		Username:    "alice",
		AccountName: "team",
	}

	restored, displayName, runtime, err := buildCheckpointRestoreJob(
		context.Background(),
		record,
		checkpoint,
		token,
		"",
	)
	if err != nil {
		t.Fatalf("buildCheckpointRestoreJob() error = %v", err)
	}
	if displayName != "train-resume" {
		t.Fatalf("displayName = %q", displayName)
	}
	if !strings.HasPrefix(restored.Name, "sg-alice-") {
		t.Fatalf("restored name = %q, want sg-alice-*", restored.Name)
	}
	if runtime == nil || runtime.RunID == 0 || runtime.Token == "" {
		t.Fatalf("runtime = %#v, want new experiment runtime", runtime)
	}
	if restored.Annotations[AnnotationKeyTaskName] != displayName ||
		restored.Annotations[AnnotationKeyAlertEnabled] != "true" {
		t.Fatalf("restored annotations = %#v", restored.Annotations)
	}
	if restored.Annotations[service.ExperimentAnnotationRunID] != strconv.FormatUint(uint64(runtime.RunID), 10) {
		t.Fatalf("experiment run annotation = %q, want %d", restored.Annotations[service.ExperimentAnnotationRunID], runtime.RunID)
	}
	parsedInfo, err := checkpointsvc.ParseAnnotations(restored.Annotations)
	if err != nil {
		t.Fatalf("ParseAnnotations() error = %v", err)
	}
	if parsedInfo.ResumeMode != checkpointsvc.ResumeModeManual ||
		parsedInfo.ResumeFrom != checkpoint.Path ||
		parsedInfo.LatestCheckpoint != checkpoint.Path {
		t.Fatalf("checkpoint restore annotations = %#v", parsedInfo)
	}

	values := envValues(restored.Spec.Tasks[0].Template.Spec.Containers[0].Env)
	if values["USER_ENV"] != "kept" {
		t.Fatalf("USER_ENV was not preserved: %#v", values)
	}
	if values["ORBIT_RESUME_FROM"] != checkpoint.Path ||
		values["ORBIT_RESUME_MODE"] != checkpointsvc.ResumeModeManual {
		t.Fatalf("checkpoint envs = %#v", values)
	}
	if values[service.EnvOrbitRunID] != strconv.FormatUint(uint64(runtime.RunID), 10) ||
		values[service.EnvOrbitAPIBase] != "http://orbit.test/api/v1" ||
		values[service.EnvOrbitRunToken] == "old-token" {
		t.Fatalf("experiment envs = %#v", values)
	}

	var run model.ExperimentRun
	if err := db.First(&run, runtime.RunID).Error; err != nil {
		t.Fatalf("find restore run: %v", err)
	}
	if run.ParentRunID == nil || *run.ParentRunID != parentRunID {
		t.Fatalf("ParentRunID = %#v, want %d", run.ParentRunID, parentRunID)
	}
	if run.SourceCheckpointID == nil || *run.SourceCheckpointID != checkpoint.ID {
		t.Fatalf("SourceCheckpointID = %#v, want %d", run.SourceCheckpointID, checkpoint.ID)
	}
	if run.CheckpointSnapshot["checkpointPath"] != checkpoint.Path ||
		run.CheckpointSnapshot["resumeMode"] != checkpointsvc.ResumeModeManual {
		t.Fatalf("CheckpointSnapshot = %#v", run.CheckpointSnapshot)
	}
}

func envValues(envs []v1.EnvVar) map[string]string {
	values := make(map[string]string, len(envs))
	for _, env := range envs {
		values[env.Name] = env.Value
	}
	return values
}

func restoreSourceJobTemplate(parentRunID uint) *batch.Job {
	return &batch.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "sg-old",
			Namespace: "orbit-workspace",
			Labels: map[string]string{
				crclient.LabelKeyTaskType:    string(model.JobTypeCustom),
				crclient.LabelKeyTaskUser:    "old-user",
				crclient.LalbeKeyTaskAccount: "old-account",
				crclient.LabelKeyBaseURL:     "old-base",
			},
			Annotations: map[string]string{
				AnnotationKeyTaskName:          "old-name",
				service.ExperimentAnnotationID: "1",
				service.ExperimentAnnotationRunID: strconv.FormatUint(
					uint64(parentRunID),
					10,
				),
				checkpointsvc.AnnotationKeyConfig: `{"enabled":true,"resumeMode":"auto"}`,
			},
		},
		Spec: batch.JobSpec{Tasks: []batch.TaskSpec{{
			Template: v1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						crclient.LabelKeyTaskType: string(model.JobTypeCustom),
					},
					Annotations: map[string]string{
						AnnotationKeyTaskName: "old-name",
					},
				},
				Spec: v1.PodSpec{Containers: []v1.Container{{
					Name: "custom",
					Env: []v1.EnvVar{
						{Name: "ORBIT_RUN_ID", Value: "old-run"},
						{Name: "ORBIT_RUN_TOKEN", Value: "old-token"},
						{Name: "ORBIT_API_BASE", Value: "http://old"},
						{Name: "ORBIT_RESUME_FROM", Value: "/old/checkpoint"},
						{Name: "USER_ENV", Value: "kept"},
					},
					VolumeMounts: []v1.VolumeMount{{
						Name:      "storage",
						MountPath: "/workspace",
						SubPath:   "users/u",
					}},
				}}},
			},
		}}},
	}
}

func ptrCheckpointInfo(info *model.CheckpointInfo) *datatypes.JSONType[*model.CheckpointInfo] {
	value := datatypes.NewJSONType(info)
	return &value
}
