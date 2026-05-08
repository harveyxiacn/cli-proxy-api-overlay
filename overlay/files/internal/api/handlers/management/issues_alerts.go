package management

import (
	"fmt"
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
		rg.GET("/issues", h.GetIssues)
		rg.GET("/health-summary", h.GetHealthSummary)
		rg.GET("/alerts", h.GetAlerts)
		rg.POST("/alerts/:id/ack", h.PostAlertAck)
		rg.POST("/alerts/:id/resolve", h.PostAlertResolve)
		rg.GET("/metrics", h.GetManagementMetrics)
	})
}

type ManagementIssue struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Kind     string `json:"kind"`
	AuthName string `json:"auth_name,omitempty"`
	Title    string `json:"title"`
	Detail   string `json:"detail,omitempty"`
	Action   string `json:"action,omitempty"`
	TS       int64  `json:"ts"`
}

type ManagementAlert struct {
	ID        string `json:"id"`
	Level     string `json:"level"`
	Category  string `json:"category"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	Target    string `json:"target,omitempty"`
	FirstSeen int64  `json:"first_seen"`
	LastSeen  int64  `json:"last_seen"`
	Count     int    `json:"count"`
	Status    string `json:"status"`
	Action    string `json:"action,omitempty"`
}

type alertStatusStore struct {
	mu     sync.RWMutex
	status map[string]string
}

var globalAlertStatuses = &alertStatusStore{status: make(map[string]string)}

func reloginMessage(message string) bool {
	lower := strings.ToLower(strings.TrimSpace(message))
	if lower == "" {
		return false
	}
	needles := []string{"refresh_token_reused", "invalid_grant", "unauthorized", "session expired", "expired token"}
	for _, needle := range needles {
		if strings.Contains(lower, needle) {
			return true
		}
	}
	return false
}

func authDisplayName(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if strings.TrimSpace(auth.FileName) != "" {
		return strings.TrimSpace(auth.FileName)
	}
	return strings.TrimSpace(auth.ID)
}

func BuildManagementIssues(manager *coreauth.Manager, now time.Time) []ManagementIssue {
	if manager == nil {
		return nil
	}
	emailGroups := make(map[string][]*coreauth.Auth)
	for _, auth := range manager.List() {
		if auth == nil {
			continue
		}
		if email := strings.ToLower(authEmail(auth)); email != "" {
			emailGroups[email] = append(emailGroups[email], auth)
		}
	}

	var issues []ManagementIssue
	for _, auth := range manager.List() {
		if auth == nil {
			continue
		}
		name := authDisplayName(auth)
		if reloginMessage(auth.StatusMessage) {
			issues = append(issues, ManagementIssue{
				ID:       "needs_relogin:" + name,
				Severity: "critical",
				Kind:     "needs_relogin",
				AuthName: name,
				Title:    "Account needs relogin",
				Detail:   strings.TrimSpace(auth.StatusMessage),
				Action:   "oauth_repair",
				TS:       now.Unix(),
			})
		}
		if auth.Disabled || auth.Status == coreauth.StatusDisabled {
			issues = append(issues, ManagementIssue{
				ID:       "disabled:" + name,
				Severity: "info",
				Kind:     "disabled",
				AuthName: name,
				Title:    "Account is disabled",
				Action:   "enable_auth",
				TS:       now.Unix(),
			})
		}
		if auth.NextRetryAfter.After(now) || auth.NextRefreshAfter.After(now) || auth.Quota.Exceeded {
			issues = append(issues, ManagementIssue{
				ID:       "cooling:" + name,
				Severity: "warning",
				Kind:     "cooling",
				AuthName: name,
				Title:    "Account is cooling down",
				Detail:   auth.Quota.Reason,
				Action:   "view_account",
				TS:       now.Unix(),
			})
		}
		if auth.Failed >= 3 {
			issues = append(issues, ManagementIssue{
				ID:       "long_failed:" + name,
				Severity: "warning",
				Kind:     "long_failed",
				AuthName: name,
				Title:    "Account has repeated failures",
				Detail:   fmt.Sprintf("%d failed requests", auth.Failed),
				Action:   "view_history",
				TS:       now.Unix(),
			})
		}
	}
	for email, group := range emailGroups {
		if len(group) < 2 {
			continue
		}
		for _, auth := range group {
			name := authDisplayName(auth)
			issues = append(issues, ManagementIssue{
				ID:       "duplicate_email:" + name,
				Severity: "warning",
				Kind:     "duplicate_email",
				AuthName: name,
				Title:    "Duplicate account email",
				Detail:   email,
				Action:   "dedupe",
				TS:       now.Unix(),
			})
		}
	}
	sort.SliceStable(issues, func(i, j int) bool {
		return issueRank(issues[i].Severity) < issueRank(issues[j].Severity)
	})
	return issues
}

func issueRank(severity string) int {
	switch severity {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

func (h *Handler) issueSource() (*coreauth.Manager, time.Time) {
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()
	return manager, time.Now()
}

func (h *Handler) GetIssues(c *gin.Context) {
	manager, now := h.issueSource()
	issues := BuildManagementIssues(manager, now)
	summary := gin.H{"critical": 0, "warning": 0, "info": 0}
	for _, issue := range issues {
		summary[issue.Severity] = summary[issue.Severity].(int) + 1
	}
	c.JSON(http.StatusOK, gin.H{"summary": summary, "items": issues})
}

func (h *Handler) GetHealthSummary(c *gin.Context) {
	manager, now := h.issueSource()
	issues := BuildManagementIssues(manager, now)
	score := 100
	healthyAccounts := 0
	activeAccounts := 0
	if manager != nil {
		for _, auth := range manager.List() {
			if auth == nil || auth.Disabled || auth.Status == coreauth.StatusDisabled {
				continue
			}
			activeAccounts++
			if auth.Status == coreauth.StatusActive || strings.EqualFold(string(auth.Status), "ready") {
				healthyAccounts++
			}
		}
	}
	reasons := make([]string, 0)
	for _, issue := range issues {
		switch issue.Severity {
		case "critical":
			score -= 15
		case "warning":
			score -= 5
		}
		if len(reasons) < 5 {
			reasons = append(reasons, issue.Title)
		}
	}
	if activeAccounts > 0 && healthyAccounts == 0 {
		score = 0
		reasons = append([]string{"no healthy accounts"}, reasons...)
	}
	if score < 0 {
		score = 0
	}
	status := "healthy"
	if score < 60 {
		status = "critical"
	} else if score < 85 {
		status = "degraded"
	}
	c.JSON(http.StatusOK, gin.H{
		"score":   score,
		"status":  status,
		"reasons": reasons,
		"metrics": gin.H{
			"active_accounts":  activeAccounts,
			"healthy_accounts": healthyAccounts,
			"issues":           len(issues),
		},
	})
}

func issueToAlert(issue ManagementIssue) ManagementAlert {
	return ManagementAlert{
		ID:        issue.ID,
		Level:     issue.Severity,
		Category:  strings.Split(issue.Kind, "_")[0],
		Title:     issue.Title,
		Message:   issue.Detail,
		Target:    issue.AuthName,
		FirstSeen: issue.TS,
		LastSeen:  issue.TS,
		Count:     1,
		Status:    "active",
		Action:    issue.Action,
	}
}

func alertStatus(id string) string {
	globalAlertStatuses.mu.RLock()
	status := globalAlertStatuses.status[id]
	globalAlertStatuses.mu.RUnlock()
	if status == "" {
		return "active"
	}
	return status
}

func setAlertStatus(id, status string) {
	globalAlertStatuses.mu.Lock()
	if globalAlertStatuses.status == nil {
		globalAlertStatuses.status = make(map[string]string)
	}
	globalAlertStatuses.status[id] = status
	globalAlertStatuses.mu.Unlock()
}

func (h *Handler) GetAlerts(c *gin.Context) {
	manager, now := h.issueSource()
	issues := BuildManagementIssues(manager, now)
	alerts := make([]ManagementAlert, 0, len(issues))
	statusFilter := strings.TrimSpace(c.Query("status"))
	levelFilter := strings.TrimSpace(c.Query("level"))
	for _, issue := range issues {
		alert := issueToAlert(issue)
		alert.Status = alertStatus(alert.ID)
		if statusFilter != "" && alert.Status != statusFilter {
			continue
		}
		if levelFilter != "" && alert.Level != levelFilter {
			continue
		}
		alerts = append(alerts, alert)
	}
	c.JSON(http.StatusOK, gin.H{"alerts": alerts, "count": len(alerts)})
}

func (h *Handler) PostAlertAck(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id is required"})
		return
	}
	setAlertStatus(id, "acknowledged")
	c.JSON(http.StatusOK, gin.H{"status": "acknowledged", "id": id})
}

func (h *Handler) PostAlertResolve(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id is required"})
		return
	}
	setAlertStatus(id, "resolved")
	c.JSON(http.StatusOK, gin.H{"status": "resolved", "id": id})
}

func (h *Handler) GetManagementMetrics(c *gin.Context) {
	manager, now := h.issueSource()
	counts := make(map[string]int)
	if manager != nil {
		for _, auth := range manager.List() {
			if auth == nil {
				continue
			}
			provider := strings.ToLower(strings.TrimSpace(auth.Provider))
			if provider == "" {
				provider = "unknown"
			}
			status := strings.ToLower(strings.TrimSpace(string(auth.Status)))
			if status == "" {
				status = "unknown"
			}
			counts[provider+"|"+status]++
		}
	}
	issues := BuildManagementIssues(manager, now)
	alertCounts := make(map[string]int)
	for _, issue := range issues {
		alertCounts[issue.Severity]++
	}
	var b strings.Builder
	b.WriteString("# TYPE cpa_management_accounts_total gauge\n")
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		parts := strings.SplitN(key, "|", 2)
		b.WriteString(fmt.Sprintf("cpa_management_accounts_total{provider=\"%s\",status=\"%s\"} %d\n", parts[0], parts[1], counts[key]))
	}
	b.WriteString("# TYPE cpa_management_alerts_active gauge\n")
	for _, level := range []string{"critical", "warning", "info"} {
		b.WriteString(fmt.Sprintf("cpa_management_alerts_active{level=\"%s\"} %d\n", level, alertCounts[level]))
	}
	c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(b.String()))
}
