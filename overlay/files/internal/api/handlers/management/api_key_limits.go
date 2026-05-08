package management

import (
	"encoding/json"
	"errors"
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
		rg.GET("/api-key-limits", h.GetAPIKeyLimits)
		rg.PUT("/api-key-limits",
			auditingHandler("api_key_limit.upsert", "api_key_limit", nil, h.PutAPIKeyLimit))
		rg.DELETE("/api-key-limits/:hash",
			auditingHandlerParam("api_key_limit.delete", "api_key_limit", "hash", h.DeleteAPIKeyLimit))
	})
}

// ── Persistent storage ────────────────────────────────────────────────────────

const apiKeyLimitsFilename = "api-key-limits.json"

// APIKeyLimit is the per-API-key soft-limit configuration.
//
// v1 of this feature is *display + alert only*: requests are NOT rejected when a
// limit is hit. The UI flags exceeded keys in red and the webhook dispatcher
// (when configured) emits `alert.api_key_quota_*` events. Operators flip
// `Enabled=false` here OR remove the underlying key from `api-keys` in
// config.yaml to actually stop traffic.
type APIKeyLimit struct {
	ID              string `json:"id"`
	Hash            string `json:"key_hash"`
	Name            string `json:"name,omitempty"`
	KeyPreview      string `json:"key_preview,omitempty"`
	DailyTokenLimit int64  `json:"daily_token_limit"`
	Enabled         bool   `json:"enabled"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
	Note            string `json:"note,omitempty"`
}

type apiKeyLimitStore struct {
	mu      sync.RWMutex
	loaded  bool
	dirHint string
	limits  map[string]*APIKeyLimit // key = hash
	// Per-day per-hash threshold-state to avoid duplicate webhook events.
	notifyMu      sync.Mutex
	notifyDate    string
	notifyState   map[string]string // hash -> "warn"|"exceeded"
}

var globalAPIKeyLimits = &apiKeyLimitStore{
	limits:      make(map[string]*APIKeyLimit),
	notifyState: make(map[string]string),
}

func (s *apiKeyLimitStore) ensureLoaded(authDir string) {
	s.mu.RLock()
	already := s.loaded
	s.mu.RUnlock()
	if already {
		return
	}
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
}

func (s *apiKeyLimitStore) loadLocked() {
	dir := s.dirHint
	if dir == "" {
		return
	}
	path := filepath.Join(dir, apiKeyLimitsFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			// silently ignore — operator can recreate via API
		}
		return
	}
	var limits []*APIKeyLimit
	if err := json.Unmarshal(data, &limits); err != nil {
		return
	}
	for _, l := range limits {
		if l == nil || l.Hash == "" {
			continue
		}
		s.limits[strings.ToLower(strings.TrimSpace(l.Hash))] = l
	}
}

func (s *apiKeyLimitStore) saveLocked() error {
	dir := s.dirHint
	if dir == "" {
		return errors.New("auth dir not set")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, apiKeyLimitsFilename)
	all := make([]*APIKeyLimit, 0, len(s.limits))
	for _, l := range s.limits {
		all = append(all, l)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Name != all[j].Name {
			return all[i].Name < all[j].Name
		}
		return all[i].Hash < all[j].Hash
	})
	data, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *apiKeyLimitStore) snapshot() []APIKeyLimit {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]APIKeyLimit, 0, len(s.limits))
	for _, l := range s.limits {
		if l == nil {
			continue
		}
		out = append(out, *l)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].Hash < out[j].Hash
	})
	return out
}

func (s *apiKeyLimitStore) getByHash(hash string) (APIKeyLimit, bool) {
	hash = strings.ToLower(strings.TrimSpace(hash))
	if hash == "" {
		return APIKeyLimit{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	l, ok := s.limits[hash]
	if !ok || l == nil {
		return APIKeyLimit{}, false
	}
	return *l, true
}

func (s *apiKeyLimitStore) upsert(l APIKeyLimit) (APIKeyLimit, error) {
	hash := strings.ToLower(strings.TrimSpace(l.Hash))
	if hash == "" {
		return APIKeyLimit{}, errors.New("key_hash is required")
	}
	now := time.Now().Unix()
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.limits[hash]
	if !ok {
		l.ID = uuid.NewString()
		l.CreatedAt = now
		l.UpdatedAt = now
		s.limits[hash] = &l
	} else {
		l.ID = existing.ID
		l.CreatedAt = existing.CreatedAt
		l.UpdatedAt = now
		l.Hash = existing.Hash
		s.limits[hash] = &l
	}
	if err := s.saveLocked(); err != nil {
		return APIKeyLimit{}, err
	}
	return *s.limits[hash], nil
}

func (s *apiKeyLimitStore) remove(hash string) bool {
	hash = strings.ToLower(strings.TrimSpace(hash))
	if hash == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.limits[hash]; !ok {
		return false
	}
	delete(s.limits, hash)
	_ = s.saveLocked()
	return true
}

// ── Threshold notification (called from token_stats.HandleUsage) ──────────────

// notifyAPIKeyQuotaIfNeeded checks the current daily usage for a key against its
// configured limit and emits a management event when the key just crossed the
// 80% (warn) or 100% (exceeded) line for the day. Subsequent calls within the
// same day for the same level are suppressed to avoid event storms.
func notifyAPIKeyQuotaIfNeeded(hash string) {
	hash = strings.ToLower(strings.TrimSpace(hash))
	if hash == "" {
		return
	}
	limit, ok := globalAPIKeyLimits.getByHash(hash)
	if !ok || !limit.Enabled || limit.DailyTokenLimit <= 0 {
		return
	}
	_, buckets := globalTokenStats.snapshotAPIKeyDaily()
	var bucket *apiKeyDailyBucket
	for i := range buckets {
		if buckets[i].Hash == hash {
			b := buckets[i]
			bucket = &b
			break
		}
	}
	if bucket == nil {
		return
	}
	used := bucket.TotalTokens
	pct := float64(used) / float64(limit.DailyTokenLimit) * 100
	level := ""
	switch {
	case pct >= 100:
		level = "exceeded"
	case pct >= 80:
		level = "warn"
	}
	if level == "" {
		return
	}

	globalAPIKeyLimits.notifyMu.Lock()
	today := todayDate()
	if globalAPIKeyLimits.notifyDate != today {
		globalAPIKeyLimits.notifyDate = today
		globalAPIKeyLimits.notifyState = make(map[string]string)
	}
	prev := globalAPIKeyLimits.notifyState[hash]
	shouldEmit := false
	if level == "exceeded" && prev != "exceeded" {
		shouldEmit = true
		globalAPIKeyLimits.notifyState[hash] = "exceeded"
	} else if level == "warn" && prev == "" {
		shouldEmit = true
		globalAPIKeyLimits.notifyState[hash] = "warn"
	}
	globalAPIKeyLimits.notifyMu.Unlock()
	if !shouldEmit {
		return
	}
	eventType := "alert.api_key_quota_warn"
	if level == "exceeded" {
		eventType = "alert.api_key_quota_exceeded"
	}
	PublishManagementEvent(eventType, map[string]any{
		"hash":         limit.Hash,
		"name":         limit.Name,
		"used_tokens":  used,
		"limit_tokens": limit.DailyTokenLimit,
		"used_percent": int(pct),
		"key_preview":  limit.KeyPreview,
	})
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

type apiKeyLimitsResponse struct {
	Date     string                       `json:"date"`
	Limits   []apiKeyLimitWithUsage       `json:"limits"`
	Orphans  []apiKeyDailyBucketResponse  `json:"orphans"`  // hashes seen with usage but no limit configured
	Total    int                          `json:"total"`
	Note     string                       `json:"note"`
}

type apiKeyLimitWithUsage struct {
	APIKeyLimit
	UsedTokens   int64  `json:"used_tokens"`
	UsedPercent  int    `json:"used_percent"`
	Status       string `json:"status"` // "ok" | "warn" | "exceeded" | "disabled" | "unused"
	LastUsedUnix int64  `json:"last_used_at,omitempty"`
	Requests     int64  `json:"requests"`
}

type apiKeyDailyBucketResponse struct {
	Hash         string `json:"key_hash"`
	UsedTokens   int64  `json:"used_tokens"`
	Requests     int64  `json:"requests"`
	LastUsedUnix int64  `json:"last_used_at,omitempty"`
}

// GetAPIKeyLimits returns all configured limits with current daily usage, plus
// any "orphan" keys (active hashes seen by token stats but not in limit config).
func (h *Handler) GetAPIKeyLimits(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalAPIKeyLimits.ensureLoaded(dir)

	date, buckets := globalTokenStats.snapshotAPIKeyDaily()
	bucketByHash := make(map[string]apiKeyDailyBucket, len(buckets))
	for _, b := range buckets {
		bucketByHash[b.Hash] = b
	}

	limits := globalAPIKeyLimits.snapshot()
	limitsView := make([]apiKeyLimitWithUsage, 0, len(limits))
	configured := make(map[string]struct{}, len(limits))
	for _, l := range limits {
		configured[l.Hash] = struct{}{}
		used := int64(0)
		req := int64(0)
		lastUsed := int64(0)
		if b, ok := bucketByHash[l.Hash]; ok {
			used = b.TotalTokens
			req = b.Requests
			lastUsed = b.LastUsedUnix
		}
		pct := 0
		if l.DailyTokenLimit > 0 {
			pct = int(float64(used) / float64(l.DailyTokenLimit) * 100)
		}
		status := "ok"
		switch {
		case !l.Enabled:
			status = "disabled"
		case l.DailyTokenLimit > 0 && used >= l.DailyTokenLimit:
			status = "exceeded"
		case l.DailyTokenLimit > 0 && pct >= 80:
			status = "warn"
		case used == 0:
			status = "unused"
		}
		limitsView = append(limitsView, apiKeyLimitWithUsage{
			APIKeyLimit:  l,
			UsedTokens:   used,
			UsedPercent:  pct,
			Status:       status,
			LastUsedUnix: lastUsed,
			Requests:     req,
		})
	}

	orphans := make([]apiKeyDailyBucketResponse, 0)
	for _, b := range buckets {
		if _, ok := configured[b.Hash]; ok {
			continue
		}
		if b.TotalTokens == 0 && b.Requests == 0 {
			continue
		}
		orphans = append(orphans, apiKeyDailyBucketResponse{
			Hash:         b.Hash,
			UsedTokens:   b.TotalTokens,
			Requests:     b.Requests,
			LastUsedUnix: b.LastUsedUnix,
		})
	}
	sort.Slice(orphans, func(i, j int) bool { return orphans[i].UsedTokens > orphans[j].UsedTokens })

	c.JSON(http.StatusOK, apiKeyLimitsResponse{
		Date:    date,
		Limits:  limitsView,
		Orphans: orphans,
		Total:   len(limitsView),
		Note:    "v1 是软限额：超额仅展示 + 推送告警，不会拒绝请求。需要硬拦截请把 enabled 设为 false 或从 config.yaml 删掉对应 api-keys 条目。",
	})
}

// PutAPIKeyLimit upserts a limit by hash. The caller may submit either:
//   - { "key_hash": "...", "name": "...", "daily_token_limit": 1000000, "enabled": true }
//   - { "key": "raw-api-key", ... }   // backend hashes it for them
func (h *Handler) PutAPIKeyLimit(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalAPIKeyLimits.ensureLoaded(dir)

	var body struct {
		ID              string `json:"id,omitempty"`
		Hash            string `json:"key_hash,omitempty"`
		Key             string `json:"key,omitempty"`
		Name            string `json:"name,omitempty"`
		Note            string `json:"note,omitempty"`
		DailyTokenLimit int64  `json:"daily_token_limit"`
		Enabled         *bool  `json:"enabled,omitempty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	rawKey := strings.TrimSpace(body.Key)
	hash := strings.ToLower(strings.TrimSpace(body.Hash))
	if hash == "" && rawKey != "" {
		hash = hashAPIKey(rawKey)
	}
	if hash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "either key_hash or key is required"})
		return
	}
	if body.DailyTokenLimit < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "daily_token_limit cannot be negative"})
		return
	}
	limit := APIKeyLimit{
		Hash:            hash,
		Name:            strings.TrimSpace(body.Name),
		Note:            strings.TrimSpace(body.Note),
		DailyTokenLimit: body.DailyTokenLimit,
		Enabled:         true,
	}
	if body.Enabled != nil {
		limit.Enabled = *body.Enabled
	}
	if rawKey != "" {
		limit.KeyPreview = previewKey(rawKey)
	}
	saved, err := globalAPIKeyLimits.upsert(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	PublishManagementEvent("api_key_limit.updated", saved)
	c.JSON(http.StatusOK, saved)
}

func (h *Handler) DeleteAPIKeyLimit(c *gin.Context) {
	dir := strings.TrimSpace(h.cfg.AuthDir)
	globalAPIKeyLimits.ensureLoaded(dir)

	hash := strings.ToLower(strings.TrimSpace(c.Param("hash")))
	if hash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hash is required"})
		return
	}
	if !globalAPIKeyLimits.remove(hash) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	PublishManagementEvent("api_key_limit.deleted", gin.H{"hash": hash})
	c.JSON(http.StatusOK, gin.H{"status": "ok", "hash": hash})
}

func previewKey(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) <= 8 {
		return strings.Repeat("*", len(raw))
	}
	return raw[:4] + "…" + raw[len(raw)-4:]
}
