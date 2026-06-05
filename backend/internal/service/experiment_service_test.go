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

	exp := mustCreateExperiment(t, svc, ctx, CreateExperimentInput{
		Name:       "baseline",
		UserID:     token.UserID,
		AccountID:  token.AccountID,
		Visibility: model.ExperimentVisibilityPrivate,
		Tags:       datatypes.JSONMap{"stage": "test"},
	})
	runResult := mustCreateRun(t, svc, ctx, &CreateRunInput{
		ExperimentID: exp.ID,
		JobName:      "job-001",
		RunName:      "lr-1e-4",
		UserID:       token.UserID,
		AccountID:    token.AccountID,
		Hyperparams:  datatypes.JSONMap{"lr": 0.0001},
		CodeSnapshot: datatypes.JSONMap{"commit": "abc123"},
		Tags:         datatypes.JSONMap{"kind": "sft"},
	})
	if runResult.Token == "" {
		t.Fatal("create run returned empty token")
	}

	exerciseRunIngest(t, svc, ctx, runResult.Run.ID, runResult.Token)
	assertRunIngestFlow(t, svc, ctx, exp.ID, runResult.Run.ID, token)
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
	privateRun, err := svc.CreateRun(ctx, &CreateRunInput{
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
	accountRun, err := svc.CreateRun(ctx, &CreateRunInput{
		ExperimentID: accountExp.ID, JobName: "job-account", UserID: owner.UserID, AccountID: owner.AccountID,
	})
	if err != nil {
		t.Fatalf("create account run: %v", err)
	}
	if err := svc.LogMetrics(ctx, accountRun.Run.ID, []MetricInput{{Name: "loss", Step: 1, Value: 1}}); err != nil {
		t.Fatalf("log account metric: %v", err)
	}
	if _, err := svc.CreateArtifact(ctx, accountRun.Run.ID, &ArtifactInput{Name: "model", Path: "/model"}); err != nil {
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

	exp := mustCreateExperiment(t, svc, ctx, CreateExperimentInput{
		Name: "query", UserID: token.UserID, AccountID: token.AccountID, Visibility: model.ExperimentVisibilityPrivate,
	})
	runResult := mustCreateRun(t, svc, ctx, &CreateRunInput{
		ExperimentID: exp.ID,
		JobName:      "job-query",
		RunName:      "query-run",
		UserID:       token.UserID,
		AccountID:    token.AccountID,
	})

	assertMetricsQuery(t, svc, ctx, runResult.Run.ID, token)
	checkpoint := createCheckpointArtifactForRun(t, db, svc, ctx, runResult.Run.ID, token)
	assertReproducePlan(t, svc, ctx, runResult.Run.ID, token, checkpoint.ID)
}

func mustCreateExperiment(
	t *testing.T,
	svc *ExperimentService,
	ctx context.Context,
	input CreateExperimentInput,
) *model.Experiment {
	t.Helper()
	exp, err := svc.CreateExperiment(ctx, input)
	if err != nil {
		t.Fatalf("create experiment: %v", err)
	}
	return exp
}

func mustCreateRun(
	t *testing.T,
	svc *ExperimentService,
	ctx context.Context,
	input *CreateRunInput,
) *CreateRunResult {
	t.Helper()
	result, err := svc.CreateRun(ctx, input)
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	return result
}

func exerciseRunIngest(t *testing.T, svc *ExperimentService, ctx context.Context, runID uint, token string) {
	t.Helper()
	if _, err := svc.VerifyRunToken(ctx, runID, token); err != nil {
		t.Fatalf("verify run token: %v", err)
	}
	if err := svc.LogMetrics(ctx, runID, []MetricInput{
		{ClientRecordID: "metric-1", Name: "loss", Step: 1, Value: 0.9},
		{ClientRecordID: "metric-2", Name: "loss", Step: 2, Value: 0.7},
	}); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	if err := svc.LogMetrics(ctx, runID, []MetricInput{
		{ClientRecordID: "metric-1", Name: "loss", Step: 1, Value: 0.9},
	}); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	if err := svc.MergeParams(ctx, runID, datatypes.JSONMap{"batch_size": 32}); err != nil {
		t.Fatalf("merge params: %v", err)
	}
	artifact := &ArtifactInput{
		ClientRecordID: "artifact-1",
		Name:           "final_model",
		Type:           "model",
		Path:           "/outputs/model",
	}
	if _, err := svc.CreateArtifact(ctx, runID, artifact); err != nil {
		t.Fatalf("create artifact: %v", err)
	}
	if _, err := svc.CreateArtifact(ctx, runID, artifact); err != nil {
		t.Fatalf("create artifact: %v", err)
	}
	if err := svc.FinishRun(ctx, runID, model.ExperimentRunStatusSucceeded); err != nil {
		t.Fatalf("finish run: %v", err)
	}
}

func assertRunIngestFlow(
	t *testing.T,
	svc *ExperimentService,
	ctx context.Context,
	experimentID uint,
	runID uint,
	token util.JWTMessage,
) {
	t.Helper()
	runs, err := svc.ListRuns(ctx, experimentID, token)
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
	metrics, err := svc.ListMetrics(ctx, runID, token)
	if err != nil {
		t.Fatalf("list metrics: %v", err)
	}
	if len(metrics) != 2 || metrics[1].Value != 0.7 {
		t.Fatalf("metrics = %#v, want two loss points", metrics)
	}
	artifacts, err := svc.ListArtifacts(ctx, runID, token)
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	if len(artifacts) != 1 || artifacts[0].Path != "/outputs/model" {
		t.Fatalf("artifacts = %#v, want final model artifact", artifacts)
	}
}

func assertMetricsQuery(t *testing.T, svc *ExperimentService, ctx context.Context, runID uint, token util.JWTMessage) {
	t.Helper()
	var inputs []MetricInput
	for step := int64(0); step < 10; step++ {
		inputs = append(inputs,
			MetricInput{Name: "loss", Step: step, Value: float64(10 - step)},
			MetricInput{Name: "acc", Step: step, Value: float64(step) / 10},
		)
	}
	if err := svc.LogMetrics(ctx, runID, inputs); err != nil {
		t.Fatalf("log metrics: %v", err)
	}
	start, end := int64(2), int64(8)
	metrics, err := svc.ListMetrics(ctx, runID, token, MetricListQuery{
		Names:      []string{"loss"},
		StartStep:  &start,
		EndStep:    &end,
		Limit:      100,
		Downsample: 3,
	})
	if err != nil {
		t.Fatalf("list filtered metrics: %v", err)
	}
	assertFilteredMetrics(t, metrics, start, end)
}

func assertFilteredMetrics(t *testing.T, metrics []model.RunMetric, start, end int64) {
	t.Helper()
	if len(metrics) != 3 {
		t.Fatalf("metrics len = %d, want 3: %#v", len(metrics), metrics)
	}
	for i := range metrics {
		if metrics[i].Name != "loss" || metrics[i].Step < start || metrics[i].Step > end {
			t.Fatalf("metric = %#v, want filtered loss metric", metrics[i])
		}
	}
	if metrics[0].Step != start || metrics[2].Step != end {
		t.Fatalf("downsampled steps = (%d, %d), want first/last in range", metrics[0].Step, metrics[2].Step)
	}
}

func createCheckpointArtifactForRun(
	t *testing.T,
	db *gorm.DB,
	svc *ExperimentService,
	ctx context.Context,
	runID uint,
	token util.JWTMessage,
) model.JobCheckpoint {
	t.Helper()
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
	if err := svc.UpsertCheckpointArtifact(ctx, runID, &checkpoint); err != nil {
		t.Fatalf("upsert checkpoint artifact: %v", err)
	}
	return checkpoint
}

func assertReproducePlan(
	t *testing.T,
	svc *ExperimentService,
	ctx context.Context,
	runID uint,
	token util.JWTMessage,
	checkpointID uint,
) {
	t.Helper()
	plan, err := svc.ReproduceRun(ctx, runID, token, "query-rerun")
	if err != nil {
		t.Fatalf("reproduce run: %v", err)
	}
	if plan.Mode != "checkpoint-restore" || plan.Restore == nil {
		t.Fatalf("plan = %#v, want checkpoint restore plan", plan)
	}
	if plan.Restore.JobName != "job-query" || plan.Restore.CheckpointID != checkpointID || plan.Restore.Name != "query-rerun" {
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
