package model

import (
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type ExperimentVisibility string

const (
	ExperimentVisibilityPrivate ExperimentVisibility = "private"
	ExperimentVisibilityAccount ExperimentVisibility = "account"
)

type ExperimentRunStatus string

const (
	ExperimentRunStatusPending    ExperimentRunStatus = "pending"
	ExperimentRunStatusRunning    ExperimentRunStatus = "running"
	ExperimentRunStatusSucceeded  ExperimentRunStatus = "succeeded"
	ExperimentRunStatusFailed     ExperimentRunStatus = "failed"
	ExperimentRunStatusTerminated ExperimentRunStatus = "terminated"
	//nolint:misspell // Keep the existing API value spelling for compatibility.
	ExperimentRunStatusCancelled ExperimentRunStatus = "cancelled"
)

type Experiment struct {
	gorm.Model
	Name        string               `json:"name" gorm:"type:varchar(256);not null;index:idx_experiments_scope_name"`
	Description string               `json:"description" gorm:"type:text"`
	UserID      uint                 `json:"userID" gorm:"not null;index:idx_experiments_scope_name"`
	User        User                 `json:"-" gorm:"foreignKey:UserID"`
	AccountID   uint                 `json:"accountID" gorm:"not null;index:idx_experiments_scope_name"`
	Account     Account              `json:"-" gorm:"foreignKey:AccountID"`
	Visibility  ExperimentVisibility `json:"visibility" gorm:"type:varchar(32);not null;default:private"`
	Tags        datatypes.JSONMap    `json:"tags" gorm:"type:jsonb;comment:实验标签"`
}

type ExperimentRun struct {
	gorm.Model
	ExperimentID       uint                `json:"experimentID" gorm:"not null;index"`
	Experiment         Experiment          `json:"-" gorm:"foreignKey:ExperimentID"`
	ParentRunID        *uint               `json:"parentRunID" gorm:"index;comment:来源实验 Run ID"`
	SourceCheckpointID *uint               `json:"sourceCheckpointID" gorm:"index;comment:来源 checkpoint ID"`
	JobID              *uint               `json:"jobID" gorm:"index"`
	JobName            string              `json:"jobName" gorm:"type:varchar(256);index;comment:绑定的作业名"`
	RunName            string              `json:"runName" gorm:"type:varchar(256);not null"`
	Status             ExperimentRunStatus `json:"status" gorm:"type:varchar(32);not null;default:pending;index"`
	UserID             uint                `json:"userID" gorm:"not null;index"`
	AccountID          uint                `json:"accountID" gorm:"not null;index"`
	RunTokenHash       string              `json:"-" gorm:"type:varchar(128);not null"`
	Hyperparams        datatypes.JSONMap   `json:"hyperparams" gorm:"type:jsonb;comment:超参数"`
	CodeSnapshot       datatypes.JSONMap   `json:"codeSnapshot" gorm:"type:jsonb;comment:代码快照"`
	DataSnapshot       datatypes.JSONMap   `json:"dataSnapshot" gorm:"type:jsonb;comment:数据快照"`
	ImageSnapshot      datatypes.JSONMap   `json:"imageSnapshot" gorm:"type:jsonb;comment:镜像快照"`
	ResourceSnapshot   datatypes.JSONMap   `json:"resourceSnapshot" gorm:"type:jsonb;comment:资源快照"`
	CheckpointSnapshot datatypes.JSONMap   `json:"checkpointSnapshot" gorm:"type:jsonb;comment:checkpoint快照"`
	ReproduceSnapshot  datatypes.JSONMap   `json:"reproduceSnapshot" gorm:"type:jsonb;comment:复现快照"`
	Tags               datatypes.JSONMap   `json:"tags" gorm:"type:jsonb;comment:Run标签"`
	StartedAt          *time.Time          `json:"startedAt"`
	FinishedAt         *time.Time          `json:"finishedAt"`
}

type RunMetric struct {
	gorm.Model
	RunID          uint              `json:"runID" gorm:"not null;index:idx_run_metric_name_step,priority:1;uniqueIndex:idx_run_metric_client_record,priority:1"` //nolint:lll // GORM index tags are intentionally descriptive.
	Run            ExperimentRun     `json:"-" gorm:"foreignKey:RunID"`
	ClientRecordID *string           `json:"clientRecordID" gorm:"type:varchar(64);uniqueIndex:idx_run_metric_client_record,priority:2;comment:SDK离线记录ID"` //nolint:lll // GORM index tags are intentionally descriptive.
	Name           string            `json:"name" gorm:"type:varchar(256);not null;index:idx_run_metric_name_step,priority:2"`
	Step           int64             `json:"step" gorm:"not null;index:idx_run_metric_name_step,priority:3"`
	Value          float64           `json:"value" gorm:"not null"`
	Timestamp      time.Time         `json:"timestamp" gorm:"not null;index"`
	Context        datatypes.JSONMap `json:"context" gorm:"type:jsonb"`
}

type RunArtifact struct {
	gorm.Model
	RunID          uint              `json:"runID" gorm:"not null;index;uniqueIndex:idx_run_artifact_client_record,priority:1"`
	Run            ExperimentRun     `json:"-" gorm:"foreignKey:RunID"`
	ClientRecordID *string           `json:"clientRecordID" gorm:"type:varchar(64);uniqueIndex:idx_run_artifact_client_record,priority:2;comment:SDK离线记录ID"` //nolint:lll // GORM index tags are intentionally descriptive.
	Name           string            `json:"name" gorm:"type:varchar(256);not null"`
	Type           string            `json:"type" gorm:"type:varchar(64);not null;default:file"`
	Path           string            `json:"path" gorm:"type:text;not null"`
	SizeBytes      int64             `json:"sizeBytes" gorm:"not null;default:0"`
	SourceType     string            `json:"sourceType" gorm:"type:varchar(64);index;uniqueIndex:idx_run_artifact_source,priority:1;comment:来源类型"` //nolint:lll // GORM index tags are intentionally descriptive.
	SourceID       *uint             `json:"sourceID" gorm:"index;uniqueIndex:idx_run_artifact_source,priority:2;comment:来源记录ID"`
	Metadata       datatypes.JSONMap `json:"metadata" gorm:"type:jsonb"`
}
