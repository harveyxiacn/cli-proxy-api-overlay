package management

// overlay_config.go — overlay §14 SQLite analytics configuration scaffold.
//
// Why a scaffold and not a full SQLite implementation?
//
// Adopting a SQLite driver in the upstream-vendored CPA tree means either
// pulling in modernc.org/sqlite (large pure-Go dependency) or mattn/go-sqlite3
// (CGO build dependency). Both are non-trivial supply-chain decisions for the
// host project, so v1 ships only the wiring:
//
//   1. <config-dir>/overlay.yaml is parsed at startup if present, exposing
//      whether the operator has opted in to SQLite analytics.
//   2. /v0/management/analytics/storage-summary already reports
//      sqlite_enabled; we extend the diagnostics endpoint to surface the
//      effective overlay config too.
//   3. Once the team commits to a SQLite driver, the persistence functions
//      (request log dual-write, audit log copy, quota snapshots) can plug in
//      here without changing the on-disk JSONL contract or the API surface.
//
// Default state: scaffold present, no SQLite driver bundled, status reports
// "compiled=false" so the frontend correctly tells operators "not yet wired".

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const overlayConfigFilename = "overlay.yaml"

// OverlaySQLiteConfig mirrors the documented overlay.yaml schema.
type OverlaySQLiteConfig struct {
	Enabled              bool   `json:"enabled"`
	Path                 string `json:"path,omitempty"`
	RetentionDays        int    `json:"retention_days,omitempty"`
	RetentionJobInterval string `json:"retention_job_interval,omitempty"`
}

type OverlayConfig struct {
	SQLite OverlaySQLiteConfig `json:"sqlite_analytics"`
}

type overlayConfigStore struct {
	mu      sync.RWMutex
	cfg     OverlayConfig
	loaded  bool
	source  string
	loadErr string
}

var globalOverlayConfig = &overlayConfigStore{}

// LoadOverlayConfig parses <config-dir>/overlay.yaml if present. Missing file
// is not an error; we just stay at defaults. Parser is intentionally
// hand-rolled to avoid pulling another YAML lib for this single-purpose file.
func LoadOverlayConfig(configFilePath string) {
	globalOverlayConfig.mu.Lock()
	defer globalOverlayConfig.mu.Unlock()

	globalOverlayConfig.cfg = OverlayConfig{
		SQLite: OverlaySQLiteConfig{
			Enabled:              false,
			Path:                 "data/overlay_analytics.db",
			RetentionDays:        30,
			RetentionJobInterval: "6h",
		},
	}
	globalOverlayConfig.loadErr = ""
	globalOverlayConfig.source = ""
	globalOverlayConfig.loaded = true

	if configFilePath == "" {
		return
	}
	path := filepath.Join(filepath.Dir(configFilePath), overlayConfigFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			globalOverlayConfig.loadErr = err.Error()
		}
		return
	}
	globalOverlayConfig.source = path
	if err := parseOverlayYAMLLite(string(data), &globalOverlayConfig.cfg); err != nil {
		globalOverlayConfig.loadErr = err.Error()
	}
}

func GetOverlayConfig() OverlayConfig {
	globalOverlayConfig.mu.RLock()
	defer globalOverlayConfig.mu.RUnlock()
	return globalOverlayConfig.cfg
}

// parseOverlayYAMLLite handles the documented schema with simple top-level
// `sqlite-analytics:` block + key: value lines. Quoted strings, true/false,
// integers, and durations like "6h" / "30d" are recognized. This is not a
// general YAML parser; anything more complex should be flagged with an error.
func parseOverlayYAMLLite(s string, out *OverlayConfig) error {
	currentKey := ""
	for lineNo, raw := range strings.Split(s, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Top-level block?
		if !strings.HasPrefix(raw, " ") && !strings.HasPrefix(raw, "\t") && strings.HasSuffix(line, ":") {
			currentKey = strings.TrimSuffix(line, ":")
			continue
		}
		// key: value (indented)
		idx := strings.Index(line, ":")
		if idx <= 0 {
			return fmt.Errorf("line %d: malformed entry %q", lineNo+1, raw)
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		val = strings.Trim(val, `"'`)
		switch currentKey {
		case "sqlite-analytics":
			switch key {
			case "enabled":
				out.SQLite.Enabled = strings.EqualFold(val, "true")
			case "path":
				out.SQLite.Path = val
			case "retention-days":
				var n int
				_, err := fmt.Sscanf(val, "%d", &n)
				if err == nil && n > 0 {
					out.SQLite.RetentionDays = n
				}
			case "retention-job-interval":
				if _, err := time.ParseDuration(val); err == nil {
					out.SQLite.RetentionJobInterval = val
				}
			}
		}
	}
	return nil
}
