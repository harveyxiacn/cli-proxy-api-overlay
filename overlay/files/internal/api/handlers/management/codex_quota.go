package management

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/util"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
	log "github.com/sirupsen/logrus"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/codex-quota", h.GetCodexQuota)
	})
}

const (
	codexWhamUsageURL = "https://chatgpt.com/backend-api/wham/usage"
	codexQuotaTimeout = 20 * time.Second
	codexQuotaWorkers = 8
)

// QuotaWindow holds one time-window usage record from the wham API.
type QuotaWindow struct {
	UsedPercent      float64 `json:"used_percent"`
	RemainingPercent float64 `json:"remaining_percent"`
	WindowMinutes    int64   `json:"window_minutes,omitempty"` // 0 = unknown; >1440 = long-window (7d+)
	ResetAt          *int64  `json:"reset_at,omitempty"`
	ResetIn          string  `json:"reset_in,omitempty"`
}

// ExtraQuotaWindow holds an additional rate-limit window (e.g. Code Review, Spark).
type ExtraQuotaWindow struct {
	Name    string       `json:"name"`
	Primary *QuotaWindow `json:"primary,omitempty"`
}

// RawFields lists the top-level key names found in the wham response beyond rate_limit.
// Useful for diagnosing whether the API returned additional_rate_limits for this account.
type RawResponseMeta struct {
	HasAdditionalRateLimits bool     `json:"has_additional_rate_limits"`
	ExtraRateLimitKeys      []string `json:"extra_rate_limit_keys,omitempty"` // keys ending in _rate_limit
}

// CodexQuotaEntry holds the quota result for one codex auth.
type CodexQuotaEntry struct {
	ID              string           `json:"id"`
	Email           string           `json:"email,omitempty"`
	Status          string           `json:"status"`
	Disabled        bool             `json:"disabled"`
	RefreshStatus   string           `json:"refresh_status"`
	PrimaryWindow   *QuotaWindow     `json:"primary_window,omitempty"`
	SecondaryWindow *QuotaWindow     `json:"secondary_window,omitempty"`
	ExtraWindows    []ExtraQuotaWindow `json:"extra_windows,omitempty"`
	RawMeta         *RawResponseMeta `json:"raw_meta,omitempty"` // diagnostic: what the wham API returned
	Error           string           `json:"error,omitempty"`
}

// whamWindow is used for primary/secondary_window in the main rate_limit block.
type whamWindow struct {
	UsedPercent        float64  `json:"used_percent"`
	ResetAt            *float64 `json:"reset_at"`
	LimitWindowSeconds *int64   `json:"limit_window_seconds"`
}

// whamExtraWindow mirrors the shape of a window inside additional_rate_limits entries.
type whamExtraWindow struct {
	UsedPercent        *float64 `json:"used_percent"`
	ResetAt            *float64 `json:"reset_at"`
	LimitWindowSeconds *int64   `json:"limit_window_seconds"`
}

// whamExtraLimitItem is one entry in additional_rate_limits or a top-level *_rate_limit field.
type whamExtraLimitItem struct {
	LimitName       string           `json:"limit_name"`
	LimitID         string           `json:"limit_id"`
	MeteredFeature  string           `json:"metered_feature"`
	PrimaryWindow   *whamExtraWindow `json:"primary_window"`
	SecondaryWindow *whamExtraWindow `json:"secondary_window"`
	// RateLimit wraps the windows when the entry uses a nested "rate_limit" object.
	RateLimit *struct {
		PrimaryWindow   *whamExtraWindow `json:"primary_window"`
		SecondaryWindow *whamExtraWindow `json:"secondary_window"`
	} `json:"rate_limit"`
}

// whamRawResponse captures both the typed fields and the raw top-level map so we can
// scan for *_rate_limit keys that vary per account.
type whamRawResponse struct {
	// Typed primary/secondary windows
	RateLimit *struct {
		PrimaryWindow   *whamWindow `json:"primary_window"`
		SecondaryWindow *whamWindow `json:"secondary_window"`
	} `json:"rate_limit"`

	// additional_rate_limits is an array of extra quota items (Code Review, Spark, …)
	AdditionalRateLimits []whamExtraLimitItem `json:"additional_rate_limits"`

	// raw holds every top-level key for scanning dynamic *_rate_limit fields
	raw map[string]json.RawMessage
}

func intMin(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func formatResetDelta(resetAt *int64) string {
	if resetAt == nil {
		return ""
	}
	secs := *resetAt - time.Now().Unix()
	if secs <= 0 {
		return "已重置"
	}
	days := secs / 86400
	secs %= 86400
	hours := secs / 3600
	secs %= 3600
	mins := int(math.Ceil(float64(secs) / 60))
	if mins == 60 {
		hours++
		mins = 0
	}
	if hours == 24 {
		days++
		hours = 0
	}
	var parts []string
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%d天", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%d时", hours))
	}
	if mins > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%d分", mins))
	}
	return strings.Join(parts, "")
}

func buildHTTPClientForQuota(proxyURL string) *http.Client {
	client := &http.Client{Timeout: codexQuotaTimeout}
	if proxyURL != "" {
		sdkCfg := &sdkconfig.SDKConfig{ProxyURL: proxyURL}
		util.SetProxy(sdkCfg, client)
	}
	return client
}

// humanizeExtraWindowName converts a raw key/limit_name into a readable label.
// Logic mirrors Codex-Manager's humanizeExtraRateLimitLabel.
func humanizeExtraWindowName(raw string) string {
	lower := strings.ToLower(strings.TrimSpace(raw))
	if lower == "" {
		return "额外额度"
	}
	if strings.Contains(lower, "code_review") || strings.Contains(lower, "code review") {
		return "Code Review"
	}
	if lower == "codex_other" || strings.Contains(lower, "spark") {
		return "Spark"
	}
	// Strip trailing _rate_limit, then Title-Case each word
	name := strings.TrimSuffix(lower, "_rate_limit")
	parts := strings.FieldsFunc(name, func(r rune) bool { return r == '_' || r == '-' || r == ' ' })
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	result := strings.Join(parts, " ")
	if result == "" {
		return "额外额度"
	}
	return result
}

// parseExtraWindow converts a whamExtraWindow to a QuotaWindow, or nil if empty.
func parseExtraWindow(w *whamExtraWindow) *QuotaWindow {
	if w == nil || w.UsedPercent == nil {
		return nil
	}
	used := math.Min(100, math.Max(0, *w.UsedPercent))
	remaining := 100.0 - used
	qw := &QuotaWindow{
		UsedPercent:      math.Round(used*10) / 10,
		RemainingPercent: math.Round(remaining*10) / 10,
	}
	if w.LimitWindowSeconds != nil && *w.LimitWindowSeconds > 0 {
		qw.WindowMinutes = (*w.LimitWindowSeconds + 59) / 60
	}
	if w.ResetAt != nil {
		ts := int64(*w.ResetAt)
		qw.ResetAt = &ts
		qw.ResetIn = formatResetDelta(&ts)
	}
	return qw
}

// effectiveWindows returns the primary/secondary windows for an extra limit item,
// resolving both the flat layout and the nested "rate_limit" wrapper layout.
func (item *whamExtraLimitItem) effectiveWindows() (primary, secondary *whamExtraWindow) {
	if item.RateLimit != nil {
		primary = item.RateLimit.PrimaryWindow
		secondary = item.RateLimit.SecondaryWindow
	} else {
		primary = item.PrimaryWindow
		secondary = item.SecondaryWindow
	}
	return
}

// nameSeedOf returns the best human label seed for an extra limit item.
func nameSeedOf(item whamExtraLimitItem, fallbackKey string) string {
	if item.LimitName != "" {
		return item.LimitName
	}
	if item.LimitID != "" {
		return item.LimitID
	}
	if item.MeteredFeature != "" {
		return item.MeteredFeature
	}
	return fallbackKey
}

// extractExtraWindows parses a raw wham response body and returns all extra quota windows,
// covering both additional_rate_limits[] and dynamic top-level *_rate_limit keys.
// Also returns diagnostic metadata about what the API actually returned.
func extractExtraWindows(body []byte) ([]ExtraQuotaWindow, *RawResponseMeta) {
	// Unmarshal into a raw map to detect dynamic keys
	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal(body, &rawMap); err != nil {
		return nil, nil
	}

	meta := &RawResponseMeta{}

	type candidate struct {
		nameSeed string
		item     whamExtraLimitItem
	}
	var candidates []candidate

	// 1. Top-level keys ending with _rate_limit (excluding "rate_limit" itself)
	for key, val := range rawMap {
		if key == "rate_limit" || !strings.HasSuffix(key, "_rate_limit") {
			continue
		}
		meta.ExtraRateLimitKeys = append(meta.ExtraRateLimitKeys, key)
		var item whamExtraLimitItem
		if err := json.Unmarshal(val, &item); err != nil {
			continue
		}
		candidates = append(candidates, candidate{nameSeed: nameSeedOf(item, key), item: item})
	}

	// 2. additional_rate_limits array
	if arr, ok := rawMap["additional_rate_limits"]; ok {
		meta.HasAdditionalRateLimits = true
		var items []whamExtraLimitItem
		if err := json.Unmarshal(arr, &items); err == nil {
			for _, item := range items {
				seed := nameSeedOf(item, "additional")
				candidates = append(candidates, candidate{nameSeed: seed, item: item})
			}
		}
	}

	if len(candidates) == 0 {
		return nil, meta
	}

	seen := make(map[string]bool)
	var result []ExtraQuotaWindow

	for _, c := range candidates {
		label := humanizeExtraWindowName(c.nameSeed)
		primary, secondary := c.item.effectiveWindows()
		pw := parseExtraWindow(primary)
		sw := parseExtraWindow(secondary)
		if pw == nil && sw == nil {
			continue
		}

		// Primary window entry
		if pw != nil && !seen[label] {
			seen[label] = true
			result = append(result, ExtraQuotaWindow{Name: label, Primary: pw})
		}
		// Secondary window as a separate row (e.g. "Code Review · 长周期")
		if sw != nil {
			longLabel := label + " · 长周期"
			if !seen[longLabel] {
				seen[longLabel] = true
				result = append(result, ExtraQuotaWindow{Name: longLabel, Primary: sw})
			}
		}
	}

	return result, meta
}

func fetchWhamUsage(ctx context.Context, client *http.Client, accessToken, accountID string) (*whamRawResponse, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, codexWhamUsageURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	// Headers observed in Codex-Manager that unlock additional_rate_limits (Code Review etc.)
	req.Header.Set("originator", "codex")
	if accountID != "" {
		req.Header.Set("ChatGPT-Account-ID", accountID)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		preview := string(body)
		if len(preview) > 200 {
			preview = preview[:200]
		}
		return nil, resp.StatusCode, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(preview))
	}

	var out whamRawResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("parse response: %w", err)
	}

	// Stash extra windows parsed from the full raw body
	out.raw = make(map[string]json.RawMessage)
	_ = json.Unmarshal(body, &out.raw)

	// Attach extra windows directly so callers don't need the raw bytes
	out.raw["_body"] = body

	return &out, resp.StatusCode, nil
}

func parseWhamWindow(w *whamWindow) *QuotaWindow {
	if w == nil {
		return nil
	}
	used := math.Min(100, math.Max(0, w.UsedPercent))
	remaining := 100.0 - used
	qw := &QuotaWindow{
		UsedPercent:      math.Round(used*10) / 10,
		RemainingPercent: math.Round(remaining*10) / 10,
	}
	if w.LimitWindowSeconds != nil && *w.LimitWindowSeconds > 0 {
		qw.WindowMinutes = (*w.LimitWindowSeconds + 59) / 60
	}
	if w.ResetAt != nil {
		ts := int64(*w.ResetAt)
		qw.ResetAt = &ts
		qw.ResetIn = formatResetDelta(&ts)
	}
	return qw
}

type quotaJob struct {
	id          string
	email       string
	status      string
	disabled    bool
	accessToken   string
	accountID     string // ChatGPT-Account-ID (workspace/org ID) — unlocks additional_rate_limits
	planType      string // free / plus / pro / team / "" (unknown). Used for free-plan window reroute.
	statusMessage string // copied from auth.StatusMessage; scanned for re-login indicators in summary aggregation
}

// reloginKeywords are case-insensitive substrings that indicate the auth file
// can no longer refresh its OAuth token and the user must sign in again.
// Mirrors the frontend RELOGIN_MSGS list in lib/utils.ts → needsRelogin().
var reloginKeywords = []string{
	"unauthorized",
	"refresh_token_reused",
	"invalid_grant",
	"session expired",
	"sign in again",
}

func statusMessageNeedsRelogin(msg string) bool {
	if msg == "" {
		return false
	}
	lower := strings.ToLower(msg)
	for _, kw := range reloginKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// GetCodexQuota queries the OpenAI wham usage API for every loaded codex auth and
// returns per-token quota data together with an aggregated summary.
func (h *Handler) GetCodexQuota(c *gin.Context) {
	if h == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "handler not initialized"})
		return
	}

	h.mu.Lock()
	manager := h.authManager
	cfg := h.cfg
	h.mu.Unlock()

	if manager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth manager unavailable"})
		return
	}

	proxyURL := ""
	if cfg != nil {
		proxyURL = strings.TrimSpace(cfg.ProxyURL)
	}
	httpClient := buildHTTPClientForQuota(proxyURL)

	// Collect all codex auths
	var jobs []quotaJob
	for _, auth := range manager.List() {
		if auth == nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(auth.Provider), "codex") {
			continue
		}
		email := ""
		if auth.Metadata != nil {
			if v, ok := auth.Metadata["email"].(string); ok {
				email = strings.TrimSpace(v)
			}
		}
		accessToken := ""
		if auth.Metadata != nil {
			if v, ok := auth.Metadata["access_token"].(string); ok {
				accessToken = strings.TrimSpace(v)
			}
		}
		// account_id (ChatGPT-Account-ID) — present in Codex auth files;
		// passing it to wham unlocks additional_rate_limits (Code Review, Spark…)
		accountID := ""
		for _, key := range []string{"account_id", "accountId", "workspace_id"} {
			if auth.Metadata != nil {
				if v, ok := auth.Metadata[key].(string); ok && strings.TrimSpace(v) != "" {
					accountID = strings.TrimSpace(v)
					break
				}
			}
			if auth.Attributes != nil {
				if v := strings.TrimSpace(auth.Attributes[key]); v != "" {
					accountID = v
					break
				}
			}
		}
		planType := ""
		if auth.Attributes != nil {
			planType = strings.ToLower(strings.TrimSpace(auth.Attributes["plan_type"]))
		}
		jobs = append(jobs, quotaJob{
			id:            auth.ID,
			email:         email,
			status:        string(auth.Status),
			disabled:      auth.Disabled,
			accessToken:   accessToken,
			accountID:     accountID,
			planType:      planType,
			statusMessage: auth.StatusMessage,
		})
	}

	if len(jobs) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"entries": []CodexQuotaEntry{},
			"summary": gin.H{"total": 0, "success": 0, "failed": 0, "disabled": 0},
		})
		return
	}

	workers := intMin(codexQuotaWorkers, len(jobs))
	jobCh := make(chan quotaJob, len(jobs))
	type result struct{ e CodexQuotaEntry }
	resultCh := make(chan result, len(jobs))

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobCh {
				resultCh <- result{e: fetchJobQuota(c.Request.Context(), httpClient, job)}
			}
		}()
	}
	for _, j := range jobs {
		jobCh <- j
	}
	close(jobCh)
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	entries := make([]CodexQuotaEntry, 0, len(jobs))
	for r := range resultCh {
		entries = append(entries, r.e)
	}

	// Map back jobs by ID so we can read planType / statusMessage per entry
	// during aggregation. Both feed into the "include-in-totals" decision.
	planByID := make(map[string]string, len(jobs))
	statusMsgByID := make(map[string]string, len(jobs))
	for _, j := range jobs {
		planByID[j.id] = j.planType
		statusMsgByID[j.id] = j.statusMessage
	}

	// Build summary. We compute three groups of metrics:
	//   1. Status counts (success / failed / disabled)
	//   2. Primary 5h-window: average used%, account-equivalent capacity, bucket counts
	//   3. Secondary 7d-window: same shape, with Codex-Manager's free-plan-routing
	//      (an account that only reports a primary window is rerouted to the
	//      secondary bucket if it's a free plan or its window is >1440 minutes,
	//      because the API surfaces a single long window in those cases.)
	successCount, failedCount, disabledCount, reloginCount := 0, 0, 0, 0
	primarySumUsed, primaryCount, idleCount, above50Count, below20Count := 0.0, 0, 0, 0, 0
	secondarySumUsed, secondaryCount := 0.0, 0
	primaryUsedAcct := 0.0    // sum(used% / 100) across primary-bucketed accounts → "consumed account-equivalents"
	secondaryUsedAcct := 0.0  // ditto for secondary

	for _, e := range entries {
		// Exclude disabled / fetch-failed / status-error / needs-relogin from
		// pool capacity totals. Each goes into its own counter for the summary
		// header, so the user can see *why* an account was excluded without
		// confusing it with healthy capacity.
		if e.Disabled {
			disabledCount++
			continue
		}
		if e.Error != "" {
			failedCount++
			continue
		}
		// Quota fetch may have succeeded with a still-valid access_token even
		// though the auth manager already marked the auth as needing re-login.
		// Treat those as "won't be usable next refresh" → drop from totals.
		if strings.EqualFold(strings.TrimSpace(e.Status), string(cliproxyauth.StatusError)) ||
			statusMessageNeedsRelogin(statusMsgByID[e.ID]) {
			reloginCount++
			continue
		}
		successCount++

		plan := planByID[e.ID]

		// Decide window routing — the Codex-Manager rule:
		// account with ONLY primary AND (long-window OR free-plan) → treat its
		// primary as a secondary (7d) bucket entry.
		hasPrimary := e.PrimaryWindow != nil
		hasSecondary := e.SecondaryWindow != nil
		rerouteToSecondary := hasPrimary && !hasSecondary && (
			plan == "free" ||
			(e.PrimaryWindow.WindowMinutes > 1440))

		if hasPrimary && !rerouteToSecondary {
			used := e.PrimaryWindow.UsedPercent
			primarySumUsed += used
			primaryCount++
			primaryUsedAcct += used / 100.0
		}

		// Secondary bucket: actual secondary window OR rerouted primary.
		var secWindow *QuotaWindow
		if hasSecondary {
			secWindow = e.SecondaryWindow
		} else if rerouteToSecondary {
			secWindow = e.PrimaryWindow
		}
		if secWindow != nil {
			secondarySumUsed += secWindow.UsedPercent
			secondaryCount++
			secondaryUsedAcct += secWindow.UsedPercent / 100.0
		}

		// Bucket counts (idle / >50% / <20%) follow whichever window is the
		// account's primary view (rerouted secondary for free plans, real
		// primary for paid plans). This matches the user's intuition that
		// "this account is X% free" regardless of which window it actually has.
		var primaryView *QuotaWindow
		if hasPrimary && !rerouteToSecondary {
			primaryView = e.PrimaryWindow
		} else if secWindow != nil {
			primaryView = secWindow
		}
		if primaryView != nil {
			if primaryView.UsedPercent == 0 {
				idleCount++
			}
			if primaryView.RemainingPercent > 50 {
				above50Count++
			}
			if primaryView.RemainingPercent < 20 {
				below20Count++
			}
		}
	}

	avgPrimaryUsed, avgPrimaryRemaining := 0.0, 0.0
	if primaryCount > 0 {
		avgPrimaryUsed = math.Round(primarySumUsed/float64(primaryCount)*10) / 10
		avgPrimaryRemaining = math.Round((100-primarySumUsed/float64(primaryCount))*10) / 10
	}
	avgSecondaryUsed, avgSecondaryRemaining := 0.0, 0.0
	if secondaryCount > 0 {
		avgSecondaryUsed = math.Round(secondarySumUsed/float64(secondaryCount)*10) / 10
		avgSecondaryRemaining = math.Round((100-secondarySumUsed/float64(secondaryCount))*10) / 10
	}
	round2 := func(v float64) float64 { return math.Round(v*100) / 100 }

	saveCodexQuotaSnapshot(entries)

	c.JSON(http.StatusOK, gin.H{
		"entries": entries,
		"summary": gin.H{
			"total":                   len(entries),
			"success":                 successCount,
			"failed":                  failedCount,
			"disabled":                disabledCount,
			"needs_relogin":           reloginCount,
			"avg_primary_used":        avgPrimaryUsed,
			"avg_primary_remaining":   avgPrimaryRemaining,
			"avg_secondary_used":      avgSecondaryUsed,
			"avg_secondary_remaining": avgSecondaryRemaining,
			"idle_count":              idleCount,
			"above_50pct_count":       above50Count,
			"below_20pct_count":       below20Count,
			// Account-equivalent capacity: 1.0 = one account at full capacity.
			// Total = number of accounts contributing data to that bucket.
			// Used  = sum of (used% / 100). Remaining = total - used.
			"primary_capacity_total":     primaryCount,
			"primary_capacity_used":      round2(primaryUsedAcct),
			"primary_capacity_remaining": round2(float64(primaryCount) - primaryUsedAcct),
			"secondary_capacity_total":     secondaryCount,
			"secondary_capacity_used":      round2(secondaryUsedAcct),
			"secondary_capacity_remaining": round2(float64(secondaryCount) - secondaryUsedAcct),
		},
	})
}

func fetchJobQuota(ctx context.Context, client *http.Client, job quotaJob) CodexQuotaEntry {
	entry := CodexQuotaEntry{
		ID:            job.id,
		Email:         job.email,
		Status:        job.status,
		Disabled:      job.disabled,
		RefreshStatus: "ok",
	}

	if job.disabled {
		entry.Error = "disabled"
		return entry
	}
	if job.accessToken == "" {
		entry.Error = "no access_token available"
		return entry
	}

	wham, statusCode, err := fetchWhamUsage(ctx, client, job.accessToken, job.accountID)
	if err != nil {
		if statusCode == http.StatusUnauthorized {
			entry.Error = "token expired (401) — use Refresh All Tokens to renew"
			entry.RefreshStatus = "needs_refresh"
		} else {
			entry.Error = err.Error()
		}
		log.Debugf("codex quota fetch failed for %s: %v", job.id, err)
		return entry
	}
	if wham == nil || wham.RateLimit == nil {
		entry.Error = "missing rate_limit in response"
		return entry
	}

	entry.PrimaryWindow = parseWhamWindow(wham.RateLimit.PrimaryWindow)
	entry.SecondaryWindow = parseWhamWindow(wham.RateLimit.SecondaryWindow)

	// Extract extra windows (Code Review, Spark, …) from the raw body
	if body, ok := wham.raw["_body"]; ok {
		extra, meta := extractExtraWindows(body)
		entry.ExtraWindows = extra
		entry.RawMeta = meta
	}

	return entry
}
