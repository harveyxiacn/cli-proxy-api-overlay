package management

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestPutAuthAutoRefreshWorkers_ClampsNegativeToZero(t *testing.T) {
	gin.SetMode(gin.TestMode)
	configPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(configPath, []byte("port: 0\n"), 0o600); err != nil {
		t.Fatalf("failed to seed config file: %v", err)
	}
	h := NewHandler(&config.Config{}, configPath, nil)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/auth-auto-refresh-workers", bytes.NewBufferString(`{"value":-5}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	h.PutAuthAutoRefreshWorkers(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, rec.Code, rec.Body.String())
	}
	if h.cfg.AuthAutoRefreshWorkers != 0 {
		t.Fatalf("expected auth auto refresh workers to clamp to 0, got %d", h.cfg.AuthAutoRefreshWorkers)
	}
}

func TestGetDisableCooling_ReturnsCurrentValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandlerWithoutConfigFilePath(&config.Config{DisableCooling: true}, nil)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/disable-cooling", nil)

	h.GetDisableCooling(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, rec.Code, rec.Body.String())
	}
	var payload map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !payload["disable-cooling"] {
		t.Fatalf("expected disable-cooling=true, got %#v", payload)
	}
}
