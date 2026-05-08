package management

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/webhooks", h.GetWebhooks)
		rg.PUT("/webhooks",
			auditingHandler("webhook.upsert", "webhook", nil, h.PutWebhook))
		rg.DELETE("/webhooks/:id",
			auditingHandlerParam("webhook.delete", "webhook", "id", h.DeleteWebhook))
		rg.POST("/webhooks/:id/test",
			auditingHandlerParam("webhook.test", "webhook", "id", h.PostWebhookTest))
		rg.GET("/webhooks/:id/deliveries", h.GetWebhookDeliveries)
	})
}

// ── Types ─────────────────────────────────────────────────────────────────────

const webhooksFilename = "webhooks.json"

// All event types the dispatcher knows about. Webhook subscribers can pick any
// subset of these; matching is by exact event-type string.
const (
	EventAPIKeyQuotaWarn     = "alert.api_key_quota_warn"
	EventAPIKeyQuotaExceeded = "alert.api_key_quota_exceeded"
	EventOAuthBatchCreated   = "oauth.batch_created"
	EventSystemUpdateDone    = "system_update.completed"
	EventTest                = "webhook.test"
)

// KnownWebhookEvents is the curated list of events surfaced to the UI for
// subscription. Other events still flow on the bus but are not opt-in here.
var KnownWebhookEvents = []string{
	EventAPIKeyQuotaWarn,
	EventAPIKeyQuotaExceeded,
	EventOAuthBatchCreated,
	EventSystemUpdateDone,
}

type Webhook struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	URL        string   `json:"url"`
	Provider   string   `json:"provider"` // "discord" (only flavor for v1)
	Events     []string `json:"events"`
	Enabled    bool     `json:"enabled"`
	CreatedAt  int64    `json:"created_at"`
	UpdatedAt  int64    `json:"updated_at"`
	LastError  string   `json:"last_error,omitempty"`
	LastSentAt int64    `json:"last_sent_at,omitempty"`
}

type webhookDelivery struct {
	ID         string `json:"id"`
	WebhookID  string `json:"webhook_id"`
	Event      string `json:"event"`
	Status     string `json:"status"` // "ok" | "error" | "skipped"
	HTTPCode   int    `json:"http_code"`
	Error      string `json:"error,omitempty"`
	StartedAt  int64  `json:"started_at"`
	DurationMs int64  `json:"duration_ms"`
}

type webhookStore struct {
	mu      sync.RWMutex
	loaded  bool
	dirHint string
	by      map[string]*Webhook

	// Recent delivery records (per webhook id, ring buffer of last 50).
	deliveryMu sync.RWMutex
	deliveries map[string][]webhookDelivery

	// Dedup state: last fired event-key per webhook+event-type.
	dedupMu sync.Mutex
	dedup   map[string]time.Time

	dispatcherStarted sync.Once
}

var globalWebhooks = &webhookStore{
	by:         make(map[string]*Webhook),
	deliveries: make(map[string][]webhookDelivery),
	dedup:      make(map[string]time.Time),
}

const dedupWindow = 60 * time.Second
const maxDeliveriesPerWebhook = 50
const httpTimeout = 8 * time.Second

// ── Storage ───────────────────────────────────────────────────────────────────

func (s *webhookStore) ensureLoaded(authDir string) {
	s.mu.RLock()
	if s.loaded {
		s.mu.RUnlock()
		return
	}
	s.mu.RUnlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded {
		return
	}
	if authDir != "" {
		s.dirHint = authDir
	}
	s.loadLocked()
	s.loaded = true
	go s.startDispatcherOnce()
}

func (s *webhookStore) loadLocked() {
	if s.dirHint == "" {
		return
	}
	path := filepath.Join(s.dirHint, webhooksFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var hooks []*Webhook
	if err := json.Unmarshal(data, &hooks); err != nil {
		return
	}
	for _, h := range hooks {
		if h == nil || h.ID == "" {
			continue
		}
		s.by[h.ID] = h
	}
}

func (s *webhookStore) saveLocked() error {
	if s.dirHint == "" {
		return errors.New("auth dir not set")
	}
	if err := os.MkdirAll(s.dirHint, 0o755); err != nil {
		return err
	}
	all := make([]*Webhook, 0, len(s.by))
	for _, h := range s.by {
		all = append(all, h)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Name != all[j].Name {
			return all[i].Name < all[j].Name
		}
		return all[i].ID < all[j].ID
	})
	data, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dirHint, webhooksFilename+".tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dirHint, webhooksFilename))
}

func (s *webhookStore) snapshot() []Webhook {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Webhook, 0, len(s.by))
	for _, h := range s.by {
		if h == nil {
			continue
		}
		out = append(out, *h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (s *webhookStore) get(id string) (Webhook, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	h, ok := s.by[id]
	if !ok || h == nil {
		return Webhook{}, false
	}
	return *h, true
}

func (s *webhookStore) upsert(h Webhook) (Webhook, error) {
	now := time.Now().Unix()
	s.mu.Lock()
	defer s.mu.Unlock()
	if h.ID == "" {
		h.ID = uuid.NewString()
		h.CreatedAt = now
	} else if existing, ok := s.by[h.ID]; ok {
		h.CreatedAt = existing.CreatedAt
	} else {
		h.CreatedAt = now
	}
	h.UpdatedAt = now
	s.by[h.ID] = &h
	if err := s.saveLocked(); err != nil {
		return Webhook{}, err
	}
	return h, nil
}

func (s *webhookStore) updateRuntime(id string, fn func(*Webhook)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, ok := s.by[id]
	if !ok || h == nil {
		return
	}
	fn(h)
	_ = s.saveLocked()
}

func (s *webhookStore) remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.by[id]; !ok {
		return false
	}
	delete(s.by, id)
	_ = s.saveLocked()
	return true
}

func (s *webhookStore) recordDelivery(d webhookDelivery) {
	s.deliveryMu.Lock()
	defer s.deliveryMu.Unlock()
	list := s.deliveries[d.WebhookID]
	list = append(list, d)
	if len(list) > maxDeliveriesPerWebhook {
		list = list[len(list)-maxDeliveriesPerWebhook:]
	}
	s.deliveries[d.WebhookID] = list
}

func (s *webhookStore) listDeliveries(id string) []webhookDelivery {
	s.deliveryMu.RLock()
	defer s.deliveryMu.RUnlock()
	src := s.deliveries[id]
	out := make([]webhookDelivery, len(src))
	copy(out, src)
	// newest first
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

func (s *webhookStore) startDispatcherOnce() {
	s.dispatcherStarted.Do(func() {
		ch := globalManagementEvents.subscribe()
		go s.dispatchLoop(ch)
	})
}

func (s *webhookStore) dispatchLoop(ch chan managementEvent) {
	for ev := range ch {
		s.handleEvent(ev)
	}
}

func (s *webhookStore) handleEvent(ev managementEvent) {
	hooks := s.snapshot()
	for _, h := range hooks {
		if !h.Enabled || h.URL == "" {
			continue
		}
		if !containsString(h.Events, ev.Type) && ev.Type != EventTest {
			continue
		}
		if s.shouldDedup(h.ID, ev) {
			s.recordDelivery(webhookDelivery{
				ID:        uuid.NewString(),
				WebhookID: h.ID,
				Event:     ev.Type,
				Status:    "skipped",
				StartedAt: time.Now().Unix(),
				Error:     "dedup window",
			})
			continue
		}
		go s.dispatch(h, ev)
	}
}

// shouldDedup returns true if this exact (webhook, event) was sent within the
// last dedupWindow. Reduces alert spam when a runaway loop fires the same event
// every second.
func (s *webhookStore) shouldDedup(webhookID string, ev managementEvent) bool {
	if ev.Type == EventTest {
		return false
	}
	key := webhookID + "|" + ev.Type + "|" + dedupKeyFromPayload(ev)
	now := time.Now()
	s.dedupMu.Lock()
	defer s.dedupMu.Unlock()
	last, ok := s.dedup[key]
	if ok && now.Sub(last) < dedupWindow {
		return true
	}
	s.dedup[key] = now
	// GC stale entries occasionally.
	if len(s.dedup) > 256 {
		for k, t := range s.dedup {
			if now.Sub(t) > 5*time.Minute {
				delete(s.dedup, k)
			}
		}
	}
	return false
}

// dedupKeyFromPayload extracts a stable identifier from the event payload so
// alerts about *different* keys still fire separately.
func dedupKeyFromPayload(ev managementEvent) string {
	if ev.Payload == nil {
		return ""
	}
	if m, ok := ev.Payload.(map[string]any); ok {
		if v, ok := m["hash"].(string); ok && v != "" {
			return v
		}
		if v, ok := m["target"].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func (s *webhookStore) dispatch(h Webhook, ev managementEvent) {
	body, err := buildDiscordPayload(h, ev)
	if err != nil {
		s.recordDelivery(webhookDelivery{
			ID: uuid.NewString(), WebhookID: h.ID, Event: ev.Type,
			Status: "error", Error: err.Error(), StartedAt: time.Now().Unix(),
		})
		return
	}
	d := s.postToWebhook(h, ev.Type, body)
	s.recordDelivery(d)

	s.updateRuntime(h.ID, func(w *Webhook) {
		w.LastSentAt = time.Now().Unix()
		if d.Status == "ok" {
			w.LastError = ""
		} else {
			w.LastError = d.Error
		}
	})
}

func (s *webhookStore) postToWebhook(h Webhook, eventType string, payload []byte) webhookDelivery {
	started := time.Now()
	d := webhookDelivery{
		ID: uuid.NewString(), WebhookID: h.ID, Event: eventType,
		StartedAt: started.Unix(),
	}
	ctx, cancel := context.WithTimeout(context.Background(), httpTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.URL, bytes.NewReader(payload))
	if err != nil {
		d.Status = "error"
		d.Error = err.Error()
		d.DurationMs = time.Since(started).Milliseconds()
		return d
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CLIProxyAPI-Webhook/1.0")
	resp, err := http.DefaultClient.Do(req)
	d.DurationMs = time.Since(started).Milliseconds()
	if err != nil {
		d.Status = "error"
		d.Error = err.Error()
		return d
	}
	defer resp.Body.Close()
	d.HTTPCode = resp.StatusCode
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		d.Status = "ok"
		return d
	}
	d.Status = "error"
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	d.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	return d
}

// ── Discord payload formatting ────────────────────────────────────────────────

type discordEmbed struct {
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description,omitempty"`
	Color       int            `json:"color,omitempty"`
	Fields      []discordField `json:"fields,omitempty"`
	Timestamp   string         `json:"timestamp,omitempty"`
	Footer      *discordFooter `json:"footer,omitempty"`
}
type discordField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}
type discordFooter struct {
	Text string `json:"text"`
}
type discordWebhookBody struct {
	Username string         `json:"username,omitempty"`
	Embeds   []discordEmbed `json:"embeds"`
}

func buildDiscordPayload(_ Webhook, ev managementEvent) ([]byte, error) {
	embed := discordEmbed{
		Timestamp: time.Unix(ev.TS, 0).UTC().Format(time.RFC3339),
		Footer:    &discordFooter{Text: "CLIProxyAPI · " + ev.Type},
	}
	switch ev.Type {
	case EventAPIKeyQuotaWarn:
		embed.Title = "⚠ API Key 配额告警 (≥80%)"
		embed.Color = 0xFFA500 // orange
		embed.Description = "某个 API Key 今日 token 用量已达 80%。"
		embed.Fields = payloadAsFields(ev.Payload)
	case EventAPIKeyQuotaExceeded:
		embed.Title = "❌ API Key 配额已耗尽"
		embed.Color = 0xE74C3C // red
		embed.Description = "某个 API Key 今日 token 用量已超过限额。"
		embed.Fields = payloadAsFields(ev.Payload)
	case EventOAuthBatchCreated:
		embed.Title = "🔁 批量 OAuth 重登已发起"
		embed.Color = 0x3498DB // blue
		embed.Description = "管理面板创建了一批 OAuth 重登 session。"
		embed.Fields = payloadAsFields(ev.Payload)
	case EventSystemUpdateDone:
		embed.Title = "🚀 CPA 系统更新已完成"
		embed.Color = 0x2ECC71 // green
		embed.Fields = payloadAsFields(ev.Payload)
	case EventTest:
		embed.Title = "✅ Webhook 测试"
		embed.Color = 0x6C63FF
		embed.Description = "如果你看到这条消息，说明 webhook 配置正确。"
	default:
		embed.Title = ev.Type
		embed.Color = 0x6C63FF
		embed.Description = fmt.Sprintf("Event %s @ %s", ev.Type, time.Unix(ev.TS, 0).Format(time.RFC3339))
	}
	body := discordWebhookBody{
		Username: "CPA Alert",
		Embeds:   []discordEmbed{embed},
	}
	return json.Marshal(body)
}

func payloadAsFields(p any) []discordField {
	if p == nil {
		return nil
	}
	m, ok := p.(map[string]any)
	if !ok {
		// Fall through to a single field with the raw payload.
		raw, _ := json.Marshal(p)
		return []discordField{{Name: "payload", Value: truncate(string(raw), 1024), Inline: false}}
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fields := make([]discordField, 0, len(keys))
	for _, k := range keys {
		val := fmt.Sprintf("%v", m[k])
		fields = append(fields, discordField{Name: k, Value: truncate(val, 256), Inline: true})
	}
	return fields
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

type webhooksResponse struct {
	Webhooks    []Webhook `json:"webhooks"`
	KnownEvents []string  `json:"known_events"`
	Total       int       `json:"total"`
	Note        string    `json:"note"`
}

func (h *Handler) GetWebhooks(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalWebhooks.ensureLoaded(dir)
	hooks := globalWebhooks.snapshot()
	c.JSON(http.StatusOK, webhooksResponse{
		Webhooks:    hooks,
		KnownEvents: KnownWebhookEvents,
		Total:       len(hooks),
		Note:        "v1 仅支持 Discord webhook。事件触发时去重窗口为 60 秒（同一 webhook 同一 event-key）。",
	})
}

func (h *Handler) PutWebhook(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalWebhooks.ensureLoaded(dir)

	var body Webhook
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	body.URL = strings.TrimSpace(body.URL)
	body.Name = strings.TrimSpace(body.Name)
	if body.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url is required"})
		return
	}
	if !isValidDiscordWebhookURL(body.URL) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url must be a Discord webhook URL (https://discord.com/api/webhooks/...)"})
		return
	}
	if body.Provider == "" {
		body.Provider = "discord"
	}
	// Validate event subscriptions
	known := make(map[string]struct{}, len(KnownWebhookEvents))
	for _, e := range KnownWebhookEvents {
		known[e] = struct{}{}
	}
	cleanedEvents := make([]string, 0, len(body.Events))
	for _, e := range body.Events {
		e = strings.TrimSpace(e)
		if _, ok := known[e]; ok {
			cleanedEvents = append(cleanedEvents, e)
		}
	}
	body.Events = cleanedEvents

	saved, err := globalWebhooks.upsert(body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}

func (h *Handler) DeleteWebhook(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalWebhooks.ensureLoaded(dir)
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id is required"})
		return
	}
	if !globalWebhooks.remove(id) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": id})
}

func (h *Handler) PostWebhookTest(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalWebhooks.ensureLoaded(dir)
	id := strings.TrimSpace(c.Param("id"))
	hook, ok := globalWebhooks.get(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !hook.Enabled || hook.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "webhook is disabled or has no URL"})
		return
	}
	ev := managementEvent{
		Type:    EventTest,
		TS:      time.Now().Unix(),
		Source:  "management",
		Payload: map[string]any{"sent_by": "manual_test", "webhook_id": hook.ID, "webhook_name": hook.Name},
	}
	body, _ := buildDiscordPayload(hook, ev)
	d := globalWebhooks.postToWebhook(hook, ev.Type, body)
	globalWebhooks.recordDelivery(d)
	globalWebhooks.updateRuntime(hook.ID, func(w *Webhook) {
		w.LastSentAt = time.Now().Unix()
		if d.Status == "ok" {
			w.LastError = ""
		} else {
			w.LastError = d.Error
		}
	})
	if d.Status == "ok" {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "duration_ms": d.DurationMs, "http_code": d.HTTPCode})
		return
	}
	c.JSON(http.StatusBadGateway, gin.H{"status": "error", "error": d.Error, "http_code": d.HTTPCode})
}

func (h *Handler) GetWebhookDeliveries(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalWebhooks.ensureLoaded(dir)
	id := strings.TrimSpace(c.Param("id"))
	if _, ok := globalWebhooks.get(id); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"webhook_id": id,
		"deliveries": globalWebhooks.listDeliveries(id),
	})
}

func isValidDiscordWebhookURL(u string) bool {
	u = strings.TrimSpace(u)
	// We accept the canonical discord.com path and the legacy discordapp.com path.
	return strings.HasPrefix(u, "https://discord.com/api/webhooks/") ||
		strings.HasPrefix(u, "https://discordapp.com/api/webhooks/") ||
		strings.HasPrefix(u, "https://canary.discord.com/api/webhooks/") ||
		strings.HasPrefix(u, "https://ptb.discord.com/api/webhooks/")
}
