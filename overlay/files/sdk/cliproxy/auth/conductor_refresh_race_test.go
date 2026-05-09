package auth

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/executor"
)

type refreshRaceExecutor struct {
	calls int32
	block chan struct{}
}

func (e *refreshRaceExecutor) Identifier() string { return "codex" }

func (e *refreshRaceExecutor) Execute(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *refreshRaceExecutor) ExecuteStream(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}

func (e *refreshRaceExecutor) Refresh(ctx context.Context, a *Auth) (*Auth, error) {
	atomic.AddInt32(&e.calls, 1)
	select {
	case <-ctx.Done():
	case <-e.block:
	}
	updated := a.Clone()
	if updated.Metadata == nil {
		updated.Metadata = make(map[string]any)
	}
	updated.Metadata["refresh_token"] = "refresh-new"
	return updated, nil
}

func (e *refreshRaceExecutor) CountTokens(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e *refreshRaceExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, nil
}

func TestManager_RefreshAuthSingleflightsSameAuth(t *testing.T) {
	manager := NewManager(nil, nil, nil)
	exec := &refreshRaceExecutor{block: make(chan struct{})}
	manager.RegisterExecutor(exec)
	if _, err := manager.Register(context.Background(), &Auth{
		ID:       "race-auth",
		Provider: "codex",
		Metadata: map[string]any{"refresh_token": "refresh-old"},
	}); err != nil {
		t.Fatalf("register auth: %v", err)
	}

	const goroutines = 12
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			manager.refreshAuth(context.Background(), "race-auth")
		}()
	}

	close(start)
	deadline := time.Now().Add(time.Second)
	for atomic.LoadInt32(&exec.calls) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if atomic.LoadInt32(&exec.calls) == 0 {
		t.Fatal("refresh was not called")
	}
	time.Sleep(100 * time.Millisecond)
	close(exec.block)
	wg.Wait()

	if got := atomic.LoadInt32(&exec.calls); got != 1 {
		t.Fatalf("refreshAuth called executor %d times for one auth, want singleflight call", got)
	}
}

type refreshRaceErrorExecutor struct {
	manager *Manager
}

func (e refreshRaceErrorExecutor) Identifier() string { return "codex" }

func (e refreshRaceErrorExecutor) Execute(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e refreshRaceErrorExecutor) ExecuteStream(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}

func (e refreshRaceErrorExecutor) Refresh(ctx context.Context, a *Auth) (*Auth, error) {
	updated := a.Clone()
	updated.Metadata = map[string]any{"refresh_token": "refresh-new"}
	updated.LastRefreshedAt = time.Now()
	if _, err := e.manager.Update(ctx, updated); err != nil {
		return nil, err
	}
	return nil, errors.New("token refresh failed with status 400 Bad Request: invalid_grant")
}

func (e refreshRaceErrorExecutor) CountTokens(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}

func (e refreshRaceErrorExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, nil
}

func TestManager_RefreshAuthDoesNotOverwriteNewRefreshTokenAfterRaceError(t *testing.T) {
	manager := NewManager(nil, nil, nil)
	manager.RegisterExecutor(refreshRaceErrorExecutor{manager: manager})
	if _, err := manager.Register(context.Background(), &Auth{
		ID:       "race-error-auth",
		Provider: "codex",
		Metadata: map[string]any{"refresh_token": "refresh-old"},
	}); err != nil {
		t.Fatalf("register auth: %v", err)
	}

	manager.refreshAuth(context.Background(), "race-error-auth")

	updated, ok := manager.GetByID("race-error-auth")
	if !ok || updated == nil {
		t.Fatal("auth missing after refresh")
	}
	if got := updated.Metadata["refresh_token"]; got != "refresh-new" {
		t.Fatalf("refresh token = %v, want refresh-new", got)
	}
	if updated.LastError != nil {
		t.Fatalf("LastError = %v, want nil because a newer refresh token was already stored", updated.LastError)
	}
	if !updated.NextRefreshAfter.IsZero() {
		t.Fatalf("NextRefreshAfter = %s, want zero because race error was recovered", updated.NextRefreshAfter)
	}
}
