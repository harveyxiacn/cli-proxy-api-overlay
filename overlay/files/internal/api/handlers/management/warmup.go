package management

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/auth-files/warmup",
			auditingHandler("auth.warmup", "auth", extractAuthFileNames, h.PostWarmup))
	})
}

const (
	warmupWorkers = 6
	warmupTimeout = 15 * time.Second
)

// WarmupResult is the connectivity/token-validity test result for one account.
type WarmupResult struct {
	Name      string `json:"name"`
	ID        string `json:"id"`
	Email     string `json:"email,omitempty"`
	Provider  string `json:"provider"`
	OK        bool   `json:"ok"`
	Message   string `json:"message"`
	LatencyMs int64  `json:"latency_ms"`
}

type warmupJob struct {
	id          string
	name        string
	email       string
	provider    string
	status      string
	disabled    bool
	accessToken string
	accountID   string
}

// PostWarmup tests token validity for selected (or all active) accounts.
//
// Codex accounts: calls the wham usage endpoint with the stored access_token.
// Other providers: fast in-memory status check (no external network call).
//
// POST /v0/management/auth-files/warmup
// Body: {"names":["file.json",...]}  — omit / empty slice = test ALL non-disabled accounts
func (h *Handler) PostWarmup(c *gin.Context) {
	if h == nil || h.authManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth manager unavailable"})
		return
	}

	var req struct {
		Names []string `json:"names"`
	}
	_ = c.ShouldBindJSON(&req)

	h.mu.Lock()
	manager := h.authManager
	cfg := h.cfg
	h.mu.Unlock()

	proxyURL := ""
	if cfg != nil {
		proxyURL = strings.TrimSpace(cfg.ProxyURL)
	}
	httpClient := buildHTTPClientForQuota(proxyURL)
	httpClient.Timeout = warmupTimeout

	nameSet := make(map[string]bool, len(req.Names))
	for _, n := range req.Names {
		if t := strings.TrimSpace(n); t != "" {
			nameSet[t] = true
		}
	}

	var jobs []warmupJob
	for _, auth := range manager.List() {
		if auth == nil || auth.Disabled {
			continue
		}
		name := strings.TrimSpace(auth.FileName)
		if name == "" {
			name = auth.ID
		}
		if len(nameSet) > 0 && !nameSet[name] && !nameSet[auth.ID] {
			continue
		}

		email, accessToken, accountID := "", "", ""
		if auth.Metadata != nil {
			if v, ok := auth.Metadata["email"].(string); ok {
				email = strings.TrimSpace(v)
			}
			if v, ok := auth.Metadata["access_token"].(string); ok {
				accessToken = strings.TrimSpace(v)
			}
			for _, key := range []string{"account_id", "accountId", "workspace_id"} {
				if v, ok := auth.Metadata[key].(string); ok && strings.TrimSpace(v) != "" {
					accountID = strings.TrimSpace(v)
					break
				}
			}
		}

		jobs = append(jobs, warmupJob{
			id:          auth.ID,
			name:        name,
			email:       email,
			provider:    strings.TrimSpace(auth.Provider),
			status:      string(auth.Status),
			disabled:    auth.Disabled,
			accessToken: accessToken,
			accountID:   accountID,
		})
	}

	if len(jobs) == 0 {
		c.JSON(http.StatusOK, gin.H{"results": []WarmupResult{}, "total": 0, "succeeded": 0, "failed": 0})
		return
	}

	workers := intMin(warmupWorkers, len(jobs))
	jobCh := make(chan warmupJob, len(jobs))
	type resItem struct{ r WarmupResult }
	resCh := make(chan resItem, len(jobs))

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobCh {
				resCh <- resItem{r: runWarmupJob(c.Request.Context(), httpClient, job)}
			}
		}()
	}
	for _, j := range jobs {
		jobCh <- j
	}
	close(jobCh)
	go func() { wg.Wait(); close(resCh) }()

	results := make([]WarmupResult, 0, len(jobs))
	succeeded, failed := 0, 0
	for item := range resCh {
		results = append(results, item.r)
		if item.r.OK {
			succeeded++
		} else {
			failed++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results":   results,
		"total":     len(results),
		"succeeded": succeeded,
		"failed":    failed,
	})
}

func runWarmupJob(ctx context.Context, client *http.Client, job warmupJob) WarmupResult {
	r := WarmupResult{Name: job.name, ID: job.id, Email: job.email, Provider: job.provider}
	start := time.Now()

	// Codex: verify via wham API (network call)
	if strings.EqualFold(job.provider, "codex") {
		if job.accessToken == "" {
			r.OK = false
			r.Message = "未存储 access_token"
			r.LatencyMs = time.Since(start).Milliseconds()
			return r
		}
		_, statusCode, err := fetchWhamUsage(ctx, client, job.accessToken, job.accountID)
		r.LatencyMs = time.Since(start).Milliseconds()
		if err != nil {
			switch statusCode {
			case http.StatusUnauthorized:
				r.OK, r.Message = false, "access_token 已过期 (401)，请刷新 Token"
			case http.StatusForbidden:
				r.OK, r.Message = false, "账号被封禁或无权限 (403)"
			case http.StatusTooManyRequests:
				r.OK, r.Message = false, "请求频率过高 (429)，稍后再试"
			default:
				r.OK, r.Message = false, err.Error()
			}
		} else {
			r.OK, r.Message = true, "wham API 验证通过，账号有效"
		}
		return r
	}

	// Non-Codex: fast memory check
	r.LatencyMs = time.Since(start).Milliseconds()
	switch strings.ToLower(job.status) {
	case "active":
		r.OK, r.Message = true, "状态 active — 正常"
	case "ready":
		r.OK, r.Message = true, "状态 ready — 正常"
	case "disabled":
		r.OK, r.Message = false, "账号已禁用"
	case "error":
		r.OK, r.Message = false, "状态 error（非 Codex 账号不做网络验证）"
	case "":
		r.OK, r.Message = true, "状态未设置，视为正常"
	default:
		r.OK, r.Message = false, "状态异常: "+job.status
	}
	return r
}
