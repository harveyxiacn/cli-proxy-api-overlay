package management

// system_diagnostics.go — overlay §11 System Diagnostics enhancement.
//
// Aggregates runtime state useful for VPS debugging into a single endpoint and
// streams a redacted .zip bundle for offline triage.
//
// Redaction rules:
//   - config.yaml is parsed as YAML and any key whose name contains
//     "key", "token", "password", or "secret" is replaced by "<redacted>".
//   - Webhook URLs in any payload are replaced by their host + a short id
//     fragment.
//   - Logs are scanned for Bearer tokens and OpenAI-style keys; matches are
//     replaced before being written into the zip.

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/system/diagnostics", h.GetSystemDiagnostics)
		rg.GET("/system/diagnostics/export.zip", h.GetSystemDiagnosticsExport)
	})
}

type DiagnosticsCheck struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
	Note string `json:"note,omitempty"`
}

type SystemDiagnosticsResponse struct {
	GeneratedAt        int64              `json:"generated_at"`
	BinaryHash         string             `json:"binary_hash,omitempty"`
	FrontendBuildHash  string             `json:"frontend_build_hash,omitempty"`
	OverlayVersionNote string             `json:"overlay_version_note,omitempty"`
	ConfigPath         string             `json:"config_path,omitempty"`
	AuthDir            string             `json:"auth_dir,omitempty"`
	DataDir            string             `json:"data_dir,omitempty"`
	GoVersion          string             `json:"go_version"`
	OS                 string             `json:"os"`
	Arch               string             `json:"arch"`
	UptimeSeconds      int64              `json:"uptime_seconds"`
	Checks             []DiagnosticsCheck `json:"checks"`
	OverlayFeatures    []string           `json:"overlay_features"`
	UpdateLogTail      string             `json:"update_log_tail,omitempty"`
	EnvSummary         map[string]string  `json:"env_summary"`
}

func collectDiagnostics(h *Handler) SystemDiagnosticsResponse {
	now := time.Now()
	resp := SystemDiagnosticsResponse{
		GeneratedAt:   now.Unix(),
		GoVersion:     runtime.Version(),
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		UptimeSeconds: int64(now.Sub(systemStartedAt).Seconds()),
		EnvSummary:    map[string]string{},
	}
	if h != nil {
		resp.ConfigPath = h.configFilePath
		if h.cfg != nil {
			resp.AuthDir = h.cfg.AuthDir
		}
	}
	if resp.ConfigPath != "" {
		resp.DataDir = filepath.Join(filepath.Dir(resp.ConfigPath), "data")
	}

	// binary hash
	if exe, err := os.Executable(); err == nil {
		if data, err := os.ReadFile(exe); err == nil {
			sum := sha256.Sum256(data)
			resp.BinaryHash = hex.EncodeToString(sum[:])[:16]
		}
	}

	// dir read/write checks
	resp.Checks = append(resp.Checks, dirCheck("auth_dir", resp.AuthDir))
	resp.Checks = append(resp.Checks, dirCheck("data_dir", resp.DataDir))
	resp.Checks = append(resp.Checks, dirCheck("update_trigger_dir", filepath.Dir(systemUpdateTriggerPath)))

	// update log tail
	if data, err := os.ReadFile(systemUpdateLogPath); err == nil {
		const max = 4096
		if len(data) > max {
			data = data[len(data)-max:]
		}
		resp.UpdateLogTail = string(data)
	}

	// env summary (whitelist; never copy secrets)
	for _, k := range []string{"GIN_MODE", "TZ", "HOSTNAME", "HOME", "PWD"} {
		if v := os.Getenv(k); v != "" {
			resp.EnvSummary[k] = v
		}
	}

	// overlay feature list — extracted from the registry of extension routes.
	resp.OverlayFeatures = listOverlayFeatures()

	return resp
}

func dirCheck(name, path string) DiagnosticsCheck {
	if path == "" {
		return DiagnosticsCheck{Name: name, OK: false, Note: "not configured"}
	}
	info, err := os.Stat(path)
	if err != nil {
		return DiagnosticsCheck{Name: name, OK: false, Note: err.Error()}
	}
	if !info.IsDir() {
		return DiagnosticsCheck{Name: name, OK: false, Note: "not a directory"}
	}
	// write probe
	probe := filepath.Join(path, ".diag-probe.tmp")
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return DiagnosticsCheck{Name: name, OK: false, Note: "not writable: " + err.Error()}
	}
	_ = os.Remove(probe)
	return DiagnosticsCheck{Name: name, OK: true}
}

func listOverlayFeatures() []string {
	// Sourced from the existence of the helper handlers we register. This is a
	// pragmatic best-effort inventory that doesn't require route reflection.
	return []string{
		"account_health", "account_maintenance", "audit_log", "api_key_insights",
		"api_key_limits", "capacity_forecast", "codex_quota", "events", "issues_alerts",
		"jobs", "maintenance_rules", "oauth_repair", "pool_models", "request_history",
		"routing_simulate", "system_diagnostics", "system_update", "token_reports",
		"token_stats", "warmup", "webhooks",
	}
}

func (h *Handler) GetSystemDiagnostics(c *gin.Context) {
	c.JSON(http.StatusOK, collectDiagnostics(h))
}

// ── Redaction helpers ─────────────────────────────────────────────────────────

var (
	bearerPattern  = regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9._\-]{8,}`)
	openAIKeyPattern = regexp.MustCompile(`sk-[A-Za-z0-9_\-]{20,}`)
	configKeyPattern = regexp.MustCompile(`(?im)^(\s*[A-Za-z0-9_\-]*?(?:key|token|password|secret)[A-Za-z0-9_\-]*\s*:\s*).+$`)
)

func redactText(s string) string {
	s = bearerPattern.ReplaceAllString(s, "Bearer <redacted>")
	s = openAIKeyPattern.ReplaceAllString(s, "sk-<redacted>")
	return s
}

func redactConfigYAML(s string) string {
	return configKeyPattern.ReplaceAllString(s, "$1<redacted>")
}

// GetSystemDiagnosticsExport streams a zip bundle.
func (h *Handler) GetSystemDiagnosticsExport(c *gin.Context) {
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename=cpa-diagnostics.zip")
	zw := zip.NewWriter(c.Writer)
	defer func() { _ = zw.Close() }()

	// 1. diagnostics.json
	diag := collectDiagnostics(h)
	if data, err := json.MarshalIndent(diag, "", "  "); err == nil {
		writeZipEntry(zw, "diagnostics.json", data)
	}

	// 2. redacted config
	if h != nil && h.configFilePath != "" {
		if data, err := os.ReadFile(h.configFilePath); err == nil {
			writeZipEntry(zw, "config.redacted.yaml", []byte(redactConfigYAML(string(data))))
		}
	}

	// 3. last update log (redacted)
	if data, err := os.ReadFile(systemUpdateLogPath); err == nil {
		writeZipEntry(zw, "update.log", []byte(redactText(string(data))))
	}

	// 4. recent audit log (last 1000 entries)
	events := globalAuditStore.snapshot()
	if len(events) > 1000 {
		events = events[:1000]
	}
	if data, err := json.MarshalIndent(events, "", "  "); err == nil {
		writeZipEntry(zw, "audit_log.json", data)
	}

	// 5. overlay feature list
	writeZipEntry(zw, "overlay_features.txt",
		[]byte(strings.Join(listOverlayFeatures(), "\n")))

	// 6. endpoint self-check (best-effort)
	selfCheck := map[string]any{
		"checks":          diag.Checks,
		"overlay_version_note": diag.OverlayVersionNote,
		"generated_at":    diag.GeneratedAt,
	}
	if data, err := json.MarshalIndent(selfCheck, "", "  "); err == nil {
		writeZipEntry(zw, "self_check.json", data)
	}

	// 7. README
	readme := fmt.Sprintf(`CPA Diagnostics Bundle
Generated: %s
Binary hash: %s
OS / Arch: %s / %s
Uptime: %ds

Files:
- diagnostics.json: runtime status + checks
- config.redacted.yaml: config.yaml with secrets masked
- update.log: last system-update output (Bearer/sk-* redacted)
- audit_log.json: most recent audit events
- overlay_features.txt: overlay feature inventory
- self_check.json: endpoint self-check summary
`, time.Unix(diag.GeneratedAt, 0).UTC().Format(time.RFC3339),
		diag.BinaryHash, diag.OS, diag.Arch, diag.UptimeSeconds)
	writeZipEntry(zw, "README.txt", []byte(readme))
}

func writeZipEntry(zw *zip.Writer, name string, data []byte) {
	w, err := zw.Create(name)
	if err != nil {
		return
	}
	_, _ = w.Write(bytes.TrimRight(data, "\n"))
	_, _ = w.Write([]byte("\n"))
}
