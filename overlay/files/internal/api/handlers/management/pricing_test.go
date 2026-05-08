package management

import (
	"math"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

// TestLookupPricingLongestMatch asserts that the most-specific prefix wins,
// since the runtime uses substring (Contains) matching ranked by prefix length.
func TestLookupPricingLongestMatch(t *testing.T) {
	cases := []struct {
		model      string
		wantPrefix string
	}{
		// GPT-5.5 family
		{"gpt-5.5", "gpt-5.5"},
		{"gpt-5.5-instant", "gpt-5.5"}, // OpenAI consumer id; falls back to 5.5 rates
		{"gpt-5.5-pro", "gpt-5.5-pro"},
		{"gpt-5.5-2026-04-23", "gpt-5.5"},

		// GPT-5.4 family — including codex-emitted snapshot suffix
		{"gpt-5.4", "gpt-5.4"},
		{"gpt-5.4-mini", "gpt-5.4-mini"},
		{"gpt-5.4-mini-2026-03-17", "gpt-5.4-mini"},
		{"gpt-5.4-nano", "gpt-5.4-nano"},
		{"gpt-5.4-pro", "gpt-5.4-pro"},

		// GPT-5.3 — codex-only; uses 5.2-equivalent rates
		{"gpt-5.3-codex", "gpt-5.3"},
		{"gpt-5.3-codex-spark", "gpt-5.3"},

		// GPT-5.2 family
		{"gpt-5.2", "gpt-5.2"},
		{"gpt-5.2-pro", "gpt-5.2-pro"},

		// GPT-5 base (must NOT collide with 5.1/5.2/etc.)
		{"gpt-5", "gpt-5"},
		{"gpt-5-mini", "gpt-5-mini"},
		{"gpt-5-nano", "gpt-5-nano"},
		{"gpt-5-pro", "gpt-5-pro"},

		// o-series
		{"o1", "o1"},
		{"o1-pro", "o1-pro"},
		{"o3", "o3"},
		{"o3-pro", "o3-pro"},
		{"o3-mini", "o3-mini"},
		{"o3-deep-research", "o3-deep-research"},
		{"o4-mini", "o4-mini"},
		{"o4-mini-deep-research", "o4-mini-deep-research"},

		// ChatGPT chat-latest aliases — ensure version-pinned ids do NOT
		// fall back to the bare "chat-latest" prefix (which would charge 5.5 rates).
		{"chat-latest", "chat-latest"},                   // currently = gpt-5.5 instant
		{"gpt-5.5-chat-latest", "gpt-5.5-chat-latest"},
		{"gpt-5.3-chat-latest", "gpt-5.3-chat-latest"},
		{"gpt-5.2-chat-latest", "gpt-5.2-chat-latest"},
		{"gpt-5.1-chat-latest", "gpt-5.1-chat-latest"},
		{"gpt-5-chat-latest", "gpt-5-chat-latest"},
		{"chatgpt-4o-latest", "chatgpt-4o-latest"},

		// Codex API variants (platform-API, not OAuth backend)
		{"gpt-5.3-codex", "gpt-5.3"},
		{"gpt-5.2-codex", "gpt-5.2"},
		{"gpt-5.1-codex-max", "gpt-5.1"},
		{"gpt-5.1-codex", "gpt-5.1"},
		{"gpt-5.1-codex-mini", "gpt-5.1-codex-mini"},
		{"gpt-5-codex", "gpt-5"},
		{"codex-mini-latest", "codex-mini-latest"},

		// Search variants share base rates
		{"gpt-5-search-api", "gpt-5"},
		{"gpt-4o-search-preview", "gpt-4o"},
		{"gpt-4o-mini-search-preview", "gpt-4o-mini"},
	}

	for _, c := range cases {
		t.Run(c.model, func(t *testing.T) {
			got := lookupPricing(c.model)
			if got == nil {
				t.Fatalf("lookupPricing(%q) returned nil; want prefix %q", c.model, c.wantPrefix)
			}
			if got.prefix != c.wantPrefix {
				t.Fatalf("lookupPricing(%q) matched %q; want %q", c.model, got.prefix, c.wantPrefix)
			}
		})
	}
}

// TestCalcCostUSDOfficial verifies the published per-1M rates produce the
// expected dollar amount for known input/output token counts.
func TestCalcCostUSDOfficial(t *testing.T) {
	// 1,000,000 input + 1,000,000 output, no caching, no reasoning.
	cases := []struct {
		model    string
		wantUSD  float64
		inTokens int64
	}{
		// Per official 2026-05 pricing (USD per 1M):
		// gpt-5.5:        in $5     out $30  → 1M+1M = $35
		// gpt-5.4:        in $2.5   out $15  → 1M+1M = $17.5
		// gpt-5.4-mini:   in $0.75  out $4.5 → 1M+1M = $5.25
		// gpt-5.4-nano:   in $0.20  out $1.25→ 1M+1M = $1.45
		// gpt-5.5-pro:    in $30    out $180 → 1M+1M = $210
		// gpt-5-mini:     in $0.25  out $2   → 1M+1M = $2.25
		// gpt-5-nano:     in $0.05  out $0.4 → 1M+1M = $0.45
		// gpt-5:          in $1.25  out $10  → 1M+1M = $11.25
		// gpt-5.2:        in $1.75  out $14  → 1M+1M = $15.75
		// gpt-5.1:        in $1.25  out $10  → 1M+1M = $11.25
		{model: "gpt-5.5",      wantUSD: 35.00,   inTokens: 1_000_000},
		{model: "gpt-5.4",      wantUSD: 17.50,   inTokens: 1_000_000},
		{model: "gpt-5.4-mini", wantUSD:  5.25,   inTokens: 1_000_000},
		{model: "gpt-5.4-nano", wantUSD:  1.45,   inTokens: 1_000_000},
		{model: "gpt-5.5-pro",  wantUSD:210.00,   inTokens: 1_000_000},
		{model: "gpt-5-mini",   wantUSD:  2.25,   inTokens: 1_000_000},
		{model: "gpt-5-nano",   wantUSD:  0.45,   inTokens: 1_000_000},
		{model: "gpt-5",        wantUSD: 11.25,   inTokens: 1_000_000},
		{model: "gpt-5.2",      wantUSD: 15.75,   inTokens: 1_000_000},
		{model: "gpt-5.1",      wantUSD: 11.25,   inTokens: 1_000_000},

		// ChatGPT chat-latest aliases
		{model: "chat-latest",          wantUSD: 35.00,   inTokens: 1_000_000}, // = gpt-5.5
		{model: "gpt-5-chat-latest",    wantUSD: 11.25,   inTokens: 1_000_000},
		{model: "gpt-5.1-chat-latest",  wantUSD: 11.25,   inTokens: 1_000_000},
		{model: "gpt-5.2-chat-latest",  wantUSD: 15.75,   inTokens: 1_000_000},
		{model: "chatgpt-4o-latest",    wantUSD: 20.00,   inTokens: 1_000_000}, // 5+15

		// Codex variants
		{model: "gpt-5.1-codex-mini",   wantUSD:  2.25,   inTokens: 1_000_000}, // 0.25+2.0
		{model: "codex-mini-latest",    wantUSD:  7.50,   inTokens: 1_000_000}, // 1.5+6
	}

	for _, c := range cases {
		t.Run(c.model, func(t *testing.T) {
			got := calcCostUSD(c.model, usage.Detail{
				InputTokens:  c.inTokens,
				OutputTokens: c.inTokens, // same count for symmetry
			})
			if math.Abs(got-c.wantUSD) > 1e-6 {
				t.Fatalf("calcCostUSD(%q, 1M+1M tokens) = %.6f; want %.6f", c.model, got, c.wantUSD)
			}
		})
	}
}
