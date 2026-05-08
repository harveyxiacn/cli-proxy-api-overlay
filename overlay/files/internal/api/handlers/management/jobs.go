package management

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
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
}

type managementJobSnapshot struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Status    string `json:"status"`
	StartedAt int64  `json:"started_at"`
	UpdatedAt int64  `json:"updated_at"`
	Total     int    `json:"total"`
	Queued    int    `json:"queued"`
	Done      int    `json:"done"`
	Success   int    `json:"success"`
	Failed    int    `json:"failed"`
	Skipped   int    `json:"skipped"`
	Pending   int    `json:"pending"`
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

// bulkRefreshConcurrency is the number of OAuth refresh requests we allow to
// run in parallel against auth.openai.com. Upstream's TriggerRefreshAll fires
// one goroutine per auth (no cap) which causes a thundering-herd that produces
// spurious refresh_token_reused 401s on large pools (~280 codex accounts).
const bulkRefreshConcurrency = 8

func newRefreshTokensJob(manager *coreauth.Manager) *managementJob {
	now := time.Now()
	job := &managementJob{
		ID:        uuid.NewString(),
		Type:      "refresh_tokens",
		Status:    "running",
		StartedAt: now,
		UpdatedAt: now,
	}
	if manager == nil {
		job.Status = "completed"
		return job
	}
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
	if len(job.TargetIDs) == 0 {
		job.Status = "completed"
		return job
	}
	job.Queued = len(job.TargetIDs)

	// Run the actual refresh in the background through the throttled bulk
	// helper. This both caps concurrency and lets the job snapshot reflect
	// real per-auth outcomes after the worker pool finishes.
	go func() {
		manager.TriggerRefreshAllThrottled(context.Background(), bulkRefreshConcurrency)
	}()
	return job
}

func (j *managementJob) snapshot(manager *coreauth.Manager) managementJobSnapshot {
	if j == nil {
		return managementJobSnapshot{Status: "not_found"}
	}
	snap := managementJobSnapshot{
		ID:        j.ID,
		Type:      j.Type,
		Status:    j.Status,
		StartedAt: j.StartedAt.Unix(),
		UpdatedAt: time.Now().Unix(),
		Total:     len(j.TargetIDs),
		Queued:    j.Queued,
	}
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
	if snap.Done >= snap.Total {
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
	job := newRefreshTokensJob(h.authManager)
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
