package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func TestGetTokenStats_IncludesAPIKeyHash(t *testing.T) {
	gin.SetMode(gin.TestMode)
	original := globalTokenStats
	globalTokenStats = newTokenStatsPlugin()
	t.Cleanup(func() { globalTokenStats = original })

	globalTokenStats.HandleUsage(context.Background(), usage.Record{
		Provider: "codex",
		Model:    "gpt-5.4",
		APIKey:   "sk-test-token-stats-secret",
		AuthID:   "api-key-auth-1",
		Detail: usage.Detail{
			InputTokens:  10,
			OutputTokens: 20,
			TotalTokens:  30,
		},
	})

	h := NewHandlerWithoutConfigFilePath(nil, nil)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/token-stats", nil)

	h.GetTokenStats(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var payload struct {
		Entries []struct {
			AuthID     string `json:"auth_id"`
			APIKeyHash string `json:"api_key_hash"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode token stats response: %v", err)
	}
	if len(payload.Entries) != 1 {
		t.Fatalf("expected one token stats entry, got %d", len(payload.Entries))
	}
	if payload.Entries[0].APIKeyHash == "" {
		t.Fatalf("expected api_key_hash to be populated, body=%s", rec.Body.String())
	}
	if payload.Entries[0].APIKeyHash == "sk-test-token-stats-secret" {
		t.Fatalf("api_key_hash leaked raw API key")
	}
}
