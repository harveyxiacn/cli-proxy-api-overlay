package management

// backups.go — overlay §10 Backup & Restore Center.
//
// Snapshots config + auth-dir + data-dir into <config-dir>/data/backups/<id>.zip
// and supports preview-restore + restore. Restore requires a non-expired
// preview_id so the user never restores a stale plan.
//
// Files that are missing on backup time are silently skipped (recorded in
// manifest.skipped). Pre-restore backup is created automatically before any
// destructive restore action.

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/backups", h.GetBackups)
		rg.POST("/backups",
			auditingHandler("backup.create", "backup", nil, h.PostCreateBackup))
		rg.GET("/backups/:id/download", h.GetBackupDownload)
		rg.POST("/backups/:id/preview-restore",
			auditingHandlerParam("backup.preview_restore", "backup", "id", h.PostBackupPreviewRestore))
		rg.POST("/backups/:id/restore",
			auditingHandlerParam("backup.restore", "backup", "id", h.PostBackupRestore))
		rg.DELETE("/backups/:id",
			auditingHandlerParam("backup.delete", "backup", "id", h.DeleteBackup))
	})
}

const (
	backupsSubdir            = "backups"
	previewIDTTL             = 10 * time.Minute
	backupMaxRetainedDefault = 20
)

type BackupManifest struct {
	ID         string   `json:"id"`
	CreatedAt  int64    `json:"created_at"`
	SizeBytes  int64    `json:"size_bytes"`
	Files      []string `json:"files"`
	Skipped    []string `json:"skipped,omitempty"`
	Note       string   `json:"note,omitempty"`
	Source     string   `json:"source"` // "manual" | "pre_restore"
}

type BackupListResponse struct {
	Items []BackupManifest `json:"items"`
	Count int              `json:"count"`
}

// ── preview cache ─────────────────────────────────────────────────────────────

type cachedRestorePreview struct {
	backupID    string
	willCreate  []string
	willUpdate  []string
	willDelete  []string
	conflicts   []string
	expiresAt   time.Time
}

type restorePreviewCache struct {
	mu      sync.Mutex
	entries map[string]*cachedRestorePreview
}

var globalRestorePreview = &restorePreviewCache{entries: make(map[string]*cachedRestorePreview)}

func newPreviewID() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return "prv_" + hex.EncodeToString(buf)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func (h *Handler) backupsDir() (string, error) {
	if h == nil || h.configFilePath == "" {
		return "", errors.New("config path unknown")
	}
	dir := filepath.Join(filepath.Dir(h.configFilePath), "data", backupsSubdir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// gatherBackupSources returns the candidate file list to include in a backup,
// already split into (existing, missing) sets.
func (h *Handler) gatherBackupSources() (existing []string, skipped []string) {
	if h == nil {
		return nil, nil
	}
	candidates := []string{}
	if h.configFilePath != "" {
		candidates = append(candidates, h.configFilePath)
		dataDir := filepath.Join(filepath.Dir(h.configFilePath), "data")
		for _, f := range []string{"token_stats.json", "request_history.jsonl", "audit_log.jsonl"} {
			candidates = append(candidates, filepath.Join(dataDir, f))
		}
	}
	if h.cfg != nil && strings.TrimSpace(h.cfg.AuthDir) != "" {
		dir := strings.TrimSpace(h.cfg.AuthDir)
		// All files inside auth dir
		entries, err := os.ReadDir(dir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				candidates = append(candidates, filepath.Join(dir, e.Name()))
			}
		}
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			existing = append(existing, p)
		} else {
			skipped = append(skipped, p)
		}
	}
	return existing, skipped
}

func writeBackupZip(out io.Writer, files []string, baseDir string) error {
	zw := zip.NewWriter(out)
	defer func() { _ = zw.Close() }()
	for _, src := range files {
		rel, err := filepath.Rel(baseDir, src)
		if err != nil || strings.HasPrefix(rel, "..") {
			rel = filepath.Base(src)
		}
		rel = filepath.ToSlash(rel)
		f, err := os.Open(src)
		if err != nil {
			continue
		}
		w, err := zw.Create(rel)
		if err != nil {
			_ = f.Close()
			continue
		}
		_, _ = io.Copy(w, f)
		_ = f.Close()
	}
	return nil
}

func readManifest(path string) (BackupManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return BackupManifest{}, err
	}
	var m BackupManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return BackupManifest{}, err
	}
	return m, nil
}

// ── handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) GetBackups(c *gin.Context) {
	dir, err := h.backupsDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	entries, _ := os.ReadDir(dir)
	items := make([]BackupManifest, 0)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".manifest.json") {
			continue
		}
		m, err := readManifest(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		items = append(items, m)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
	c.JSON(http.StatusOK, BackupListResponse{Items: items, Count: len(items)})
}

func (h *Handler) PostCreateBackup(c *gin.Context) {
	manifest, err := h.createBackup("manual", "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, manifest)
}

// createBackup is shared between manual create and pre-restore safety backup.
func (h *Handler) createBackup(source, note string) (*BackupManifest, error) {
	dir, err := h.backupsDir()
	if err != nil {
		return nil, err
	}
	id := fmt.Sprintf("backup_%d_%s", time.Now().Unix(), randomToken(4))
	zipPath := filepath.Join(dir, id+".zip")
	manifestPath := filepath.Join(dir, id+".manifest.json")

	files, skipped := h.gatherBackupSources()
	baseDir := ""
	if h.configFilePath != "" {
		baseDir = filepath.Dir(h.configFilePath)
	}

	f, err := os.Create(zipPath)
	if err != nil {
		return nil, err
	}
	if err := writeBackupZip(f, files, baseDir); err != nil {
		_ = f.Close()
		return nil, err
	}
	_ = f.Close()
	stat, _ := os.Stat(zipPath)

	rels := make([]string, 0, len(files))
	for _, file := range files {
		if rel, err := filepath.Rel(baseDir, file); err == nil {
			rels = append(rels, filepath.ToSlash(rel))
		} else {
			rels = append(rels, filepath.Base(file))
		}
	}
	skippedRel := make([]string, 0, len(skipped))
	for _, s := range skipped {
		skippedRel = append(skippedRel, filepath.ToSlash(filepath.Base(s)))
	}

	m := BackupManifest{
		ID:        id,
		CreatedAt: time.Now().Unix(),
		SizeBytes: 0,
		Files:     rels,
		Skipped:   skippedRel,
		Note:      note,
		Source:    source,
	}
	if stat != nil {
		m.SizeBytes = stat.Size()
	}
	data, _ := json.MarshalIndent(m, "", "  ")
	if err := os.WriteFile(manifestPath, data, 0o600); err != nil {
		return nil, err
	}
	pruneOldBackups(dir, backupMaxRetainedDefault)
	return &m, nil
}

func pruneOldBackups(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type pair struct {
		ts   int64
		name string
	}
	var manifests []pair
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".manifest.json") {
			continue
		}
		m, err := readManifest(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		manifests = append(manifests, pair{ts: m.CreatedAt, name: m.ID})
	}
	sort.Slice(manifests, func(i, j int) bool { return manifests[i].ts > manifests[j].ts })
	for i, p := range manifests {
		if i < keep {
			continue
		}
		_ = os.Remove(filepath.Join(dir, p.name+".zip"))
		_ = os.Remove(filepath.Join(dir, p.name+".manifest.json"))
	}
}

func (h *Handler) GetBackupDownload(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	dir, err := h.backupsDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	zipPath := filepath.Join(dir, id+".zip")
	if _, err := os.Stat(zipPath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return
	}
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename="+id+".zip")
	c.File(zipPath)
}

func (h *Handler) DeleteBackup(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	dir, err := h.backupsDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = os.Remove(filepath.Join(dir, id+".zip"))
	_ = os.Remove(filepath.Join(dir, id+".manifest.json"))
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": id})
}

// PostBackupPreviewRestore enumerates which files would be created/updated so the
// operator can review before triggering the actual restore.
func (h *Handler) PostBackupPreviewRestore(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	dir, err := h.backupsDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	zipPath := filepath.Join(dir, id+".zip")
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return
	}
	defer func() { _ = zr.Close() }()

	baseDir := ""
	if h.configFilePath != "" {
		baseDir = filepath.Dir(h.configFilePath)
	}
	preview := &cachedRestorePreview{backupID: id, expiresAt: time.Now().Add(previewIDTTL)}
	for _, f := range zr.File {
		dst := filepath.Join(baseDir, f.Name)
		if _, err := os.Stat(dst); err == nil {
			preview.willUpdate = append(preview.willUpdate, f.Name)
		} else {
			preview.willCreate = append(preview.willCreate, f.Name)
		}
	}
	previewID := newPreviewID()
	globalRestorePreview.mu.Lock()
	globalRestorePreview.entries[previewID] = preview
	for k, v := range globalRestorePreview.entries {
		if time.Now().After(v.expiresAt) {
			delete(globalRestorePreview.entries, k)
		}
	}
	globalRestorePreview.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"preview_id":  previewID,
		"backup_id":   id,
		"expires_at":  preview.expiresAt.Unix(),
		"will_create": preview.willCreate,
		"will_update": preview.willUpdate,
		"will_delete": preview.willDelete,
		"conflicts":   preview.conflicts,
	})
}

// PostBackupRestore extracts the backup into baseDir, but only when the request
// references a still-valid preview_id obtained from the preview-restore call.
// Before extraction it creates a pre-restore safety backup.
func (h *Handler) PostBackupRestore(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	var req struct {
		PreviewID string `json:"preview_id"`
	}
	_ = c.ShouldBindJSON(&req)
	if strings.TrimSpace(req.PreviewID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "preview_id is required", "code": "missing_preview"})
		return
	}
	globalRestorePreview.mu.Lock()
	preview, ok := globalRestorePreview.entries[req.PreviewID]
	if ok && time.Now().After(preview.expiresAt) {
		delete(globalRestorePreview.entries, req.PreviewID)
		ok = false
	}
	globalRestorePreview.mu.Unlock()
	if !ok || preview.backupID != id {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "preview_id expired or mismatched — re-run preview-restore", "code": "preview_invalid"})
		return
	}

	// Pre-restore safety backup
	pre, err := h.createBackup("pre_restore", "automatic snapshot before restore of "+id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "pre-restore backup failed: " + err.Error()})
		return
	}

	dir, err := h.backupsDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	zr, err := zip.OpenReader(filepath.Join(dir, id+".zip"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return
	}
	defer func() { _ = zr.Close() }()

	baseDir := ""
	if h.configFilePath != "" {
		baseDir = filepath.Dir(h.configFilePath)
	}
	type extractResult struct {
		Path string `json:"path"`
		OK   bool   `json:"ok"`
		Err  string `json:"error,omitempty"`
	}
	results := make([]extractResult, 0, len(zr.File))
	succeeded := 0
	failed := 0
	for _, f := range zr.File {
		dst := filepath.Join(baseDir, f.Name)
		// Reject path traversal
		if strings.HasPrefix(f.Name, "..") || strings.Contains(f.Name, "..\\") || strings.Contains(f.Name, "../") {
			results = append(results, extractResult{Path: f.Name, OK: false, Err: "path traversal rejected"})
			failed++
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			results = append(results, extractResult{Path: f.Name, OK: false, Err: err.Error()})
			failed++
			continue
		}
		rc, err := f.Open()
		if err != nil {
			results = append(results, extractResult{Path: f.Name, OK: false, Err: err.Error()})
			failed++
			continue
		}
		out, err := os.Create(dst)
		if err != nil {
			_ = rc.Close()
			results = append(results, extractResult{Path: f.Name, OK: false, Err: err.Error()})
			failed++
			continue
		}
		if _, err := io.Copy(out, rc); err != nil {
			_ = out.Close()
			_ = rc.Close()
			results = append(results, extractResult{Path: f.Name, OK: false, Err: err.Error()})
			failed++
			continue
		}
		_ = out.Close()
		_ = rc.Close()
		results = append(results, extractResult{Path: f.Name, OK: true})
		succeeded++
	}

	// Invalidate preview after use.
	globalRestorePreview.mu.Lock()
	delete(globalRestorePreview.entries, req.PreviewID)
	globalRestorePreview.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"status":            "ok",
		"backup_id":         id,
		"pre_restore_id":    pre.ID,
		"succeeded":         succeeded,
		"failed":            failed,
		"results":           results,
	})
}

func randomToken(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
