package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func TestGetAuthFilesMaintenanceSummary_CountsAndCandidates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	auths := []*coreauth.Auth{
		{
			ID:          "free-unavailable",
			FileName:    "free-unavailable.json",
			Provider:    "codex",
			Status:      coreauth.StatusActive,
			Unavailable: true,
			Attributes:  map[string]string{"path": "/tmp/free-unavailable.json", "plan_type": "free"},
			Metadata: map[string]any{
				"email": "free@example.com",
				"group": "free-pool",
				"tags":  []any{"weekly", "shared"},
			},
		},
		{
			ID:         "team-active",
			FileName:   "team-active.json",
			Provider:   "codex",
			Status:     coreauth.StatusActive,
			Attributes: map[string]string{"path": "/tmp/team-active.json", "plan_type": "team"},
			Metadata: map[string]any{
				"email": "team@example.com",
				"group": "paid",
				"tags":  []any{"team"},
			},
		},
		{
			ID:            "needs-login",
			FileName:      "needs-login.json",
			Provider:      "codex",
			Status:        coreauth.StatusError,
			StatusMessage: "refresh_token_reused",
			Attributes:    map[string]string{"path": "/tmp/needs-login.json", "plan_type": "free"},
			Metadata:      map[string]any{"email": "login@example.com"},
		},
		{
			ID:         "disabled-claude",
			FileName:   "disabled-claude.json",
			Provider:   "claude",
			Status:     coreauth.StatusDisabled,
			Disabled:   true,
			Attributes: map[string]string{"path": "/tmp/disabled-claude.json"},
		},
	}
	for _, auth := range auths {
		if _, err := manager.Register(context.Background(), auth); err != nil {
			t.Fatalf("register %s: %v", auth.ID, err)
		}
	}

	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, manager)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/auth-files/maintenance-summary", nil)

	h.GetAuthFilesMaintenanceSummary(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var payload struct {
		Summary struct {
			Total           int `json:"total"`
			Disabled        int `json:"disabled"`
			Unavailable     int `json:"unavailable"`
			NeedsRelogin    int `json:"needs_relogin"`
			UnavailableFree int `json:"unavailable_free"`
			Problem         int `json:"problem"`
		} `json:"summary"`
		Counts struct {
			Providers map[string]int `json:"providers"`
			Groups    map[string]int `json:"groups"`
			Tags      map[string]int `json:"tags"`
			Plans     map[string]int `json:"plans"`
		} `json:"counts"`
		Candidates struct {
			UnavailableFree []string `json:"unavailable_free"`
			NeedsRelogin    []string `json:"needs_relogin"`
			Problem         []string `json:"problem"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Summary.Total != 4 || payload.Summary.Disabled != 1 || payload.Summary.Unavailable != 1 {
		t.Fatalf("unexpected summary counts: %#v", payload.Summary)
	}
	if payload.Summary.NeedsRelogin != 1 || payload.Summary.UnavailableFree != 1 || payload.Summary.Problem != 3 {
		t.Fatalf("unexpected maintenance summary: %#v", payload.Summary)
	}
	if payload.Counts.Providers["codex"] != 3 || payload.Counts.Providers["claude"] != 1 {
		t.Fatalf("unexpected provider counts: %#v", payload.Counts.Providers)
	}
	if payload.Counts.Groups["free-pool"] != 1 || payload.Counts.Tags["weekly"] != 1 || payload.Counts.Plans["free"] != 2 {
		t.Fatalf("unexpected group/tag/plan counts: %#v", payload.Counts)
	}
	if len(payload.Candidates.UnavailableFree) != 1 || payload.Candidates.UnavailableFree[0] != "free-unavailable.json" {
		t.Fatalf("unexpected unavailable_free candidates: %#v", payload.Candidates.UnavailableFree)
	}
	if len(payload.Candidates.NeedsRelogin) != 1 || payload.Candidates.NeedsRelogin[0] != "needs-login.json" {
		t.Fatalf("unexpected needs_relogin candidates: %#v", payload.Candidates.NeedsRelogin)
	}
}
