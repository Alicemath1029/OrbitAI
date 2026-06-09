package model

import (
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type ModelExportStatus string

const (
	ModelExportStatusPending   ModelExportStatus = "pending"
	ModelExportStatusRunning   ModelExportStatus = "running"
	ModelExportStatusSucceeded ModelExportStatus = "succeeded"
	ModelExportStatusFailed    ModelExportStatus = "failed"
)

// ModelExport records an asynchronous conversion from a training checkpoint to an exported model artifact.
type ModelExport struct {
	gorm.Model
	JobID             uint              `json:"jobID" gorm:"not null;index;comment:来源作业 ID"`
	RunID             *uint             `json:"runID" gorm:"index;comment:来源实验 Run ID"`
	CheckpointID      uint              `json:"checkpointID" gorm:"not null;index;comment:来源 checkpoint ID"`
	Checkpoint        JobCheckpoint     `json:"-" gorm:"foreignKey:CheckpointID"`
	SourceJobName     string            `json:"sourceJobName" gorm:"type:varchar(256);not null;index;comment:来源作业名称"`
	UserID            uint              `json:"userID" gorm:"not null;index;comment:用户 ID"`
	AccountID         uint              `json:"accountID" gorm:"not null;index;comment:账户 ID"`
	Name              string            `json:"name" gorm:"type:varchar(256);not null;index;comment:导出模型名称"`
	Framework         string            `json:"framework" gorm:"type:varchar(32);not null;index;comment:checkpoint 框架"`
	Format            string            `json:"format" gorm:"type:varchar(64);not null;index;comment:目标模型格式"`
	CheckpointPath    string            `json:"checkpointPath" gorm:"type:varchar(1024);not null;comment:容器内 checkpoint 路径"`
	CheckpointStorage string            `json:"checkpointStorage" gorm:"type:varchar(1024);not null;comment:存储根目录下 checkpoint 相对路径"`
	OutputPath        string            `json:"outputPath" gorm:"type:varchar(1024);not null;comment:导出模型存储相对路径"`
	SizeBytes         int64             `json:"sizeBytes" gorm:"not null;default:0;comment:导出模型大小"`
	Status            ModelExportStatus `json:"status" gorm:"type:varchar(32);not null;default:pending;index;comment:导出状态"`
	JobName           string            `json:"jobName" gorm:"type:varchar(256);index;comment:Kubernetes Job 名称"`
	Message           string            `json:"message" gorm:"type:text;comment:错误或状态信息"`
	DatasetID         *uint             `json:"datasetID" gorm:"index;comment:导出成功后的模型数据记录 ID"`
	RunArtifactID     *uint             `json:"runArtifactID" gorm:"index;comment:导出成功后的 Run artifact ID"`
	StartedAt         *time.Time        `json:"startedAt"`
	FinishedAt        *time.Time        `json:"finishedAt"`
	Metadata          datatypes.JSONMap `json:"metadata" gorm:"type:jsonb;comment:导出元数据"`
}
