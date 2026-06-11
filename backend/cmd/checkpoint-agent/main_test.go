package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestProcessManifestCopiesToFinalAndPostsFinalPath(t *testing.T) {
	stagingDir := t.TempDir()
	finalDir := t.TempDir()
	source := filepath.Join(stagingDir, "checkpoint-1.pt")
	mustWriteAgentFile(t, source, "checkpoint")
	mustWriteAgentFile(t, source+fileSuccessSuffix, "ok")
	mustWriteAgentManifest(t, source+manifestSuffix, manifest{
		SchemaVersion: manifestSchemaV2,
		CheckpointID:  "checkpoint-id",
		JobName:       "job-a",
		RunID:         "7",
		Framework:     "pytorch",
		Format:        "file",
		Name:          "checkpoint-1.pt",
		Path:          source,
		Step:          1,
		Status:        "committed",
		StoragePath:   source,
		StagingPath:   source,
		SizeBytes:     int64(len("checkpoint")),
	})

	var event checkpointEvent
	oldTransport := http.DefaultClient.Transport
	http.DefaultClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/internal/checkpoints/events" {
			t.Fatalf("unexpected event path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			t.Fatalf("decode event: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(bytes.NewReader(nil)),
			Header:     make(http.Header),
		}, nil
	})
	t.Cleanup(func() {
		http.DefaultClient.Transport = oldTransport
	})

	if err := processManifest(context.Background(), source+manifestSuffix, stagingDir, finalDir, finalLayoutFlat, "http://checkpoint-agent.test"); err != nil {
		t.Fatalf("processManifest() error = %v", err)
	}

	dest := filepath.Join(finalDir, "checkpoint-1.pt")
	if got := mustReadAgentFile(t, dest); got != "checkpoint" {
		t.Fatalf("copied checkpoint = %q", got)
	}
	var finalManifest manifest
	data := mustReadAgentFile(t, dest+manifestSuffix)
	if err := json.Unmarshal([]byte(data), &finalManifest); err != nil {
		t.Fatalf("decode final manifest: %v", err)
	}
	if finalManifest.Path != dest || finalManifest.StoragePath != dest || finalManifest.StagingPath != source {
		t.Fatalf("final manifest paths = %#v, want dest/storagePath=%q staging=%q", finalManifest, dest, source)
	}
	if event.Path != dest || event.StoragePath != dest || event.JobName != "job-a" || event.RunID != "7" {
		t.Fatalf("event = %#v, want final path %q", event, dest)
	}
}

func TestCopyResumeCheckpointCopiesSourceToLocalPath(t *testing.T) {
	source := filepath.Join(t.TempDir(), "checkpoint-2")
	dest := filepath.Join(t.TempDir(), "resume")
	mustWriteAgentFile(t, filepath.Join(source, "model.bin"), "weights")
	mustWriteAgentFile(t, filepath.Join(source, successMarker), "ok")

	if err := copyResumeCheckpoint(context.Background(), source, dest); err != nil {
		t.Fatalf("copyResumeCheckpoint() error = %v", err)
	}
	if got := mustReadAgentFile(t, filepath.Join(dest, "model.bin")); got != "weights" {
		t.Fatalf("prefetched file = %q", got)
	}
	if _, err := os.Stat(filepath.Join(dest, successMarker)); err != nil {
		t.Fatalf("resume success marker missing: %v", err)
	}
	if _, err := os.Stat(dest + manifestSuffix); !os.IsNotExist(err) {
		t.Fatalf("resume manifest exists or stat failed with non-not-exist error: %v", err)
	}
}

func mustWriteAgentManifest(t *testing.T, path string, item manifest) {
	t.Helper()
	data, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteAgentFile(t, path, string(data))
}

func mustWriteAgentFile(t *testing.T, path string, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustReadAgentFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
