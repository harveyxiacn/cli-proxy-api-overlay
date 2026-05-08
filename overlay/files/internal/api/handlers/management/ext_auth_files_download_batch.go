package management

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/auth-files/download-batch", h.PostDownloadAuthFilesBatch)
	})
}

type downloadBatchRequest struct {
	Names []string `json:"names"`
}

// PostDownloadAuthFilesBatch streams a ZIP of the requested auth JSON files.
// Body: {"names": ["a.json", "b.json", ...]}
// Response: application/zip (filename: auth-files-<timestamp>.zip)
func (h *Handler) PostDownloadAuthFilesBatch(c *gin.Context) {
	if h == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "handler not ready"})
		return
	}
	var req downloadBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: " + err.Error()})
		return
	}

	wanted := make([]string, 0, len(req.Names))
	seen := make(map[string]struct{})
	for _, n := range req.Names {
		n = strings.TrimSpace(n)
		if n == "" || isUnsafeAuthFileName(n) {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(n), ".json") {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		wanted = append(wanted, n)
	}
	if len(wanted) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no valid file names supplied"})
		return
	}

	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("auth-files-%s.zip", timestamp)
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Status(http.StatusOK)

	zw := zip.NewWriter(c.Writer)
	defer func() { _ = zw.Close() }()

	for _, name := range wanted {
		full := filepath.Join(h.cfg.AuthDir, name)
		f, err := os.Open(full)
		if err != nil {
			// Skip missing files silently — client can re-list to see what survived
			continue
		}
		w, err := zw.Create(name)
		if err != nil {
			_ = f.Close()
			continue
		}
		_, _ = io.Copy(w, f)
		_ = f.Close()
	}
}
