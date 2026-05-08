package management

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func TestRequestHistoryPersistence_LoadsJSONLNewestFirst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "request_history.jsonl")
	records := []*RequestRecord{
		{Timestamp: 100, Model: "gpt-4o", Provider: "codex", TotalTokens: 10},
		{Timestamp: 200, Model: "o3", Provider: "codex", TotalTokens: 20},
	}

	for _, rec := range records {
		if err := appendRequestHistoryRecord(path, rec); err != nil {
			t.Fatalf("failed to append request record: %v", err)
		}
	}

	buf := newRequestRingBuffer()
	if err := loadRequestHistoryFile(path, buf); err != nil {
		t.Fatalf("failed to load request history file: %v", err)
	}

	got := buf.newestFirst()
	if len(got) != 2 {
		t.Fatalf("expected 2 loaded records, got %d", len(got))
	}
	if got[0].Timestamp != 200 || got[1].Timestamp != 100 {
		t.Fatalf("expected newest-first timestamps [200,100], got [%d,%d]", got[0].Timestamp, got[1].Timestamp)
	}
}

func TestTokenStatsPersistence_RestoresSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "token_stats.json")
	original := newTokenStatsPlugin()
	original.HandleUsage(context.Background(), usage.Record{
		Provider:    "codex",
		Model:       "gpt-4o",
		AuthID:      "auth-1",
		RequestedAt: time.Unix(200, 0),
		Detail: usage.Detail{
			InputTokens:  100,
			OutputTokens: 50,
			CachedTokens: 25,
			TotalTokens:  150,
		},
	})

	if err := saveTokenStatsSnapshot(path, original.snapshot()); err != nil {
		t.Fatalf("failed to save token stats snapshot: %v", err)
	}

	snap, ok, err := loadTokenStatsSnapshot(path)
	if err != nil {
		t.Fatalf("failed to load token stats snapshot: %v", err)
	}
	if !ok {
		t.Fatalf("expected token stats snapshot to exist")
	}

	restored := newTokenStatsPlugin()
	restored.restore(snap)
	if restored.globalTotal.Load() != 150 {
		t.Fatalf("expected restored total tokens 150, got %d", restored.globalTotal.Load())
	}
	if restored.globalRequests.Load() != 1 {
		t.Fatalf("expected restored requests 1, got %d", restored.globalRequests.Load())
	}
	restored.mu.RLock()
	entry := restored.byAuthID["auth-1"]
	restored.mu.RUnlock()
	if entry == nil {
		t.Fatalf("expected auth-1 entry to be restored")
	}
	if entry.InputTokens.Load() != 100 || entry.OutputTokens.Load() != 50 {
		t.Fatalf("unexpected restored entry tokens: input=%d output=%d", entry.InputTokens.Load(), entry.OutputTokens.Load())
	}
}
