package management

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func resetAuditStore(t *testing.T) {
	t.Helper()
	globalAuditStore.mu.Lock()
	globalAuditStore.records = make([]AuditEvent, auditLogCapacity)
	globalAuditStore.head, globalAuditStore.count = 0, 0
	globalAuditStore.path = ""
	globalAuditStore.seq = 0
	globalAuditStore.mu.Unlock()
}

func TestAuditLog_AppendAndQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetAuditStore(t)
	configureAuditLogPersistence(filepath.Join(t.TempDir(), auditLogFileName))

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v0/management/auth-files/status-batch", nil)
	c.Request.Header.Set("Authorization", "Bearer test-token-1")
	c.Request.Header.Set("User-Agent", "go-test")

	appendAudit(c, "auth.status_batch", AuditTarget{Type: "auth", IDs: []string{"a.json", "b.json"}}, AuditResult{OK: true, Succeeded: 2})

	rec2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(rec2)
	c2.Request = httptest.NewRequest(http.MethodGet, "/v0/management/audit-log", nil)
	(&Handler{}).GetAuditLog(c2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("audit-log GET want 200, got %d", rec2.Code)
	}
	var payload struct {
		Items []AuditEvent `json:"items"`
		Total int          `json:"total"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Total != 1 || len(payload.Items) != 1 {
		t.Fatalf("expected 1 item, got %+v", payload)
	}
	ev := payload.Items[0]
	if ev.Action != "auth.status_batch" {
		t.Fatalf("wrong action: %q", ev.Action)
	}
	if ev.Actor.ManagementKeyHash == "" {
		t.Fatalf("expected hashed token, got empty")
	}
	if len(ev.Actor.ManagementKeyHash) != 16 {
		t.Fatalf("hash length should be 16, got %d", len(ev.Actor.ManagementKeyHash))
	}
	if len(ev.Target.IDs) != 2 || ev.Target.IDs[0] != "a.json" {
		t.Fatalf("wrong target ids: %+v", ev.Target.IDs)
	}
}

func TestAuditLog_NoSecretLeakInPayload(t *testing.T) {
	resetAuditStore(t)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v0/management/foo", nil)
	c.Request.Header.Set("Authorization", "Bearer sk-VERY-SECRET-TOKEN")

	appendAudit(c, "test.action", AuditTarget{}, AuditResult{OK: true})

	all := globalAuditStore.snapshot()
	if len(all) != 1 {
		t.Fatalf("expected 1 event")
	}
	body, _ := json.Marshal(all[0])
	if bytes.Contains(body, []byte("sk-VERY-SECRET-TOKEN")) {
		t.Fatalf("audit event must not contain raw bearer token")
	}
	// hash should be present
	if !bytes.Contains(body, []byte(`"management_key_hash"`)) {
		t.Fatalf("audit event should contain hashed key")
	}
}

func TestAuditLog_AuditingHandlerWrapsBatch(t *testing.T) {
	resetAuditStore(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Inner handler echoes input back as 200 OK.
	inner := func(c *gin.Context) {
		var req struct {
			Names []string `json:"names"`
		}
		_ = c.ShouldBindJSON(&req)
		c.JSON(http.StatusOK, gin.H{"received": req.Names})
	}
	r.POST("/test/batch", auditingHandler("test.batch", "auth", extractAuthFileNames, inner))

	body, _ := json.Marshal(map[string][]string{"names": {"x.json", "y.json"}})
	req := httptest.NewRequest(http.MethodPost, "/test/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer wrap-token")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("x.json")) {
		t.Fatalf("inner handler did not see body, response=%s", rec.Body.String())
	}
	all := globalAuditStore.snapshot()
	if len(all) != 1 {
		t.Fatalf("expected 1 audit event, got %d", len(all))
	}
	if all[0].Action != "test.batch" {
		t.Fatalf("wrong action: %q", all[0].Action)
	}
	if len(all[0].Target.IDs) != 2 || all[0].Target.IDs[0] != "x.json" {
		t.Fatalf("wrong target ids extracted: %+v", all[0].Target.IDs)
	}
	if !all[0].Result.OK {
		t.Fatalf("expected ok=true, got %+v", all[0].Result)
	}
}

func TestAuditLog_FilterByAction(t *testing.T) {
	resetAuditStore(t)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", nil)

	appendAudit(c, "auth.delete_batch", AuditTarget{Type: "auth", IDs: []string{"a"}}, AuditResult{OK: true})
	appendAudit(c, "webhook.delete", AuditTarget{Type: "webhook", IDs: []string{"hook-1"}}, AuditResult{OK: true})

	rec2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(rec2)
	c2.Request = httptest.NewRequest(http.MethodGet, "/v0/management/audit-log?action=webhook.delete", nil)
	values := c2.Request.URL.Query()
	c2.Request.URL.RawQuery = values.Encode()
	(&Handler{}).GetAuditLog(c2)

	var payload struct {
		Items []AuditEvent `json:"items"`
	}
	_ = json.Unmarshal(rec2.Body.Bytes(), &payload)
	if len(payload.Items) != 1 || payload.Items[0].Action != "webhook.delete" {
		t.Fatalf("filter by action failed, got %+v", payload.Items)
	}
}
