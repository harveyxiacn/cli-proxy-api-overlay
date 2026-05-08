// system_update.go — 一键更新 CPA 的后端实现。
//
// 设计：
//   - 容器内 CPA 收到管理面板的 POST /system/update 请求 → 写一个非空的
//     "trigger 文件" 到 host 共享目录（通过 docker bind mount）。
//   - host 上的 systemd timer 每 30s 跑一次 update-watcher.sh，发现非空 trigger
//     就执行 /opt/cliproxyapi/update-cpa.sh、把结果写到 .update-meta.json，
//     并把 trigger 清空。
//   - 前端轮询 GET /system/status / GET /system/update-log 看进度。
//
// 关键文件（都在 host /opt/cliproxyapi/，container 内 /CLIProxyAPI/.* mount 进来）：
//   - .update-trigger  : POST 时写时间戳；watcher 跑完清空
//   - .update-log      : watcher 跑出来的 stdout+stderr（最后一次）
//   - .update-meta.json: { started_at, ended_at, success, exit_code,
//                          image_before, image_after, image_changed, trigger_content }
package management

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/buildinfo"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/system/status", h.GetSystemStatus)
		rg.POST("/system/update",
			auditingHandler("system.update", "system", nil, h.PostSystemUpdate))
		rg.GET("/system/update-log", h.GetSystemUpdateLog)
		rg.GET("/system/check-upstream", h.GetSystemCheckUpstream)
	})
}

// upstreamRepo identifies the GitHub repo we compare against for "check for
// updates". Hardcoded since the overlay is built specifically against this
// upstream; if ever forked, change here.
const upstreamRepo = "router-for-me/CLIProxyAPI"

const (
	systemUpdateTriggerPath = "/CLIProxyAPI/.update-trigger"
	systemUpdateLogPath     = "/CLIProxyAPI/.update-log"
	systemUpdateMetaPath    = "/CLIProxyAPI/.update-meta.json"
	systemUpdateLogTailMax  = 64 * 1024 // 64 KB tail
)

var systemStartedAt = time.Now()

// systemUpdateMeta mirrors the JSON the host watcher emits. Fields that the
// watcher hasn't set yet stay at their zero values.
type systemUpdateMeta struct {
	StartedAt      int64  `json:"started_at"`
	EndedAt        int64  `json:"ended_at"`
	DurationSec    int64  `json:"duration_sec"`
	Success        bool   `json:"success"`
	ExitCode       int    `json:"exit_code"`
	ImageBefore    string `json:"image_before"`
	ImageAfter     string `json:"image_after"`
	ImageChanged   bool   `json:"image_changed"`
	TriggerContent string `json:"trigger_content"`
}

// GetSystemStatus returns runtime version + uptime + last-update meta + whether
// an update is currently pending (non-empty trigger file).
//
// GET /v0/management/system/status
func (h *Handler) GetSystemStatus(c *gin.Context) {
	status := gin.H{
		"version":    buildinfo.Version,
		"commit":     buildinfo.Commit,
		"build_date": buildinfo.BuildDate,
		"go_version": runtime.Version(),
		"started_at": systemStartedAt.Unix(),
		"uptime_sec": int64(time.Since(systemStartedAt).Seconds()),
	}

	// Binary mtime — useful as a "last self-deploy" indicator.
	if info, err := os.Stat("/CLIProxyAPI/CLIProxyAPI"); err == nil {
		status["binary_mtime"] = info.ModTime().Unix()
		status["binary_size"] = info.Size()
	}

	// Pending trigger?
	if info, err := os.Stat(systemUpdateTriggerPath); err == nil && info.Size() > 0 {
		status["update_pending"] = true
		status["pending_since"] = info.ModTime().Unix()
	} else {
		status["update_pending"] = false
	}

	// Last update meta (written by host watcher).
	if data, err := os.ReadFile(systemUpdateMetaPath); err == nil && len(data) > 0 {
		var meta systemUpdateMeta
		if err := json.Unmarshal(data, &meta); err == nil {
			status["last_update"] = meta
		}
	}

	c.JSON(http.StatusOK, status)
}

// PostSystemUpdate writes the trigger file. Idempotent — repeated calls just
// refresh the timestamp; the host watcher dedupes by clearing the file when
// it picks up the work.
//
// POST /v0/management/system/update
func (h *Handler) PostSystemUpdate(c *gin.Context) {
	now := time.Now()
	body := []byte(now.Format(time.RFC3339))
	if err := os.WriteFile(systemUpdateTriggerPath, body, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("write trigger failed: %v", err),
			"hint":  "check that " + systemUpdateTriggerPath + " is bind-mounted from host",
		})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"status":    "queued",
		"message":   "更新已排队，host watcher 将在 30s 内执行 update-cpa.sh。可调用 /system/status 轮询进度。",
		"queued_at": now.Unix(),
	})
}

// GetSystemCheckUpstream queries GitHub for the upstream's latest release and
// returns it alongside the current build identity, letting the operator see
// at a glance whether an update is available.
//
// GET /v0/management/system/check-upstream
func (h *Handler) GetSystemCheckUpstream(c *gin.Context) {
	type ghAsset struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	type ghRelease struct {
		TagName     string    `json:"tag_name"`
		Name        string    `json:"name"`
		HTMLURL     string    `json:"html_url"`
		Draft       bool      `json:"draft"`
		Prerelease  bool      `json:"prerelease"`
		PublishedAt string    `json:"published_at"`
		Body        string    `json:"body"`
		Assets      []ghAsset `json:"assets"`
	}

	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", upstreamRepo)
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, url, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "cli-proxy-api-overlay/check-upstream")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":  "github fetch failed: " + err.Error(),
			"hint":   "check VPS outbound connectivity to api.github.com",
			"upstream_repo": upstreamRepo,
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB cap
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":         "github returned non-200: " + resp.Status,
			"upstream_repo": upstreamRepo,
			"raw_body":      string(body),
		})
		return
	}
	var release ghRelease
	if err := json.Unmarshal(body, &release); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode release: " + err.Error()})
		return
	}

	current := strings.TrimSpace(buildinfo.Version)
	currentTag := current
	if currentTag != "" && !strings.HasPrefix(currentTag, "v") && current != "dev" {
		currentTag = "v" + current
	}
	available := strings.TrimSpace(release.TagName) != "" &&
		current != "" && current != "dev" &&
		!strings.EqualFold(currentTag, strings.TrimSpace(release.TagName))

	// When local build is "dev"/unknown, we can't reliably compare versions —
	// surface that uncertainty rather than claiming an update is or isn't
	// available.
	uncertain := current == "" || current == "dev"

	c.JSON(http.StatusOK, gin.H{
		"upstream_repo":     upstreamRepo,
		"latest_tag":        release.TagName,
		"latest_name":       release.Name,
		"latest_url":        release.HTMLURL,
		"published_at":      release.PublishedAt,
		"prerelease":        release.Prerelease,
		"body":              release.Body,
		"asset_count":       len(release.Assets),
		"current_version":   buildinfo.Version,
		"current_commit":    buildinfo.Commit,
		"current_build_date": buildinfo.BuildDate,
		"update_available":  available,
		"version_uncertain": uncertain,
		"checked_at":        time.Now().Unix(),
	})
}

// GetSystemUpdateLog returns the tail of the host-side update log. Capped at
// systemUpdateLogTailMax bytes to keep responses small.
//
// GET /v0/management/system/update-log?bytes=NNN
func (h *Handler) GetSystemUpdateLog(c *gin.Context) {
	data, err := os.ReadFile(systemUpdateLogPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{
				"log":    "",
				"exists": false,
				"size":   0,
				"hint":   "no host-side update has run yet (or .update-log mount missing)",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(data) > systemUpdateLogTailMax {
		data = data[len(data)-systemUpdateLogTailMax:]
	}

	info, _ := os.Stat(systemUpdateLogPath)
	out := gin.H{
		"log":    string(data),
		"exists": true,
		"size":   len(data),
	}
	if info != nil {
		out["mtime"] = info.ModTime().Unix()
	}
	c.JSON(http.StatusOK, out)
}
