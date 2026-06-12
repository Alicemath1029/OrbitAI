package vcjob

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCheckpointInternalRoutesRequireToken(t *testing.T) {
	t.Setenv("ORBIT_CHECKPOINT_INTERNAL_TOKEN", "secret-token")
	gin.SetMode(gin.TestMode)

	router := gin.New()
	group := router.Group("/internal/checkpoints")
	RegisterCheckpointInternalRoutes(group)

	req := httptest.NewRequest(http.MethodPost, "/internal/checkpoints/events", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status without token = %d, want %d", resp.Code, http.StatusUnauthorized)
	}

	req = httptest.NewRequest(http.MethodPost, "/internal/checkpoints/events", nil)
	req.Header.Set(checkpointInternalTokenHeader, "secret-token")
	resp = httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code == http.StatusUnauthorized || resp.Code == http.StatusForbidden {
		t.Fatalf("status with token = %d, want handler to run", resp.Code)
	}
}
