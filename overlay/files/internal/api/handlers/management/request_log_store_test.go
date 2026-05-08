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

func TestGetRequestHistory_TimeRangeFilters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	globalRequestLogBuf.reset()
	t.Cleanup(func() { globalRequestLogBuf.reset() })

	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:   100,
		Model:       "gpt-4o",
		Provider:    "codex",
		InputTokens: 10,
		TotalTokens: 10,
	})
	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:    200,
		Model:        "gpt-4o",
		Provider:     "codex",
		OutputTokens: 20,
		TotalTokens:  20,
	})
	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:       300,
		Model:           "gpt-4o",
		Provider:        "codex",
		ReasoningTokens: 30,
		TotalTokens:     30,
	})

	h := NewHandlerWithoutConfigFilePath(nil, nil)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/request-history?after_ts=150&before_ts=250&limit=10", nil)

	h.GetRequestHistory(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var payload struct {
		Records []RequestRecord `json:"records"`
		Count   int             `json:"count"`
		Summary struct {
			TotalTokens int64 `json:"total_tokens"`
			Requests    int64 `json:"requests"`
		} `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload.Count != 1 || len(payload.Records) != 1 {
		t.Fatalf("expected exactly one filtered record, got count=%d len=%d body=%s", payload.Count, len(payload.Records), rec.Body.String())
	}
	if payload.Records[0].Timestamp != 200 {
		t.Fatalf("expected timestamp 200, got %d", payload.Records[0].Timestamp)
	}
	if payload.Summary.TotalTokens != 20 || payload.Summary.Requests != 1 {
		t.Fatalf("expected summary total=20 requests=1, got total=%d requests=%d", payload.Summary.TotalTokens, payload.Summary.Requests)
	}
}

func TestRequestLogPlugin_EnrichesHTTPContextAndHashesAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	buf := newRequestRingBuffer()
	plugin := &requestLogPlugin{buf: buf}

	rec := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(rec)
	ginCtx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses?debug=1", nil)
	ginCtx.Status(http.StatusCreated)

	ctx := context.WithValue(context.Background(), "gin", ginCtx)
	plugin.HandleUsage(ctx, usage.Record{
		Provider:  "codex",
		Model:     "gpt-5.4",
		Alias:     "coding-model",
		APIKey:    "sk-test-secret",
		AuthID:    "auth-1",
		AuthIndex: "idx-1",
		AuthType:  "oauth",
		Source:    "owner@example.com",
		Detail: usage.Detail{
			InputTokens:  3,
			OutputTokens: 4,
			TotalTokens:  7,
		},
	})

	records := buf.newestFirst()
	if len(records) != 1 {
		t.Fatalf("expected one record, got %d", len(records))
	}
	got := records[0]
	if got.Method != http.MethodPost {
		t.Fatalf("method = %q, want %q", got.Method, http.MethodPost)
	}
	if got.Path != "/v1/responses" {
		t.Fatalf("path = %q, want /v1/responses", got.Path)
	}
	if got.StatusCode != http.StatusCreated {
		t.Fatalf("status_code = %d, want %d", got.StatusCode, http.StatusCreated)
	}
	if got.APIKeyHash == "" || got.APIKeyHash == "sk-test-secret" {
		t.Fatalf("api_key_hash should be populated and should not leak the raw key, got %q", got.APIKeyHash)
	}
	if got.Alias != "coding-model" || got.Source != "owner@example.com" || got.AuthIndex != "idx-1" || got.AuthType != "oauth" {
		t.Fatalf("record metadata not preserved: %#v", got)
	}
}

func TestGetRequestHistory_SearchStatusAndPagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	globalRequestLogBuf.reset()
	t.Cleanup(func() { globalRequestLogBuf.reset() })

	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:   100,
		Method:      http.MethodPost,
		Path:        "/v1/responses",
		StatusCode:  http.StatusOK,
		Model:       "gpt-5.4",
		Alias:       "code",
		Provider:    "codex",
		Email:       "ok@example.com",
		TotalTokens: 12,
	})
	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:   200,
		Method:      http.MethodPost,
		Path:        "/v1/chat/completions",
		StatusCode:  http.StatusTooManyRequests,
		Model:       "gpt-5.4",
		Provider:    "codex",
		Email:       "limited@example.com",
		Failed:      true,
		TotalTokens: 0,
	})
	globalRequestLogBuf.push(&RequestRecord{
		Timestamp:   300,
		Method:      http.MethodPost,
		Path:        "/v1/responses",
		StatusCode:  http.StatusBadGateway,
		Model:       "claude-sonnet",
		Provider:    "claude",
		Email:       "bad@example.com",
		Failed:      true,
		TotalTokens: 0,
	})

	h := NewHandlerWithoutConfigFilePath(nil, nil)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v0/management/request-history?q=chat&status=4xx&limit=1&offset=0", nil)

	h.GetRequestHistory(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var payload struct {
		Records []RequestRecord `json:"records"`
		Count   int             `json:"count"`
		Total   int             `json:"total"`
		Limit   int             `json:"limit"`
		Offset  int             `json:"offset"`
		Summary struct {
			Requests       int64 `json:"requests"`
			FailedRequests int64 `json:"failed_requests"`
		} `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload.Count != 1 || payload.Total != 1 || payload.Limit != 1 || payload.Offset != 0 {
		t.Fatalf("unexpected paging payload: count=%d total=%d limit=%d offset=%d body=%s", payload.Count, payload.Total, payload.Limit, payload.Offset, rec.Body.String())
	}
	if payload.Records[0].StatusCode != http.StatusTooManyRequests || payload.Records[0].Path != "/v1/chat/completions" {
		t.Fatalf("unexpected filtered record: %#v", payload.Records[0])
	}
	if payload.Summary.Requests != 0 || payload.Summary.FailedRequests != 1 {
		t.Fatalf("unexpected summary: %#v", payload.Summary)
	}
}
