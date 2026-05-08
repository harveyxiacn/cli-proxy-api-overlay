package management

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func resetGlobalWebhooksForTest(t *testing.T, dir string) {
	t.Helper()
	globalWebhooks.mu.Lock()
	globalWebhooks.by = make(map[string]*Webhook)
	globalWebhooks.loaded = false
	globalWebhooks.dirHint = dir
	globalWebhooks.mu.Unlock()
	globalWebhooks.deliveryMu.Lock()
	globalWebhooks.deliveries = make(map[string][]webhookDelivery)
	globalWebhooks.deliveryMu.Unlock()
	globalWebhooks.dedupMu.Lock()
	globalWebhooks.dedup = make(map[string]time.Time)
	globalWebhooks.dedupMu.Unlock()
	globalWebhooks.dispatcherStarted = sync.Once{}
}

func TestWebhooksCRUD(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	resetGlobalWebhooksForTest(t, dir)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, nil)

	// PUT — create
	put := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/webhooks", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		h.PutWebhook(ctx)
		return rec
	}

	rec := put(`{
		"name":"team-alerts",
		"url":"https://discord.com/api/webhooks/123/abc",
		"events":["alert.api_key_quota_warn","alert.api_key_quota_exceeded","unknown.event"],
		"enabled":true
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT failed: %d %s", rec.Code, rec.Body.String())
	}
	var saved Webhook
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatalf("decode saved: %v", err)
	}
	if saved.ID == "" || saved.Provider != "discord" {
		t.Fatalf("unexpected saved: %+v", saved)
	}
	if len(saved.Events) != 2 {
		t.Fatalf("expected 2 events (unknown filtered), got: %v", saved.Events)
	}

	// GET — should list it + known events
	getRec := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRec)
	getCtx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/webhooks", nil)
	h.GetWebhooks(getCtx)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET failed: %d", getRec.Code)
	}
	var list webhooksResponse
	_ = json.Unmarshal(getRec.Body.Bytes(), &list)
	if len(list.Webhooks) != 1 || len(list.KnownEvents) == 0 {
		t.Fatalf("unexpected list: %+v", list)
	}

	// DELETE
	delRec := httptest.NewRecorder()
	delCtx, _ := gin.CreateTestContext(delRec)
	delCtx.Params = gin.Params{{Key: "id", Value: saved.ID}}
	delCtx.Request = httptest.NewRequest(http.MethodDelete, "/v0/management/webhooks/"+saved.ID, nil)
	h.DeleteWebhook(delCtx)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete failed: %d", delRec.Code)
	}
}

func TestWebhooksValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	resetGlobalWebhooksForTest(t, dir)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, nil)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/webhooks", strings.NewReader(`{"url":"https://example.com/hook"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PutWebhook(ctx)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-discord URL, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/webhooks", strings.NewReader(`{"url":""}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PutWebhook(ctx)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty URL, got %d", rec.Code)
	}
}

func TestWebhooksTestEndpointHitsURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	resetGlobalWebhooksForTest(t, dir)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: dir}, nil)

	// Spin up a fake "Discord" endpoint to capture POST.
	var hits int32
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &captured)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	// We allow non-discord URLs only in tests by going through the dispatch
	// internals directly (the public PUT validates URL prefix).
	saved, err := globalWebhooks.upsert(Webhook{
		Name:     "test-hook",
		URL:      srv.URL,
		Provider: "discord",
		Events:   []string{EventAPIKeyQuotaWarn},
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Params = gin.Params{{Key: "id", Value: saved.ID}}
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/webhooks/"+saved.ID+"/test", nil)
	h.PostWebhookTest(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("test endpoint failed: %d %s", rec.Code, rec.Body.String())
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", hits)
	}
	if captured == nil {
		t.Fatalf("expected captured payload")
	}
	embeds, _ := captured["embeds"].([]any)
	if len(embeds) != 1 {
		t.Fatalf("expected 1 embed, got %v", captured["embeds"])
	}
}

func TestWebhooksDispatchOnEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	resetGlobalWebhooksForTest(t, dir)

	var hits int32
	var capturedTitles []string
	var captureMu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		var body discordWebhookBody
		_ = json.NewDecoder(r.Body).Decode(&body)
		captureMu.Lock()
		if len(body.Embeds) > 0 {
			capturedTitles = append(capturedTitles, body.Embeds[0].Title)
		}
		captureMu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Configure webhook subscribed to quota events.
	if _, err := globalWebhooks.upsert(Webhook{
		Name:     "quota-watcher",
		URL:      srv.URL,
		Provider: "discord",
		Events:   []string{EventAPIKeyQuotaExceeded, EventAPIKeyQuotaWarn},
		Enabled:  true,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Start dispatcher manually (ensureLoaded normally does it).
	globalWebhooks.startDispatcherOnce()

	// Publish an exceeded event with a hash payload.
	PublishManagementEvent(EventAPIKeyQuotaExceeded, map[string]any{
		"hash":         "abcd1234",
		"name":         "team-a",
		"used_tokens":  1500,
		"limit_tokens": 1000,
		"used_percent": 150,
	})
	// Same payload again immediately — should be deduped.
	PublishManagementEvent(EventAPIKeyQuotaExceeded, map[string]any{
		"hash":         "abcd1234",
		"used_tokens":  1600,
		"limit_tokens": 1000,
	})
	// Different hash — should fire.
	PublishManagementEvent(EventAPIKeyQuotaWarn, map[string]any{
		"hash":         "ef567890",
		"used_tokens":  900,
		"limit_tokens": 1000,
		"used_percent": 90,
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&hits) >= 2 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("expected 2 hits after dedup, got %d (titles: %+v)", hits, capturedTitles)
	}
}

func TestIsValidDiscordWebhookURL(t *testing.T) {
	cases := map[string]bool{
		"https://discord.com/api/webhooks/123/abc":         true,
		"https://discordapp.com/api/webhooks/x/y":          true,
		"https://canary.discord.com/api/webhooks/x/y":      true,
		"https://example.com/webhooks/123":                 false,
		"http://discord.com/api/webhooks/123/abc":          false,
		"":                                                 false,
	}
	for u, want := range cases {
		if got := isValidDiscordWebhookURL(u); got != want {
			t.Errorf("URL %q: want %v, got %v", u, want, got)
		}
	}
}
