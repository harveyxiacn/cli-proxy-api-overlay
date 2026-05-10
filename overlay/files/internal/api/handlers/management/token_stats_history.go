package management

// token_stats_history.go — overlay addition.
//
// Appends a daily snapshot of token usage to data/token_stats_daily.jsonl at
// 23:59:30 each night, just before the daily bucket resets at midnight.
// This preserves per-day totals across CPA restarts and provides the data
// for the historical usage chart on the Token Stats page.
//
// The archive goroutine runs in the background and is safe to run alongside
// the existing snapshot persistence (token_stats.json).

import (
	"bufio"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/token-stats/daily-history", h.GetTokenStatsDailyHistory)
	})
	go runDailyHistoryArchiver()
}

const tokenStatsDailyHistoryFileName = "token_stats_daily.jsonl"

// DailyStatsRecord is one row in the JSONL history file — one per archived day.
type DailyStatsRecord struct {
	Date            string  `json:"date"`             // "2006-01-02"
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
	Requests        int64   `json:"requests"`
	FailedRequests  int64   `json:"failed_requests"`
	// per-model breakdown (top 10 by tokens)
	Models []DailyModelBreakdown `json:"models,omitempty"`
}

type DailyModelBreakdown struct {
	Key         string  `json:"key"`   // "provider:model"
	TotalTokens int64   `json:"total_tokens"`
	EstimatedUSD float64 `json:"estimated_usd"`
	Requests    int64   `json:"requests"`
}

// dailyHistoryPersistence holds the path to the JSONL history file.
type dailyHistoryPersistence struct {
	mu   sync.Mutex
	path string
}

var globalDailyHistory = &dailyHistoryPersistence{}

// configureDailyHistoryPersistence sets the path, called from configureUsagePersistence.
func configureDailyHistoryPersistence(path string) {
	globalDailyHistory.mu.Lock()
	globalDailyHistory.path = path
	globalDailyHistory.mu.Unlock()
}

// runDailyHistoryArchiver sleeps until 23:59:30 each day and archives today's stats.
// Running just before midnight captures essentially the full day before the
// dailyBucket.maybeReset() zeroes the counters on the first request after midnight.
func runDailyHistoryArchiver() {
	for {
		now := time.Now()
		// Target: 23:59:30 local time today
		target := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 30, 0, now.Location())
		if now.After(target) {
			// Already past 23:59:30 — sleep until tomorrow's window
			target = target.Add(24 * time.Hour)
		}
		time.Sleep(target.Sub(now))
		archiveTodayStats()
	}
}

// archiveTodayStats snapshots the current day's token stats and appends to JSONL.
func archiveTodayStats() {
	globalDailyHistory.mu.Lock()
	path := globalDailyHistory.path
	globalDailyHistory.mu.Unlock()
	if path == "" {
		return
	}

	snap := globalTokenStats.snapshot()
	today := snap.Today
	if today.Date == "" || today.TotalTokens == 0 {
		return // nothing worth archiving
	}

	// Build per-model breakdown (top 10 by total tokens)
	type modelRow struct {
		key         string
		totalTokens int64
		usd         float64
		reqs        int64
	}
	modelMap := make(map[string]*modelRow)
	for _, e := range snap.Entries {
		k := e.Provider + ":" + e.Key
		if _, ok := modelMap[k]; !ok {
			modelMap[k] = &modelRow{key: k}
		}
		r := modelMap[k]
		r.totalTokens += e.TotalTokens
		r.usd += e.EstimatedUSD
		r.reqs += e.Requests
	}
	rows := make([]*modelRow, 0, len(modelMap))
	for _, r := range modelMap {
		rows = append(rows, r)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].totalTokens > rows[j].totalTokens })
	if len(rows) > 10 {
		rows = rows[:10]
	}
	models := make([]DailyModelBreakdown, 0, len(rows))
	for _, r := range rows {
		models = append(models, DailyModelBreakdown{
			Key:          r.key,
			TotalTokens:  r.totalTokens,
			EstimatedUSD: r.usd,
			Requests:     r.reqs,
		})
	}

	rec := DailyStatsRecord{
		Date:            today.Date,
		InputTokens:     today.InputTokens,
		OutputTokens:    today.OutputTokens,
		CachedTokens:    today.CachedTokens,
		ReasoningTokens: today.ReasoningTokens,
		TotalTokens:     today.TotalTokens,
		EstimatedUSD:    today.EstimatedUSD,
		Requests:        today.Requests,
		FailedRequests:  today.FailedRequests,
		Models:          models,
	}
	_ = appendDailyHistoryRecord(path, rec)
}

func appendDailyHistoryRecord(path string, rec DailyStatsRecord) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	enc := json.NewEncoder(f)
	return enc.Encode(rec)
}

// GetTokenStatsDailyHistory returns the last N days of archived token stats.
// GET /v0/management/token-stats/daily-history?days=30
func (h *Handler) GetTokenStatsDailyHistory(c *gin.Context) {
	globalDailyHistory.mu.Lock()
	path := globalDailyHistory.path
	globalDailyHistory.mu.Unlock()

	days := 30
	if v := c.Query("days"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 && d <= 365 {
			days = d
		}
	}

	records, err := loadDailyHistory(path, days)
	if errors.Is(err, os.ErrNotExist) || path == "" {
		// Return today's snapshot if no history file yet
		snap := globalTokenStats.snapshot()
		today := snap.Today
		if today.Date != "" {
			c.JSON(http.StatusOK, gin.H{
				"records": []DailyStatsRecord{{
					Date:            today.Date,
					InputTokens:     today.InputTokens,
					OutputTokens:    today.OutputTokens,
					CachedTokens:    today.CachedTokens,
					ReasoningTokens: today.ReasoningTokens,
					TotalTokens:     today.TotalTokens,
					EstimatedUSD:    today.EstimatedUSD,
					Requests:        today.Requests,
					FailedRequests:  today.FailedRequests,
				}},
				"count": 1,
				"note":  "no history file yet; showing today only",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{"records": []DailyStatsRecord{}, "count": 0})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Also include today's in-progress data if it's not already in the file
	snap := globalTokenStats.snapshot()
	today := snap.Today
	hasToday := false
	for _, r := range records {
		if r.Date == today.Date {
			hasToday = true
			break
		}
	}
	if !hasToday && today.Date != "" && today.TotalTokens > 0 {
		records = append(records, DailyStatsRecord{
			Date:            today.Date,
			InputTokens:     today.InputTokens,
			OutputTokens:    today.OutputTokens,
			CachedTokens:    today.CachedTokens,
			ReasoningTokens: today.ReasoningTokens,
			TotalTokens:     today.TotalTokens,
			EstimatedUSD:    today.EstimatedUSD,
			Requests:        today.Requests,
			FailedRequests:  today.FailedRequests,
		})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Date < records[j].Date })

	c.JSON(http.StatusOK, gin.H{"records": records, "count": len(records)})
}

func loadDailyHistory(path string, days int) ([]DailyStatsRecord, error) {
	if path == "" {
		return nil, os.ErrNotExist
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	cutoff := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	seen := make(map[string]DailyStatsRecord)

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var rec DailyStatsRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		if rec.Date < cutoff {
			continue
		}
		// Later entries for the same date win (final archive of the day)
		seen[rec.Date] = rec
	}

	out := make([]DailyStatsRecord, 0, len(seen))
	for _, r := range seen {
		out = append(out, r)
	}
	return out, scanner.Err()
}

