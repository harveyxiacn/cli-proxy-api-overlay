//go:build !embed_frontend

package api

// registerFrontendRoutes is a no-op when the embed_frontend build tag is not set.
// Build with: go build -tags embed_frontend to embed the React frontend.
func (s *Server) registerFrontendRoutes() {}
