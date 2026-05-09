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
	"time"
)

// atRefreshLeadTime is how close to expiry an access token must be before
// smart-mode bulk refresh will attempt to renew it. Refreshing too early wastes
// the one-time-use ST/RT; too late risks the token expiring under load.
const atRefreshLeadTime = 24 * time.Hour

// shouldSkipBulkRefresh returns true when the account's access token is still
// working and does not need an immediate refresh.
//
// Key insight: CPA sets status="active" when the access token is valid and the
// account can serve requests. For Codex/ChatGPT, each refresh token (ST) is
// one-time-use — refreshing unnecessarily consumes it permanently. Smart mode
// therefore checks the actual AT expiry from the JWT before deciding to refresh.
//
// Decision tree:
//  1. Non-active (error/unavailable) → refresh (account is broken)
//  2. Has LastError → refresh (something went wrong, try to recover)
//  3. AT expiry known AND expiry > 24h away → skip (plenty of time left)
//  4. AT expiry known AND expiry ≤ 24h → refresh (approaching expiry)
//  5. No expiry info, status=active → skip (trust CPA; don't waste the ST)
func shouldSkipBulkRefresh(a *Auth) bool {
	if a == nil || a.Disabled {
		return true
	}
	// Broken accounts always need a refresh attempt.
	if a.Status != StatusActive && string(a.Status) != "ready" {
		return false
	}
	// Active accounts with an error also need a retry.
	if a.LastError != nil {
		return false
	}
	// Check actual AT expiry from the auth metadata "expired" field.
	// For Codex, CodexTokenStorage writes "expired" with the AT expiry (~10 days).
	// Do NOT use id_token JWT exp — that's the session token's 1-hour lifetime,
	// not the access_token's expiry.
	if expiry, ok := a.ExpirationTime(); ok && !expiry.IsZero() {
		remaining := time.Until(expiry)
		// Skip if the AT has more than 24h left; otherwise refresh proactively.
		return remaining > atRefreshLeadTime
	}
	// No expiry info — trust CPA's active status to avoid consuming the
	// one-time-use refresh token unnecessarily.
	return true
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
