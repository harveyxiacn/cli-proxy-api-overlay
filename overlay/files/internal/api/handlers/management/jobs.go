package management

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/jobs/refresh-tokens", h.PostRefreshTokensJob)
		rg.GET("/jobs", h.ListManagementJobs)
		rg.GET("/jobs/:id", h.GetManagementJob)
	})
}

const refreshJobTimeout = 10 * time.Minute

type managementJob struct {
	ID        string
	Type      string
	Status    string
	StartedAt time.Time
	UpdatedAt time.Time
	TargetIDs []string
	Queued    int
	// PreSkippedCount is the number of OAuth accounts whose tokens were still
	// valid at job creation time and were skipped (force=false / smart mode).
	// They are counted as Done+Skipped from the start of the job.
	PreSkippedCount int
	Force           bool
	// goroutineDone is set to 1 (atomically) once the background refresh
	// goroutine exits. snapshot() uses this to detect that all refreshAuth
	// calls have completed, so any accounts still appearing "pending" (because
	// conductor skipped them via NextRefreshAfter or refreshAuth returned early)
	// can be reclassified as skipped and the job marked completed.
	goroutineDone int32
}

type managementJobSnapshot struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	Status          string `json:"status"`
	StartedAt       int64  `json:"started_at"`
	UpdatedAt       int64  `json:"updated_at"`
	Total           int    `json:"total"`
	Queued          int    `json:"queued"`
	Done            int    `json:"done"`
	Success         int    `json:"success"`
	Failed          int    `json:"failed"`
	Skipped         int    `json:"skipped"`
	Pending         int    `json:"pending"`
	PreSkippedCount int    `json:"pre_skipped_count"` // accounts skipped due to valid token
	Force           bool   `json:"force"`
}

type managementJobStore struct {
	mu   sync.RWMutex
	jobs map[string]*managementJob
}

var globalManagementJobs = &managementJobStore{jobs: make(map[string]*managementJob)}

func (s *managementJobStore) put(job *managementJob) {
	if s == nil || job == nil || job.ID == "" {
		return
	}
	s.mu.Lock()
	if s.jobs == nil {
		s.jobs = make(map[string]*managementJob)
	}
	s.jobs[job.ID] = job
	cutoff := time.Now().Add(-1 * time.Hour)
	for id, existing := range s.jobs {
		if existing != nil && existing.StartedAt.Before(cutoff) {
			delete(s.jobs, id)
		}
	}
	s.mu.Unlock()
}

func (s *managementJobStore) get(id string) (*managementJob, bool) {
	if s == nil || id == "" {
		return nil, false
	}
	s.mu.RLock()
	job, ok := s.jobs[id]
	s.mu.RUnlock()
	return job, ok
}

// bulkRefreshConcurrency is the default number of OAuth refresh requests we
// allow to run in parallel against auth.openai.com.
const bulkRefreshConcurrency = 8

// throttledRefresher is satisfied by *coreauth.Manager when the overlay's
// bulk_refresh_throttled.go is present in the auth package. jobs.go uses an
// interface assertion so it compiles against the bare upstream (which lacks
// TriggerRefreshAllThrottled) and falls back gracefully.
type throttledRefresher interface {
	TriggerRefreshAllThrottled(ctx context.Context, concurrency int, force bool) (queued, skipped, succeeded, failed int)
}

type refreshJobOptions struct {
	Force       bool
	Concurrency int
}

func newRefreshTokensJob(manager *coreauth.Manager, opts refreshJobOptions) *managementJob {
	now := time.Now()
	conc := opts.Concurrency
	if conc <= 0 {
		conc = bulkRefreshConcurrency
	}

	job := &managementJob{
		ID:        uuid.NewString(),
		Type:      "refresh_tokens",
		Status:    "running",
		StartedAt: now,
		UpdatedAt: now,
		Force:     opts.Force,
	}
	if manager == nil {
		job.Status = "completed"
		return job
	}

	// Determine which accounts need refreshing. In smart mode (force=false)
	// the throttled worker (TriggerRefreshAllThrottled) handles the per-account
	// skip logic internally via shouldSkipBulkRefresh. Here we just collect all
	// non-disabled, non-api-key OAuth accounts as targets so the snapshot can
	// track per-account progress regardless of mode.
	for _, auth := range manager.List() {
		if auth == nil || auth.Disabled {
			continue
		}
		accountType, _ := auth.AccountInfo()
		if strings.EqualFold(strings.TrimSpace(accountType), "api_key") {
			continue
		}
		job.TargetIDs = append(job.TargetIDs, auth.ID)
	}

	// Queued = total OAuth accounts in scope (for display in "已创建任务 N 个账号").
	job.Queued = len(job.TargetIDs)

	if len(job.TargetIDs) == 0 {
		job.Status = "completed"
		return job
	}

	go func() {
		// goroutineDone=1 signals snapshot() that all refresh attempts have
		// returned, so any still-pending accounts can be reclassified as
		// skipped and the job marked completed — even when conductor skipped
		// an account due to NextRefreshAfter backoff.
		defer atomic.StoreInt32(&job.goroutineDone, 1)

		ctx := context.Background()
		if tr, ok := any(manager).(throttledRefresher); ok {
			// Overlay throttled version: blocks until every refreshAuth call
			// returns via a bounded worker pool — no thundering herd.
			tr.TriggerRefreshAllThrottled(ctx, conc, opts.Force)
			return
		}

		// Fallback: upstream TriggerRefreshAll fires goroutines in the
		// background and returns immediately (no blocking). Poll until all
		// target accounts reach a terminal state or the job is close to
		// timing out, then let the defer signal completion.
		manager.TriggerRefreshAll(ctx)
		deadline := time.Now().Add(refreshJobTimeout - 30*time.Second)
		for time.Now().Before(deadline) {
			time.Sleep(3 * time.Second)
			pending := 0
			for _, id := range job.TargetIDs {
				a, ok := manager.GetByID(id)
				if !ok || a == nil || a.Disabled {
					continue
				}
				refreshed := !a.LastRefreshedAt.IsZero() && !a.LastRefreshedAt.Before(job.StartedAt)
				hasFailed := a.LastError != nil && !a.NextRefreshAfter.IsZero() && a.NextRefreshAfter.After(job.StartedAt)
				if !refreshed && !hasFailed {
					pending++
				}
			}
			if pending == 0 {
				return
			}
		}
		// Deadline reached; defer sets goroutineDone and snapshot() will
		// force-complete remaining pending accounts as skipped.
	}()
	return job
}

func (j *managementJob) snapshot(manager *coreauth.Manager) managementJobSnapshot {
	if j == nil {
		return managementJobSnapshot{Status: "not_found"}
	}
	snap := managementJobSnapshot{
		ID:              j.ID,
		Type:            j.Type,
		Status:          j.Status,
		StartedAt:       j.StartedAt.Unix(),
		UpdatedAt:       time.Now().Unix(),
		Total:           len(j.TargetIDs) + j.PreSkippedCount,
		Queued:          j.Queued,
		PreSkippedCount: j.PreSkippedCount,
		Force:           j.Force,
	}
	// Accounts skipped upfront (valid token) count as done immediately.
	snap.Skipped += j.PreSkippedCount
	snap.Done += j.PreSkippedCount

	if manager == nil || len(j.TargetIDs) == 0 {
		snap.Status = "completed"
		return snap
	}
	for _, id := range j.TargetIDs {
		auth, ok := manager.GetByID(id)
		if !ok || auth == nil || auth.Disabled {
			snap.Skipped++
			snap.Done++
			continue
		}
		if !auth.LastRefreshedAt.IsZero() && !auth.LastRefreshedAt.Before(j.StartedAt) {
			snap.Success++
			snap.Done++
			continue
		}
		if auth.LastError != nil && !auth.NextRefreshAfter.IsZero() && auth.NextRefreshAfter.After(j.StartedAt) {
			snap.Failed++
			snap.Done++
			continue
		}
		snap.Pending++
	}
	// If the background goroutine has exited, all refreshAuth calls have
	// returned. Any account still showing as Pending at this point was either
	// skipped by the conductor (NextRefreshAfter in future at call time) or
	// refreshAuth returned early without updating state. Reclassify them as
	// Skipped so Done reaches Total and the job can be marked completed.
	goroutineDone := atomic.LoadInt32(&j.goroutineDone) != 0
	if goroutineDone && snap.Pending > 0 {
		snap.Skipped += snap.Pending
		snap.Done += snap.Pending
		snap.Pending = 0
	}
	if snap.Done >= snap.Total || goroutineDone {
		snap.Status = "completed"
	} else if time.Since(j.StartedAt) > refreshJobTimeout {
		snap.Status = "timeout"
	} else {
		snap.Status = "running"
	}
	return snap
}

func (h *Handler) PostRefreshTokensJob(c *gin.Context) {
	if h == nil || h.authManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth manager unavailable"})
		return
	}
	var body struct {
		Force       bool `json:"force"`
		Concurrency int  `json:"concurrency"`
	}
	_ = c.ShouldBindJSON(&body) // body is optional

	job := newRefreshTokensJob(h.authManager, refreshJobOptions{
		Force:       body.Force,
		Concurrency: body.Concurrency,
	})
	globalManagementJobs.put(job)
	snapshot := job.snapshot(h.authManager)
	PublishManagementEvent("job.created", snapshot)
	c.JSON(http.StatusOK, snapshot)
}

func (h *Handler) GetManagementJob(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	job, ok := globalManagementJobs.get(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()
	snapshot := job.snapshot(manager)
	PublishManagementEvent("job.updated", snapshot)
	c.JSON(http.StatusOK, snapshot)
}

// ListManagementJobs returns recent in-memory jobs (sorted newest-first).
// GET /v0/management/jobs
func (h *Handler) ListManagementJobs(c *gin.Context) {
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()

	globalManagementJobs.mu.RLock()
	all := make([]*managementJob, 0, len(globalManagementJobs.jobs))
	for _, j := range globalManagementJobs.jobs {
		if j != nil {
			all = append(all, j)
		}
	}
	globalManagementJobs.mu.RUnlock()

	// Sort newest-first
	sort.Slice(all, func(i, j int) bool {
		return all[i].StartedAt.After(all[j].StartedAt)
	})

	out := make([]managementJobSnapshot, 0, len(all))
	for _, j := range all {
		out = append(out, j.snapshot(manager))
	}

	c.JSON(http.StatusOK, gin.H{
		"jobs":  out,
		"count": len(out),
	})
}
