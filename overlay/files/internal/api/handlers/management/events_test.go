package management

import (
	"testing"
	"time"
)

func TestManagementEventBusReplayAndToken(t *testing.T) {
	bus := newManagementEventBus(3)

	first := bus.publish("job.created", map[string]any{"id": "job-1"})
	second := bus.publish("job.updated", map[string]any{"id": "job-1"})
	if first.ID != 1 || second.ID != 2 {
		t.Fatalf("expected monotonic ids 1 and 2, got %d and %d", first.ID, second.ID)
	}

	replayed, ok := bus.replayAfter(1)
	if !ok {
		t.Fatalf("expected replay to be available")
	}
	if len(replayed) != 1 || replayed[0].Type != "job.updated" {
		t.Fatalf("unexpected replay: %#v", replayed)
	}

	token := bus.createToken(time.Minute)
	if token == "" {
		t.Fatalf("expected non-empty token")
	}
	if !bus.validateToken(token) {
		t.Fatalf("expected token to validate before expiry")
	}
	if bus.validateToken("missing") {
		t.Fatalf("unexpected validation for missing token")
	}
}
