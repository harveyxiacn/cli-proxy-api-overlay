package management

import (
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/startup-snapshot", h.GetStartupSnapshot)
	})
}

// GetStartupSnapshot returns auth-files + auth-stats + today's token stats in a single call,
// allowing the management UI to initialise with one round-trip instead of three.
// GET /v0/management/startup-snapshot
func (h *Handler) GetStartupSnapshot(c *gin.Context) {
	if h == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "handler not initialized"})
		return
	}

	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()

	if manager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth manager unavailable"})
		return
	}

	// ── Parallel fetch of files and stats ─────────────────────────────────
	type filesResult struct {
		files []gin.H
	}
	type statsResult struct {
		entries      []authStatEntry
		totalSuccess int64
		totalFailed  int64
	}

	var fr filesResult
	var sr statsResult
	var mu sync.Mutex
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		auths := manager.List()
		files := make([]gin.H, 0, len(auths))
		for _, auth := range auths {
			if entry := h.buildAuthFileEntry(auth); entry != nil {
				files = append(files, entry)
			}
		}
		sort.Slice(files, func(i, j int) bool {
			ni, _ := files[i]["name"].(string)
			nj, _ := files[j]["name"].(string)
			return strings.ToLower(ni) < strings.ToLower(nj)
		})
		mu.Lock()
		fr.files = files
		mu.Unlock()
	}()

	go func() {
		defer wg.Done()
		now := time.Now()
		var entries []authStatEntry
		ts, tf := int64(0), int64(0)
		for _, auth := range manager.List() {
			if auth == nil {
				continue
			}
			email := ""
			if auth.Metadata != nil {
				if v, ok := auth.Metadata["email"].(string); ok {
					email = strings.TrimSpace(v)
				}
			}
			entries = append(entries, authStatEntry{
				ID:             auth.ID,
				Provider:       strings.TrimSpace(auth.Provider),
				Label:          strings.TrimSpace(auth.Label),
				Email:          email,
				Status:         string(auth.Status),
				Disabled:       auth.Disabled,
				Unavailable:    auth.Unavailable,
				Success:        auth.Success,
				Failed:         auth.Failed,
				RecentRequests: auth.RecentRequestsSnapshot(now),
			})
			ts += auth.Success
			tf += auth.Failed
		}
		mu.Lock()
		sr.entries = entries
		sr.totalSuccess = ts
		sr.totalFailed = tf
		mu.Unlock()
	}()

	wg.Wait()

	// ── Today's token stats (memory read, no external call) ───────────────
	p := globalTokenStats
	p.today.mu.Lock()
	p.today.maybeReset()
	tokenToday := gin.H{
		"date":             p.today.date,
		"input_tokens":     p.today.InputTokens,
		"output_tokens":    p.today.OutputTokens,
		"cached_tokens":    p.today.CachedTokens,
		"reasoning_tokens": p.today.ReasoningTokens,
		"total_tokens":     p.today.TotalTokens,
		"estimated_usd":    math.Round(p.today.EstimatedUSD*1e6) / 1e6,
		"requests":         p.today.Requests,
		"failed_requests":  p.today.FailedRequests,
	}
	p.today.mu.Unlock()

	files := fr.files
	if files == nil {
		files = []gin.H{}
	}
	entries := sr.entries
	if entries == nil {
		entries = []authStatEntry{}
	}

	c.JSON(http.StatusOK, gin.H{
		"files": gin.H{
			"files": files,
		},
		"stats": gin.H{
			"auths":         entries,
			"total_success": sr.totalSuccess,
			"total_failed":  sr.totalFailed,
			"count":         len(entries),
		},
		"token_today": tokenToday,
		"fetched_at":  time.Now().Unix(),
	})
}
