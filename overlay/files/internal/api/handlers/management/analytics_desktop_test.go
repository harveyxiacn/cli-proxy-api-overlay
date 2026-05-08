package management

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestUsageDailyAggregatesRequestHistory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	globalRequestLogBuf.reset()
	globalRequestLogBuf.push(&RequestRecord{Timestamp: 1770000000, Provider: "codex", Model: "gpt-5.4", AuthID: "a", TotalTokens: 10, EstimatedUSD: 0.01})
	globalRequestLogBuf.push(&RequestRecord{Timestamp: 1770000100, Provider: "codex", Model: "gpt-5.4", AuthID: "a", TotalTokens: 20, EstimatedUSD: 0.02, Failed: true})
	t.Cleanup(func() { globalRequestLogBuf.reset() })

	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, nil)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/analytics/usage-daily", nil)
	h.GetUsageDailyAnalytics(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"total_tokens":30`) || !strings.Contains(body, `"failed_requests":1`) {
		t.Fatalf("unexpected analytics body: %s", body)
	}
}

func TestDesktopInfoIncludesLegacyEntrypoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, nil)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/desktop/info", nil)
	h.GetDesktopInfo(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{"/management/", "/extended.html", "/management.html"} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected %s in desktop info: %s", want, body)
		}
	}
}
