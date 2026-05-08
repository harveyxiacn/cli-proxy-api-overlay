package management

// routing_lab.go — overlay §7 Routing Lab (simulate).
//
// New endpoint: POST /v0/management/routing/simulate.
// The existing POST /routing/explain stays untouched (analytics.go) and keeps
// its current "explain current candidates" contract.
//
// simulate is read-only: it never sends real provider requests, never mutates
// auth state, and defaults to quota_mode=cached so it doesn't accidentally
// burn wham API budget.

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/routing/simulate", h.PostRoutingSimulate)
	})
}

type RoutingSimulateRequest struct {
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	APIKeyHash      string `json:"api_key_hash"`
	Group           string `json:"group"`
	Strategy        string `json:"strategy"`
	IncludeDisabled bool   `json:"include_disabled"`
	QuotaMode       string `json:"quota_mode"`
}

type RoutingSimulateCandidate struct {
	Name        string   `json:"name"`
	Score       int      `json:"score"`
	Selected    bool     `json:"selected"`
	Reasons     []string `json:"reasons,omitempty"`
	SkipReasons []string `json:"skip_reasons,omitempty"`
}

type RoutingSimulateResponse struct {
	Selected   string                     `json:"selected"`
	Strategy   string                     `json:"strategy"`
	QuotaMode  string                     `json:"quota_mode"`
	Candidates []RoutingSimulateCandidate `json:"candidates"`
}

func (h *Handler) PostRoutingSimulate(c *gin.Context) {
	if h == nil || h.authManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth manager unavailable"})
		return
	}
	var req RoutingSimulateRequest
	_ = c.ShouldBindJSON(&req)

	quotaMode := strings.ToLower(strings.TrimSpace(req.QuotaMode))
	if quotaMode != "cached" && quotaMode != "fresh" {
		quotaMode = "cached"
	}
	// "fresh" mode is currently treated as "cached" until §7.4's bounded
	// fresh-pull is implemented; we still echo back what was requested so the
	// frontend can reason about staleness.

	strategy := strings.TrimSpace(req.Strategy)
	if strategy == "" {
		strategy = "default"
	}

	candidates := make([]RoutingSimulateCandidate, 0)
	bestScore := -1
	bestName := ""
	for _, auth := range h.authManager.List() {
		if auth == nil {
			continue
		}
		name := authDisplayName(auth)

		var skip []string
		if auth.Disabled && !req.IncludeDisabled {
			skip = append(skip, "disabled")
		}
		if auth.Unavailable {
			skip = append(skip, "unavailable")
		}
		if authNeedsRelogin(auth) {
			skip = append(skip, "needs relogin")
		}
		if auth.Status == "error" {
			skip = append(skip, "status error")
		}
		if auth.Quota.Exceeded {
			skip = append(skip, "quota exceeded")
		}
		if req.Provider != "" && !strings.EqualFold(auth.Provider, req.Provider) {
			skip = append(skip, "provider mismatch")
		}
		if req.Group != "" && !strings.EqualFold(authGroup(auth), req.Group) {
			skip = append(skip, "group mismatch")
		}

		if len(skip) > 0 {
			candidates = append(candidates, RoutingSimulateCandidate{
				Name:        name,
				Score:       0,
				SkipReasons: skip,
			})
			continue
		}

		// Score: base 50, +30 healthy, +quota factor.
		score := 50
		reasons := []string{}
		if req.Provider != "" {
			reasons = append(reasons, "provider match")
		}
		if req.Group != "" {
			reasons = append(reasons, "group match")
		}
		if auth.Status == "active" || auth.Status == "ready" {
			score += 30
			reasons = append(reasons, "healthy")
		}
		if snap, ok := loadCodexQuotaSnapshotFor(auth.ID); ok {
			if snap.SecondaryWindow != nil {
				score += int(snap.SecondaryWindow.RemainingPercent / 4) // up to +25
				reasons = append(reasons, fmt.Sprintf("quota secondary remaining %.0f%%", snap.SecondaryWindow.RemainingPercent))
			} else if snap.PrimaryWindow != nil {
				score += int(snap.PrimaryWindow.RemainingPercent / 4)
				reasons = append(reasons, fmt.Sprintf("quota primary remaining %.0f%%", snap.PrimaryWindow.RemainingPercent))
			}
		}

		if score > bestScore {
			bestScore = score
			bestName = name
		}
		candidates = append(candidates, RoutingSimulateCandidate{
			Name:    name,
			Score:   score,
			Reasons: reasons,
		})
	}

	for i := range candidates {
		if candidates[i].Name == bestName && len(candidates[i].SkipReasons) == 0 {
			candidates[i].Selected = true
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Selected != candidates[j].Selected {
			return candidates[i].Selected
		}
		return candidates[i].Score > candidates[j].Score
	})

	c.JSON(http.StatusOK, RoutingSimulateResponse{
		Selected:   bestName,
		Strategy:   strategy,
		QuotaMode:  quotaMode,
		Candidates: candidates,
	})
}
