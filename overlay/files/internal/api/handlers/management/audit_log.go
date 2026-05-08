package management

// audit_log.go — overlay §9 audit log infrastructure.
//
// Records every destructive management action to <config-dir>/data/audit_log.jsonl
// and exposes GET /audit-log + GET /audit-log/export.csv for review.
//
// Design notes:
// - Append-only ring buffer in memory (capped) + JSONL persistence.
// - Best-effort write: a disk failure must never block the user-facing action.
// - The audit record never contains raw API keys / OAuth tokens; only the
//   sha256-prefix hash of the bearer token used to authenticate the request.
// - Other handlers should call appendAudit(c, ...) right after the underlying
//   action completes (success or failure both recorded).

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/audit-log", h.GetAuditLog)
		rg.GET("/audit-log/export.csv", h.GetAuditLogExportCSV)
	})
}

const (
	auditLogFileName = "audit_log.jsonl"
	auditLogCapacity = 10000
)

type AuditActor struct {
	ManagementKeyHash string `json:"management_key_hash,omitempty"`
	IP                string `json:"ip,omitempty"`
	UserAgent         string `json:"user_agent,omitempty"`
}

type AuditTarget struct {
	Type string   `json:"type,omitempty"`
	IDs  []string `json:"ids,omitempty"`
}

type AuditRequest struct {
	Path   string `json:"path,omitempty"`
	Method string `json:"method,omitempty"`
}

type AuditResult struct {
	OK        bool   `json:"ok"`
	Succeeded int    `json:"succeeded,omitempty"`
	Failed    int    `json:"failed,omitempty"`
	Error     string `json:"error,omitempty"`
}

type AuditEvent struct {
	ID      string       `json:"id"`
	TS      int64        `json:"ts"`
	Actor   AuditActor   `json:"actor"`
	Action  string       `json:"action"`
	Target  AuditTarget  `json:"target"`
	Request AuditRequest `json:"request"`
	Result  AuditResult  `json:"result"`
}

// ── ring buffer + persistence ─────────────────────────────────────────────────

type auditStore struct {
	mu      sync.Mutex
	records []AuditEvent
	head    int
	count   int
	path    string
	seq     uint64
}

var globalAuditStore = &auditStore{records: make([]AuditEvent, auditLogCapacity)}

func (s *auditStore) configurePath(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.path = strings.TrimSpace(path)
	if s.path != "" {
		_ = os.MkdirAll(filepath.Dir(s.path), 0o700)
		s.loadFromDiskLocked()
	}
}

// loadFromDiskLocked reads the JSONL file (best-effort) and replays entries
// into the ring buffer so a restart preserves recent history.
func (s *auditStore) loadFromDiskLocked() {
	f, err := os.Open(s.path)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev AuditEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		s.records[s.head] = ev
		s.head = (s.head + 1) % auditLogCapacity
		if s.count < auditLogCapacity {
			s.count++
		}
	}
}

func (s *auditStore) push(ev AuditEvent) {
	s.mu.Lock()
	s.records[s.head] = ev
	s.head = (s.head + 1) % auditLogCapacity
	if s.count < auditLogCapacity {
		s.count++
	}
	path := s.path
	s.mu.Unlock()
	if path == "" {
		return
	}
	go appendAuditEventToDisk(path, ev) // best-effort; failure swallowed
}

func appendAuditEventToDisk(path string, ev AuditEvent) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()
	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(ev)
}

func (s *auditStore) snapshot() []AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.count == 0 {
		return nil
	}
	out := make([]AuditEvent, s.count)
	for i := 0; i < s.count; i++ {
		idx := (s.head - 1 - i + auditLogCapacity) % auditLogCapacity
		out[i] = s.records[idx]
	}
	return out
}

func (s *auditStore) nextID(ts int64) string {
	n := atomic.AddUint64(&s.seq, 1)
	return fmt.Sprintf("audit_%d_%03d", ts, n%1000)
}

// configureAuditLogPersistence wires audit_log.jsonl alongside other data files.
func configureAuditLogPersistence(path string) {
	globalAuditStore.configurePath(path)
}

// ── Public emit helper (call from other handlers) ─────────────────────────────

// appendAudit records one event. `result.OK` defaults to false when not set
// and the caller is encouraged to fill `succeeded`/`failed` for batch ops.
// Pass nil ginContext when called from a non-HTTP code path.
func appendAudit(c *gin.Context, action string, target AuditTarget, result AuditResult) {
	ts := time.Now().Unix()
	ev := AuditEvent{
		ID:     globalAuditStore.nextID(ts),
		TS:     ts,
		Action: strings.TrimSpace(action),
		Target: target,
		Result: result,
	}
	if c != nil {
		ev.Actor = AuditActor{
			ManagementKeyHash: hashBearerToken(c.GetHeader("Authorization")),
			IP:                c.ClientIP(),
			UserAgent:         strings.TrimSpace(c.GetHeader("User-Agent")),
		}
		if c.Request != nil {
			ev.Request = AuditRequest{
				Path:   c.Request.URL.Path,
				Method: c.Request.Method,
			}
		}
	}
	globalAuditStore.push(ev)
}

func hashBearerToken(authHeader string) string {
	v := strings.TrimSpace(authHeader)
	if v == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(v), "bearer ") {
		v = strings.TrimSpace(v[len("Bearer "):])
	}
	if v == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(v))
	encoded := hex.EncodeToString(sum[:])
	if len(encoded) > 16 {
		return encoded[:16]
	}
	return encoded
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// auditingHandler wraps a gin handler so an audit_log entry is emitted after
// the handler completes. extractIDs runs on the captured request body to
// derive target IDs (returns nil for handlers without a meaningful target).
// Body is buffered and re-injected so downstream c.ShouldBindJSON still works.
func auditingHandler(action, targetType string, extractIDs func([]byte) []string, inner gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		var bodyBytes []byte
		if c.Request != nil && c.Request.Body != nil {
			bodyBytes, _ = io.ReadAll(c.Request.Body)
			_ = c.Request.Body.Close()
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}
		var ids []string
		if extractIDs != nil && len(bodyBytes) > 0 {
			ids = extractIDs(bodyBytes)
		}
		inner(c)
		status := c.Writer.Status()
		result := AuditResult{OK: status >= 200 && status < 400}
		if !result.OK {
			result.Error = http.StatusText(status)
		}
		appendAudit(c, action, AuditTarget{Type: targetType, IDs: ids}, result)
	}
}

// extractAuthFileNames pulls the "names" field from the standard batch payload
// shape used by /auth-files/{status,delete,fields}-batch.
func extractAuthFileNames(body []byte) []string {
	var payload struct {
		Names []string `json:"names"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	return payload.Names
}

// extractAuthFileSingleName pulls "name" for single-target endpoints.
func extractAuthFileSingleName(body []byte) []string {
	var payload struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	if strings.TrimSpace(payload.Name) == "" {
		return nil
	}
	return []string{payload.Name}
}

// extractParamID pulls a single named gin path parameter for use with handlers
// that operate on URL params instead of body fields.
func extractParamID(name string) func(c *gin.Context) []string {
	return func(c *gin.Context) []string {
		v := strings.TrimSpace(c.Param(name))
		if v == "" {
			return nil
		}
		return []string{v}
	}
}

// auditingHandlerParam is the param-extracting variant of auditingHandler. It
// reads the target ID from the gin route param after the handler runs.
func auditingHandlerParam(action, targetType string, paramName string, inner gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		inner(c)
		status := c.Writer.Status()
		result := AuditResult{OK: status >= 200 && status < 400}
		if !result.OK {
			result.Error = http.StatusText(status)
		}
		var ids []string
		if v := strings.TrimSpace(c.Param(paramName)); v != "" {
			ids = []string{v}
		}
		appendAudit(c, action, AuditTarget{Type: targetType, IDs: ids}, result)
	}
}

// GetAuditLog returns paginated audit events with optional filters.
func (h *Handler) GetAuditLog(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))
	actionFilter := strings.TrimSpace(c.Query("action"))
	targetFilter := strings.TrimSpace(c.Query("target"))
	afterTS, _ := strconv.ParseInt(c.Query("after_ts"), 10, 64)
	beforeTS, _ := strconv.ParseInt(c.Query("before_ts"), 10, 64)

	all := globalAuditStore.snapshot()
	filtered := make([]AuditEvent, 0, len(all))
	for _, ev := range all {
		if actionFilter != "" && !strings.EqualFold(ev.Action, actionFilter) {
			continue
		}
		if targetFilter != "" && !strings.EqualFold(ev.Target.Type, targetFilter) {
			continue
		}
		if afterTS > 0 && ev.TS < afterTS {
			continue
		}
		if beforeTS > 0 && ev.TS > beforeTS {
			continue
		}
		if q != "" {
			hay := strings.ToLower(ev.Action + " " + ev.Target.Type + " " + ev.Request.Path + " " + strings.Join(ev.Target.IDs, " "))
			if !strings.Contains(hay, q) {
				continue
			}
		}
		filtered = append(filtered, ev)
	}
	total := len(filtered)
	start := offset
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	page := filtered[start:end]
	c.JSON(http.StatusOK, gin.H{
		"items":  page,
		"count":  len(page),
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetAuditLogExportCSV streams the full filtered audit log as CSV.
func (h *Handler) GetAuditLogExportCSV(c *gin.Context) {
	all := globalAuditStore.snapshot()
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=audit_log.csv")
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"id", "iso_time", "ts", "action", "actor_ip", "actor_key_hash", "target_type", "target_ids", "method", "path", "ok", "succeeded", "failed", "error"})
	for _, ev := range all {
		_ = w.Write([]string{
			ev.ID,
			time.Unix(ev.TS, 0).UTC().Format(time.RFC3339),
			strconv.FormatInt(ev.TS, 10),
			ev.Action,
			ev.Actor.IP,
			ev.Actor.ManagementKeyHash,
			ev.Target.Type,
			strings.Join(ev.Target.IDs, "|"),
			ev.Request.Method,
			ev.Request.Path,
			strconv.FormatBool(ev.Result.OK),
			strconv.Itoa(ev.Result.Succeeded),
			strconv.Itoa(ev.Result.Failed),
			ev.Result.Error,
		})
	}
	w.Flush()
}
