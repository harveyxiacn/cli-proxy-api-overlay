package management

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func resetMaintenanceState(t *testing.T) {
	t.Helper()
	globalMaintenanceRuleStore.mu.Lock()
	globalMaintenanceRuleStore.rules = make(map[string]*MaintenanceRule)
	globalMaintenanceRuleStore.dirHint = ""
	globalMaintenanceRuleStore.loaded = false
	globalMaintenanceRuleStore.mu.Unlock()

	globalDryRunCache.mu.Lock()
	globalDryRunCache.entries = make(map[string]*cachedDryRun)
	globalDryRunCache.mu.Unlock()

	globalRequestLogBuf.reset()
	saveCodexQuotaSnapshot(nil)
}

func newMaintenanceHandler(t *testing.T, manager *coreauth.Manager) (*Handler, string) {
	t.Helper()
	dir := t.TempDir()
	return NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, manager), dir
}

func TestMaintenanceRules_PutGetDelete(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetMaintenanceState(t)
	h, _ := newMaintenanceHandler(t, coreauth.NewManager(&memoryAuthStore{}, nil, nil))

	rule := MaintenanceRule{
		ID:      "disable-bad",
		Name:    "Disable severe failures",
		Enabled: true,
		Mode:    "dry_run",
		Conditions: []MaintenanceCondition{
			{Field: "failure_rate_24h", Op: ">=", Value: 0.6},
			{Field: "requests_24h", Op: ">=", Value: 10},
		},
		Action: MaintenanceAction{Type: "disable"},
	}
	body, _ := json.Marshal(rule)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPut, "/v0/management/maintenance-rules", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PutMaintenanceRule(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT failed: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v0/management/maintenance-rules", nil)
	h.GetMaintenanceRules(c)
	var listResp struct {
		Items []MaintenanceRule `json:"items"`
		Count int               `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listResp)
	if listResp.Count != 1 || listResp.Items[0].ID != "disable-bad" {
		t.Fatalf("expected 1 rule, got %+v", listResp)
	}

	rec = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodDelete, "/v0/management/maintenance-rules/disable-bad", nil)
	c.Params = []gin.Param{{Key: "id", Value: "disable-bad"}}
	h.DeleteMaintenanceRule(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE failed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestMaintenanceRules_RejectsInvalidField(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetMaintenanceState(t)
	h, _ := newMaintenanceHandler(t, coreauth.NewManager(&memoryAuthStore{}, nil, nil))

	rule := MaintenanceRule{
		ID:      "bad",
		Action:  MaintenanceAction{Type: "disable"},
		Enabled: true,
		Conditions: []MaintenanceCondition{
			{Field: "not_a_field", Op: "==", Value: 1},
		},
	}
	body, _ := json.Marshal(rule)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPut, "/v0/management/maintenance-rules", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PutMaintenanceRule(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid field, got %d", rec.Code)
	}
}

func TestMaintenanceRules_DryRunMatchesAndApplyExecutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetMaintenanceState(t)

	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	if _, err := manager.Register(context.Background(), &coreauth.Auth{
		ID: "bad.json", FileName: "bad.json", Provider: "codex", Status: coreauth.StatusActive,
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	h, _ := newMaintenanceHandler(t, manager)

	rule := MaintenanceRule{
		ID:      "disable-bad",
		Name:    "Disable severe failures",
		Enabled: true,
		Mode:    "dry_run",
		Conditions: []MaintenanceCondition{
			{Field: "failure_rate_24h", Op: ">=", Value: 0.6},
		},
		Action: MaintenanceAction{Type: "disable"},
	}
	body, _ := json.Marshal(rule)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPut, "/v0/management/maintenance-rules", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PutMaintenanceRule(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT rule failed: %d", rec.Code)
	}

	now := time.Now()
	for i := 0; i < 12; i++ {
		globalRequestLogBuf.push(&RequestRecord{
			Timestamp: now.Unix() - int64(i*60),
			AuthID:    "bad.json",
			Failed:    i < 9,
		})
	}

	rec = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v0/management/maintenance-rules/dry-run", bytes.NewReader([]byte(`{}`)))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PostMaintenanceRulesDryRun(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("dry-run failed: %d %s", rec.Code, rec.Body.String())
	}
	var dr MaintenanceDryRunResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &dr); err != nil {
		t.Fatalf("decode dry-run: %v", err)
	}
	if dr.MatchedAccounts != 1 || len(dr.Actions) != 1 {
		t.Fatalf("expected 1 matched action, got %+v", dr)
	}
	if dr.DryRunToken == "" {
		t.Fatalf("dry-run must return a token")
	}
	actionID := dr.Actions[0].ID

	applyBody, _ := json.Marshal(map[string]any{
		"dry_run_token": dr.DryRunToken,
		"action_ids":    []string{actionID},
	})
	rec = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v0/management/maintenance-rules/apply", bytes.NewReader(applyBody))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PostMaintenanceRulesApply(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply failed: %d %s", rec.Code, rec.Body.String())
	}
	var ar MaintenanceApplyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &ar); err != nil {
		t.Fatalf("decode apply: %v", err)
	}
	if ar.Total != 1 || ar.Results[0].ID != actionID {
		t.Fatalf("apply result mismatch: %+v", ar)
	}
}

func TestMaintenanceRules_ApplyRejectsUnknownToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetMaintenanceState(t)
	h, _ := newMaintenanceHandler(t, coreauth.NewManager(&memoryAuthStore{}, nil, nil))

	body, _ := json.Marshal(map[string]any{
		"dry_run_token": "dr_does_not_exist",
		"action_ids":    []string{"act_1"},
	})
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v0/management/maintenance-rules/apply", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PostMaintenanceRulesApply(c)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid token, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMaintenanceRules_PersistAcrossReload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetMaintenanceState(t)
	dir := t.TempDir()
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, coreauth.NewManager(&memoryAuthStore{}, nil, nil))

	rule := MaintenanceRule{
		ID:         "persist-rule",
		Name:       "persist",
		Enabled:    true,
		Action:     MaintenanceAction{Type: "select"},
		Conditions: []MaintenanceCondition{{Field: "level", Op: "==", Value: "warning"}},
	}
	body, _ := json.Marshal(rule)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPut, "/v0/management/maintenance-rules", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.PutMaintenanceRule(c)

	if _, err := os.Stat(filepath.Join(dir, maintenanceRulesFilename)); err != nil {
		t.Fatalf("expected persistence file to exist: %v", err)
	}

	globalMaintenanceRuleStore.mu.Lock()
	globalMaintenanceRuleStore.rules = make(map[string]*MaintenanceRule)
	globalMaintenanceRuleStore.dirHint = ""
	globalMaintenanceRuleStore.loaded = false
	globalMaintenanceRuleStore.mu.Unlock()

	globalMaintenanceRuleStore.ensureLoaded(dir)
	rules := globalMaintenanceRuleStore.snapshot()
	if len(rules) != 1 || rules[0].ID != "persist-rule" {
		t.Fatalf("expected 1 persisted rule, got %+v", rules)
	}
}
