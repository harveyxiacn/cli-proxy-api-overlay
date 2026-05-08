package management

import "github.com/gin-gonic/gin"

// Routes for handlers added by the api_key_usage.go patch.
// GetAllAuthStats and PostRefreshAllTokens function bodies live in the patched
// file; URL contract lives here so the patch stays small.
func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/auth-stats", h.GetAllAuthStats)
		rg.POST("/auth-files/refresh-all-tokens", h.PostRefreshAllTokens)
	})
}
