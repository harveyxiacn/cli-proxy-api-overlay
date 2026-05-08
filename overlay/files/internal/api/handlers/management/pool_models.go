package management

import (
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/registry"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/pool-models", h.GetPoolModels)
	})
}

// GetPoolModels returns an aggregated view of every model currently registered
// in the global Model Registry, including per-provider availability counts and
// the number of clients currently quota-exceeded or suspended. Used by the
// extended management UI to display a "model pool" page across all auth files.
func (h *Handler) GetPoolModels(c *gin.Context) {
	reg := registry.GetGlobalRegistry()
	summaries := reg.GetPoolModelsSummary()

	models := make([]gin.H, 0, len(summaries))
	for _, s := range summaries {
		if s.Info == nil {
			continue
		}
		entry := gin.H{
			"id":                  s.Info.ID,
			"total_clients":       s.TotalClients,
			"available_clients":   s.AvailableClients,
			"quota_exceeded":      s.QuotaExceeded,
			"suspended":           s.Suspended,
			"suspended_cooldown":  s.SuspendedByCooldown,
		}
		if s.Info.DisplayName != "" {
			entry["display_name"] = s.Info.DisplayName
		}
		if s.Info.Type != "" {
			entry["type"] = s.Info.Type
		}
		if s.Info.OwnedBy != "" {
			entry["owned_by"] = s.Info.OwnedBy
		}
		if s.Info.Version != "" {
			entry["version"] = s.Info.Version
		}
		if s.Info.Description != "" {
			entry["description"] = s.Info.Description
		}
		if s.Info.ContextLength > 0 {
			entry["context_length"] = s.Info.ContextLength
		}
		if s.Info.MaxCompletionTokens > 0 {
			entry["max_completion_tokens"] = s.Info.MaxCompletionTokens
		}
		if len(s.Providers) > 0 {
			provs := make([]gin.H, 0, len(s.Providers))
			for _, p := range s.Providers {
				provs = append(provs, gin.H{"name": p.Name, "count": p.Count})
			}
			entry["providers"] = provs
		}
		if s.Info.Thinking != nil && len(s.Info.Thinking.Levels) > 0 {
			entry["thinking_levels"] = s.Info.Thinking.Levels
		}
		models = append(models, entry)
	}

	c.JSON(200, gin.H{"models": models, "total": len(models)})
}
