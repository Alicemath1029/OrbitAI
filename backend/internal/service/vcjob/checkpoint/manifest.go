package checkpoint

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gorm.io/datatypes"

	"github.com/raids-lab/orbit/dao/model"
)

const (
	checkpointManifestSuffix        = ".orbit.json"
	checkpointManifestReadLimit     = 64 * 1024
	checkpointSHA256BufferSize      = 1024 * 1024
	checkpointManifestSchemaVersion = "orbit.checkpoint.manifest.v1"

	checkpointValidationStatusKey = "validationStatus"
	checkpointValidationErrorsKey = "validationErrors"
	checkpointValidationValid     = "valid"
	checkpointValidationInvalid   = "invalid"
)

type checkpointManifest struct {
	SchemaVersion string            `json:"schemaVersion"`
	Framework     string            `json:"framework"`
	Format        string            `json:"format"`
	Name          string            `json:"name"`
	Path          string            `json:"path"`
	Step          *int64            `json:"step"`
	SizeBytes     *int64            `json:"sizeBytes"`
	SHA256        string            `json:"sha256"`
	RunID         string            `json:"runID"`
	JobName       string            `json:"jobName"`
	CreatedAt     string            `json:"createdAt"`
	Metadata      datatypes.JSONMap `json:"metadata"`
}

type manifestValidationTarget struct {
	ActualSize int64
	FilePath   string
	JobName    string
	RunID      *uint
}

func parseCheckpointManifest(data []byte) (*checkpointManifest, error) {
	var manifest checkpointManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	return &manifest, nil
}

func validateCheckpointManifest(
	ctx context.Context,
	manifest *checkpointManifest,
	target manifestValidationTarget,
) []string {
	if manifest == nil {
		return nil
	}
	issues := make([]string, 0)
	issues = append(issues, validateManifestBasics(manifest)...)
	issues = append(issues, validateManifestTargetFields(manifest, target)...)
	if shaIssue := validateManifestSHA256(ctx, manifest, target.FilePath); shaIssue != "" {
		issues = append(issues, shaIssue)
	}
	return issues
}

func validateManifestBasics(manifest *checkpointManifest) []string {
	issues := make([]string, 0)
	if schema := strings.TrimSpace(manifest.SchemaVersion); schema != "" && schema != checkpointManifestSchemaVersion {
		issues = append(issues, fmt.Sprintf("unsupported schemaVersion %q", schema))
	}
	if manifest.Step != nil && *manifest.Step < 0 {
		issues = append(issues, "step must be non-negative")
	}
	if schemaIssue := validateFrameworkCheckpointSchema(manifest); schemaIssue != "" {
		issues = append(issues, schemaIssue)
	}
	return issues
}

func validateManifestTargetFields(manifest *checkpointManifest, target manifestValidationTarget) []string {
	issues := make([]string, 0)
	if manifest.SizeBytes != nil && target.ActualSize >= 0 && *manifest.SizeBytes != target.ActualSize {
		issues = append(issues, fmt.Sprintf("sizeBytes mismatch: manifest=%d actual=%d", *manifest.SizeBytes, target.ActualSize))
	}
	if jobName := strings.TrimSpace(manifest.JobName); jobName != "" && target.JobName != "" && jobName != target.JobName {
		issues = append(issues, fmt.Sprintf("jobName mismatch: manifest=%q job=%q", jobName, target.JobName))
	}
	if runID := strings.TrimSpace(manifest.RunID); runID != "" && target.RunID != nil {
		parsed, err := strconv.ParseUint(runID, 10, 64)
		if err != nil || parsed == 0 {
			issues = append(issues, fmt.Sprintf("runID %q is invalid", runID))
		} else if uint(parsed) != *target.RunID {
			issues = append(issues, fmt.Sprintf("runID mismatch: manifest=%d run=%d", parsed, *target.RunID))
		}
	}
	return issues
}

func validateManifestSHA256(ctx context.Context, manifest *checkpointManifest, filePath string) string {
	sha := strings.TrimSpace(manifest.SHA256)
	if sha == "" || filePath == "" {
		return ""
	}
	actual, err := sha256File(ctx, filePath)
	if err != nil {
		return fmt.Sprintf("sha256 verification failed: %v", err)
	}
	if actual != "" && !strings.EqualFold(sha, actual) {
		return "sha256 mismatch"
	}
	return ""
}

func validateFrameworkCheckpointSchema(manifest *checkpointManifest) string {
	if manifest == nil || manifest.Metadata == nil {
		return ""
	}
	raw, ok := manifest.Metadata["checkpointSchemaVersion"]
	if !ok {
		return ""
	}
	schema, ok := raw.(string)
	if !ok {
		return "checkpointSchemaVersion must be a string"
	}
	schema = strings.TrimSpace(schema)
	if schema == "" {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(manifest.Framework)) {
	case FrameworkPytorch:
		if schema != "orbit.pytorch.checkpoint.v1" {
			return fmt.Sprintf("unsupported pytorch checkpoint schema %q", schema)
		}
	case FrameworkFSDP:
		if schema != "orbit.fsdp.checkpoint.v1" {
			return fmt.Sprintf("unsupported fsdp checkpoint schema %q", schema)
		}
	case FrameworkDeepSpeed:
		if schema != "orbit.deepspeed.checkpoint.v1" {
			return fmt.Sprintf("unsupported deepspeed checkpoint schema %q", schema)
		}
	case FrameworkHFTrainer:
		if schema != "orbit.hf-trainer.checkpoint.v1" {
			return fmt.Sprintf("unsupported hf-trainer checkpoint schema %q", schema)
		}
	case FrameworkLightning:
		if schema != "orbit.lightning.checkpoint.v1" {
			return fmt.Sprintf("unsupported lightning checkpoint schema %q", schema)
		}
	case FrameworkTensorFlow:
		if schema != "orbit.tensorflow.checkpoint.v1" {
			return fmt.Sprintf("unsupported tensorflow checkpoint schema %q", schema)
		}
	case FrameworkJAX:
		if schema != "orbit.jax.checkpoint.v1" {
			return fmt.Sprintf("unsupported jax checkpoint schema %q", schema)
		}
	}
	return ""
}

func sha256File(ctx context.Context, path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", nil
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	digest := sha256.New()
	buf := make([]byte, checkpointSHA256BufferSize)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, err := file.Read(buf)
		if n > 0 {
			if _, writeErr := digest.Write(buf[:n]); writeErr != nil {
				return "", writeErr
			}
		}
		if err == nil {
			continue
		}
		if err == io.EOF {
			break
		}
		return "", err
	}
	return fmt.Sprintf("%x", digest.Sum(nil)), nil
}

func manifestPathForCheckpoint(path string) string {
	return path + checkpointManifestSuffix
}

func applyManifestToCheckpoint(checkpoint *model.JobCheckpoint, manifest *checkpointManifest, manifestStoragePath string) {
	if checkpoint == nil || manifest == nil {
		return
	}
	if name := strings.TrimSpace(manifest.Name); name != "" {
		checkpoint.Name = name
	}
	if path := strings.TrimSpace(manifest.Path); path != "" {
		checkpoint.Path = filepath.ToSlash(filepath.Clean(path))
	}
	if framework := strings.TrimSpace(manifest.Framework); framework != "" {
		checkpoint.Framework = strings.ToLower(framework)
	}
	if manifest.Step != nil {
		checkpoint.Step = *manifest.Step
	}
	if manifest.SizeBytes != nil && checkpoint.SizeBytes == 0 {
		checkpoint.SizeBytes = *manifest.SizeBytes
	}
	checkpoint.Metadata = mergeManifestMetadata(checkpoint.Metadata, manifest, manifestStoragePath)
}

func applyManifestValidationToCheckpoint(checkpoint *model.JobCheckpoint, issues []string) {
	if checkpoint == nil || len(issues) == 0 {
		return
	}
	if checkpoint.Metadata == nil {
		checkpoint.Metadata = datatypes.JSONMap{}
	}
	checkpoint.Status = model.JobCheckpointStatusInvalid
	checkpoint.Latest = false
	checkpoint.Metadata[checkpointValidationStatusKey] = checkpointValidationInvalid
	checkpoint.Metadata[checkpointValidationErrorsKey] = issues
}

func applyManifestParseErrorToCheckpoint(checkpoint *model.JobCheckpoint, manifestStoragePath string, err error) {
	if checkpoint == nil || err == nil {
		return
	}
	if checkpoint.Metadata == nil {
		checkpoint.Metadata = datatypes.JSONMap{}
	}
	checkpoint.Status = model.JobCheckpointStatusInvalid
	checkpoint.Latest = false
	checkpoint.Metadata[checkpointValidationStatusKey] = checkpointValidationInvalid
	checkpoint.Metadata[checkpointValidationErrorsKey] = []string{fmt.Sprintf("manifest parse failed: %v", err)}
	if manifestStoragePath != "" {
		checkpoint.Metadata["manifestStoragePath"] = filepath.ToSlash(filepath.Clean(manifestStoragePath))
	}
}

func mergeManifestMetadata(
	metadata datatypes.JSONMap,
	manifest *checkpointManifest,
	manifestStoragePath string,
) datatypes.JSONMap {
	next := cloneJSONMap(metadata)
	if next == nil {
		next = datatypes.JSONMap{}
	}
	for key, value := range manifest.Metadata {
		next[key] = value
	}
	if manifest.SchemaVersion != "" {
		next["manifestSchemaVersion"] = manifest.SchemaVersion
	}
	if manifestStoragePath != "" {
		next["manifestStoragePath"] = filepath.ToSlash(filepath.Clean(manifestStoragePath))
	}
	if manifest.SHA256 != "" {
		next["sha256"] = manifest.SHA256
	}
	if manifest.Format != "" {
		next["format"] = manifest.Format
	}
	if manifest.CreatedAt != "" {
		next["manifestCreatedAt"] = manifest.CreatedAt
	}
	if manifest.RunID != "" {
		next["manifestRunID"] = manifest.RunID
	}
	if manifest.JobName != "" {
		next["manifestJobName"] = manifest.JobName
	}
	return next
}
