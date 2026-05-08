package management

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func TestPatchAuthFileFields_GroupAndTags(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	if _, err := manager.Register(context.Background(), &coreauth.Auth{
		ID:         "acct.json",
		FileName:   "acct.json",
		Provider:   "codex",
		Status:     coreauth.StatusActive,
		Attributes: map[string]string{"path": "/tmp/acct.json"},
		Metadata:   map[string]any{"type": "codex"},
	}); err != nil {
		t.Fatalf("register auth: %v", err)
	}
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPatch, "/v0/management/auth-files/fields", strings.NewReader(`{"name":"acct.json","group":"codex-free","tags":["free","weekly"]}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PatchAuthFileFields(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated, _ := manager.GetByID("acct.json")
	if got, _ := updated.Metadata["group"].(string); got != "codex-free" {
		t.Fatalf("metadata.group = %q", got)
	}
	tags, ok := metadataStringSlice(updated.Metadata["tags"])
	if !ok || len(tags) != 2 || tags[0] != "free" || tags[1] != "weekly" {
		t.Fatalf("unexpected tags %#v ok=%v", tags, ok)
	}
}

func TestPostAuthFilesFieldsBatch_SetGroupAndAddRemoveTags(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := coreauth.NewManager(&memoryAuthStore{}, nil, nil)
	for _, id := range []string{"a.json", "b.json"} {
		if _, err := manager.Register(context.Background(), &coreauth.Auth{
			ID:         id,
			FileName:   id,
			Provider:   "codex",
			Status:     coreauth.StatusActive,
			Attributes: map[string]string{"path": "/tmp/" + id},
			Metadata:   map[string]any{"type": "codex", "tags": []any{"old"}},
		}); err != nil {
			t.Fatalf("register %s: %v", id, err)
		}
	}
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: t.TempDir()}, manager)

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	body := `{"names":["a.json","b.json"],"set":{"group":"prod"},"add_tags":["new"],"remove_tags":["old"]}`
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v0/management/auth-files/fields-batch", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PostAuthFilesFieldsBatch(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	for _, id := range []string{"a.json", "b.json"} {
		updated, _ := manager.GetByID(id)
		if got, _ := updated.Metadata["group"].(string); got != "prod" {
			t.Fatalf("%s group = %q", id, got)
		}
		tags, ok := metadataStringSlice(updated.Metadata["tags"])
		if !ok || len(tags) != 1 || tags[0] != "new" {
			t.Fatalf("%s tags = %#v ok=%v", id, tags, ok)
		}
	}
}
