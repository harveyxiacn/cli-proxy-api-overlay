package management

import "github.com/gin-gonic/gin"

// ExtensionRouteFn registers extension routes onto the management route group.
// Each new feature should call RegisterExtensionRoute from an init() block to
// add its routes; server.go calls ApplyExtensionRoutes once after wiring up
// upstream routes, so the patch on server.go stays a one-liner.
type ExtensionRouteFn func(rg *gin.RouterGroup, h *Handler)

var extensionRoutes []ExtensionRouteFn

// RegisterExtensionRoute appends a route registrar. Safe to call from init().
// Route order doesn't matter because gin paths are unique.
func RegisterExtensionRoute(fn ExtensionRouteFn) {
	if fn == nil {
		return
	}
	extensionRoutes = append(extensionRoutes, fn)
}

// ApplyExtensionRoutes runs every registered extension registrar against the
// supplied management route group and handler. Idempotent within a process.
func ApplyExtensionRoutes(rg *gin.RouterGroup, h *Handler) {
	for _, fn := range extensionRoutes {
		fn(rg, h)
	}
}
