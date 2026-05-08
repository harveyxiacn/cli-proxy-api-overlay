package auth

// bulk_refresh_throttled.go — overlay addition.
//
// Upstream's `TriggerRefreshAll` fires `go m.refreshAuth(...)` for every
// non-disabled OAuth credential at once. With 280+ codex accounts this
// produces a thundering herd of simultaneous OpenAI OAuth-token POSTs
// (auth.openai.com /oauth/token), saturating the upstream rate limit and
// returning 401 / `refresh_token_reused` for many accounts that would
// otherwise refresh fine if attempted serially.
//
// `TriggerRefreshAllThrottled` runs the same per-auth refresh path through a
// bounded worker pool. It blocks until every queued auth has finished, so
// callers can synchronously report success/failure counts.

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
)

// TriggerRefreshAllThrottled queues a refresh for every non-disabled,
// non-api-key auth and waits for all attempts to complete, throttled to
// `concurrency` parallel refreshes (clamped to 1..32; default 8 if <= 0).
// Returns (queued, succeeded, failed). Errors are not bubbled up; the per-auth
// outcome is reflected in each Auth's LastError / LastRefreshedAt fields.
func (m *Manager) TriggerRefreshAllThrottled(ctx context.Context, concurrency int) (queued, succeeded, failed int) {
	if m == nil {
		return 0, 0, 0
	}
	if concurrency <= 0 {
		concurrency = 8
	}
	if concurrency > 32 {
		concurrency = 32
	}
	if ctx == nil {
		ctx = context.Background()
	}

	auths := m.List()
	ids := make([]string, 0, len(auths))
	for _, a := range auths {
		if a == nil || a.Disabled {
			continue
		}
		accountType, _ := a.AccountInfo()
		if strings.EqualFold(strings.TrimSpace(accountType), "api_key") {
			continue
		}
		ids = append(ids, a.ID)
	}
	queued = len(ids)
	if queued == 0 {
		return 0, 0, 0
	}

	var succ, fail int64
	jobs := make(chan string, queued)
	for _, id := range ids {
		jobs <- id
	}
	close(jobs)

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range jobs {
				m.refreshAuth(ctx, id)
				if updated, ok := m.GetByID(id); ok && updated != nil {
					if updated.LastError == nil && !updated.LastRefreshedAt.IsZero() {
						atomic.AddInt64(&succ, 1)
					} else {
						atomic.AddInt64(&fail, 1)
					}
				} else {
					atomic.AddInt64(&fail, 1)
				}
			}
		}()
	}
	wg.Wait()
	return queued, int(atomic.LoadInt64(&succ)), int(atomic.LoadInt64(&fail))
}
