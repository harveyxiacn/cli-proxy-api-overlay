package management

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/desktop/info", h.GetDesktopInfo)
	})
}

func (h *Handler) GetDesktopInfo(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"mode": "browser",
		"entrypoints": gin.H{
			"modern":      "/cpa-management/",
			"extended":    "/extended.html",
			"legacy":      "/management.html",
			"api":         "/v0/management",
			"desktop_api": "/v0/management/desktop/info",
		},
		"legacy_supported": true,
		"tauri_supported":  false,
	})
}
