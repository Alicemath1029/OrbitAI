package reconciler

import (
	"reflect"
	"testing"

	batch "volcano.sh/apis/pkg/apis/batch/v1alpha1"
)

func TestGetPodNameFromJobTemplateHandlesNilJob(t *testing.T) {
	if got := getPodNameFromJobTemplate(nil); got != "" {
		t.Fatalf("getPodNameFromJobTemplate(nil) = %q, want empty", got)
	}
	if got := getPodNamesFromJobTemplate(nil); got != nil {
		t.Fatalf("getPodNamesFromJobTemplate(nil) = %#v, want nil", got)
	}
}

func TestGetPodNamesFromJobTemplate(t *testing.T) {
	job := &batch.Job{}
	job.Name = "job-a"
	job.Spec.Tasks = []batch.TaskSpec{
		{Name: "worker", Replicas: 2},
		{Name: "ignored", Replicas: 0},
	}

	if got := getPodNameFromJobTemplate(job); got != "job-a-worker-0" {
		t.Fatalf("getPodNameFromJobTemplate() = %q, want job-a-worker-0", got)
	}
	want := []string{"job-a-worker-0", "job-a-worker-1"}
	if got := getPodNamesFromJobTemplate(job); !reflect.DeepEqual(got, want) {
		t.Fatalf("getPodNamesFromJobTemplate() = %#v, want %#v", got, want)
	}
}
