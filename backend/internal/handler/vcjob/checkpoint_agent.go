package vcjob

import (
	"path/filepath"
	"strconv"
	"strings"

	v1 "k8s.io/api/core/v1"

	"github.com/raids-lab/orbit/pkg/config"
)

const (
	checkpointAgentContainerName = "checkpoint-agent"
	checkpointStagingVolumeName  = "checkpoint-staging"
	defaultCheckpointAgentImage  = "orbit-checkpoint-agent"
)

func applyCheckpointAgent(podSpec *v1.PodSpec, checkpoint *CheckpointConfig) {
	if podSpec == nil || checkpoint == nil || !checkpoint.Enabled || !checkpointAgentEnabledForPod() {
		return
	}

	stagingMountPath := checkpointStagingMountPathForPod()
	ensureCheckpointStagingVolume(podSpec)
	stagingMount := v1.VolumeMount{Name: checkpointStagingVolumeName, MountPath: stagingMountPath}
	for i := range podSpec.Containers {
		ensureVolumeMount(&podSpec.Containers[i], stagingMount)
	}
	if hasContainer(podSpec, checkpointAgentContainerName) || hasInitContainer(podSpec, checkpointAgentContainerName) {
		return
	}

	agentMounts := cloneVolumeMounts(podSpec.Containers[0].VolumeMounts)
	ensureVolumeMountsContain(&agentMounts, stagingMount)
	restartAlways := v1.ContainerRestartPolicyAlways
	podSpec.InitContainers = append(podSpec.InitContainers, v1.Container{
		Name:            checkpointAgentContainerName,
		Image:           checkpointAgentImage(),
		Command:         []string{"/checkpoint-agent"},
		ImagePullPolicy: v1.PullIfNotPresent,
		RestartPolicy:   &restartAlways,
		Env: []v1.EnvVar{
			{Name: "ORBIT_CHECKPOINT_STAGING_DIR", Value: stagingMountPath},
			{Name: "ORBIT_CHECKPOINT_DIR", Value: checkpoint.CheckpointDir},
			{Name: "ORBIT_CHECKPOINT_FINAL_DIR", Value: checkpointFinalRootForPod(checkpoint)},
			{Name: "ORBIT_CHECKPOINT_FINAL_LAYOUT", Value: checkpointFinalLayoutForPod()},
			{Name: "ORBIT_CHECKPOINT_STORAGE_BACKEND", Value: checkpointStorageBackendForPod()},
			{Name: "ORBIT_CHECKPOINT_UPLOAD_CONCURRENCY", Value: strconv.Itoa(checkpointUploadConcurrencyForPod())},
			{Name: "ORBIT_CHECKPOINT_BANDWIDTH_LIMIT", Value: config.GetConfig().Checkpoint.Agent.BandwidthLimit},
			{Name: "ORBIT_CHECKPOINT_SCANNER_MODE", Value: checkpointScannerModeForPod()},
			{Name: "ORBIT_INTERNAL_API_BASE", Value: checkpointAgentBackendEndpoint()},
			{Name: "ORBIT_RESUME_FROM", Value: checkpoint.ResumeFrom},
			{Name: "ORBIT_RESUME_LOCAL_PATH", Value: filepath.ToSlash(filepath.Join(stagingMountPath, "resume"))},
			{Name: "ORBIT_CHECKPOINT_PREFETCH", Value: strconv.FormatBool(strings.TrimSpace(checkpoint.ResumeFrom) != "")},
		},
		VolumeMounts: agentMounts,
	})
}

func ensureCheckpointStagingVolume(podSpec *v1.PodSpec) {
	for i := range podSpec.Volumes {
		if podSpec.Volumes[i].Name == checkpointStagingVolumeName {
			return
		}
	}
	medium := v1.StorageMediumDefault
	if strings.EqualFold(strings.TrimSpace(config.GetConfig().Checkpoint.Staging.Medium), "memory") {
		medium = v1.StorageMediumMemory
	}
	podSpec.Volumes = append(podSpec.Volumes, v1.Volume{
		Name: checkpointStagingVolumeName,
		VolumeSource: v1.VolumeSource{
			EmptyDir: &v1.EmptyDirVolumeSource{Medium: medium},
		},
	})
}

func ensureVolumeMount(container *v1.Container, mount v1.VolumeMount) {
	if container == nil {
		return
	}
	ensureVolumeMountsContain(&container.VolumeMounts, mount)
}

func ensureVolumeMountsContain(mounts *[]v1.VolumeMount, mount v1.VolumeMount) {
	for i := range *mounts {
		if (*mounts)[i].Name == mount.Name || (*mounts)[i].MountPath == mount.MountPath {
			return
		}
	}
	*mounts = append(*mounts, mount)
}

func hasContainer(podSpec *v1.PodSpec, name string) bool {
	for i := range podSpec.Containers {
		if podSpec.Containers[i].Name == name {
			return true
		}
	}
	return false
}

func hasInitContainer(podSpec *v1.PodSpec, name string) bool {
	for i := range podSpec.InitContainers {
		if podSpec.InitContainers[i].Name == name {
			return true
		}
	}
	return false
}

func cloneVolumeMounts(mounts []v1.VolumeMount) []v1.VolumeMount {
	cloned := make([]v1.VolumeMount, len(mounts))
	copy(cloned, mounts)
	return cloned
}

func checkpointAgentEnabledForPod() bool {
	agent := config.GetConfig().Checkpoint.Agent
	return agent.Enabled || strings.TrimSpace(agent.Image) != ""
}

func checkpointAgentImage() string {
	if image := strings.TrimSpace(config.GetConfig().Checkpoint.Agent.Image); image != "" {
		return image
	}
	return defaultCheckpointAgentImage
}

func checkpointStagingMountPathForPod() string {
	if path := strings.TrimSpace(config.GetConfig().Checkpoint.Staging.MountPath); path != "" {
		return filepath.ToSlash(filepath.Clean(path))
	}
	return "/checkpoint-staging"
}

func checkpointFinalRootForPod(checkpoint *CheckpointConfig) string {
	if root := strings.TrimSpace(config.GetConfig().Checkpoint.Storage.FinalRoot); root != "" {
		return filepath.ToSlash(filepath.Clean(root))
	}
	if checkpoint != nil && strings.TrimSpace(checkpoint.CheckpointDir) != "" {
		return filepath.ToSlash(filepath.Clean(checkpoint.CheckpointDir))
	}
	return checkpointStagingMountPathForPod()
}

func checkpointFinalLayoutForPod() string {
	if strings.TrimSpace(config.GetConfig().Checkpoint.Storage.FinalRoot) != "" {
		return "job"
	}
	return "flat"
}

func checkpointStorageBackendForPod() string {
	if backend := strings.TrimSpace(config.GetConfig().Checkpoint.Storage.Backend); backend != "" {
		return backend
	}
	return "pvc"
}

func checkpointUploadConcurrencyForPod() int {
	if concurrency := config.GetConfig().Checkpoint.Agent.UploadConcurrency; concurrency > 0 {
		return concurrency
	}
	return 4
}

func checkpointScannerModeForPod() string {
	if mode := strings.TrimSpace(config.GetConfig().Checkpoint.Scanner.Mode); mode != "" {
		return mode
	}
	return "reconcile"
}

func checkpointAgentBackendEndpoint() string {
	return strings.TrimRight(strings.TrimSpace(config.GetConfig().Checkpoint.Agent.BackendEndpoint), "/")
}
