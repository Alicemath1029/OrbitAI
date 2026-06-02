package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"

	"github.com/raids-lab/orbit/dao/model"
	"github.com/raids-lab/orbit/internal/resputil"
	"github.com/raids-lab/orbit/internal/service"
	"github.com/raids-lab/orbit/internal/util"
)

//nolint:gochecknoinits // This is the standard way to register a gin handler.
func init() {
	Registers = append(Registers, NewExperimentMgr)
}

type ExperimentMgr struct {
	name string
	svc  *service.ExperimentService
}

func NewExperimentMgr(_ *RegisterConfig) Manager {
	return &ExperimentMgr{
		name: "experiments",
		svc:  service.NewExperimentService(),
	}
}

func (mgr *ExperimentMgr) GetName() string { return mgr.name }

func (mgr *ExperimentMgr) RegisterPublic(_ *gin.RouterGroup) {}

func (mgr *ExperimentMgr) RegisterPublicV1(g *gin.RouterGroup) {
	g.POST("runs/:runID/metrics", mgr.LogMetricsByRunToken)
	g.POST("runs/:runID/params", mgr.LogParamsByRunToken)
	g.POST("runs/:runID/tags", mgr.LogTagsByRunToken)
	g.POST("runs/:runID/artifacts", mgr.CreateArtifactByRunToken)
	g.POST("runs/:runID/finish", mgr.FinishRunByRunToken)
}

func (mgr *ExperimentMgr) RegisterProtected(g *gin.RouterGroup) {
	g.GET("", mgr.ListExperiments)
	g.POST("", mgr.CreateExperiment)
	g.GET(":id", mgr.GetExperiment)
	g.PUT(":id", mgr.UpdateExperiment)
	g.GET(":id/runs", mgr.ListRuns)
	g.GET("runs/:runID", mgr.GetRun)
	g.GET("runs/:runID/metrics", mgr.ListMetrics)
	g.GET("runs/:runID/artifacts", mgr.ListArtifacts)
}

func (mgr *ExperimentMgr) RegisterAdmin(_ *gin.RouterGroup) {}

type createExperimentReq struct {
	Name        string                     `json:"name" binding:"required"`
	Description string                     `json:"description"`
	Visibility  model.ExperimentVisibility `json:"visibility"`
	Tags        datatypes.JSONMap          `json:"tags"`
}

type updateExperimentReq struct {
	Name        *string                     `json:"name"`
	Description *string                     `json:"description"`
	Visibility  *model.ExperimentVisibility `json:"visibility"`
	Tags        *datatypes.JSONMap          `json:"tags"`
}

type metricsBatchReq struct {
	Metrics []service.MetricInput `json:"metrics"`
}

type paramsReq struct {
	Params datatypes.JSONMap `json:"params"`
}

type tagsReq struct {
	Tags datatypes.JSONMap `json:"tags"`
}

type finishRunReq struct {
	Status model.ExperimentRunStatus `json:"status"`
}

func (mgr *ExperimentMgr) ListExperiments(c *gin.Context) {
	token := util.GetToken(c)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	items, total, err := mgr.svc.ListExperiments(c.Request.Context(), token, limit, offset)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.ServiceError)
		return
	}
	resputil.Success(c, resputil.List[model.Experiment]{Items: items, Total: total})
}

func (mgr *ExperimentMgr) CreateExperiment(c *gin.Context) {
	token := util.GetToken(c)
	var req createExperimentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	exp, err := mgr.svc.CreateExperiment(c.Request.Context(), service.CreateExperimentInput{
		Name:        req.Name,
		Description: req.Description,
		Visibility:  req.Visibility,
		Tags:        req.Tags,
		UserID:      token.UserID,
		AccountID:   token.AccountID,
	})
	if err != nil {
		resputil.Error(c, err.Error(), resputil.ServiceError)
		return
	}
	resputil.Success(c, exp)
}

func (mgr *ExperimentMgr) GetExperiment(c *gin.Context) {
	token := util.GetToken(c)
	id, ok := bindUintParam(c, "id")
	if !ok {
		return
	}
	exp, err := mgr.svc.GetExperiment(c.Request.Context(), id, token)
	if err != nil {
		writeExperimentError(c, err)
		return
	}
	resputil.Success(c, exp)
}

func (mgr *ExperimentMgr) UpdateExperiment(c *gin.Context) {
	token := util.GetToken(c)
	id, ok := bindUintParam(c, "id")
	if !ok {
		return
	}
	var req updateExperimentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	exp, err := mgr.svc.UpdateExperiment(c.Request.Context(), id, token, service.UpdateExperimentInput{
		Name:        req.Name,
		Description: req.Description,
		Visibility:  req.Visibility,
		Tags:        req.Tags,
	})
	if err != nil {
		writeExperimentError(c, err)
		return
	}
	resputil.Success(c, exp)
}

func (mgr *ExperimentMgr) ListRuns(c *gin.Context) {
	token := util.GetToken(c)
	id, ok := bindUintParam(c, "id")
	if !ok {
		return
	}
	runs, err := mgr.svc.ListRuns(c.Request.Context(), id, token)
	if err != nil {
		writeExperimentError(c, err)
		return
	}
	resputil.Success(c, runs)
}

func (mgr *ExperimentMgr) GetRun(c *gin.Context) {
	token := util.GetToken(c)
	runID, ok := bindUintParam(c, "runID")
	if !ok {
		return
	}
	run, err := mgr.svc.GetRun(c.Request.Context(), runID, token)
	if err != nil {
		writeExperimentError(c, err)
		return
	}
	resputil.Success(c, run)
}

func (mgr *ExperimentMgr) ListMetrics(c *gin.Context) {
	token := util.GetToken(c)
	runID, ok := bindUintParam(c, "runID")
	if !ok {
		return
	}
	metrics, err := mgr.svc.ListMetrics(c.Request.Context(), runID, token)
	if err != nil {
		writeExperimentError(c, err)
		return
	}
	resputil.Success(c, metrics)
}

func (mgr *ExperimentMgr) ListArtifacts(c *gin.Context) {
	token := util.GetToken(c)
	runID, ok := bindUintParam(c, "runID")
	if !ok {
		return
	}
	artifacts, err := mgr.svc.ListArtifacts(c.Request.Context(), runID, token)
	if err != nil {
		writeExperimentError(c, err)
		return
	}
	resputil.Success(c, artifacts)
}

func (mgr *ExperimentMgr) LogMetricsByRunToken(c *gin.Context) {
	run, ok := mgr.verifyRunToken(c)
	if !ok {
		return
	}
	var req metricsBatchReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	if err := mgr.svc.LogMetrics(c.Request.Context(), run.ID, req.Metrics); err != nil {
		resputil.Error(c, err.Error(), resputil.ServiceError)
		return
	}
	resputil.Success(c, gin.H{"accepted": len(req.Metrics)})
}

func (mgr *ExperimentMgr) LogParamsByRunToken(c *gin.Context) {
	run, ok := mgr.verifyRunToken(c)
	if !ok {
		return
	}
	var req paramsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	if err := mgr.svc.MergeParams(c.Request.Context(), run.ID, req.Params); err != nil {
		resputil.Error(c, err.Error(), resputil.ServiceError)
		return
	}
	resputil.Success(c, gin.H{"accepted": len(req.Params)})
}

func (mgr *ExperimentMgr) LogTagsByRunToken(c *gin.Context) {
	run, ok := mgr.verifyRunToken(c)
	if !ok {
		return
	}
	var req tagsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	if err := mgr.svc.MergeTags(c.Request.Context(), run.ID, req.Tags); err != nil {
		resputil.Error(c, err.Error(), resputil.ServiceError)
		return
	}
	resputil.Success(c, gin.H{"accepted": len(req.Tags)})
}

func (mgr *ExperimentMgr) CreateArtifactByRunToken(c *gin.Context) {
	run, ok := mgr.verifyRunToken(c)
	if !ok {
		return
	}
	var req service.ArtifactInput
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	artifact, err := mgr.svc.CreateArtifact(c.Request.Context(), run.ID, req)
	if err != nil {
		resputil.Error(c, err.Error(), resputil.ServiceError)
		return
	}
	resputil.Success(c, artifact)
}

func (mgr *ExperimentMgr) FinishRunByRunToken(c *gin.Context) {
	run, ok := mgr.verifyRunToken(c)
	if !ok {
		return
	}
	var req finishRunReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	if err := mgr.svc.FinishRun(c.Request.Context(), run.ID, req.Status); err != nil {
		resputil.BadRequestError(c, err.Error())
		return
	}
	resputil.Success(c, gin.H{"status": req.Status})
}

func (mgr *ExperimentMgr) verifyRunToken(c *gin.Context) (*model.ExperimentRun, bool) {
	runID, ok := bindUintParam(c, "runID")
	if !ok {
		return nil, false
	}
	token := c.GetHeader("X-Orbit-Run-Token")
	if token == "" {
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}
	run, err := mgr.svc.VerifyRunToken(c.Request.Context(), runID, token)
	if err != nil {
		resputil.HTTPError(c, http.StatusUnauthorized, err.Error(), resputil.TokenInvalid)
		return nil, false
	}
	return run, true
}

func bindUintParam(c *gin.Context, name string) (uint, bool) {
	raw := c.Param(name)
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		resputil.BadRequestError(c, "invalid "+name)
		return 0, false
	}
	return uint(value), true
}

func writeExperimentError(c *gin.Context, err error) {
	if service.IsRecordNotFound(err) {
		resputil.HTTPError(c, http.StatusNotFound, "not found", resputil.InvalidRequest)
		return
	}
	resputil.Error(c, err.Error(), resputil.ServiceError)
}
