package management

// pricing_view.go — exposes the in-process pricingTable so operators can
// verify what the cost estimator is billing against without rebuilding.
//
// GET /v0/management/pricing returns the table sorted by prefix length
// (most-specific first, matching lookupPricing's longest-substring-match
// behaviour). All values are converted back from "USD per 1K" to the more
// readable "USD per 1M tokens" so they can be compared directly against
// developers.openai.com/api/docs/pricing.

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/pricing", h.GetPricing)
	})
}

type PricingRow struct {
	Prefix             string  `json:"prefix"`
	InputPer1M         float64 `json:"input_per_1m"`
	CachedInputPer1M   float64 `json:"cached_input_per_1m"`
	OutputPer1M        float64 `json:"output_per_1m"`
	ReasoningPer1M     float64 `json:"reasoning_per_1m"`
	ReasoningInherited bool    `json:"reasoning_inherits_output"`
}

func (h *Handler) GetPricing(c *gin.Context) {
	rows := make([]PricingRow, 0, len(pricingTable))
	for _, p := range pricingTable {
		row := PricingRow{
			Prefix:           p.prefix,
			InputPer1M:       p.input * 1000,
			CachedInputPer1M: p.cached * 1000,
			OutputPer1M:      p.output * 1000,
			ReasoningPer1M:   p.reasoning * 1000,
		}
		if p.reasoning == 0 {
			row.ReasoningPer1M = row.OutputPer1M
			row.ReasoningInherited = true
		}
		rows = append(rows, row)
	}
	// Most-specific first matches lookupPricing's longest-substring-match.
	sort.Slice(rows, func(i, j int) bool {
		if len(rows[i].Prefix) != len(rows[j].Prefix) {
			return len(rows[i].Prefix) > len(rows[j].Prefix)
		}
		return rows[i].Prefix < rows[j].Prefix
	})
	c.JSON(http.StatusOK, gin.H{
		"items":      rows,
		"count":      len(rows),
		"unit":       "USD per 1M tokens",
		"source":     "in-process pricingTable (token_stats.go)",
		"note":       "Match is longest-substring of model id; cached_input == input_per_1m means OpenAI lists '-' (no cache discount).",
	})
}
