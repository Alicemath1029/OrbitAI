package checkpoint

import (
	"encoding/json"
	"path/filepath"
	"strings"

	"gorm.io/datatypes"

	"github.com/raids-lab/orbit/dao/model"
)

const (
	checkpointManifestSuffix    = ".orbit.json"
	checkpointManifestReadLimit = 64 * 1024
)

type checkpointManifest struct {
	SchemaVersion string            `json:"schemaVersion"`
	Framework     string            `json:"framework"`
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

func parseCheckpointManifest(data []byte) (*checkpointManifest, error) {
	var manifest checkpointManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	return &manifest, nil
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
