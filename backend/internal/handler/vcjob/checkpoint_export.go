package vcjob

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/dao/query"
	"github.com/raids-lab/orbit/internal/resputil"
	checkpointsvc "github.com/raids-lab/orbit/internal/service/vcjob/checkpoint"
	"github.com/raids-lab/orbit/internal/util"
	"github.com/raids-lab/orbit/pkg/config"
	"github.com/raids-lab/orbit/pkg/constants"
	"github.com/raids-lab/orbit/pkg/utils"
)

const (
	defaultModelExportFormat = "huggingface"
	modelExportMountPath     = "/orbit"
	modelExportAppLabel      = "model-export"
	modelExportContainerName = "exporter"
)

type exportCheckpointReq struct {
	Format string `json:"format"`
	Name   string `json:"name"`
}

type exportCheckpointResp struct {
	Export model.ModelExport `json:"export"`
}

func (mgr *VolcanojobMgr) ExportCheckpointModel(c *gin.Context) {
	var uriReq checkpointActionReq
	if err := c.ShouldBindUri(&uriReq); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	var bodyReq exportCheckpointReq
	if err := c.ShouldBindJSON(&bodyReq); err != nil && err.Error() != "EOF" {
		resputil.BadRequestError(c, err.Error())
		return
	}

	token := util.GetToken(c)
	job, err := getJob(c, uriReq.JobName, &token)
	if err != nil {
		recordCheckpointOperation(c, constants.OpTypeExportCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), nil)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}
	checkpoint, err := getReadyCheckpoint(c, job, uriReq.CheckpointID)
	if err != nil {
		details := checkpointOpDetails(job, nil, nil)
		recordCheckpointOperation(c, constants.OpTypeExportCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	exportRecord, err := buildModelExportRecord(job, checkpoint, token, bodyReq)
	if err != nil {
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(c, constants.OpTypeExportCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	if err := query.GetDB().WithContext(c).Create(exportRecord).Error; err != nil {
		details := checkpointOpDetails(job, checkpoint, nil)
		recordCheckpointOperation(c, constants.OpTypeExportCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	exportJob := buildModelExportJob(exportRecord)
	if err := mgr.kubeClient.BatchV1().Jobs(config.GetConfig().Namespaces.Job).Delete(c, exportRecord.JobName, metav1.DeleteOptions{}); err != nil {
		klog.V(4).Infof("model export job %s did not need cleanup before submit: %v", exportRecord.JobName, err)
	}
	if _, err := mgr.kubeClient.BatchV1().Jobs(config.GetConfig().Namespaces.Job).Create(c, exportJob, metav1.CreateOptions{}); err != nil {
		now := time.Now()
		exportRecord.Status = model.ModelExportStatusFailed
		exportRecord.Message = fmt.Sprintf("submit export job failed: %v", err)
		exportRecord.FinishedAt = &now
		_ = query.GetDB().WithContext(c).Save(exportRecord).Error
		details := checkpointOpDetails(job, checkpoint, map[string]any{"exportID": exportRecord.ID})
		recordCheckpointOperation(c, constants.OpTypeExportCheckpoint, uriReq.JobName, constants.OpStatusFailed, err.Error(), details)
		resputil.Error(c, err.Error(), resputil.NotSpecified)
		return
	}

	now := time.Now()
	if err := query.GetDB().WithContext(c).Model(&model.ModelExport{}).
		Where("id = ?", exportRecord.ID).
		Updates(map[string]any{
			"status":     model.ModelExportStatusRunning,
			"started_at": &now,
		}).Error; err != nil {
		klog.Warningf("failed to mark model export %d running: %v", exportRecord.ID, err)
	} else {
		exportRecord.Status = model.ModelExportStatusRunning
		exportRecord.StartedAt = &now
	}

	details := checkpointOpDetails(job, checkpoint, map[string]any{
		"exportID":   exportRecord.ID,
		"exportName": exportRecord.Name,
		"format":     exportRecord.Format,
		"outputPath": exportRecord.OutputPath,
		"exportJob":  exportRecord.JobName,
	})
	recordCheckpointOperation(c, constants.OpTypeExportCheckpoint, uriReq.JobName, constants.OpStatusSuccess, "", details)
	resputil.Success(c, exportCheckpointResp{Export: *exportRecord})
}

func buildModelExportRecord(
	job *model.Job,
	checkpoint *model.JobCheckpoint,
	token util.JWTMessage,
	req exportCheckpointReq,
) (*model.ModelExport, error) {
	format := normalizeModelExportFormat(req.Format)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = defaultExportModelName(job, checkpoint)
	}
	name = sanitizeModelExportName(name)
	if name == "" {
		return nil, fmt.Errorf("export name is required")
	}
	if strings.TrimSpace(checkpoint.StoragePath) == "" {
		return nil, fmt.Errorf("checkpoint has no storage path")
	}
	framework := strings.TrimSpace(checkpoint.Framework)
	if framework == "" {
		framework = checkpointsvc.FrameworkCustom
	}
	outputPath := filepath.ToSlash(filepath.Join(config.GetConfig().Storage.Prefix.Public, "Models", name))
	exportJobName := utils.GenerateJobName("mexp", token.Username)

	metadata := cloneJSONMetadata(checkpoint.Metadata)
	metadata["source"] = "checkpoint-export"
	metadata["sourceCheckpointID"] = checkpoint.ID
	metadata["sourceCheckpointPath"] = checkpoint.Path

	return &model.ModelExport{
		JobID:             job.ID,
		RunID:             checkpoint.RunID,
		CheckpointID:      checkpoint.ID,
		SourceJobName:     job.JobName,
		UserID:            token.UserID,
		AccountID:         token.AccountID,
		Name:              name,
		Framework:         strings.ToLower(framework),
		Format:            format,
		CheckpointPath:    checkpoint.Path,
		CheckpointStorage: checkpoint.StoragePath,
		OutputPath:        outputPath,
		Status:            model.ModelExportStatusPending,
		JobName:           exportJobName,
		Metadata:          metadata,
	}, nil
}

func buildModelExportJob(exportRecord *model.ModelExport) *batchv1.Job {
	labels := map[string]string{
		"app":             modelExportAppLabel,
		"model-export-id": fmt.Sprintf("%d", exportRecord.ID),
		"user-id":         fmt.Sprintf("%d", exportRecord.UserID),
	}
	backoffLimit := int32(0)
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      exportRecord.JobName,
			Namespace: config.GetConfig().Namespaces.Job,
			Labels:    labels,
		},
		Spec: batchv1.JobSpec{
			BackoffLimit: &backoffLimit,
			Template: v1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: v1.PodSpec{
					RestartPolicy: v1.RestartPolicyNever,
					Containers: []v1.Container{
						{
							Name:    modelExportContainerName,
							Image:   modelExportImage(),
							Command: []string{"/bin/bash", "-lc"},
							Args:    []string{buildModelExportCommand(exportRecord)},
							Env: []v1.EnvVar{
								{Name: "ORBIT_EXPORT_ID", Value: fmt.Sprintf("%d", exportRecord.ID)},
								{Name: "ORBIT_EXPORT_FORMAT", Value: exportRecord.Format},
								{Name: "ORBIT_CHECKPOINT_FRAMEWORK", Value: exportRecord.Framework},
							},
							Resources: v1.ResourceRequirements{
								Requests: v1.ResourceList{
									v1.ResourceCPU:    resource.MustParse("1"),
									v1.ResourceMemory: resource.MustParse("2Gi"),
								},
								Limits: v1.ResourceList{
									v1.ResourceCPU:    resource.MustParse("4"),
									v1.ResourceMemory: resource.MustParse("8Gi"),
								},
							},
							VolumeMounts: []v1.VolumeMount{{
								Name:      "orbit-storage",
								MountPath: modelExportMountPath,
							}},
						},
					},
					Volumes: []v1.Volume{{
						Name: "orbit-storage",
						VolumeSource: v1.VolumeSource{
							PersistentVolumeClaim: &v1.PersistentVolumeClaimVolumeSource{
								ClaimName: config.GetConfig().Storage.PVC.ReadWriteMany,
							},
						},
					}},
				},
			},
		},
	}
}

func buildModelExportCommand(exportRecord *model.ModelExport) string {
	checkpointPath := filepath.ToSlash(filepath.Join(modelExportMountPath, exportRecord.CheckpointStorage))
	outputPath := filepath.ToSlash(filepath.Join(modelExportMountPath, exportRecord.OutputPath))
	command := frameworkExportCommand(exportRecord.Framework, exportRecord.Format, checkpointPath, outputPath)
	return fmt.Sprintf(`
set -euo pipefail
CHECKPOINT_DIR=%q
OUT_DIR=%q
export CHECKPOINT_DIR OUT_DIR
mkdir -p "$OUT_DIR"
echo "Exporting checkpoint $CHECKPOINT_DIR to $OUT_DIR as %s/%s"
%s
SIZE=$(du -sb "$OUT_DIR" 2>/dev/null | cut -f1 || echo 0)
echo "[RESULT] size_bytes=$SIZE output_path=%s"
`, checkpointPath, outputPath, exportRecord.Framework, exportRecord.Format, command, exportRecord.OutputPath)
}

func frameworkExportCommand(framework, format, checkpointPath, outputPath string) string {
	switch strings.ToLower(framework) {
	case checkpointsvc.FrameworkDeepSpeed:
		if format == "pytorch" {
			return fmt.Sprintf(`zero_to_fp32.py %q %q`, checkpointPath, filepath.ToSlash(filepath.Join(outputPath, "pytorch_model.bin")))
		}
		return fmt.Sprintf(`
if command -v zero_to_fp32.py >/dev/null 2>&1; then
  zero_to_fp32.py %q %q
else
  cp -a %q/. %q/
fi
`, checkpointPath, filepath.ToSlash(filepath.Join(outputPath, "pytorch_model.bin")), checkpointPath, outputPath)
	case checkpointsvc.FrameworkHFTrainer, checkpointsvc.FrameworkLightning:
		return fmt.Sprintf(`cp -a %q/. %q/`, checkpointPath, outputPath)
	case checkpointsvc.FrameworkPytorch, checkpointsvc.FrameworkFSDP:
		return fmt.Sprintf(`cp -a %q %q/`, checkpointPath, outputPath)
	default:
		return fmt.Sprintf(`cp -a %q/. %q/ 2>/dev/null || cp -a %q %q/`, checkpointPath, outputPath, checkpointPath, outputPath)
	}
}

func normalizeModelExportFormat(format string) string {
	format = strings.ToLower(strings.TrimSpace(format))
	if format == "" {
		return defaultModelExportFormat
	}
	return format
}

func defaultExportModelName(job *model.Job, checkpoint *model.JobCheckpoint) string {
	parts := []string{"checkpoint-export"}
	if job != nil && job.Name != "" {
		parts = append(parts, job.Name)
	} else if job != nil {
		parts = append(parts, job.JobName)
	}
	if checkpoint != nil {
		if checkpoint.Step >= 0 {
			parts = append(parts, fmt.Sprintf("step-%d", checkpoint.Step))
		} else {
			parts = append(parts, checkpoint.Name)
		}
	}
	return strings.Join(parts, "-")
}

func sanitizeModelExportName(name string) string {
	name = strings.TrimSpace(name)
	name = regexp.MustCompile(`[^A-Za-z0-9_.-]+`).ReplaceAllString(name, "-")
	name = regexp.MustCompile(`\.+`).ReplaceAllString(name, ".")
	name = strings.Trim(name, "-.")
	return name
}

func modelExportImage() string {
	if img := config.GetConfig().ModelDownload.Image; img != "" {
		return img
	}
	return "python:3.11-slim"
}

func cloneJSONMetadata(src datatypes.JSONMap) datatypes.JSONMap {
	dst := datatypes.JSONMap{}
	for key, value := range src {
		dst[key] = value
	}
	return dst
}
