package management

import "github.com/gin-gonic/gin"

// Batch endpoints we add to the upstream auth_files.go via patch. The patch only
// contains function bodies and entry-builder additions; URL contract and audit
// wiring live here.
func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/auth-files/delete-batch",
			auditingHandler("auth.delete_batch", "auth", extractAuthFileNames, h.PostDeleteAuthFilesBatch))
		rg.POST("/auth-files/status-batch",
			auditingHandler("auth.status_batch", "auth", extractAuthFileNames, h.PostStatusAuthFilesBatch))
		rg.POST("/auth-files/fields-batch",
			auditingHandler("auth.fields_batch", "auth", extractAuthFileNames, h.PostAuthFilesFieldsBatch))
	})
}
