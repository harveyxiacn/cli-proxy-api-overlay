package management

import (
	"context"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
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
