package management

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/executor"
)

func TestRefreshTokenJobSnapshotCountsSuccessFailureAndPending(t *testing.T) {
	started := time.Now().Add(-time.Minute)
	manager := auth.NewManager(nil, nil, nil)
	seed := []*auth.Auth{
		{ID: "ok", Provider: "codex", Status: auth.StatusActive, LastRefreshedAt: started.Add(time.Second)},
		{ID: "failed", Provider: "codex", Status: auth.StatusActive, LastError: &auth.Error{Message: "refresh failed"}, NextRefreshAfter: started.Add(time.Minute)},
		{ID: "pending", Provider: "codex", Status: auth.StatusActive},
	}
	for _, item := range seed {
		if _, err := manager.Register(context.Background(), item); err != nil {
			t.Fatalf("failed to register auth %s: %v", item.ID, err)
		}
	}

	job := &managementJob{
		ID:        "job-1",
		Type:      "refresh_tokens",
		Status:    "running",
		StartedAt: started,
		TargetIDs: []string{"ok", "failed", "pending"},
	}

	snap := job.snapshot(manager)
	if snap.Success != 1 || snap.Failed != 1 || snap.Pending != 1 || snap.Done != 2 || snap.Total != 3 {
		t.Fatalf("unexpected snapshot counts: %#v", snap)
	}
	if snap.Status != "running" {
		t.Fatalf("expected running status while one target is pending, got %q", snap.Status)
	}
}

type refreshConcurrencyRecorder struct {
	sleep     time.Duration
	active    int32
	maxActive int32
	calls     int32
}

func (r *refreshConcurrencyRecorder) Identifier() string { return "codex" }

func (r *refreshConcurrencyRecorder) Execute(context.Context, *auth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (r *refreshConcurrencyRecorder) ExecuteStream(context.Context, *auth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}

func (r *refreshConcurrencyRecorder) Refresh(ctx context.Context, a *auth.Auth) (*auth.Auth, error) {
	current := atomic.AddInt32(&r.active, 1)
	for {
		maxSeen := atomic.LoadInt32(&r.maxActive)
		if current <= maxSeen || atomic.CompareAndSwapInt32(&r.maxActive, maxSeen, current) {
			break
		}
	}
	atomic.AddInt32(&r.calls, 1)
	select {
	case <-ctx.Done():
	case <-time.After(r.sleep):
	}
	atomic.AddInt32(&r.active, -1)
	return a, nil
}

func (r *refreshConcurrencyRecorder) CountTokens(context.Context, *auth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (r *refreshConcurrencyRecorder) HttpRequest(context.Context, *auth.Auth, *http.Request) (*http.Response, error) {
	return nil, nil
}

func TestPostRefreshAllTokensUsesThrottledRefresh(t *testing.T) {
	gin.SetMode(gin.TestMode)
	globalManagementJobs = &managementJobStore{jobs: make(map[string]*managementJob)}

	manager := auth.NewManager(nil, nil, nil)
	recorder := &refreshConcurrencyRecorder{sleep: 100 * time.Millisecond}
	manager.RegisterExecutor(recorder)

	const totalAuths = bulkRefreshConcurrency + 12
	for i := 0; i < totalAuths; i++ {
		item := &auth.Auth{
			ID:       fmt.Sprintf("oauth-%02d", i),
			Provider: "codex",
			Status:   auth.StatusActive,
			Metadata: map[string]any{"email": fmt.Sprintf("user-%02d@example.test", i)},
		}
		if _, err := manager.Register(context.Background(), item); err != nil {
			t.Fatalf("failed to register auth %s: %v", item.ID, err)
		}
	}

	h := NewHandlerWithoutConfigFilePath(&config.Config{}, manager)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/auth-files/refresh-all-tokens", nil)

	h.PostRefreshAllTokens(ctx)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %s", http.StatusOK, w.Code, w.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got := int(payload["queued"].(float64)); got != totalAuths {
		t.Fatalf("expected queued=%d, got %d in %#v", totalAuths, got, payload)
	}

	deadline := time.Now().Add(3 * time.Second)
	for atomic.LoadInt32(&recorder.calls) < totalAuths && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&recorder.calls); got != totalAuths {
		t.Fatalf("expected all %d refresh calls, got %d", totalAuths, got)
	}
	if got := atomic.LoadInt32(&recorder.maxActive); got > bulkRefreshConcurrency {
		t.Fatalf("refresh-all endpoint ran %d refreshes concurrently, want <= %d", got, bulkRefreshConcurrency)
	}
}
