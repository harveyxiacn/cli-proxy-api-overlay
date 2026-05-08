package management

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/analytics/usage-daily", h.GetUsageDailyAnalytics)
		rg.GET("/analytics/usage-hourly", h.GetUsageHourlyAnalytics)
		rg.GET("/analytics/top-auths", h.GetTopAuthsAnalytics)
		rg.GET("/analytics/errors", h.GetErrorsAnalytics)
		rg.GET("/analytics/storage-summary", h.GetStorageSummary)
		rg.POST("/routing/explain", h.PostRoutingExplain)
	})
}

type usageAggregate struct {
	Day             string  `json:"day,omitempty"`
	AuthID          string  `json:"auth_id,omitempty"`
	Provider        string  `json:"provider,omitempty"`
	Model           string  `json:"model,omitempty"`
	Requests        int64   `json:"requests"`
	FailedRequests  int64   `json:"failed_requests"`
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
	LastTimestamp   int64   `json:"last_ts,omitempty"`
}

func addRecordToAggregate(agg *usageAggregate, record *RequestRecord) {
	if agg == nil || record == nil {
		return
	}
	if record.Failed {
		agg.FailedRequests++
	} else {
		agg.Requests++
	}
	agg.InputTokens += record.InputTokens
	agg.OutputTokens += record.OutputTokens
	agg.CachedTokens += record.CachedTokens
	agg.ReasoningTokens += record.ReasoningTokens
	agg.TotalTokens += record.TotalTokens
	agg.EstimatedUSD += record.EstimatedUSD
	if record.Timestamp > agg.LastTimestamp {
		agg.LastTimestamp = record.Timestamp
	}
}

func requestHistorySnapshotForAnalytics() []*RequestRecord {
	return globalRequestLogBuf.newestFirst()
}

func (h *Handler) GetUsageDailyAnalytics(c *gin.Context) {
	byDay := make(map[string]*usageAggregate)
	for _, record := range requestHistorySnapshotForAnalytics() {
		if record == nil {
			continue
		}
		day := time.Unix(record.Timestamp, 0).UTC().Format("2006-01-02")
		agg := byDay[day]
		if agg == nil {
			agg = &usageAggregate{Day: day}
			byDay[day] = agg
		}
		addRecordToAggregate(agg, record)
	}
	items := make([]*usageAggregate, 0, len(byDay))
	for _, agg := range byDay {
		items = append(items, agg)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Day > items[j].Day })
	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

func (h *Handler) GetUsageHourlyAnalytics(c *gin.Context) {
	byHour := make(map[string]*usageAggregate)
	for _, record := range requestHistorySnapshotForAnalytics() {
		if record == nil {
			continue
		}
		hour := time.Unix(record.Timestamp, 0).UTC().Format("2006-01-02T15:00:00Z")
		agg := byHour[hour]
		if agg == nil {
			agg = &usageAggregate{Day: hour}
			byHour[hour] = agg
		}
		addRecordToAggregate(agg, record)
	}
	items := make([]*usageAggregate, 0, len(byHour))
	for _, agg := range byHour {
		items = append(items, agg)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Day > items[j].Day })
	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

func (h *Handler) GetTopAuthsAnalytics(c *gin.Context) {
	byAuth := make(map[string]*usageAggregate)
	for _, record := range requestHistorySnapshotForAnalytics() {
		if record == nil {
			continue
		}
		key := strings.TrimSpace(record.AuthID)
		if key == "" {
			key = "unknown"
		}
		agg := byAuth[key]
		if agg == nil {
			agg = &usageAggregate{AuthID: key, Provider: record.Provider}
			byAuth[key] = agg
		}
		addRecordToAggregate(agg, record)
	}
	items := make([]*usageAggregate, 0, len(byAuth))
	for _, agg := range byAuth {
		items = append(items, agg)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].TotalTokens > items[j].TotalTokens })
	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

func (h *Handler) GetErrorsAnalytics(c *gin.Context) {
	type errorAggregate struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
		Count    int64  `json:"count"`
	}
	counts := make(map[string]*errorAggregate)
	for _, record := range requestHistorySnapshotForAnalytics() {
		if record == nil || !record.Failed {
			continue
		}
		key := record.Provider + "|" + record.Model
		agg := counts[key]
		if agg == nil {
			agg = &errorAggregate{Provider: record.Provider, Model: record.Model}
			counts[key] = agg
		}
		agg.Count++
	}
	items := make([]*errorAggregate, 0, len(counts))
	for _, agg := range counts {
		items = append(items, agg)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Count > items[j].Count })
	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

func (h *Handler) GetStorageSummary(c *gin.Context) {
	overlay := GetOverlayConfig()
	// SQLite is configured-but-not-yet-compiled in v1; report this honestly so
	// the frontend can prompt the operator to wait for the driver upgrade
	// rather than silently pretending it works.
	c.JSON(http.StatusOK, gin.H{
		"mode":                     "jsonl-json",
		"sqlite_enabled":           overlay.SQLite.Enabled,
		"sqlite_compiled":          false,
		"sqlite_path":              overlay.SQLite.Path,
		"sqlite_retention_days":    overlay.SQLite.RetentionDays,
		"request_history_capacity": requestLogCapacity,
		"records_loaded":           len(globalRequestLogBuf.newestFirst()),
	})
}

func (h *Handler) PostRoutingExplain(c *gin.Context) {
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()
	if manager == nil {
		c.JSON(http.StatusOK, gin.H{"selected": "", "candidates": []gin.H{}})
		return
	}
	candidates := make([]gin.H, 0)
	selected := ""
	bestScore := -1
	for _, auth := range manager.List() {
		if auth == nil || auth.Disabled {
			continue
		}
		score := 50
		reasons := []string{"available"}
		if auth.Status == "active" || auth.Status == "ready" {
			score += 30
			reasons = append(reasons, "healthy")
		}
		if auth.Quota.Exceeded {
			score -= 40
			reasons = append(reasons, "quota exceeded")
		}
		name := authDisplayName(auth)
		if score > bestScore {
			bestScore = score
			selected = name
		}
		candidates = append(candidates, gin.H{"name": name, "score": score, "reasons": reasons})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i]["score"].(int) > candidates[j]["score"].(int)
	})
	c.JSON(http.StatusOK, gin.H{"selected": selected, "candidates": candidates})
}
