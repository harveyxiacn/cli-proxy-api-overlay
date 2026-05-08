package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func resetGlobalAPIKeyLimitsForTest(t *testing.T, dir string) {
	t.Helper()
	globalAPIKeyLimits.mu.Lock()
	globalAPIKeyLimits.limits = make(map[string]*APIKeyLimit)
	globalAPIKeyLimits.loaded = false
	globalAPIKeyLimits.dirHint = dir
	globalAPIKeyLimits.mu.Unlock()
	globalAPIKeyLimits.notifyMu.Lock()
	globalAPIKeyLimits.notifyDate = ""
	globalAPIKeyLimits.notifyState = make(map[string]string)
	globalAPIKeyLimits.notifyMu.Unlock()
}

func TestAPIKeyLimitsCRUD(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	resetGlobalAPIKeyLimitsForTest(t, dir)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, nil)

	// PUT — create with raw key
	put := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/api-key-limits", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		h.PutAPIKeyLimit(ctx)
		return rec
	}

	rec := put(`{"key":"sk-test-12345678","name":"team-a","daily_token_limit":1000000}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT failed: %d %s", rec.Code, rec.Body.String())
	}
	var saved APIKeyLimit
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatalf("decode saved: %v", err)
	}
	if saved.Hash == "" || saved.Name != "team-a" || saved.DailyTokenLimit != 1_000_000 || !saved.Enabled {
		t.Fatalf("unexpected saved: %+v", saved)
	}
	if saved.KeyPreview == "" || !strings.Contains(saved.KeyPreview, "…") {
		t.Fatalf("expected preview with ellipsis: %q", saved.KeyPreview)
	}

	// File should be persisted
	if _, err := os.Stat(filepath.Join(dir, apiKeyLimitsFilename)); err != nil {
		t.Fatalf("limits file not created: %v", err)
	}

	// GET — should include the limit + zero usage + status "unused"
	getRec := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRec)
	getCtx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/api-key-limits", nil)
	h.GetAPIKeyLimits(getCtx)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET failed: %d", getRec.Code)
	}
	var listResp apiKeyLimitsResponse
	if err := json.Unmarshal(getRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listResp.Limits) != 1 || listResp.Limits[0].Status != "unused" {
		t.Fatalf("unexpected limits view: %+v", listResp)
	}

	// PUT — update existing (toggle enabled false)
	upd := put(`{"key_hash":"` + saved.Hash + `","daily_token_limit":2000000,"enabled":false}`)
	if upd.Code != http.StatusOK {
		t.Fatalf("update failed: %d %s", upd.Code, upd.Body.String())
	}
	var updated APIKeyLimit
	_ = json.Unmarshal(upd.Body.Bytes(), &updated)
	if updated.DailyTokenLimit != 2_000_000 || updated.Enabled {
		t.Fatalf("update did not stick: %+v", updated)
	}

	// DELETE
	delRec := httptest.NewRecorder()
	delCtx, _ := gin.CreateTestContext(delRec)
	delCtx.Params = gin.Params{{Key: "hash", Value: saved.Hash}}
	delCtx.Request = httptest.NewRequest(http.MethodDelete, "/v0/management/api-key-limits/"+saved.Hash, nil)
	h.DeleteAPIKeyLimit(delCtx)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete failed: %d", delRec.Code)
	}

	// Subsequent GET — empty
	getRec2 := httptest.NewRecorder()
	getCtx2, _ := gin.CreateTestContext(getRec2)
	getCtx2.Request = httptest.NewRequest(http.MethodGet, "/v0/management/api-key-limits", nil)
	h.GetAPIKeyLimits(getCtx2)
	var listResp2 apiKeyLimitsResponse
	_ = json.Unmarshal(getRec2.Body.Bytes(), &listResp2)
	if len(listResp2.Limits) != 0 {
		t.Fatalf("expected empty after delete: %+v", listResp2)
	}
}

func TestAPIKeyLimitsValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	resetGlobalAPIKeyLimitsForTest(t, dir)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, nil)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/api-key-limits", strings.NewReader(`{"daily_token_limit":1000}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PutAPIKeyLimit(ctx)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/api-key-limits", strings.NewReader(`{"key":"abc","daily_token_limit":-5}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PutAPIKeyLimit(ctx)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for negative limit, got %d", rec.Code)
	}
}

func TestAPIKeyLimitsThresholdNotification(t *testing.T) {
	dir := t.TempDir()
	resetGlobalAPIKeyLimitsForTest(t, dir)

	// Configure a small limit: 1000 tokens/day, enabled.
	hash := hashAPIKey("sk-quota-test")
	_, err := globalAPIKeyLimits.upsert(APIKeyLimit{
		Hash:            hash,
		Name:            "quota-test",
		DailyTokenLimit: 1000,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Capture published events.
	bus := globalManagementEvents
	if bus == nil {
		t.Skip("event bus not initialized in test environment")
	}
	ch := bus.subscribe()
	captured := []managementEvent{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for evt := range ch {
			captured = append(captured, evt)
		}
	}()

	// Push usage so we cross 80% (warn).
	globalTokenStats.recordAPIKeyDaily(hash, usage.Detail{TotalTokens: 800}, 0, false)
	notifyAPIKeyQuotaIfNeeded(hash)
	// Cross 100% (exceeded).
	globalTokenStats.recordAPIKeyDaily(hash, usage.Detail{TotalTokens: 300}, 0, false)
	notifyAPIKeyQuotaIfNeeded(hash)
	// Push more — should NOT emit again.
	globalTokenStats.recordAPIKeyDaily(hash, usage.Detail{TotalTokens: 5000}, 0, false)
	notifyAPIKeyQuotaIfNeeded(hash)

	// Drain & assert.
	bus.unsubscribe(ch)
	<-done
	warnSeen, exceededSeen, totalQuotaEvents := false, false, 0
	for _, evt := range captured {
		switch evt.Type {
		case "alert.api_key_quota_warn":
			warnSeen = true
			totalQuotaEvents++
		case "alert.api_key_quota_exceeded":
			exceededSeen = true
			totalQuotaEvents++
		}
	}
	if !warnSeen || !exceededSeen {
		t.Fatalf("expected both warn and exceeded events, got: %+v", captured)
	}
	if totalQuotaEvents != 2 {
		t.Fatalf("expected exactly 2 quota events (no dup), got %d: %+v", totalQuotaEvents, captured)
	}
}
