package management

// account_health.go — P0 Account Health Diagnostic Center.
// See docs/OVERLAY_FEATURE_MODULES_DESIGN.md §3.
//
// Combines auth-files / auth-stats / cached codex-quota / request-history into a
// single per-account health view: score, level, reason codes (with merging for
// same-root-cause groups), suggested actions, and candidate buckets for batch
// operations. Reads only — no wham API calls, no side effects on auth state.

import (
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/account-health", h.GetAccountHealth)
		rg.GET("/account-health/:name", h.GetAccountHealthOne)
		rg.POST("/account-health/recompute", h.PostAccountHealthRecompute)
	})
}

// ── Public types ──────────────────────────────────────────────────────────────

type HealthReason struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message,omitempty"`
}

type HealthSuggestion struct {
	Type  string `json:"type"`
	Label string `json:"label"`
	Risk  string `json:"risk"`
}

type HealthQuota struct {
	PrimaryRemaining   *float64 `json:"primary_remaining,omitempty"`
	SecondaryRemaining *float64 `json:"secondary_remaining,omitempty"`
}

type HealthRequestWindow struct {
	Requests24h    int64   `json:"requests_24h"`
	Failed24h      int64   `json:"failed_24h"`
	FailureRate24h float64 `json:"failure_rate_24h"`
}

type AccountHealthItem struct {
	Name             string              `json:"name"`
	ID               string              `json:"id"`
	Provider         string              `json:"provider"`
	Email            string              `json:"email,omitempty"`
	Group            string              `json:"group,omitempty"`
	Tags             []string            `json:"tags,omitempty"`
	Score            int                 `json:"score"`
	Level            string              `json:"level"`
	Reasons          []HealthReason      `json:"reasons"`
	SuggestedActions []HealthSuggestion  `json:"suggested_actions"`
	LastRequestAt    int64               `json:"last_request_at,omitempty"`
	LastRefreshAt    *time.Time          `json:"last_refresh_at,omitempty"`
	Quota            *HealthQuota        `json:"quota,omitempty"`
	RequestWindow    HealthRequestWindow `json:"request_window"`
}

type AccountHealthSummary struct {
	Total        int `json:"total"`
	Healthy      int `json:"healthy"`
	Warning      int `json:"warning"`
	Critical     int `json:"critical"`
	NeedsRelogin int `json:"needs_relogin"`
	QuotaLow     int `json:"quota_low"`
	Stale        int `json:"stale"`
}

type AccountHealthCandidates struct {
	Relogin      []string `json:"relogin"`
	Disable      []string `json:"disable"`
	Warmup       []string `json:"warmup"`
	DeleteReview []string `json:"delete_review"`
}

type AccountHealthResponse struct {
	Summary    AccountHealthSummary    `json:"summary"`
	Items      []AccountHealthItem     `json:"items"`
	Candidates AccountHealthCandidates `json:"candidates"`
	ComputedAt int64                   `json:"computed_at"`
}

// ── Codex quota snapshot cache ────────────────────────────────────────────────
//
// Populated by GetCodexQuota (codex_quota.go) every time it returns a fresh
// wham result. Account-health reads from this snapshot so it never triggers a
// wham API call itself. Snapshot may be empty/stale; callers must treat
// missing entries as "no quota concept available for this auth".

type codexQuotaSnapshotCache struct {
	mu sync.RWMutex
	by map[string]CodexQuotaEntry
	ts int64
}

var globalCodexQuotaSnapshot = &codexQuotaSnapshotCache{by: make(map[string]CodexQuotaEntry)}

func saveCodexQuotaSnapshot(entries []CodexQuotaEntry) {
	globalCodexQuotaSnapshot.mu.Lock()
	defer globalCodexQuotaSnapshot.mu.Unlock()
	m := make(map[string]CodexQuotaEntry, len(entries))
	for _, e := range entries {
		if id := strings.TrimSpace(e.ID); id != "" {
			m[id] = e
		}
	}
	globalCodexQuotaSnapshot.by = m
	globalCodexQuotaSnapshot.ts = time.Now().Unix()
}

func loadCodexQuotaSnapshotFor(id string) (CodexQuotaEntry, bool) {
	globalCodexQuotaSnapshot.mu.RLock()
	defer globalCodexQuotaSnapshot.mu.RUnlock()
	e, ok := globalCodexQuotaSnapshot.by[id]
	return e, ok
}

// ── Reason table & merging (§3.3) ─────────────────────────────────────────────

const (
	reasonGroupOAuth   = "oauth_broken"
	reasonGroupFailure = "failure_rate"
	reasonGroupQuota   = "quota"

	healthLevelHealthy  = "healthy"
	healthLevelWarning  = "warning"
	healthLevelCritical = "critical"
)

type healthReasonSpec struct {
	code     string
	severity string
	penalty  int
	group    string // empty = standalone
}

var healthReasonTable = map[string]healthReasonSpec{
	"disabled":             {code: "disabled", severity: "warning", penalty: 30},
	"status_error":         {code: "status_error", severity: "critical", penalty: 45, group: reasonGroupOAuth},
	"needs_relogin":        {code: "needs_relogin", severity: "critical", penalty: 60, group: reasonGroupOAuth},
	"unavailable":          {code: "unavailable", severity: "warning", penalty: 35, group: reasonGroupOAuth},
	"failure_rate_high":    {code: "failure_rate_high", severity: "warning", penalty: 35, group: reasonGroupFailure},
	"failure_rate_severe":  {code: "failure_rate_severe", severity: "critical", penalty: 60, group: reasonGroupFailure},
	"consecutive_failures": {code: "consecutive_failures", severity: "warning", penalty: 30},
	"stale":                {code: "stale", severity: "warning", penalty: 20},
	"quota_low":            {code: "quota_low", severity: "warning", penalty: 20, group: reasonGroupQuota},
	"quota_critical":       {code: "quota_critical", severity: "critical", penalty: 45, group: reasonGroupQuota},
}

func severityRank(s string) int {
	switch s {
	case "info":
		return 0
	case "warning":
		return 1
	case "critical":
		return 2
	}
	return -1
}

// mergeReasons collapses reasons that share a group, keeping the highest-severity
// (and biggest-penalty) member. Penalty for the kept reason is the max in the group.
// Standalone reasons (group == "") pass through unchanged.
//
// Always returns a non-nil slice so JSON marshal produces "[]" rather than "null"
// (the frontend's useMemo iterates these without a null guard).
func mergeReasons(raw []HealthReason) (kept []HealthReason, penalty int) {
	kept = []HealthReason{}
	if len(raw) == 0 {
		return kept, 0
	}
	type best struct {
		reason  HealthReason
		penalty int
	}
	groups := make(map[string]*best)
	standalone := make([]HealthReason, 0, len(raw))
	standalonePenalty := 0
	for _, r := range raw {
		spec, ok := healthReasonTable[r.Code]
		if !ok {
			continue
		}
		if spec.group == "" {
			standalone = append(standalone, r)
			standalonePenalty += spec.penalty
			continue
		}
		cur := groups[spec.group]
		if cur == nil || severityRank(r.Severity) > severityRank(cur.reason.Severity) || (severityRank(r.Severity) == severityRank(cur.reason.Severity) && spec.penalty > cur.penalty) {
			groups[spec.group] = &best{reason: r, penalty: spec.penalty}
		}
	}
	for _, b := range groups {
		kept = append(kept, b.reason)
		penalty += b.penalty
	}
	kept = append(kept, standalone...)
	penalty += standalonePenalty
	// Stable order: critical first, then warning, then info; alpha within tier.
	sort.SliceStable(kept, func(i, j int) bool {
		ri, rj := severityRank(kept[i].Severity), severityRank(kept[j].Severity)
		if ri != rj {
			return ri > rj
		}
		return kept[i].Code < kept[j].Code
	})
	return kept, penalty
}

// ── Aggregation helpers (request history) ─────────────────────────────────────

type requestWindowAgg struct {
	requests int64
	failed   int64
}

func collectRequestWindowStats(now time.Time, history []*RequestRecord) (window map[string]requestWindowAgg, lastAt map[string]int64) {
	cutoff := now.Add(-24 * time.Hour).Unix()
	staleCutoff := now.Add(-7 * 24 * time.Hour).Unix()
	_ = staleCutoff // currently unused — last_request_at carries enough info
	window = make(map[string]requestWindowAgg)
	lastAt = make(map[string]int64)
	for _, rec := range history {
		if rec == nil {
			continue
		}
		id := strings.TrimSpace(rec.AuthID)
		if id == "" {
			continue
		}
		if rec.Timestamp > lastAt[id] {
			lastAt[id] = rec.Timestamp
		}
		if rec.Timestamp >= cutoff {
			agg := window[id]
			agg.requests++
			if rec.Failed {
				agg.failed++
			}
			window[id] = agg
		}
	}
	return window, lastAt
}

func roundFraction(n, d int64) float64 {
	if d == 0 {
		return 0
	}
	v := float64(n) / float64(d)
	return float64(int(v*10000)) / 10000
}

// ── Per-auth computation ──────────────────────────────────────────────────────

func computeAccountHealthItem(
	auth *coreauth.Auth,
	now time.Time,
	winAgg requestWindowAgg,
	lastReq int64,
) AccountHealthItem {
	name := authDisplayName(auth)
	provider := strings.TrimSpace(auth.Provider)
	disabled := auth.Disabled || auth.Status == coreauth.StatusDisabled
	needsRelogin := authNeedsRelogin(auth)
	statusError := auth.Status == coreauth.StatusError
	unavailable := auth.Unavailable

	rawReasons := make([]HealthReason, 0, 6)
	addReason := func(code, message string) {
		spec, ok := healthReasonTable[code]
		if !ok {
			return
		}
		rawReasons = append(rawReasons, HealthReason{
			Code:     spec.code,
			Severity: spec.severity,
			Message:  message,
		})
	}

	if disabled {
		addReason("disabled", "")
	}
	if needsRelogin {
		msg := strings.TrimSpace(auth.StatusMessage)
		if msg == "" && auth.LastError != nil {
			msg = strings.TrimSpace(auth.LastError.Message)
		}
		addReason("needs_relogin", msg)
	}
	if statusError && !needsRelogin {
		addReason("status_error", strings.TrimSpace(auth.StatusMessage))
	}
	if unavailable {
		reasonMsg := ""
		if auth.Quota.Reason != "" {
			reasonMsg = auth.Quota.Reason
		}
		addReason("unavailable", reasonMsg)
	}

	// Failure rate (24h) — only meaningful when sample size is reasonable.
	var failureRate float64
	if winAgg.requests > 0 {
		failureRate = float64(winAgg.failed) / float64(winAgg.requests)
	}
	if winAgg.requests >= 10 {
		switch {
		case failureRate >= 0.60:
			addReason("failure_rate_severe", formatPercent(failureRate))
		case failureRate >= 0.30:
			addReason("failure_rate_high", formatPercent(failureRate))
		}
	}

	// Stale: 7d no successful request.
	if lastReq > 0 && now.Unix()-lastReq >= 7*24*3600 {
		addReason("stale", "no successful request in 7d")
	}

	// Quota — only when we actually have a snapshot for this auth (so API-key auths skip).
	var quotaPayload *HealthQuota
	if snap, ok := loadCodexQuotaSnapshotFor(auth.ID); ok {
		hq := &HealthQuota{}
		var minRemaining *float64
		if snap.PrimaryWindow != nil {
			v := snap.PrimaryWindow.RemainingPercent
			hq.PrimaryRemaining = &v
			minRemaining = ptrMin(minRemaining, v)
		}
		if snap.SecondaryWindow != nil {
			v := snap.SecondaryWindow.RemainingPercent
			hq.SecondaryRemaining = &v
			minRemaining = ptrMin(minRemaining, v)
		}
		quotaPayload = hq
		if minRemaining != nil {
			switch {
			case *minRemaining < 5:
				addReason("quota_critical", formatPercentValue(*minRemaining))
			case *minRemaining < 20:
				addReason("quota_low", formatPercentValue(*minRemaining))
			}
		}
	}

	merged, penalty := mergeReasons(rawReasons)
	score := 100 - penalty
	if score < 0 {
		score = 0
	}
	level := computeAccountLevel(score, merged, disabled, len(rawReasons) == 1 && disabled)

	suggested := suggestedActionsFor(merged, disabled)
	if suggested == nil {
		suggested = []HealthSuggestion{}
	}
	tags := authTags(auth)
	if tags == nil {
		tags = []string{}
	}

	item := AccountHealthItem{
		Name:             name,
		ID:               name,
		Provider:         provider,
		Email:            authEmail(auth),
		Group:            authGroup(auth),
		Tags:             tags,
		Score:            score,
		Level:            level,
		Reasons:          merged,
		SuggestedActions: suggested,
		LastRequestAt:    lastReq,
		Quota:            quotaPayload,
		RequestWindow: HealthRequestWindow{
			Requests24h:    winAgg.requests,
			Failed24h:      winAgg.failed,
			FailureRate24h: roundFraction(winAgg.failed, winAgg.requests),
		},
	}
	if !auth.LastRefreshedAt.IsZero() {
		t := auth.LastRefreshedAt.UTC()
		item.LastRefreshAt = &t
	}
	return item
}

func computeAccountLevel(score int, reasons []HealthReason, disabled, disabledOnly bool) string {
	for _, r := range reasons {
		if r.Code == "needs_relogin" {
			return healthLevelCritical
		}
	}
	if disabledOnly {
		return healthLevelWarning
	}
	switch {
	case score >= 80:
		return healthLevelHealthy
	case score >= 50:
		return healthLevelWarning
	default:
		return healthLevelCritical
	}
}

func suggestedActionsFor(reasons []HealthReason, disabled bool) []HealthSuggestion {
	out := make([]HealthSuggestion, 0, 3)
	add := func(t, label, risk string) {
		out = append(out, HealthSuggestion{Type: t, Label: label, Risk: risk})
	}
	hasCode := func(code string) bool {
		for _, r := range reasons {
			if r.Code == code {
				return true
			}
		}
		return false
	}
	switch {
	case hasCode("needs_relogin"):
		add("relogin", "重新登录", "medium")
	case hasCode("status_error"), hasCode("unavailable"):
		add("warmup", "运行连通性测试", "low")
	case hasCode("failure_rate_severe"):
		add("disable", "禁用账号", "medium")
	case hasCode("failure_rate_high"):
		add("warmup", "运行连通性测试", "low")
		add("lower_priority", "降低优先级", "low")
	case hasCode("stale"):
		add("warmup", "运行连通性测试", "low")
	case hasCode("quota_critical"):
		add("lower_priority", "降低优先级", "low")
	case hasCode("quota_low"):
		add("none", "继续观察", "none")
	case disabled && len(reasons) == 1:
		add("enable", "启用账号", "medium")
	}
	if len(out) == 0 {
		add("none", "无需处理", "none")
	}
	return out
}

// ── Top-level handler ─────────────────────────────────────────────────────────

func (h *Handler) buildAccountHealth(now time.Time) AccountHealthResponse {
	resp := AccountHealthResponse{
		Items:      []AccountHealthItem{},
		Candidates: AccountHealthCandidates{},
		ComputedAt: now.Unix(),
	}
	if h == nil || h.authManager == nil {
		return resp
	}
	auths := h.authManager.List()

	history := globalRequestLogBuf.newestFirst()
	winStats, lastAt := collectRequestWindowStats(now, history)

	items := make([]AccountHealthItem, 0, len(auths))
	for _, auth := range auths {
		if auth == nil {
			continue
		}
		if isRuntimeOnlyAuth(auth) && (auth.Disabled || auth.Status == coreauth.StatusDisabled) {
			continue
		}
		win := winStats[auth.ID]
		// Fall back to FileName-keyed history when AuthID didn't match.
		if win.requests == 0 {
			if alt, ok := winStats[strings.TrimSpace(auth.FileName)]; ok {
				win = alt
			}
		}
		lastReq := lastAt[auth.ID]
		if lastReq == 0 {
			lastReq = lastAt[strings.TrimSpace(auth.FileName)]
		}
		items = append(items, computeAccountHealthItem(auth, now, win, lastReq))
	}

	// Sort: critical first, then warning, then healthy; within tier alpha by name.
	levelOrder := map[string]int{healthLevelCritical: 0, healthLevelWarning: 1, healthLevelHealthy: 2}
	sort.SliceStable(items, func(i, j int) bool {
		li, lj := levelOrder[items[i].Level], levelOrder[items[j].Level]
		if li != lj {
			return li < lj
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	for _, item := range items {
		resp.Summary.Total++
		switch item.Level {
		case healthLevelHealthy:
			resp.Summary.Healthy++
		case healthLevelWarning:
			resp.Summary.Warning++
		case healthLevelCritical:
			resp.Summary.Critical++
		}
		hasReason := func(code string) bool {
			for _, r := range item.Reasons {
				if r.Code == code {
					return true
				}
			}
			return false
		}
		if hasReason("needs_relogin") {
			resp.Summary.NeedsRelogin++
			resp.Candidates.Relogin = append(resp.Candidates.Relogin, item.Name)
		}
		if hasReason("quota_low") || hasReason("quota_critical") {
			resp.Summary.QuotaLow++
		}
		if hasReason("stale") {
			resp.Summary.Stale++
		}
		if hasReason("failure_rate_severe") {
			resp.Candidates.Disable = append(resp.Candidates.Disable, item.Name)
		}
		if hasReason("stale") || hasReason("status_error") || hasReason("unavailable") {
			resp.Candidates.Warmup = append(resp.Candidates.Warmup, item.Name)
		}
		// delete_review: 30-day stale + already disabled, or persistent severe failures while disabled
		if item.Level == healthLevelCritical && (hasReason("status_error") && hasReason("disabled")) {
			resp.Candidates.DeleteReview = append(resp.Candidates.DeleteReview, item.Name)
		}
	}
	dedupSort(&resp.Candidates.Relogin)
	dedupSort(&resp.Candidates.Disable)
	dedupSort(&resp.Candidates.Warmup)
	dedupSort(&resp.Candidates.DeleteReview)
	// Ensure all slices are non-nil so JSON yields "[]" (frontend's useMemo
	// iterates without a null guard).
	if resp.Candidates.Relogin == nil {
		resp.Candidates.Relogin = []string{}
	}
	if resp.Candidates.Disable == nil {
		resp.Candidates.Disable = []string{}
	}
	if resp.Candidates.Warmup == nil {
		resp.Candidates.Warmup = []string{}
	}
	if resp.Candidates.DeleteReview == nil {
		resp.Candidates.DeleteReview = []string{}
	}
	resp.Items = items
	return resp
}

// GetAccountHealth returns the full health view.
func (h *Handler) GetAccountHealth(c *gin.Context) {
	resp := h.buildAccountHealth(time.Now())
	c.JSON(http.StatusOK, resp)
}

// GetAccountHealthOne returns a single account's health record.
func (h *Handler) GetAccountHealthOne(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing account name"})
		return
	}
	resp := h.buildAccountHealth(time.Now())
	for _, item := range resp.Items {
		if strings.EqualFold(item.Name, name) {
			c.JSON(http.StatusOK, gin.H{"item": item, "computed_at": resp.ComputedAt})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "account not found", "code": "account_not_found"})
}

// PostAccountHealthRecompute is a no-op placeholder — the view is computed
// fresh on every GET. Kept so the frontend can wire a "recompute" button to a
// stable endpoint without diverging API contracts later.
func (h *Handler) PostAccountHealthRecompute(c *gin.Context) {
	resp := h.buildAccountHealth(time.Now())
	c.JSON(http.StatusOK, gin.H{"status": "ok", "computed_at": resp.ComputedAt})
}

// ── Tiny utilities ────────────────────────────────────────────────────────────

func ptrMin(cur *float64, v float64) *float64 {
	if cur == nil {
		out := v
		return &out
	}
	if v < *cur {
		out := v
		return &out
	}
	return cur
}

func formatPercent(rate float64) string {
	pct := rate * 100
	return formatPercentValue(pct)
}

func formatPercentValue(pct float64) string {
	whole := int(pct*10) / 10
	frac := int(pct*10) % 10
	if frac == 0 {
		return itoaPositive(whole) + "%"
	}
	return itoaPositive(whole) + "." + itoaPositive(frac) + "%"
}

func itoaPositive(v int) string {
	if v < 0 {
		v = -v
	}
	if v == 0 {
		return "0"
	}
	buf := make([]byte, 0, 6)
	for v > 0 {
		buf = append([]byte{byte('0' + v%10)}, buf...)
		v /= 10
	}
	return string(buf)
}

func dedupSort(list *[]string) {
	if list == nil || len(*list) == 0 {
		return
	}
	seen := make(map[string]struct{}, len(*list))
	out := (*list)[:0]
	for _, v := range *list {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Strings(out)
	*list = out
}
