package management

import "github.com/gin-gonic/gin"

// Routes for handlers added by the config_basic.go patch (runtime config endpoints).
// Kept in a separate file so the upstream patch on config_basic.go stays minimal:
// the patch only adds function bodies; this file alone owns the URL contract.
func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/disable-cooling", h.GetDisableCooling)
		rg.PUT("/disable-cooling", h.PutDisableCooling)
		rg.PATCH("/disable-cooling", h.PutDisableCooling)

		rg.GET("/auth-auto-refresh-workers", h.GetAuthAutoRefreshWorkers)
		rg.PUT("/auth-auto-refresh-workers", h.PutAuthAutoRefreshWorkers)
		rg.PATCH("/auth-auto-refresh-workers", h.PutAuthAutoRefreshWorkers)

		rg.GET("/max-retry-credentials", h.GetMaxRetryCredentials)
		rg.PUT("/max-retry-credentials", h.PutMaxRetryCredentials)
		rg.PATCH("/max-retry-credentials", h.PutMaxRetryCredentials)
	})
}
