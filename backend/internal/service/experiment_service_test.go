package service

import (
	"context"
	"testing"

	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/internal/util"
)

func TestExperimentServiceRunIngestFlow(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.User{},
		&model.Account{},
		&model.Experiment{},
		&model.ExperimentRun{},
		&model.RunMetric{},
		&model.RunArtifact{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	ctx := context.Background()
	svc := NewExperimentServiceWithDB(db)
	token := util.JWTMessage{
		UserID:       1,
		AccountID:    1,
		RolePlatform: model.RoleUser,
	}

	exp, err := svc.CreateExperiment(ctx, CreateExperimentInput{
		Name:       "baseline",
		UserID:     token.UserID,
		AccountID:  token.AccountID,
		Visibility: model.ExperimentVisibilityPrivate,
		Tags:       datatypes.JSONMap{"stage": "test"},
	})
	if err != nil {
		t.Fatalf("create experiment: %v", err)
	}

	runResult, err := svc.CreateRun(ctx, CreateRunInput{
		ExperimentID: exp.ID,
		JobName:      "job-001",
		RunName:      "lr-1e-4",
		UserID:       token.UserID,
		AccountID:    token.AccountID,
		Hyperparams:  datatypes.JSONMap{"lr": 0.0001},
		CodeSnapshot: datatypes.JSONMap{"commit": "abc123"},
		Tags:         datatypes.JSONMap{"kind": "sft"},
	})
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	if runResult.Token == "" {
		t.Fatal("create run returned empty token")
	}

	if _, err := svc.VerifyRunToken(ctx, runResult.Run.ID, runResult.Token); err != nil {
		t.Fatalf("verify run token: %v", err)
	}
	if err := svc.LogMetrics(ctx, runResult.Run.ID, []MetricInput{
		{Name: "loss", Step: 1, Value: 0.9},
		{Name: "loss", Step: 2, Value: 0.7},
	}); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	if err := svc.MergeParams(ctx, runResult.Run.ID, datatypes.JSONMap{"batch_size": 32}); err != nil {
		t.Fatalf("merge params: %v", err)
	}
	if _, err := svc.CreateArtifact(ctx, runResult.Run.ID, ArtifactInput{
		Name: "final_model",
		Type: "model",
		Path: "/outputs/model",
	}); err != nil {
		t.Fatalf("create artifact: %v", err)
	}
	if err := svc.FinishRun(ctx, runResult.Run.ID, model.ExperimentRunStatusSucceeded); err != nil {
		t.Fatalf("finish run: %v", err)
	}

	runs, err := svc.ListRuns(ctx, exp.ID, token)
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	if len(runs) != 1 || runs[0].RunName != "lr-1e-4" {
		t.Fatalf("runs = %#v, want one lr-1e-4 run", runs)
	}
	if runs[0].Status != model.ExperimentRunStatusSucceeded {
		t.Fatalf("run status = %s, want succeeded", runs[0].Status)
	}
	if _, ok := runs[0].Hyperparams["batch_size"]; !ok {
		t.Fatalf("merged hyperparams = %#v, want batch_size", runs[0].Hyperparams)
	}

	metrics, err := svc.ListMetrics(ctx, runResult.Run.ID, token)
	if err != nil {
		t.Fatalf("list metrics: %v", err)
	}
	if len(metrics) != 2 || metrics[1].Value != 0.7 {
		t.Fatalf("metrics = %#v, want two loss points", metrics)
	}

	artifacts, err := svc.ListArtifacts(ctx, runResult.Run.ID, token)
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	if len(artifacts) != 1 || artifacts[0].Path != "/outputs/model" {
		t.Fatalf("artifacts = %#v, want final model artifact", artifacts)
	}
}
