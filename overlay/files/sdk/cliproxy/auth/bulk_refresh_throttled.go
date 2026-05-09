package auth

// bulk_refresh_throttled.go — overlay addition.
//
// Upstream's `TriggerRefreshAll` fires `go m.refreshAuth(...)` for every
// non-disabled OAuth credential at once. With 280+ codex accounts this
// produces a thundering herd of simultaneous OpenAI OAuth-token POSTs
// (auth.openai.com /oauth/token), saturating the upstream rate limit and
// returning 401 / `refresh_token_reused` for many accounts that would
// otherwise refresh fine if attempted serially or with low concurrency.
//
// This file only calls public Manager methods (RefreshAuthByID, List, GetByID)
// so it remains version-independent and compiles against any upstream build.

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
)

// shouldSkipBulkRefresh returns true when the account's access token is still
// working and does not need an immediate refresh.
//
// Key insight: CPA sets status="active" when the access token is valid and the
// account can serve requests. LastRefreshedAt is an in-memory field that resets
// to zero on every CPA restart — it does NOT indicate whether the token is fresh.
// Trying to refresh "active" accounts is both unnecessary (token is fine) and
// harmful (consumes the refresh token, which is one-time-use for Codex/ChatGPT).
//
// Smart mode therefore only refreshes accounts that are genuinely broken:
// status=error (access token expired), unavailable, or explicitly flagged.
func shouldSkipBulkRefresh(a *Auth) bool {
	if a == nil || a.Disabled {
		return true
	}
	// Account is currently serving requests — skip to avoid wasting the
	// one-time-use refresh token on a token that doesn't need refreshing.
	if a.Status == StatusActive || string(a.Status) == "ready" {
		return true
	}
	// Account is broken (error, unavailable, unknown) — needs refresh.
	return false
}

// TriggerRefreshAllThrottled queues a refresh for every non-disabled,
// non-api-key auth and waits for all attempts to complete, throttled to
// `concurrency` parallel refreshes (clamped to 1..32; default 8 if <= 0).
//
// When force is false (smart mode), accounts whose tokens are fresh (no error,
// refreshed within the last 55 min, or expiry > 5 min away) are skipped to
// avoid unnecessary OAuth calls that can trigger rate limits.
//
// Returns (queued, skipped, succeeded, failed):
//   - queued:    accounts that entered the worker pool
//   - skipped:   accounts whose tokens were fresh and skipped (force=false only)
//   - succeeded: accounts that refreshed successfully
//   - failed:    accounts where refresh failed
func (m *Manager) TriggerRefreshAllThrottled(ctx context.Context, concurrency int, force bool) (queued, skipped, succeeded, failed int) {
	if m == nil {
		return 0, 0, 0, 0
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
		if !force && shouldSkipBulkRefresh(a) {
			skipped++
			continue
		}
		ids = append(ids, a.ID)
	}
	queued = len(ids)
	if queued == 0 {
		return 0, skipped, 0, 0
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
				m.RefreshAuthByID(ctx, id)
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
	return queued, skipped, int(atomic.LoadInt64(&succ)), int(atomic.LoadInt64(&fail))
}
