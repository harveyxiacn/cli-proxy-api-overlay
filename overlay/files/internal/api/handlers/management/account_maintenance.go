package management

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/auth-files/maintenance-summary", h.GetAuthFilesMaintenanceSummary)
	})
}

type authMaintenanceSummary struct {
	Total           int `json:"total"`
	Active          int `json:"active"`
	Ready           int `json:"ready"`
	Disabled        int `json:"disabled"`
	Unavailable     int `json:"unavailable"`
	Error           int `json:"error"`
	NeedsRelogin    int `json:"needs_relogin"`
	UnavailableFree int `json:"unavailable_free"`
	Problem         int `json:"problem"`
	// RefreshFailed: active accounts whose refresh_token has a non-retryable
	// error (e.g. refresh_token_reused) but whose access_token is still valid.
	// These work now but will need re-OAuth when the access_token expires.
	RefreshFailed int `json:"refresh_failed"`
}

type authMaintenanceCounts struct {
	Providers map[string]int `json:"providers"`
	Groups    map[string]int `json:"groups"`
	Tags      map[string]int `json:"tags"`
	Plans     map[string]int `json:"plans"`
}

type authMaintenanceCandidates struct {
	NeedsRelogin    []string `json:"needs_relogin"`
	UnavailableFree []string `json:"unavailable_free"`
	Problem         []string `json:"problem"`
}

// GetAuthFilesMaintenanceSummary returns low-risk maintenance metadata used by the
// frontend to drive filters and bulk selections without deleting anything.
func (h *Handler) GetAuthFilesMaintenanceSummary(c *gin.Context) {
	if h == nil || h.authManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "core auth manager unavailable"})
		return
	}

	auths := h.authManager.List()
	summary := authMaintenanceSummary{}
	counts := authMaintenanceCounts{
		Providers: map[string]int{},
		Groups:    map[string]int{},
		Tags:      map[string]int{},
		Plans:     map[string]int{},
	}
	candidates := authMaintenanceCandidates{}

	for _, auth := range auths {
		if auth == nil {
			continue
		}
		if isRuntimeOnlyAuth(auth) && (auth.Disabled || auth.Status == coreauth.StatusDisabled) {
			continue
		}

		name := authMaintenanceName(auth)
		provider := normalizedCountKey(auth.Provider, "unknown")
		plan := normalizedCountKey(authPlanType(auth), "unknown")
		group := normalizedCountKey(authGroup(auth), "ungrouped")
		tags := authTags(auth)
		needsRelogin := authNeedsRelogin(auth)
		unavailableFree := authUnavailableFree(auth, plan, needsRelogin)
		problem := authProblem(auth, needsRelogin)
		refreshFailed := authRefreshFailed(auth)

		summary.Total++
		counts.Providers[provider]++
		counts.Plans[plan]++
		counts.Groups[group]++
		for _, tag := range tags {
			counts.Tags[tag]++
		}

		if auth.Disabled || auth.Status == coreauth.StatusDisabled {
			summary.Disabled++
		} else {
			switch auth.Status {
			case coreauth.StatusActive:
				summary.Active++
			case coreauth.Status("ready"):
				summary.Ready++
			case coreauth.StatusError:
				summary.Error++
			}
		}
		if auth.Unavailable {
			summary.Unavailable++
		}
		if needsRelogin {
			summary.NeedsRelogin++
			candidates.NeedsRelogin = append(candidates.NeedsRelogin, name)
		}
		if unavailableFree {
			summary.UnavailableFree++
			candidates.UnavailableFree = append(candidates.UnavailableFree, name)
		}
		if problem {
			summary.Problem++
			candidates.Problem = append(candidates.Problem, name)
		}
		if refreshFailed {
			summary.RefreshFailed++
		}
	}

	sort.Strings(candidates.NeedsRelogin)
	sort.Strings(candidates.UnavailableFree)
	sort.Strings(candidates.Problem)

	c.JSON(http.StatusOK, gin.H{
		"summary":    summary,
		"counts":     counts,
		"candidates": candidates,
	})
}

func authMaintenanceName(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if name := strings.TrimSpace(auth.FileName); name != "" {
		return name
	}
	return strings.TrimSpace(auth.ID)
}

func normalizedCountKey(value, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return fallback
	}
	return value
}

func authPlanType(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if auth.Attributes != nil {
		if plan := strings.TrimSpace(auth.Attributes["plan_type"]); plan != "" {
			return plan
		}
		if plan := strings.TrimSpace(auth.Attributes["chatgpt_plan_type"]); plan != "" {
			return plan
		}
	}
	if auth.Metadata != nil {
		for _, key := range []string{"plan_type", "chatgpt_plan_type"} {
			if raw, ok := auth.Metadata[key].(string); ok {
				if plan := strings.TrimSpace(raw); plan != "" {
					return plan
				}
			}
		}
	}
	return ""
}

func authGroup(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if group := strings.TrimSpace(authAttribute(auth, "group")); group != "" {
		return group
	}
	if auth.Metadata != nil {
		if raw, ok := auth.Metadata["group"].(string); ok {
			return strings.TrimSpace(raw)
		}
	}
	return ""
}

func authTags(auth *coreauth.Auth) []string {
	if auth == nil || auth.Metadata == nil {
		return nil
	}
	tags, ok := metadataStringSlice(auth.Metadata["tags"])
	if !ok {
		return nil
	}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		normalized := normalizedCountKey(tag, "")
		if normalized != "" {
			out = append(out, normalized)
		}
	}
	return out
}

func authNeedsRelogin(auth *coreauth.Auth) bool {
	if auth == nil {
		return false
	}
	// Trust status first. When status is active/ready the access_token is still
	// working — even if the refresh_token is dead (refresh_token_reused), the
	// account can serve requests right now. The Badge shows "刷新失败" (orange)
	// for those via lastError, but the maintenance "needs_relogin" bucket should
	// only count accounts whose access_token has ALSO expired (status = error /
	// unavailable). This avoids the earlier bug where ~282 accounts were falsely
	// flagged because every account had at least one transient 401 in its history.
	if auth.Status == coreauth.StatusActive || string(auth.Status) == "ready" {
		return false
	}
	if statusMessageNeedsRelogin(auth.StatusMessage) {
		return true
	}
	if auth.LastError != nil {
		return statusMessageNeedsRelogin(auth.LastError.Code) || statusMessageNeedsRelogin(auth.LastError.Message)
	}
	return false
}

// nonRetryableRefreshErrors are error codes that indicate the refresh_token
// is permanently dead and no amount of retrying will help. These cause
// authRefreshFailed() to flag an otherwise-active account.
var nonRetryableRefreshErrors = []string{"refresh_token_reused", "invalid_grant"}

// authRefreshFailed returns true when an account is still active (access_token
// working) but its last refresh attempt failed with a confirmed non-retryable
// error. These accounts will need re-OAuth when the access_token expires.
//
// Note: only counts errors confirmed non-retryable (refresh_token_reused,
// invalid_grant), NOT all relogin-keyword matches, to avoid false positives
// from transient errors like 429 or network timeouts.
func authRefreshFailed(auth *coreauth.Auth) bool {
	if auth == nil || auth.Disabled {
		return false
	}
	if auth.Status != coreauth.StatusActive && string(auth.Status) != "ready" {
		return false // counted separately as error/needsRelogin
	}
	if auth.LastError == nil {
		return false
	}
	errText := strings.ToLower(auth.LastError.Code + " " + auth.LastError.Message)
	for _, e := range nonRetryableRefreshErrors {
		if strings.Contains(errText, e) {
			return true
		}
	}
	return false
}

func authUnavailableFree(auth *coreauth.Auth, plan string, needsRelogin bool) bool {
	if auth == nil {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(auth.Provider), "codex") {
		return false
	}
	if plan != "free" {
		return false
	}
	if needsRelogin {
		return false
	}
	return auth.Unavailable || strings.EqualFold(string(auth.Status), "unavailable") || auth.Status == coreauth.StatusError
}

func authProblem(auth *coreauth.Auth, needsRelogin bool) bool {
	if auth == nil {
		return false
	}
	if auth.Disabled || auth.Unavailable || needsRelogin {
		return true
	}
	switch auth.Status {
	case "", coreauth.StatusActive, coreauth.Status("ready"):
		return false
	default:
		return true
	}
}
