package vcjob

import (
	"testing"
	"time"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	batch "volcano.sh/apis/pkg/apis/batch/v1alpha1"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/internal/service"
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

func envValues(envs []v1.EnvVar) map[string]string {
	values := make(map[string]string, len(envs))
	for _, env := range envs {
		values[env.Name] = env.Value
	}
	return values
}
