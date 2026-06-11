package checkpoint

import (
	"path/filepath"
	"strconv"
	"strings"

	v1 "k8s.io/api/core/v1"

	"github.com/raids-lab/orbit/pkg/config"
)

const checkpointEnvCapacity = 20

func AppendEnvs(envs []v1.EnvVar, cfg *Config, jobName string) []v1.EnvVar {
	if cfg == nil || !cfg.Enabled {
		return envs
	}

	filtered := make([]v1.EnvVar, 0, len(envs)+checkpointEnvCapacity)
	for _, env := range envs {
		if strings.HasPrefix(env.Name, "ORBIT_") {
			continue
		}
		filtered = append(filtered, env)
	}

	return append(filtered,
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_ENABLED", Value: strconv.FormatBool(cfg.Enabled)},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_FRAMEWORK", Value: cfg.Framework},
		v1.EnvVar{Name: "ORBIT_PROJECT_NAME", Value: cfg.ProjectName},
		v1.EnvVar{Name: "ORBIT_EXPERIMENT_NAME", Value: cfg.ExperimentName},
		v1.EnvVar{Name: "ORBIT_JOB_NAME", Value: jobName},
		v1.EnvVar{Name: "ORBIT_OUTPUT_DIR", Value: cfg.OutputDir},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_DIR", Value: cfg.CheckpointDir},
		v1.EnvVar{Name: "ORBIT_RESUME_MODE", Value: cfg.ResumeMode},
		v1.EnvVar{Name: "ORBIT_RESUME_FROM", Value: cfg.ResumeFrom},
		v1.EnvVar{Name: "ORBIT_SAVE_STEPS", Value: strconv.Itoa(cfg.SaveSteps)},
		v1.EnvVar{Name: "ORBIT_SAVE_TOTAL_LIMIT", Value: strconv.Itoa(cfg.MaxToKeep)},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_MAX_BYTES", Value: strconv.FormatInt(cfg.MaxBytes, 10)},
		v1.EnvVar{Name: "ORBIT_LATEST_CHECKPOINT", Value: cfg.LatestCheckpoint},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_STAGING_DIR", Value: checkpointStagingMountPath()},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_FINAL_DIR", Value: checkpointFinalRoot(cfg)},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_FINAL_LAYOUT", Value: checkpointFinalLayout()},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_STORAGE_BACKEND", Value: checkpointStorageBackend()},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_AGENT_ENABLED", Value: strconv.FormatBool(checkpointAgentEnabled())},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_UPLOAD_CONCURRENCY", Value: strconv.Itoa(checkpointUploadConcurrency())},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_BANDWIDTH_LIMIT", Value: config.GetConfig().Checkpoint.Agent.BandwidthLimit},
		v1.EnvVar{Name: "ORBIT_CHECKPOINT_PREFETCH", Value: strconv.FormatBool(strings.TrimSpace(cfg.ResumeFrom) != "")},
		v1.EnvVar{Name: "ORBIT_RESUME_LOCAL_PATH", Value: filepath.ToSlash(filepath.Join(checkpointStagingMountPath(), "resume"))},
	)
}

func checkpointStagingMountPath() string {
	if mountPath := strings.TrimSpace(config.GetConfig().Checkpoint.Staging.MountPath); mountPath != "" {
		return mountPath
	}
	return "/checkpoint-staging"
}

func checkpointFinalRoot(cfg *Config) string {
	if root := strings.TrimSpace(config.GetConfig().Checkpoint.Storage.FinalRoot); root != "" {
		return root
	}
	if cfg != nil && strings.TrimSpace(cfg.CheckpointDir) != "" {
		return cfg.CheckpointDir
	}
	return checkpointStagingMountPath()
}

func checkpointFinalLayout() string {
	if strings.TrimSpace(config.GetConfig().Checkpoint.Storage.FinalRoot) != "" {
		return "job"
	}
	return "flat"
}

func checkpointStorageBackend() string {
	if backend := strings.TrimSpace(config.GetConfig().Checkpoint.Storage.Backend); backend != "" {
		return backend
	}
	return "pvc"
}

func checkpointAgentEnabled() bool {
	cfg := config.GetConfig().Checkpoint.Agent
	return cfg.Enabled || strings.TrimSpace(cfg.Image) != ""
}

func checkpointUploadConcurrency() int {
	concurrency := config.GetConfig().Checkpoint.Agent.UploadConcurrency
	if concurrency <= 0 {
		return 4
	}
	return concurrency
}
