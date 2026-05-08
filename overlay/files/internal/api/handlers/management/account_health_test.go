package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

// resetAccountHealthGlobals zeroes the request-history buffer and the cached
// codex quota snapshot so each test starts from a clean state.
func resetAccountHealthGlobals(t *testing.T) {
	t.Helper()
	globalRequestLogBuf.reset()
	saveCodexQuotaSnapshot(nil)
}

func registerAuth(t *testing.T, manager *coreauth.Manager, auth *coreauth.Auth) {
	t.Helper()
	if _, err := manager.Register(context.Background(), auth); err != nil {
		t.Fatalf("register %s: %v", auth.ID, err)
	}
}

func newAccountHealthHandler(t *testing.T, manager *coreauth.Manager) *Handler {
	t.Helper()
	return NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, manager)
}

func decodeAccountHealth(t *testing.T, body []byte) AccountHealthResponse {
	t.Helper()
	var payload AccountHealthResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode response: %v\n%s", err, string(body))
	}
	return payload
}

func TestAccountHealth_HealthyAccountScoresHigh(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	registerAuth(t, manager, &coreauth.Auth{
		ID:       "ok.json",
		FileName: "ok.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
	})
	h := newAccountHealthHandler(t, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if len(resp.Items) != 1 {
		t.Fatalf("want 1 item, got %d", len(resp.Items))
	}
	item := resp.Items[0]
	if item.Score < 80 {
		t.Fatalf("healthy account should score >= 80, got %d (reasons=%+v)", item.Score, item.Reasons)
	}
	if item.Level != "healthy" {
		t.Fatalf("want level=healthy, got %q", item.Level)
	}
	if resp.Summary.Healthy != 1 || resp.Summary.Critical != 0 {
		t.Fatalf("unexpected summary: %+v", resp.Summary)
	}
}

func TestAccountHealth_NeedsReloginIsCriticalAndCandidate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	registerAuth(t, manager, &coreauth.Auth{
		ID:            "broken.json",
		FileName:      "broken.json",
		Provider:      "codex",
		Status:        coreauth.StatusError,
		StatusMessage: "refresh_token_reused",
	})
	h := newAccountHealthHandler(t, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if len(resp.Items) != 1 {
		t.Fatalf("want 1 item, got %d", len(resp.Items))
	}
	item := resp.Items[0]
	if item.Level != "critical" {
		t.Fatalf("needs_relogin must be critical, got %q (reasons=%+v)", item.Level, item.Reasons)
	}
	if resp.Summary.NeedsRelogin != 1 {
		t.Fatalf("summary.needs_relogin should be 1, got %d", resp.Summary.NeedsRelogin)
	}
	found := false
	for _, name := range resp.Candidates.Relogin {
		if name == "broken.json" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("candidates.relogin should include broken.json, got %+v", resp.Candidates.Relogin)
	}
}

func TestAccountHealth_DisabledOnlyIsWarningNotCritical(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	registerAuth(t, manager, &coreauth.Auth{
		ID:       "off.json",
		FileName: "off.json",
		Provider: "codex",
		Status:   coreauth.StatusDisabled,
		Disabled: true,
	})
	h := newAccountHealthHandler(t, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if len(resp.Items) != 1 || resp.Items[0].Level != "warning" {
		t.Fatalf("disabled-only should be warning, got items=%+v", resp.Items)
	}
	for _, name := range resp.Candidates.DeleteReview {
		if name == "off.json" {
			t.Fatalf("disabled-only must not be in delete_review candidates: %+v", resp.Candidates.DeleteReview)
		}
	}
}

func TestAccountHealth_ReasonGroupsAreMerged(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	// status=error + needs_relogin + unavailable all share the oauth_broken group.
	registerAuth(t, manager, &coreauth.Auth{
		ID:            "oauth-broken.json",
		FileName:      "oauth-broken.json",
		Provider:      "codex",
		Status:        coreauth.StatusError,
		StatusMessage: "invalid_grant",
		Unavailable:   true,
	})
	h := newAccountHealthHandler(t, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if len(resp.Items) != 1 {
		t.Fatalf("want 1 item, got %d", len(resp.Items))
	}
	oauthCount := 0
	for _, r := range resp.Items[0].Reasons {
		if r.Code == "needs_relogin" || r.Code == "status_error" || r.Code == "unavailable" {
			oauthCount++
		}
	}
	if oauthCount != 1 {
		t.Fatalf("oauth_broken group should collapse to one reason, got %d in %+v", oauthCount, resp.Items[0].Reasons)
	}
}

func TestAccountHealth_QuotaLowFromSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	registerAuth(t, manager, &coreauth.Auth{
		ID:       "low-quota.json",
		FileName: "low-quota.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
	})

	// Inject a cached quota snapshot that puts secondary into the quota_low band.
	saveCodexQuotaSnapshot([]CodexQuotaEntry{
		{
			ID:              "low-quota.json",
			Status:          string(coreauth.StatusActive),
			SecondaryWindow: &QuotaWindow{UsedPercent: 92, RemainingPercent: 8},
		},
	})

	h := newAccountHealthHandler(t, manager)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if resp.Summary.QuotaLow != 1 {
		t.Fatalf("expected 1 quota_low, got summary=%+v", resp.Summary)
	}
	hasQuotaReason := false
	for _, r := range resp.Items[0].Reasons {
		if r.Code == "quota_low" || r.Code == "quota_critical" {
			hasQuotaReason = true
		}
	}
	if !hasQuotaReason {
		t.Fatalf("expected quota_low/quota_critical reason, got %+v", resp.Items[0].Reasons)
	}
}

func TestAccountHealth_APIKeyAuthSkipsQuotaPenalty(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	// No quota snapshot for this auth → quota reasons must not fire.
	registerAuth(t, manager, &coreauth.Auth{
		ID:       "key-only.json",
		FileName: "key-only.json",
		Provider: "openai-api-key",
		Status:   coreauth.StatusActive,
	})
	h := newAccountHealthHandler(t, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if resp.Items[0].Score < 80 {
		t.Fatalf("API key auth without quota data should stay healthy, got score=%d reasons=%+v",
			resp.Items[0].Score, resp.Items[0].Reasons)
	}
	if resp.Items[0].Quota != nil {
		t.Fatalf("API key auth should not carry quota payload: %+v", resp.Items[0].Quota)
	}
}

func TestAccountHealth_FailureRateFromHistory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	registerAuth(t, manager, &coreauth.Auth{
		ID:       "bad-stream.json",
		FileName: "bad-stream.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
	})

	// 12 records, 9 failed → failure_rate = 0.75 → severe.
	now := time.Now()
	for i := 0; i < 12; i++ {
		globalRequestLogBuf.push(&RequestRecord{
			Timestamp: now.Unix() - int64(i*60),
			AuthID:    "bad-stream.json",
			Failed:    i < 9,
		})
	}

	h := newAccountHealthHandler(t, manager)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health", nil)
	h.GetAccountHealth(ctx)

	resp := decodeAccountHealth(t, rec.Body.Bytes())
	if len(resp.Items) != 1 {
		t.Fatalf("want 1 item, got %d", len(resp.Items))
	}
	item := resp.Items[0]
	if item.RequestWindow.Requests24h != 12 || item.RequestWindow.Failed24h != 9 {
		t.Fatalf("wrong request window stats: %+v", item.RequestWindow)
	}
	severe := false
	for _, r := range item.Reasons {
		if r.Code == "failure_rate_severe" {
			severe = true
		}
	}
	if !severe {
		t.Fatalf("expected failure_rate_severe reason, got %+v", item.Reasons)
	}
	disableCandidate := false
	for _, name := range resp.Candidates.Disable {
		if name == "bad-stream.json" {
			disableCandidate = true
		}
	}
	if !disableCandidate {
		t.Fatalf("expected disable candidate, got %+v", resp.Candidates.Disable)
	}
}

func TestAccountHealth_GetByName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAccountHealthGlobals(t)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	registerAuth(t, manager, &coreauth.Auth{
		ID: "alpha.json", FileName: "alpha.json", Provider: "codex", Status: coreauth.StatusActive,
	})
	registerAuth(t, manager, &coreauth.Auth{
		ID: "beta.json", FileName: "beta.json", Provider: "codex", Status: coreauth.StatusActive,
	})
	h := newAccountHealthHandler(t, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health/alpha.json", nil)
	ctx.Params = []gin.Param{{Key: "name", Value: "alpha.json"}}
	h.GetAccountHealthOne(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Item AccountHealthItem `json:"item"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Item.Name != "alpha.json" {
		t.Fatalf("want alpha.json, got %q", payload.Item.Name)
	}

	rec2 := httptest.NewRecorder()
	ctx2, _ := gin.CreateTestContext(rec2)
	ctx2.Request = httptest.NewRequest(http.MethodGet, "/v0/management/account-health/missing.json", nil)
	ctx2.Params = []gin.Param{{Key: "name", Value: "missing.json"}}
	h.GetAccountHealthOne(ctx2)
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("missing account should be 404, got %d", rec2.Code)
	}
}
