package checkpoint

import (
	"strconv"
	"strings"

	v1 "k8s.io/api/core/v1"
)

const checkpointEnvCapacity = 12

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
	)
}
