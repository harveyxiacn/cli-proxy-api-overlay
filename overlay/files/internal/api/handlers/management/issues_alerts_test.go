package management

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func TestBuildManagementIssuesDetectsReloginAndDuplicates(t *testing.T) {
	manager := coreauth.NewManager(nil, nil, nil)
	seed := []*coreauth.Auth{
		{ID: "a", FileName: "a.json", Provider: "codex", Status: coreauth.StatusActive, StatusMessage: "refresh_token_reused", Metadata: map[string]any{"email": "same@example.com"}},
		{ID: "b", FileName: "b.json", Provider: "codex", Status: coreauth.StatusActive, Metadata: map[string]any{"email": "same@example.com"}},
	}
	for _, item := range seed {
		if _, err := manager.Register(context.Background(), item); err != nil {
			t.Fatalf("register %s: %v", item.ID, err)
		}
	}

	issues := BuildManagementIssues(manager, time.Now())
	kinds := map[string]int{}
	for _, issue := range issues {
		kinds[issue.Kind]++
	}
	if kinds["needs_relogin"] != 1 {
		t.Fatalf("expected one needs_relogin issue, got %#v", kinds)
	}
	if kinds["duplicate_email"] != 2 {
		t.Fatalf("expected duplicate issues for both accounts, got %#v", kinds)
	}
}

func TestGetHealthSummaryCriticalWhenNoHealthyAccounts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := coreauth.NewManager(nil, nil, nil)
	if _, err := manager.Register(context.Background(), &coreauth.Auth{
		ID:       "bad",
		FileName: "bad.json",
		Provider: "codex",
		Status:   coreauth.StatusError,
	}); err != nil {
		t.Fatalf("register auth: %v", err)
	}
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/health-summary", nil)
	h.GetHealthSummary(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"status":"critical"`) {
		t.Fatalf("expected critical health, got %s", rec.Body.String())
	}
}

func TestManagementMetricsIncludesAccountGauge(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := coreauth.NewManager(nil, nil, nil)
	if _, err := manager.Register(context.Background(), &coreauth.Auth{ID: "ok", Provider: "codex", Status: coreauth.StatusActive}); err != nil {
		t.Fatalf("register auth: %v", err)
	}
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/metrics", nil)
	h.GetManagementMetrics(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `cpa_management_accounts_total{provider="codex",status="active"} 1`) {
		t.Fatalf("expected account metric, got %s", body)
	}
}
