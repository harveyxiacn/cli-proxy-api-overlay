package management

// api_key_insights.go — overlay §6 API Key Insights.
//
// Combines configured limits + request-history token usage to produce a
// per-key dashboard view (today / 7d tokens, failure rate, status flags).
//
// Window note: detection of "unused" depends on what the in-memory ring buffer
// can actually show. Because the buffer caps at requestLogCapacity entries, on
// a busy server the visible window can be much shorter than 30 days. We
// therefore expose unused_within_window + window_seconds rather than a fixed
// unused_30d, and only upgrade to a real 30d view once SQLite analytics
// (P3 §14) lands.

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/api-key-insights", h.GetAPIKeyInsights)
	})
}

type APIKeyInsightItem struct {
	Hash               string   `json:"hash"`
	Preview            string   `json:"preview,omitempty"`
	Name               string   `json:"name,omitempty"`
	Providers          []string `json:"providers,omitempty"`
	Status             string   `json:"status"`
	TodayTokens        int64    `json:"today_tokens"`
	SevenDayTokens     int64    `json:"seven_day_tokens"`
	DailyLimit         int64    `json:"daily_limit,omitempty"`
	EstimatedUSDToday  float64  `json:"estimated_usd_today"`
	EstimatedUSD7d     float64  `json:"estimated_usd_7d"`
	FailureRate24h     float64  `json:"failure_rate_24h"`
	LastUsedAt         int64    `json:"last_used_at,omitempty"`
	Reasons            []string `json:"reasons,omitempty"`
	HasLimitConfigured bool     `json:"has_limit_configured"`
}

type APIKeyInsightsSummary struct {
	Configured          int `json:"configured"`
	ActiveToday         int `json:"active_today"`
	UnusedWithinWindow  int `json:"unused_within_window"`
	WindowSeconds       int64 `json:"window_seconds"`
	OverLimit           int `json:"over_limit"`
	HighFailure         int `json:"high_failure"`
}

type APIKeyInsightsResponse struct {
	Summary APIKeyInsightsSummary `json:"summary"`
	Items   []APIKeyInsightItem   `json:"items"`
}

func (h *Handler) GetAPIKeyInsights(c *gin.Context) {
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	sevenDayStart := now.Add(-7 * 24 * time.Hour).Unix()
	dayAgo := now.Add(-24 * time.Hour).Unix()

	history := requestHistorySnapshotForAnalytics()
	type aggregator struct {
		todayTokens   int64
		sevenDay      int64
		todayUSD      float64
		sevenDayUSD   float64
		failed24h     int64
		requests24h   int64
		lastUsed      int64
		providers     map[string]struct{}
	}
	by := make(map[string]*aggregator)
	oldest := int64(0)
	for _, r := range history {
		if r == nil {
			continue
		}
		if oldest == 0 || r.Timestamp < oldest {
			oldest = r.Timestamp
		}
		hash := strings.TrimSpace(r.APIKeyHash)
		if hash == "" {
			continue
		}
		agg := by[hash]
		if agg == nil {
			agg = &aggregator{providers: make(map[string]struct{})}
			by[hash] = agg
		}
		if r.Timestamp >= sevenDayStart {
			agg.sevenDay += r.TotalTokens
			agg.sevenDayUSD += r.EstimatedUSD
		}
		if r.Timestamp >= todayStart {
			agg.todayTokens += r.TotalTokens
			agg.todayUSD += r.EstimatedUSD
		}
		if r.Timestamp >= dayAgo {
			agg.requests24h++
			if r.Failed {
				agg.failed24h++
			}
		}
		if r.Timestamp > agg.lastUsed {
			agg.lastUsed = r.Timestamp
		}
		if r.Provider != "" {
			agg.providers[r.Provider] = struct{}{}
		}
	}

	// Pull configured limits + names so we can return rows for keys that have
	// no traffic yet.
	globalAPIKeyLimits.ensureLoaded(strings.TrimSpace(h.cfgAuthDir()))
	globalAPIKeyLimits.mu.RLock()
	limits := make(map[string]*APIKeyLimit, len(globalAPIKeyLimits.limits))
	for k, v := range globalAPIKeyLimits.limits {
		limits[k] = v
	}
	globalAPIKeyLimits.mu.RUnlock()

	// Combined hash set
	hashes := make(map[string]struct{}, len(by)+len(limits))
	for h := range by {
		hashes[h] = struct{}{}
	}
	for h := range limits {
		hashes[h] = struct{}{}
	}

	items := make([]APIKeyInsightItem, 0, len(hashes))
	summary := APIKeyInsightsSummary{Configured: len(limits)}
	if oldest > 0 {
		summary.WindowSeconds = now.Unix() - oldest
	} else {
		summary.WindowSeconds = 0
	}

	for hash := range hashes {
		agg := by[hash]
		limit := limits[hash]

		item := APIKeyInsightItem{
			Hash:               hash,
			HasLimitConfigured: limit != nil,
		}
		if limit != nil {
			item.Name = limit.Name
			item.Preview = limit.KeyPreview
			item.DailyLimit = limit.DailyTokenLimit
		}
		if agg != nil {
			item.TodayTokens = agg.todayTokens
			item.SevenDayTokens = agg.sevenDay
			item.EstimatedUSDToday = agg.todayUSD
			item.EstimatedUSD7d = agg.sevenDayUSD
			item.LastUsedAt = agg.lastUsed
			if agg.requests24h > 0 {
				item.FailureRate24h = float64(int(float64(agg.failed24h)/float64(agg.requests24h)*10000)) / 10000
			}
			if len(agg.providers) > 0 {
				ps := make([]string, 0, len(agg.providers))
				for p := range agg.providers {
					ps = append(ps, p)
				}
				sort.Strings(ps)
				item.Providers = ps
			}
		}

		// Status & reasons.
		reasons := make([]string, 0, 3)
		switch {
		case limit != nil && limit.DailyTokenLimit > 0 && item.TodayTokens >= limit.DailyTokenLimit:
			item.Status = "exceeded"
			reasons = append(reasons, "today_tokens >= daily_limit")
		case limit != nil && limit.DailyTokenLimit > 0 && float64(item.TodayTokens)/float64(limit.DailyTokenLimit) >= 0.8:
			item.Status = "warn"
			reasons = append(reasons, "daily usage >= 80%")
		case agg == nil || (now.Unix()-agg.lastUsed) > summary.WindowSeconds && summary.WindowSeconds > 0:
			item.Status = "unused"
			reasons = append(reasons, "no requests within visible window")
		case item.FailureRate24h >= 0.30 && agg != nil && agg.requests24h >= 10:
			item.Status = "high_failure"
			reasons = append(reasons, "failure_rate_24h >= 30%")
		default:
			item.Status = "ok"
		}

		// Orphan detection: configured but no limit and no traffic in window.
		if limit != nil && item.TodayTokens == 0 && item.SevenDayTokens == 0 {
			reasons = append(reasons, "configured but unused in window")
		}

		item.Reasons = reasons
		items = append(items, item)

		// Summary counters.
		if item.TodayTokens > 0 {
			summary.ActiveToday++
		}
		switch item.Status {
		case "unused":
			summary.UnusedWithinWindow++
		case "exceeded":
			summary.OverLimit++
		case "high_failure":
			summary.HighFailure++
		}
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].SevenDayTokens != items[j].SevenDayTokens {
			return items[i].SevenDayTokens > items[j].SevenDayTokens
		}
		return items[i].Hash < items[j].Hash
	})

	c.JSON(http.StatusOK, APIKeyInsightsResponse{Summary: summary, Items: items})
}

// cfgAuthDir is a tiny helper so the insights handler matches the style used
// elsewhere when reaching into Config without locking.
func (h *Handler) cfgAuthDir() string {
	if h == nil || h.cfg == nil {
		return ""
	}
	return strings.TrimSpace(h.cfg.AuthDir)
}
