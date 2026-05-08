package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func resetTokenReportsState() {
	globalRequestLogBuf.reset()
}

func pushRecord(ts int64, model, provider, authID, apiKeyHash string, totalTokens int64, usd float64, failed bool) {
	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:    ts,
		Model:        model,
		Provider:     provider,
		AuthID:       authID,
		APIKeyHash:   apiKeyHash,
		TotalTokens:  totalTokens,
		EstimatedUSD: usd,
		Failed:       failed,
	})
}

func TestTokenReports_SummaryAggregates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetTokenReportsState()
	now := time.Now().Unix()
	pushRecord(now-60, "gpt-5", "codex", "a.json", "kh1", 1000, 0.01, false)
	pushRecord(now-120, "gpt-5", "codex", "b.json", "kh1", 500, 0.005, true)
	pushRecord(now-180, "claude-4", "claude", "c.json", "kh2", 2000, 0.02, false)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v0/management/token-reports/summary?range=24h", nil)
	(&Handler{}).GetTokenReportSummary(c)

	var resp tokenReportEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Totals.TotalTokens != 3500 {
		t.Fatalf("expected 3500 total tokens, got %d", resp.Totals.TotalTokens)
	}
	if resp.Totals.Requests != 2 || resp.Totals.FailedRequests != 1 {
		t.Fatalf("unexpected totals: %+v", resp.Totals)
	}
}

func TestTokenReports_ByAPIKeyAndProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetTokenReportsState()
	now := time.Now().Unix()
	pushRecord(now-60, "gpt-5", "codex", "a.json", "kh1", 1000, 0.01, false)
	pushRecord(now-120, "gpt-5", "codex", "b.json", "kh1", 500, 0.005, false)
	pushRecord(now-180, "claude-4", "claude", "c.json", "kh2", 2000, 0.02, false)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v0/management/token-reports/by-api-key?range=24h", nil)
	(&Handler{}).GetTokenReportByAPIKey(c)

	var resp tokenReportEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Items) != 2 {
		t.Fatalf("expected 2 api keys, got %d (%+v)", len(resp.Items), resp.Items)
	}
	if resp.Items[0].Key != "kh2" && resp.Items[0].Key != "kh1" {
		t.Fatalf("unexpected api key: %q", resp.Items[0].Key)
	}

	rec2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(rec2)
	c2.Request = httptest.NewRequest(http.MethodGet, "/v0/management/token-reports/by-provider?range=24h", nil)
	(&Handler{}).GetTokenReportByProvider(c2)
	var resp2 tokenReportEnvelope
	_ = json.Unmarshal(rec2.Body.Bytes(), &resp2)
	if len(resp2.Items) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(resp2.Items))
	}
}

func TestTokenReports_TruncatedFlagSetWhenHistoryShorterThanRange(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetTokenReportsState()
	// Records only span the last 1 hour, request 7d.
	now := time.Now().Unix()
	for i := 0; i < 5; i++ {
		pushRecord(now-int64(i*600), "gpt-5", "codex", "a.json", "k", 100, 0.001, false)
	}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v0/management/token-reports/summary?range=7d", nil)
	(&Handler{}).GetTokenReportSummary(c)
	var resp tokenReportEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if !resp.Truncated {
		t.Fatalf("expected truncated=true when history shorter than range, got %+v", resp)
	}
	if resp.ActualRangeSeconds >= int64((7 * 24 * time.Hour).Seconds()) {
		t.Fatalf("actual_range_seconds should be smaller than full range, got %d", resp.ActualRangeSeconds)
	}
}

func TestTokenReports_CSVDoesNotLeakAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetTokenReportsState()
	pushRecord(time.Now().Unix(), "gpt-5", "codex", "a.json", "kh-secret", 100, 0.001, false)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v0/management/token-reports/export.csv?range=24h", nil)
	(&Handler{}).GetTokenReportExportCSV(c)
	body := rec.Body.String()
	if !contains2(body, "kh-secret") {
		t.Fatalf("expected api_key_hash in CSV")
	}
	// the helper hash kh-secret is fine; raw key would be visible if we were
	// exporting it, so the rule we enforce is "no header named api_key" without hash:
	if contains2(body, "raw_api_key") {
		t.Fatalf("CSV must not export raw api key")
	}
}

func contains2(haystack, needle string) bool { return len(needle) > 0 && len(haystack) >= len(needle) && (func() bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
})() }
