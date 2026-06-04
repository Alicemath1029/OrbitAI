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
	db := newExperimentTestDB(t)

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
		{ClientRecordID: "metric-1", Name: "loss", Step: 1, Value: 0.9},
		{ClientRecordID: "metric-2", Name: "loss", Step: 2, Value: 0.7},
	}); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	if err := svc.LogMetrics(ctx, runResult.Run.ID, []MetricInput{
		{ClientRecordID: "metric-1", Name: "loss", Step: 1, Value: 0.9},
	}); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	if err := svc.MergeParams(ctx, runResult.Run.ID, datatypes.JSONMap{"batch_size": 32}); err != nil {
		t.Fatalf("merge params: %v", err)
	}
	if _, err := svc.CreateArtifact(ctx, runResult.Run.ID, ArtifactInput{
		ClientRecordID: "artifact-1",
		Name:           "final_model",
		Type:           "model",
		Path:           "/outputs/model",
	}); err != nil {
		t.Fatalf("create artifact: %v", err)
	}
	if _, err := svc.CreateArtifact(ctx, runResult.Run.ID, ArtifactInput{
		ClientRecordID: "artifact-1",
		Name:           "final_model",
		Type:           "model",
		Path:           "/outputs/model",
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

func TestExperimentRunAccessFollowsExperimentVisibility(t *testing.T) {
	db := newExperimentTestDB(t)
	ctx := context.Background()
	svc := NewExperimentServiceWithDB(db)
	owner := util.JWTMessage{UserID: 1, AccountID: 1, RolePlatform: model.RoleUser}
	peer := util.JWTMessage{UserID: 2, AccountID: 1, RolePlatform: model.RoleUser}
	outsider := util.JWTMessage{UserID: 3, AccountID: 2, RolePlatform: model.RoleUser}

	privateExp, err := svc.CreateExperiment(ctx, CreateExperimentInput{
		Name: "private", UserID: owner.UserID, AccountID: owner.AccountID, Visibility: model.ExperimentVisibilityPrivate,
	})
	if err != nil {
		t.Fatalf("create private experiment: %v", err)
	}
	privateRun, err := svc.CreateRun(ctx, CreateRunInput{
		ExperimentID: privateExp.ID, JobName: "job-private", UserID: owner.UserID, AccountID: owner.AccountID,
	})
	if err != nil {
		t.Fatalf("create private run: %v", err)
	}
	if _, err := svc.GetRun(ctx, privateRun.Run.ID, peer); !IsRecordNotFound(err) {
		t.Fatalf("peer private run access err = %v, want not found", err)
	}

	accountExp, err := svc.CreateExperiment(ctx, CreateExperimentInput{
		Name: "account", UserID: owner.UserID, AccountID: owner.AccountID, Visibility: model.ExperimentVisibilityAccount,
	})
	if err != nil {
		t.Fatalf("create account experiment: %v", err)
	}
	accountRun, err := svc.CreateRun(ctx, CreateRunInput{
		ExperimentID: accountExp.ID, JobName: "job-account", UserID: owner.UserID, AccountID: owner.AccountID,
	})
	if err != nil {
		t.Fatalf("create account run: %v", err)
	}
	if err := svc.LogMetrics(ctx, accountRun.Run.ID, []MetricInput{{Name: "loss", Step: 1, Value: 1}}); err != nil {
		t.Fatalf("log account metric: %v", err)
	}
	if _, err := svc.CreateArtifact(ctx, accountRun.Run.ID, ArtifactInput{Name: "model", Path: "/model"}); err != nil {
		t.Fatalf("create account artifact: %v", err)
	}
	if _, err := svc.GetRun(ctx, accountRun.Run.ID, peer); err != nil {
		t.Fatalf("peer account run access: %v", err)
	}
	if _, err := svc.ListMetrics(ctx, accountRun.Run.ID, peer); err != nil {
		t.Fatalf("peer account metrics access: %v", err)
	}
	if _, err := svc.ListArtifacts(ctx, accountRun.Run.ID, peer); err != nil {
		t.Fatalf("peer account artifacts access: %v", err)
	}
	if _, err := svc.GetRun(ctx, accountRun.Run.ID, outsider); !IsRecordNotFound(err) {
		t.Fatalf("outsider account run access err = %v, want not found", err)
	}
}

func TestExperimentMetricsQueryAndReproducePlan(t *testing.T) {
	db := newExperimentTestDB(t)
	ctx := context.Background()
	svc := NewExperimentServiceWithDB(db)
	token := util.JWTMessage{UserID: 1, AccountID: 1, RolePlatform: model.RoleUser}

	exp, err := svc.CreateExperiment(ctx, CreateExperimentInput{
		Name: "query", UserID: token.UserID, AccountID: token.AccountID, Visibility: model.ExperimentVisibilityPrivate,
	})
	if err != nil {
		t.Fatalf("create experiment: %v", err)
	}
	runResult, err := svc.CreateRun(ctx, CreateRunInput{
		ExperimentID: exp.ID,
		JobName:      "job-query",
		RunName:      "query-run",
		UserID:       token.UserID,
		AccountID:    token.AccountID,
	})
	if err != nil {
		t.Fatalf("create run: %v", err)
	}

	var inputs []MetricInput
	for step := int64(0); step < 10; step++ {
		inputs = append(inputs,
			MetricInput{Name: "loss", Step: step, Value: float64(10 - step)},
			MetricInput{Name: "acc", Step: step, Value: float64(step) / 10},
		)
	}
	if err := svc.LogMetrics(ctx, runResult.Run.ID, inputs); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	start, end := int64(2), int64(8)
	metrics, err := svc.ListMetrics(ctx, runResult.Run.ID, token, MetricListQuery{
		Names:      []string{"loss"},
		StartStep:  &start,
		EndStep:    &end,
		Limit:      100,
		Downsample: 3,
	})
	if err != nil {
		t.Fatalf("list filtered metrics: %v", err)
	}
	if len(metrics) != 3 {
		t.Fatalf("metrics len = %d, want 3: %#v", len(metrics), metrics)
	}
	for _, metric := range metrics {
		if metric.Name != "loss" || metric.Step < start || metric.Step > end {
			t.Fatalf("metric = %#v, want filtered loss metric", metric)
		}
	}
	if metrics[0].Step != 2 || metrics[2].Step != 8 {
		t.Fatalf("downsampled steps = (%d, %d), want first/last in range", metrics[0].Step, metrics[2].Step)
	}

	runID := runResult.Run.ID
	checkpoint := model.JobCheckpoint{
		RunID:       &runID,
		JobName:     "job-query",
		UserID:      token.UserID,
		AccountID:   token.AccountID,
		Framework:   "pytorch",
		Name:        "checkpoint-8.pt",
		Path:        "/workspace/checkpoints/checkpoint-8.pt",
		StoragePath: "users/u/checkpoint-8.pt",
		Step:        8,
		SizeBytes:   128,
		Status:      model.JobCheckpointStatusReady,
		Latest:      true,
	}
	if err := db.Create(&checkpoint).Error; err != nil {
		t.Fatalf("create checkpoint: %v", err)
	}
	if err := svc.UpsertCheckpointArtifact(ctx, runResult.Run.ID, checkpoint); err != nil {
		t.Fatalf("upsert checkpoint artifact: %v", err)
	}
	plan, err := svc.ReproduceRun(ctx, runResult.Run.ID, token, "query-rerun")
	if err != nil {
		t.Fatalf("reproduce run: %v", err)
	}
	if plan.Mode != "checkpoint-restore" || plan.Restore == nil {
		t.Fatalf("plan = %#v, want checkpoint restore plan", plan)
	}
	if plan.Restore.JobName != "job-query" || plan.Restore.CheckpointID != checkpoint.ID || plan.Restore.Name != "query-rerun" {
		t.Fatalf("restore plan = %#v, want checkpoint restore target", plan.Restore)
	}
}

func newExperimentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
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
		&model.JobCheckpoint{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}
