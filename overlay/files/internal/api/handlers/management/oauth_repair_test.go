package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestOAuthRepairSessionLifecycle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, nil)

	createRec := httptest.NewRecorder()
	createCtx, _ := gin.CreateTestContext(createRec)
	createCtx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/oauth/repair-session", strings.NewReader(`{"provider":"codex","target_name":"bad.json","mode":"replace"}`))
	createCtx.Request.Header.Set("Content-Type", "application/json")
	h.PostOAuthRepairSession(createCtx)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", createRec.Code, createRec.Body.String())
	}
	var createBody struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createBody); err != nil {
		t.Fatalf("decode create body: %v", err)
	}
	sessionID := createBody.SessionID
	if sessionID == "" {
		t.Fatalf("expected session_id in %s", createRec.Body.String())
	}

	getRec := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRec)
	getCtx.Params = gin.Params{{Key: "id", Value: sessionID}}
	getCtx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/oauth/sessions/"+sessionID, nil)
	h.GetOAuthRepairSession(getCtx)
	if getRec.Code != http.StatusOK || !strings.Contains(getRec.Body.String(), `"status":"pending"`) {
		t.Fatalf("unexpected get response %d: %s", getRec.Code, getRec.Body.String())
	}

	warmRec := httptest.NewRecorder()
	warmCtx, _ := gin.CreateTestContext(warmRec)
	warmCtx.Params = gin.Params{{Key: "id", Value: sessionID}}
	warmCtx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/oauth/sessions/"+sessionID+"/warmup", nil)
	h.PostOAuthRepairSessionWarmup(warmCtx)
	if warmRec.Code != http.StatusOK || !strings.Contains(warmRec.Body.String(), `"status":"warmup_completed"`) {
		t.Fatalf("unexpected warmup response %d: %s", warmRec.Code, warmRec.Body.String())
	}
}

func TestOAuthRepairSessionBatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, nil)

	body := `{
		"provider":"codex",
		"mode":"replace",
		"targets":[
			{"target_name":"codex-foo.json"},
			{"target_name":"codex-bar.json"},
			{"target_name":""},
			{"provider":"unknown","target_name":"x"}
		]
	}`
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/oauth/repair-session-batch", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PostOAuthRepairSessionBatch(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Sessions []struct {
			TargetName string              `json:"target_name"`
			Provider   string              `json:"provider"`
			Session    *OAuthRepairSession `json:"session,omitempty"`
			Error      string              `json:"error,omitempty"`
		} `json:"sessions"`
		Total     int `json:"total"`
		Succeeded int `json:"succeeded"`
		Failed    int `json:"failed"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode batch body: %v", err)
	}
	if resp.Total != 4 || resp.Succeeded != 2 || resp.Failed != 2 {
		t.Fatalf("unexpected counts: %+v", resp)
	}
	if resp.Sessions[0].Session == nil || resp.Sessions[0].Session.AuthURL == "" {
		t.Fatalf("expected first slot to have a session: %+v", resp.Sessions[0])
	}
	if resp.Sessions[2].Error == "" || resp.Sessions[3].Error == "" {
		t.Fatalf("expected slots 2 and 3 to have errors: %+v", resp.Sessions)
	}
	// Sessions should be retrievable by id.
	id := resp.Sessions[0].Session.SessionID
	getRec := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRec)
	getCtx.Params = gin.Params{{Key: "id", Value: id}}
	getCtx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/oauth/sessions/"+id, nil)
	h.GetOAuthRepairSession(getCtx)
	if getRec.Code != http.StatusOK {
		t.Fatalf("session not retrievable: %d %s", getRec.Code, getRec.Body.String())
	}
}

func TestOAuthRepairSessionBatchValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, nil)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/oauth/repair-session-batch", strings.NewReader(`{"targets":[]}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PostOAuthRepairSessionBatch(ctx)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty targets, got %d", rec.Code)
	}
}
