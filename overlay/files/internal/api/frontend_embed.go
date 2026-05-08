//go:build embed_frontend

package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:frontend_dist
var frontendEmbedFS embed.FS

// frontendFS returns the embedded frontend filesystem.
func frontendFS() (http.FileSystem, bool) {
	sub, err := fs.Sub(frontendEmbedFS, "frontend_dist")
	if err != nil {
		return nil, false
	}
	return http.FS(sub), true
}

// registerFrontendRoutes mounts the React SPA at /cpa-management/*.
// All non-API requests under /cpa-management are served index.html for client-side routing.
func (s *Server) registerFrontendRoutes() {
	fsys, ok := frontendFS()
	if !ok {
		return
	}

	fileServer := http.FileServer(fsys)

	s.engine.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if !strings.HasPrefix(path, "/cpa-management") {
			c.Next()
			return
		}

		// Try to serve the actual file first
		subPath := strings.TrimPrefix(path, "/cpa-management")
		if subPath == "" {
			subPath = "/"
		}

		// Check if the file exists in the embedded FS
		// If it's a file (has extension), serve it directly
		if subPath != "/" && strings.Contains(subPath, ".") {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
			http.StripPrefix("/cpa-management", fileServer).ServeHTTP(c.Writer, c.Request)
			return
		}

		// For all routes, serve index.html (SPA routing)
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Content-Type", "text/html; charset=utf-8")
		f, err := frontendEmbedFS.ReadFile("frontend_dist/index.html")
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", f)
	})

	// Also serve /cpa-management explicitly
	s.engine.GET("/cpa-management", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		f, err := frontendEmbedFS.ReadFile("frontend_dist/index.html")
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", f)
	})

	// Serve assets at /cpa-management/assets/*
	s.engine.GET("/cpa-management/assets/*filepath", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.Request.URL.Path = "/assets" + c.Param("filepath")
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
