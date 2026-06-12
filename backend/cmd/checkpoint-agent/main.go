package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultPollInterval = 2 * time.Second
	manifestSuffix      = ".orbit.json"
	successMarker       = "_SUCCESS"
	fileSuccessSuffix   = "._SUCCESS"
	manifestSchemaV2    = "orbit.checkpoint.manifest.v2"
	finalLayoutFlat     = "flat"
	finalLayoutJob      = "job"
	statusStaged        = "staged"
	statusUploading     = "uploading"
	statusCommitted     = "committed"
	statusFailed        = "failed"
	internalTokenHeader = "X-Orbit-Internal-Token"
)

type manifest struct {
	SchemaVersion  string         `json:"schemaVersion"`
	CheckpointID   string         `json:"checkpointID"`
	JobName        string         `json:"jobName"`
	RunID          string         `json:"runID"`
	Framework      string         `json:"framework"`
	Format         string         `json:"format"`
	Name           string         `json:"name"`
	Path           string         `json:"path"`
	Step           int64          `json:"step"`
	Status         string         `json:"status"`
	Distributed    bool           `json:"distributed"`
	WorldSize      int            `json:"worldSize"`
	StorageBackend string         `json:"storageBackend"`
	StoragePath    string         `json:"storagePath"`
	StagingPath    string         `json:"stagingPath"`
	SizeBytes      int64          `json:"sizeBytes"`
	SHA256         string         `json:"sha256"`
	CreatedAt      string         `json:"createdAt"`
	CommittedAt    string         `json:"committedAt"`
	Metadata       map[string]any `json:"metadata"`
}

type checkpointEvent struct {
	CheckpointID uint           `json:"checkpointID,omitempty"`
	JobName      string         `json:"jobName,omitempty"`
	RunID        string         `json:"runID,omitempty"`
	Path         string         `json:"path,omitempty"`
	StoragePath  string         `json:"storagePath,omitempty"`
	Status       string         `json:"status"`
	Step         *int64         `json:"step,omitempty"`
	SizeBytes    *int64         `json:"sizeBytes,omitempty"`
	Framework    string         `json:"framework,omitempty"`
	Format       string         `json:"format,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	stagingDir := firstEnv("ORBIT_CHECKPOINT_STAGING_DIR", "/checkpoint-staging")
	finalDir := firstEnv("ORBIT_CHECKPOINT_FINAL_DIR", "/orbit/checkpoints")
	storagePrefix := firstEnv("ORBIT_CHECKPOINT_STORAGE_PREFIX", "")
	finalLayout := firstEnv("ORBIT_CHECKPOINT_FINAL_LAYOUT", finalLayoutJob)
	backendURL := strings.TrimRight(firstEnv("ORBIT_INTERNAL_API_BASE", ""), "/")
	internalToken := firstEnv("ORBIT_CHECKPOINT_INTERNAL_TOKEN", "")
	resumeFrom := firstEnv("ORBIT_RESUME_FROM", "")
	resumeLocalPath := firstEnv("ORBIT_RESUME_LOCAL_PATH", filepath.Join(stagingDir, "resume"))
	prefetchResume := boolEnv("ORBIT_CHECKPOINT_PREFETCH") && resumeFrom != ""
	resumePrefetched := false
	processed := map[string]time.Time{}

	for {
		if err := ctx.Err(); err != nil {
			return
		}
		if prefetchResume && !resumePrefetched {
			if err := copyResumeCheckpoint(ctx, resumeFrom, resumeLocalPath); err != nil {
				fmt.Fprintf(os.Stderr, "checkpoint-agent: resume prefetch: %v\n", err)
			} else {
				resumePrefetched = true
			}
		}
		if err := processStaging(ctx, stagingDir, finalDir, storagePrefix, finalLayout, backendURL, internalToken, processed); err != nil {
			fmt.Fprintf(os.Stderr, "checkpoint-agent: %v\n", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(defaultPollInterval):
		}
	}
}

func processStaging(
	ctx context.Context,
	stagingDir string,
	finalDir string,
	storagePrefix string,
	finalLayout string,
	backendURL string,
	internalToken string,
	processed map[string]time.Time,
) error {
	return filepath.WalkDir(stagingDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), manifestSuffix) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if last, ok := processed[path]; ok && !info.ModTime().After(last) {
			return nil
		}
		if err := processManifest(ctx, path, stagingDir, finalDir, storagePrefix, finalLayout, backendURL, internalToken); err != nil {
			return err
		}
		processed[path] = info.ModTime()
		return nil
	})
}

func processManifest(
	ctx context.Context,
	manifestPath string,
	stagingDir string,
	finalDir string,
	storagePrefix string,
	finalLayout string,
	backendURL string,
	internalToken string,
) error {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return err
	}
	var item manifest
	if err := json.Unmarshal(data, &item); err != nil {
		return err
	}
	if item.SchemaVersion != manifestSchemaV2 || (item.Status != statusStaged && item.Status != statusCommitted) {
		return nil
	}
	source := strings.TrimSuffix(manifestPath, manifestSuffix)
	sourceInfo, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !successMarkerExists(source, sourceInfo.IsDir()) {
		return nil
	}

	dest := finalPath(finalDir, finalLayout, item, source, stagingDir)
	finalStoragePath := finalStoragePath(storagePrefix, finalDir, dest, item.StoragePath)
	finalManifest := finalManifestForDestination(item, source, dest, finalStoragePath)
	if backendURL != "" {
		step := item.Step
		size := item.SizeBytes
		if err := postEvent(ctx, backendURL, internalToken, checkpointEvent{
			JobName:     item.JobName,
			RunID:       item.RunID,
			Path:        finalManifest.Path,
			StoragePath: finalManifest.StoragePath,
			Status:      statusUploading,
			Step:        &step,
			SizeBytes:   &size,
			Framework:   item.Framework,
			Format:      item.Format,
			Metadata: map[string]any{
				"checkpointID": item.CheckpointID,
			},
		}); err != nil {
			return err
		}
	}
	if filepath.Clean(source) != filepath.Clean(dest) {
		if err := copyPathAtomically(source, dest); err != nil {
			postFailedEvent(ctx, backendURL, internalToken, item, finalManifest, err)
			return err
		}
		if err := writeManifest(dest+manifestSuffix, finalManifest); err != nil {
			postFailedEvent(ctx, backendURL, internalToken, item, finalManifest, err)
			return err
		}
		if err := writeSuccessMarker(dest, sourceInfo.IsDir()); err != nil {
			postFailedEvent(ctx, backendURL, internalToken, item, finalManifest, err)
			return err
		}
	} else if item.Path != finalManifest.Path || item.StoragePath != finalManifest.StoragePath || item.StagingPath != finalManifest.StagingPath {
		if err := writeManifest(manifestPath, finalManifest); err != nil {
			postFailedEvent(ctx, backendURL, internalToken, item, finalManifest, err)
			return err
		}
	}
	if backendURL != "" {
		size := item.SizeBytes
		step := item.Step
		if err := postEvent(ctx, backendURL, internalToken, checkpointEvent{
			JobName:     item.JobName,
			RunID:       item.RunID,
			Path:        finalManifest.Path,
			StoragePath: finalManifest.StoragePath,
			Status:      statusCommitted,
			Step:        &step,
			SizeBytes:   &size,
			Framework:   item.Framework,
			Format:      item.Format,
			Metadata: map[string]any{
				"checkpointID": item.CheckpointID,
				"agentCopied":  true,
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

func finalPath(finalDir string, finalLayout string, item manifest, source string, stagingDir string) string {
	name := item.Name
	if name == "" {
		name = filepath.Base(source)
	}
	if strings.EqualFold(strings.TrimSpace(finalLayout), finalLayoutJob) {
		jobName := item.JobName
		if jobName == "" {
			jobName = "unknown-job"
		}
		return filepath.Join(finalDir, jobName, name)
	}
	return filepath.Join(finalDir, name)
}

func finalStoragePath(storagePrefix string, finalDir string, dest string, fallback string) string {
	storagePrefix = cleanRelativePath(storagePrefix)
	if storagePrefix != "" {
		if rel, err := filepath.Rel(filepath.Clean(finalDir), filepath.Clean(dest)); err == nil && rel != "." {
			return filepath.ToSlash(filepath.Join(storagePrefix, rel))
		}
		return storagePrefix
	}
	if cleaned := cleanRelativePath(fallback); cleaned != "" {
		return cleaned
	}
	return filepath.ToSlash(dest)
}

func cleanRelativePath(path string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	if path == "" || filepath.IsAbs(path) {
		return ""
	}
	cleaned := filepath.ToSlash(filepath.Clean(path))
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return ""
	}
	return strings.TrimLeft(cleaned, "/")
}

func finalManifestForDestination(item manifest, source string, dest string, storagePath string) manifest {
	next := item
	if next.Metadata == nil {
		next.Metadata = map[string]any{}
	}
	next.Path = filepath.ToSlash(dest)
	next.StoragePath = filepath.ToSlash(storagePath)
	next.StagingPath = filepath.ToSlash(source)
	next.Status = statusCommitted
	next.CommittedAt = time.Now().UTC().Format(time.RFC3339)
	next.Metadata["agentCopied"] = true
	return next
}

func writeManifest(path string, item manifest) error {
	data, err := json.MarshalIndent(item, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func copyResumeCheckpoint(ctx context.Context, source string, dest string) error {
	source = strings.TrimSpace(source)
	dest = strings.TrimSpace(dest)
	if source == "" || dest == "" || filepath.Clean(source) == filepath.Clean(dest) {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	if err := copyPath(source, dest); err != nil {
		return err
	}
	return writeSuccessMarker(dest, info.IsDir())
}

func boolEnv(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func successMarkerExists(path string, isDir bool) bool {
	_, err := os.Stat(successMarkerPath(path, isDir))
	return err == nil
}

func writeSuccessMarker(path string, isDir bool) error {
	marker := successMarkerPath(path, isDir)
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		return err
	}
	return os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)), 0o644)
}

func successMarkerPath(path string, isDir bool) string {
	if isDir {
		return filepath.Join(path, successMarker)
	}
	return path + fileSuccessSuffix
}

func copyPath(source string, dest string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return copyDir(source, dest)
	}
	return copyFile(source, dest)
}

func copyPathAtomically(source string, dest string) error {
	tmp := dest + ".tmp." + strconv.Itoa(os.Getpid())
	if err := os.RemoveAll(tmp); err != nil {
		return err
	}
	if err := copyPath(source, tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	if err := os.RemoveAll(dest); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	return nil
}

func copyDir(source string, dest string) error {
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(source string, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}

func postFailedEvent(ctx context.Context, backendURL string, internalToken string, item manifest, finalManifest manifest, cause error) {
	if backendURL == "" || cause == nil {
		return
	}
	step := item.Step
	size := item.SizeBytes
	err := postEvent(ctx, backendURL, internalToken, checkpointEvent{
		JobName:     item.JobName,
		RunID:       item.RunID,
		Path:        finalManifest.Path,
		StoragePath: finalManifest.StoragePath,
		Status:      statusFailed,
		Step:        &step,
		SizeBytes:   &size,
		Framework:   item.Framework,
		Format:      item.Format,
		Metadata: map[string]any{
			"checkpointID": item.CheckpointID,
			"error":        cause.Error(),
		},
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "checkpoint-agent: failed to post failure event: %v\n", err)
	}
}

func postEvent(ctx context.Context, backendURL string, internalToken string, event checkpointEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, backendURL+"/internal/checkpoints/events", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(internalToken) != "" {
		req.Header.Set(internalTokenHeader, strings.TrimSpace(internalToken))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return errors.New(resp.Status)
	}
	return nil
}

func firstEnv(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
