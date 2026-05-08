package management

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/request-history", h.GetRequestHistory)
		rg.POST("/request-history/clear",
			auditingHandler("history.clear", "request_history", nil, h.PostClearRequestHistory))
	})
}

const requestLogCapacity = 5000

// RequestRecord stores a single proxied request with token metadata.
type RequestRecord struct {
	Timestamp       int64   `json:"ts"`
	Method          string  `json:"method,omitempty"`
	Path            string  `json:"path,omitempty"`
	StatusCode      int     `json:"status_code,omitempty"`
	Model           string  `json:"model,omitempty"`
	Alias           string  `json:"alias,omitempty"`
	Provider        string  `json:"provider,omitempty"`
	AuthID          string  `json:"auth_id,omitempty"`
	AuthIndex       string  `json:"auth_index,omitempty"`
	AuthType        string  `json:"auth_type,omitempty"`
	Email           string  `json:"email,omitempty"`
	Source          string  `json:"source,omitempty"`
	APIKeyHash      string  `json:"api_key_hash,omitempty"`
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
	LatencyMs       int64   `json:"latency_ms"`
	Failed          bool    `json:"failed"`
}

// requestRingBuffer is a thread-safe fixed-capacity ring buffer for RequestRecords.
type requestRingBuffer struct {
	mu      sync.RWMutex
	records []*RequestRecord
	head    int // next write position
	count   int // number of valid records (0..requestLogCapacity)
}

func newRequestRingBuffer() *requestRingBuffer {
	return &requestRingBuffer{records: make([]*RequestRecord, requestLogCapacity)}
}

func (b *requestRingBuffer) push(r *RequestRecord) {
	b.mu.Lock()
	b.records[b.head] = r
	b.head = (b.head + 1) % requestLogCapacity
	if b.count < requestLogCapacity {
		b.count++
	}
	b.mu.Unlock()
}

// newestFirst returns a snapshot of stored records ordered newest first.
func (b *requestRingBuffer) newestFirst() []*RequestRecord {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.count == 0 {
		return nil
	}
	out := make([]*RequestRecord, b.count)
	for i := 0; i < b.count; i++ {
		idx := (b.head - 1 - i + requestLogCapacity) % requestLogCapacity
		out[i] = b.records[idx]
	}
	return out
}

func (b *requestRingBuffer) reset() {
	b.mu.Lock()
	b.records = make([]*RequestRecord, requestLogCapacity)
	b.head, b.count = 0, 0
	b.mu.Unlock()
}

// requestLogPlugin feeds the ring buffer from the usage manager pipeline.
type requestLogPlugin struct{ buf *requestRingBuffer }

// HandleUsage implements usage.Plugin.
func (p *requestLogPlugin) HandleUsage(ctx context.Context, rec usage.Record) {
	cost := calcCostUSD(rec.Model, rec.Detail)
	method, path, statusCode := requestHTTPContext(ctx)
	record := &RequestRecord{
		Timestamp:       rec.RequestedAt.Unix(),
		Method:          method,
		Path:            path,
		StatusCode:      statusCode,
		Model:           strings.TrimSpace(rec.Model),
		Alias:           strings.TrimSpace(rec.Alias),
		Provider:        strings.TrimSpace(rec.Provider),
		AuthID:          strings.TrimSpace(rec.AuthID),
		AuthIndex:       strings.TrimSpace(rec.AuthIndex),
		AuthType:        strings.TrimSpace(rec.AuthType),
		Source:          strings.TrimSpace(rec.Source),
		APIKeyHash:      hashAPIKey(rec.APIKey),
		InputTokens:     rec.Detail.InputTokens,
		OutputTokens:    rec.Detail.OutputTokens,
		CachedTokens:    rec.Detail.CachedTokens,
		ReasoningTokens: rec.Detail.ReasoningTokens,
		TotalTokens:     rec.Detail.TotalTokens,
		EstimatedUSD:    math.Round(cost*1e6) / 1e6,
		LatencyMs:       rec.Latency.Milliseconds(),
		Failed:          rec.Failed,
	}
	p.buf.push(record)
	appendRequestHistoryPersisted(record)
	PublishManagementEvent("request.recorded", record)
}

var globalRequestLogBuf = newRequestRingBuffer()

func init() {
	usage.RegisterPlugin(&requestLogPlugin{buf: globalRequestLogBuf})
}

func requestHTTPContext(ctx context.Context) (string, string, int) {
	if ctx == nil {
		return "", "", 0
	}
	ginCtx, ok := ctx.Value("gin").(*gin.Context)
	if !ok || ginCtx == nil || ginCtx.Request == nil {
		return "", "", 0
	}
	method := strings.TrimSpace(ginCtx.Request.Method)
	path := strings.TrimSpace(ginCtx.Request.URL.Path)
	statusCode := ginCtx.Writer.Status()
	return method, path, statusCode
}

func hashAPIKey(apiKey string) string {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(apiKey))
	encoded := hex.EncodeToString(sum[:])
	if len(encoded) > 16 {
		return encoded[:16]
	}
	return encoded
}

// GetRequestHistory returns recent proxied requests (newest first).
// GET /v0/management/request-history?limit=200&offset=0&q=gpt&status=4xx&model=gpt-4o&provider=codex&failed=true
func (h *Handler) GetRequestHistory(c *gin.Context) {
	limit := 200
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= requestLogCapacity {
			limit = n
		}
	}
	offset := 0
	if o := strings.TrimSpace(c.Query("offset")); o != "" {
		n, err := strconv.Atoi(o)
		if err != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "offset must be a non-negative integer"})
			return
		}
		offset = n
	}
	search := strings.ToLower(strings.TrimSpace(c.Query("q")))
	statusFilter := strings.ToLower(strings.TrimSpace(c.Query("status")))
	modelFilter := strings.ToLower(strings.TrimSpace(c.Query("model")))
	providerFilter := strings.ToLower(strings.TrimSpace(c.Query("provider")))
	failedOnly := strings.EqualFold(strings.TrimSpace(c.Query("failed")), "true")
	afterTS := int64(0)
	if v := strings.TrimSpace(c.Query("after_ts")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "after_ts must be a non-negative unix timestamp"})
			return
		}
		afterTS = n
	}
	beforeTS := int64(0)
	if v := strings.TrimSpace(c.Query("before_ts")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "before_ts must be a non-negative unix timestamp"})
			return
		}
		beforeTS = n
	}

	all := globalRequestLogBuf.newestFirst()

	// Build email lookup map from auth manager.
	emailByID := map[string]string{}
	h.mu.Lock()
	mgr := h.authManager
	h.mu.Unlock()
	if mgr != nil {
		for _, auth := range mgr.List() {
			if auth == nil {
				continue
			}
			if auth.Metadata != nil {
				if v, ok := auth.Metadata["email"].(string); ok {
					emailByID[auth.ID] = strings.TrimSpace(v)
				}
			}
		}
	}

	// Filter and optionally enrich with email.
	var filtered []*RequestRecord
	for _, r := range all {
		if r == nil {
			continue
		}
		if search != "" && !requestRecordMatchesSearch(r, search) {
			continue
		}
		if statusFilter != "" && !requestRecordMatchesStatus(r, statusFilter) {
			continue
		}
		if modelFilter != "" && !strings.Contains(strings.ToLower(r.Model), modelFilter) {
			continue
		}
		if providerFilter != "" && !strings.Contains(strings.ToLower(r.Provider), providerFilter) {
			continue
		}
		if failedOnly && !r.Failed {
			continue
		}
		if afterTS > 0 && r.Timestamp < afterTS {
			continue
		}
		if beforeTS > 0 && r.Timestamp > beforeTS {
			continue
		}
		if r.Email == "" {
			if email, ok := emailByID[r.AuthID]; ok {
				enriched := *r
				enriched.Email = email
				r = &enriched
			}
		}
		filtered = append(filtered, r)
	}

	total := len(filtered)
	pageEnd := offset + limit
	if offset > total {
		offset = total
	}
	if pageEnd > total {
		pageEnd = total
	}
	out := filtered[offset:pageEnd]

	// Compute summary over the full filtered set, not only the current page.
	summaryRecords := filtered
	if len(summaryRecords) == 0 {
		summaryRecords = nil
	}

	var (
		sumIn, sumOut, sumCached, sumTotal int64
		sumCost                            float64
		reqOK, reqFailed                   int64
	)
	for _, r := range summaryRecords {
		if r.Failed {
			reqFailed++
		} else {
			reqOK++
			sumIn += r.InputTokens
			sumOut += r.OutputTokens
			sumCached += r.CachedTokens
			sumTotal += r.TotalTokens
			sumCost += r.EstimatedUSD
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"records": out,
		"count":   len(out),
		"total":   total,
		"limit":   limit,
		"offset":  offset,
		"summary": gin.H{
			"input_tokens":    sumIn,
			"output_tokens":   sumOut,
			"cached_tokens":   sumCached,
			"total_tokens":    sumTotal,
			"estimated_usd":   math.Round(sumCost*1e6) / 1e6,
			"requests":        reqOK,
			"failed_requests": reqFailed,
		},
	})
}

func requestRecordMatchesSearch(r *RequestRecord, search string) bool {
	if r == nil || search == "" {
		return true
	}
	fields := []string{
		r.Method,
		r.Path,
		r.Model,
		r.Alias,
		r.Provider,
		r.AuthID,
		r.AuthIndex,
		r.AuthType,
		r.Email,
		r.Source,
		r.APIKeyHash,
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), search) {
			return true
		}
	}
	return false
}

func requestRecordMatchesStatus(r *RequestRecord, status string) bool {
	if r == nil || status == "" || status == "all" {
		return true
	}
	switch status {
	case "success", "ok":
		return !r.Failed
	case "failed", "error":
		return r.Failed
	case "2xx":
		return r.StatusCode >= 200 && r.StatusCode < 300
	case "3xx":
		return r.StatusCode >= 300 && r.StatusCode < 400
	case "4xx":
		return r.StatusCode >= 400 && r.StatusCode < 500
	case "5xx":
		return r.StatusCode >= 500 && r.StatusCode < 600
	default:
		if code, err := strconv.Atoi(status); err == nil {
			return r.StatusCode == code
		}
		return true
	}
}

// PostClearRequestHistory clears the in-memory ring buffer.
// POST /v0/management/request-history/clear
func (h *Handler) PostClearRequestHistory(c *gin.Context) {
	globalRequestLogBuf.reset()
	clearRequestHistoryPersistence()
	c.JSON(http.StatusOK, gin.H{"status": "ok", "message": "request history cleared"})
}
