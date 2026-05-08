package management

// token_reports.go — overlay §5 Token Reports Center.
//
// Aggregates the request-history ring buffer over fixed ranges (24h / 7d / 30d)
// and exposes per-model, per-provider, per-api-key, per-account views plus a
// CSV export. When the requested range exceeds what the ring buffer holds, the
// response carries truncated=true with the actual covered window so the
// frontend can warn the user (full coverage requires P3 SQLite).

import (
	"encoding/csv"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/token-reports/summary", h.GetTokenReportSummary)
		rg.GET("/token-reports/by-model", h.GetTokenReportByModel)
		rg.GET("/token-reports/by-provider", h.GetTokenReportByProvider)
		rg.GET("/token-reports/by-api-key", h.GetTokenReportByAPIKey)
		rg.GET("/token-reports/by-account", h.GetTokenReportByAccount)
		rg.GET("/token-reports/export.csv", h.GetTokenReportExportCSV)
	})
}

type tokenReportTotals struct {
	Requests        int64   `json:"requests"`
	FailedRequests  int64   `json:"failed_requests"`
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
}

type tokenReportItem struct {
	Key string `json:"key"`
	tokenReportTotals
	FailureRate float64 `json:"failure_rate"`
}

type tokenReportEnvelope struct {
	Range               string            `json:"range"`
	WindowStartTS       int64             `json:"window_start_ts"`
	WindowEndTS         int64             `json:"window_end_ts"`
	Truncated           bool              `json:"truncated"`
	ActualRangeSeconds  int64             `json:"actual_range_seconds"`
	Totals              tokenReportTotals `json:"totals"`
	Items               []tokenReportItem `json:"items"`
}

func parseTokenRange(raw string) (label string, dur time.Duration) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "24h", "1d", "":
		return "24h", 24 * time.Hour
	case "7d":
		return "7d", 7 * 24 * time.Hour
	case "30d":
		return "30d", 30 * 24 * time.Hour
	}
	return "24h", 24 * time.Hour
}

// reportTotalsFromHistory walks the snapshot once, returning totals + per-key
// aggregates. Keyed by the result of keyFn (empty string is bucketed as
// "unknown"). Also reports the actual covered range — usually equal to the
// requested window, but smaller when the ring buffer was filled before the
// window began.
func reportTotalsFromHistory(history []*RequestRecord, since int64, keyFn func(*RequestRecord) string) (tokenReportTotals, []tokenReportItem, int64) {
	totals := tokenReportTotals{}
	by := make(map[string]*tokenReportItem)
	oldest := int64(0)
	for _, r := range history {
		if r == nil || r.Timestamp < since {
			continue
		}
		if oldest == 0 || r.Timestamp < oldest {
			oldest = r.Timestamp
		}
		if r.Failed {
			totals.FailedRequests++
		} else {
			totals.Requests++
		}
		totals.InputTokens += r.InputTokens
		totals.OutputTokens += r.OutputTokens
		totals.CachedTokens += r.CachedTokens
		totals.ReasoningTokens += r.ReasoningTokens
		totals.TotalTokens += r.TotalTokens
		totals.EstimatedUSD += r.EstimatedUSD
		if keyFn != nil {
			key := keyFn(r)
			if key == "" {
				key = "unknown"
			}
			it := by[key]
			if it == nil {
				it = &tokenReportItem{Key: key}
				by[key] = it
			}
			if r.Failed {
				it.FailedRequests++
			} else {
				it.Requests++
			}
			it.InputTokens += r.InputTokens
			it.OutputTokens += r.OutputTokens
			it.CachedTokens += r.CachedTokens
			it.ReasoningTokens += r.ReasoningTokens
			it.TotalTokens += r.TotalTokens
			it.EstimatedUSD += r.EstimatedUSD
		}
	}
	items := make([]tokenReportItem, 0, len(by))
	for _, it := range by {
		denom := it.Requests + it.FailedRequests
		if denom > 0 {
			it.FailureRate = float64(int(float64(it.FailedRequests)/float64(denom)*10000)) / 10000
		}
		items = append(items, *it)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].TotalTokens > items[j].TotalTokens })
	return totals, items, oldest
}

func buildTokenReport(c *gin.Context, keyFn func(*RequestRecord) string) tokenReportEnvelope {
	rangeRaw := c.Query("range")
	rangeLabel, dur := parseTokenRange(rangeRaw)
	now := time.Now()
	windowStart := now.Add(-dur).Unix()
	history := requestHistorySnapshotForAnalytics()

	totals, items, oldest := reportTotalsFromHistory(history, windowStart, keyFn)
	actual := dur.Nanoseconds() / int64(time.Second)
	truncated := false
	if oldest > 0 && oldest > windowStart {
		// History didn't reach back to the requested window start.
		actual = now.Unix() - oldest
		truncated = true
	}
	return tokenReportEnvelope{
		Range:              rangeLabel,
		WindowStartTS:      windowStart,
		WindowEndTS:        now.Unix(),
		Truncated:          truncated,
		ActualRangeSeconds: actual,
		Totals:             totals,
		Items:              items,
	}
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) GetTokenReportSummary(c *gin.Context) {
	report := buildTokenReport(c, nil)
	c.JSON(http.StatusOK, report)
}

func (h *Handler) GetTokenReportByModel(c *gin.Context) {
	report := buildTokenReport(c, func(r *RequestRecord) string {
		if r.Alias != "" {
			return r.Alias
		}
		return r.Model
	})
	c.JSON(http.StatusOK, report)
}

func (h *Handler) GetTokenReportByProvider(c *gin.Context) {
	report := buildTokenReport(c, func(r *RequestRecord) string { return r.Provider })
	c.JSON(http.StatusOK, report)
}

func (h *Handler) GetTokenReportByAPIKey(c *gin.Context) {
	report := buildTokenReport(c, func(r *RequestRecord) string { return r.APIKeyHash })
	c.JSON(http.StatusOK, report)
}

func (h *Handler) GetTokenReportByAccount(c *gin.Context) {
	report := buildTokenReport(c, func(r *RequestRecord) string { return r.AuthID })
	c.JSON(http.StatusOK, report)
}

// GetTokenReportExportCSV streams the per-record list inside the requested
// range, using ISO 8601 timestamps and 6-digit USD precision. Raw API keys are
// never exported — only api_key_hash.
func (h *Handler) GetTokenReportExportCSV(c *gin.Context) {
	rangeLabel, dur := parseTokenRange(c.Query("range"))
	since := time.Now().Add(-dur).Unix()
	history := requestHistorySnapshotForAnalytics()

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=token_report_"+rangeLabel+".csv")
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{
		"iso_time", "ts", "method", "path", "status_code", "provider", "model", "alias",
		"auth_id", "api_key_hash", "input_tokens", "output_tokens", "cached_tokens",
		"reasoning_tokens", "total_tokens", "estimated_usd", "latency_ms", "failed",
	})
	for _, r := range history {
		if r == nil || r.Timestamp < since {
			continue
		}
		_ = w.Write([]string{
			time.Unix(r.Timestamp, 0).UTC().Format(time.RFC3339),
			strconv.FormatInt(r.Timestamp, 10),
			r.Method,
			r.Path,
			strconv.Itoa(r.StatusCode),
			r.Provider,
			r.Model,
			r.Alias,
			r.AuthID,
			r.APIKeyHash,
			strconv.FormatInt(r.InputTokens, 10),
			strconv.FormatInt(r.OutputTokens, 10),
			strconv.FormatInt(r.CachedTokens, 10),
			strconv.FormatInt(r.ReasoningTokens, 10),
			strconv.FormatInt(r.TotalTokens, 10),
			strconv.FormatFloat(r.EstimatedUSD, 'f', 6, 64),
			strconv.FormatInt(r.LatencyMs, 10),
			strconv.FormatBool(r.Failed),
		})
	}
	w.Flush()
}
