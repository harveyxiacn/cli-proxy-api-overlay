package management

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/token-stats", h.GetTokenStats)
		rg.POST("/token-stats/reset",
			auditingHandler("stats.reset", "token_stats", nil, h.PostResetTokenStats))
	})
}

// ── Model pricing table (USD per 1K tokens, official OpenAI prices) ──────────
// Matched by longest prefix (most-specific wins).
type pricingEntry struct {
	prefix    string
	input     float64 // non-cached input tokens per 1K
	cached    float64 // cached input tokens per 1K
	output    float64 // non-reasoning output tokens per 1K
	reasoning float64 // reasoning tokens per 1K (o-series); 0 = same as output
}

// Prices as of 2026-05-06 official OpenAI API pricing page (standard tier, <272K context).
// Values are stored as "USD per 1K tokens" expressed as `(USD-per-1M) / 1000`,
// because the cost formula divides by 1000 again (`tokens * rate / 1000`).
//
// Lookup uses longest-substring-match (see lookupPricing), so order does not
// matter — but more specific prefixes (e.g. "gpt-5.4-mini") MUST exist or a
// shorter prefix ("gpt-5.4") would win for the more-specific id.
//
// For models OpenAI lists with cached=null/"-"/"" (no caching discount),
// we set cached := input so cached tokens are billed at the normal input rate.
//
// Codex OAuth accounts consume quota, not dollars — cost shown is "as-if" API price.
var pricingTable = []pricingEntry{
	// o-series reasoning models
	{"o1-pro", 150.000 / 1000, 150.000 / 1000, 600.000 / 1000, 600.000 / 1000},
	{"o1-mini", 1.100 / 1000, 0.550 / 1000, 4.400 / 1000, 4.400 / 1000},
	{"o1", 15.000 / 1000, 7.500 / 1000, 60.000 / 1000, 60.000 / 1000},
	{"o3-pro", 20.000 / 1000, 20.000 / 1000, 80.000 / 1000, 80.000 / 1000},
	{"o3-deep-research", 10.000 / 1000, 2.500 / 1000, 40.000 / 1000, 40.000 / 1000},
	{"o3-mini", 1.100 / 1000, 0.550 / 1000, 4.400 / 1000, 4.400 / 1000},
	{"o3", 2.000 / 1000, 0.500 / 1000, 8.000 / 1000, 8.000 / 1000},
	{"o4-mini-deep-research", 2.000 / 1000, 0.500 / 1000, 8.000 / 1000, 8.000 / 1000},
	{"o4-mini", 1.100 / 1000, 0.275 / 1000, 4.400 / 1000, 4.400 / 1000},

	// GPT-5.5 (frontier; gpt-5.5-instant id rejected by codex backend — falls
	// back to "gpt-5.5" rates via longest-substring match. The same model is
	// reachable via OpenAI platform API as `chat-latest` / `gpt-5.5-chat-latest`).
	{"gpt-5.5-pro", 30.000 / 1000, 30.000 / 1000, 180.000 / 1000, 0},
	{"gpt-5.5", 5.000 / 1000, 0.500 / 1000, 30.000 / 1000, 0},

	// ChatGPT alias models (platform.openai.com /v1/chat/completions).
	// `chat-latest` is OpenAI's pointer alias to the latest chat-tuned model;
	// today (2026-05) it tracks GPT-5.5 Instant ($5/$0.5/$30 matches gpt-5.5).
	// Version-pinned entries must be longer than the bare "chat-latest" prefix
	// so longest-substring-match returns their own rate, not the alias's.
	{"gpt-5.5-chat-latest", 5.000 / 1000, 0.500 / 1000, 30.000 / 1000, 0},
	{"gpt-5.3-chat-latest", 1.750 / 1000, 0.175 / 1000, 14.000 / 1000, 0},
	{"gpt-5.2-chat-latest", 1.750 / 1000, 0.175 / 1000, 14.000 / 1000, 0},
	{"gpt-5.1-chat-latest", 1.250 / 1000, 0.125 / 1000, 10.000 / 1000, 0},
	{"gpt-5-chat-latest", 1.250 / 1000, 0.125 / 1000, 10.000 / 1000, 0},
	{"chat-latest", 5.000 / 1000, 0.500 / 1000, 30.000 / 1000, 0},
	{"chatgpt-4o-latest", 5.000 / 1000, 5.000 / 1000, 15.000 / 1000, 0},

	// GPT-5.4 family
	{"gpt-5.4-pro", 30.000 / 1000, 30.000 / 1000, 180.000 / 1000, 0},
	{"gpt-5.4-mini", 0.750 / 1000, 0.075 / 1000, 4.500 / 1000, 0},
	{"gpt-5.4-nano", 0.200 / 1000, 0.020 / 1000, 1.250 / 1000, 0},
	{"gpt-5.4", 2.500 / 1000, 0.250 / 1000, 15.000 / 1000, 0},

	// GPT-5.3 (no public price published; use 5.2 rates as nearest neighbour)
	{"gpt-5.3", 1.750 / 1000, 0.175 / 1000, 14.000 / 1000, 0},

	// GPT-5.2 family
	{"gpt-5.2-pro", 21.000 / 1000, 21.000 / 1000, 168.000 / 1000, 0},
	{"gpt-5.2", 1.750 / 1000, 0.175 / 1000, 14.000 / 1000, 0},

	// GPT-5.1 family (codex variants share base 5.1 rates except the explicit -mini)
	{"gpt-5.1-codex-mini", 0.250 / 1000, 0.025 / 1000, 2.000 / 1000, 0},
	{"gpt-5.1", 1.250 / 1000, 0.125 / 1000, 10.000 / 1000, 0},

	// Codex aliases that don't share base GPT-5 rates
	{"codex-mini-latest", 1.500 / 1000, 0.375 / 1000, 6.000 / 1000, 0},

	// GPT-5 base family
	{"gpt-5-pro", 15.000 / 1000, 15.000 / 1000, 120.000 / 1000, 0},
	{"gpt-5-mini", 0.250 / 1000, 0.025 / 1000, 2.000 / 1000, 0},
	{"gpt-5-nano", 0.050 / 1000, 0.005 / 1000, 0.400 / 1000, 0},
	{"gpt-5", 1.250 / 1000, 0.125 / 1000, 10.000 / 1000, 0},

	// GPT-4.1 family
	{"gpt-4.1-mini", 0.400 / 1000, 0.100 / 1000, 1.600 / 1000, 0},
	{"gpt-4.1-nano", 0.100 / 1000, 0.025 / 1000, 0.400 / 1000, 0},
	{"gpt-4.1", 2.000 / 1000, 0.500 / 1000, 8.000 / 1000, 0},

	// GPT-4o family
	{"gpt-4o-mini", 0.150 / 1000, 0.075 / 1000, 0.600 / 1000, 0},
	{"gpt-4o", 2.500 / 1000, 1.250 / 1000, 10.000 / 1000, 0},

	// GPT-4 (legacy; no caching discount)
	{"gpt-4-turbo", 10.000 / 1000, 10.000 / 1000, 30.000 / 1000, 0},
	{"gpt-4-32k", 60.000 / 1000, 60.000 / 1000, 120.000 / 1000, 0},
	{"gpt-4", 30.000 / 1000, 30.000 / 1000, 60.000 / 1000, 0},

	// GPT-3.5 (legacy)
	{"gpt-3.5-turbo-instruct", 1.500 / 1000, 1.500 / 1000, 2.000 / 1000, 0},
	{"gpt-3.5-turbo-16k", 3.000 / 1000, 3.000 / 1000, 4.000 / 1000, 0},
	{"gpt-3.5-turbo-1106", 1.000 / 1000, 1.000 / 1000, 2.000 / 1000, 0},
	{"gpt-3.5-turbo-0613", 1.500 / 1000, 1.500 / 1000, 2.000 / 1000, 0},
	{"gpt-3.5-turbo", 0.500 / 1000, 0.500 / 1000, 1.500 / 1000, 0},
	{"gpt-3.5", 0.500 / 1000, 0.500 / 1000, 1.500 / 1000, 0},

	// Computer use
	{"computer-use", 3.000 / 1000, 3.000 / 1000, 12.000 / 1000, 0},

	// Embeddings (input-only; no real output, but mirror input rate for safety)
	{"text-embedding-3-small", 0.020 / 1000, 0.020 / 1000, 0, 0},
	{"text-embedding-3-large", 0.130 / 1000, 0.130 / 1000, 0, 0},
	{"text-embedding-ada", 0.100 / 1000, 0.100 / 1000, 0, 0},

	// GPT-realtime — text-modality default; audio is billed separately upstream
	// and not represented here. Image input is approximated by the input rate.
	{"gpt-realtime", 4.000 / 1000, 0.400 / 1000, 16.000 / 1000, 0},

	// GPT-image — text input + image output approximation; for accurate
	// per-request cost use the OpenAI image-generation calculator.
	{"gpt-image", 5.000 / 1000, 1.250 / 1000, 30.000 / 1000, 0},

	// Older base models
	{"davinci-002", 2.000 / 1000, 2.000 / 1000, 2.000 / 1000, 0},
	{"babbage-002", 0.400 / 1000, 0.400 / 1000, 0.400 / 1000, 0},
}

// lookupPricing returns the pricing entry for a model name (longest prefix match).
func lookupPricing(model string) *pricingEntry {
	lower := strings.ToLower(strings.TrimSpace(model))
	best := (*pricingEntry)(nil)
	bestLen := 0
	for i := range pricingTable {
		p := &pricingTable[i]
		if strings.Contains(lower, p.prefix) && len(p.prefix) > bestLen {
			best = p
			bestLen = len(p.prefix)
		}
	}
	return best
}

// calcCostUSD estimates the USD cost for one usage record.
func calcCostUSD(model string, d usage.Detail) float64 {
	p := lookupPricing(model)
	if p == nil {
		return 0
	}
	nonCachedIn := d.InputTokens - d.CachedTokens
	if nonCachedIn < 0 {
		nonCachedIn = 0
	}
	reasoningOut := d.ReasoningTokens
	reasoningRate := p.reasoning
	if reasoningRate == 0 {
		reasoningRate = p.output
	}
	nonReasonOut := d.OutputTokens - reasoningOut
	if nonReasonOut < 0 {
		nonReasonOut = 0
	}
	cost := float64(nonCachedIn)*p.input/1000 +
		float64(d.CachedTokens)*p.cached/1000 +
		float64(nonReasonOut)*p.output/1000 +
		float64(reasoningOut)*reasoningRate/1000
	return cost
}

// ── Daily bucket (resets at local midnight) ───────────────────────────────────

type dailyBucket struct {
	mu              sync.Mutex
	date            string // "2006-01-02"
	InputTokens     int64
	OutputTokens    int64
	CachedTokens    int64
	ReasoningTokens int64
	TotalTokens     int64
	EstimatedUSD    float64
	Requests        int64
	FailedRequests  int64
}

// apiKeyDailyBucket tracks per-API-key daily usage for soft-limit detection.
// All buckets reset on day rollover by tokenStatsPlugin.maybeRotateAPIKeyDaily().
type apiKeyDailyBucket struct {
	Hash            string
	InputTokens     int64
	OutputTokens    int64
	CachedTokens    int64
	ReasoningTokens int64
	TotalTokens     int64
	EstimatedUSD    float64
	Requests        int64
	FailedRequests  int64
	LastUsedUnix    int64
}

func todayDate() string { return time.Now().Format("2006-01-02") }

func (b *dailyBucket) maybeReset() {
	// called inside lock; rotate if date changed
	if today := todayDate(); b.date != today {
		b.date = today
		b.InputTokens = 0
		b.OutputTokens = 0
		b.CachedTokens = 0
		b.ReasoningTokens = 0
		b.TotalTokens = 0
		b.EstimatedUSD = 0
		b.Requests = 0
		b.FailedRequests = 0
	}
}

// ── Per-auth lifetime entry ───────────────────────────────────────────────────

type tokenAuthEntry struct {
	AuthID     string
	Provider   string
	Email      string
	APIKeyHash string

	InputTokens     atomic.Int64
	OutputTokens    atomic.Int64
	CachedTokens    atomic.Int64
	ReasoningTokens atomic.Int64
	TotalTokens     atomic.Int64
	Requests        atomic.Int64
	FailedRequests  atomic.Int64
	lastUsedUnix    atomic.Int64

	costMu       sync.Mutex
	EstimatedUSD float64 // lifetime estimated cost (needs mutex)
}

// ── Plugin ────────────────────────────────────────────────────────────────────

type tokenStatsPlugin struct {
	mu        sync.RWMutex
	byAuthID  map[string]*tokenAuthEntry
	startedAt time.Time

	// global lifetime atomics
	globalIn        atomic.Int64
	globalOut       atomic.Int64
	globalCached    atomic.Int64
	globalReasoning atomic.Int64
	globalTotal     atomic.Int64
	globalRequests  atomic.Int64
	globalFailed    atomic.Int64

	globalCostMu  sync.Mutex
	globalCostUSD float64

	// today's rolling bucket
	today dailyBucket

	// Per-api-key-hash daily counters (reset at midnight).
	apiKeyDailyMu   sync.Mutex
	apiKeyDailyDate string
	apiKeyDaily     map[string]*apiKeyDailyBucket
}

func newTokenStatsPlugin() *tokenStatsPlugin {
	p := &tokenStatsPlugin{
		byAuthID:    make(map[string]*tokenAuthEntry),
		apiKeyDaily: make(map[string]*apiKeyDailyBucket),
		startedAt:   time.Now(),
	}
	p.today.date = todayDate()
	p.apiKeyDailyDate = todayDate()
	return p
}

// maybeRotateAPIKeyDaily resets the per-key daily map when the day changes.
// Caller must hold apiKeyDailyMu.
func (p *tokenStatsPlugin) maybeRotateAPIKeyDaily() {
	if today := todayDate(); p.apiKeyDailyDate != today {
		p.apiKeyDailyDate = today
		p.apiKeyDaily = make(map[string]*apiKeyDailyBucket)
	}
}

// recordAPIKeyDaily updates the per-key daily bucket for one usage record. The
// returned bucket is a snapshot copy that callers can compare against limits.
// Returns nil if hash is empty.
func (p *tokenStatsPlugin) recordAPIKeyDaily(hash string, d usage.Detail, cost float64, failed bool) *apiKeyDailyBucket {
	hash = strings.TrimSpace(hash)
	if hash == "" {
		return nil
	}
	p.apiKeyDailyMu.Lock()
	defer p.apiKeyDailyMu.Unlock()
	p.maybeRotateAPIKeyDaily()
	b, ok := p.apiKeyDaily[hash]
	if !ok {
		b = &apiKeyDailyBucket{Hash: hash}
		p.apiKeyDaily[hash] = b
	}
	now := time.Now().Unix()
	if failed {
		b.FailedRequests++
		b.LastUsedUnix = now
		snap := *b
		return &snap
	}
	b.InputTokens += d.InputTokens
	b.OutputTokens += d.OutputTokens
	b.CachedTokens += d.CachedTokens
	b.ReasoningTokens += d.ReasoningTokens
	b.TotalTokens += d.TotalTokens
	b.EstimatedUSD += cost
	b.Requests++
	b.LastUsedUnix = now
	snap := *b
	return &snap
}

// snapshotAPIKeyDaily returns copies of every per-key bucket for read-only consumers.
func (p *tokenStatsPlugin) snapshotAPIKeyDaily() (string, []apiKeyDailyBucket) {
	p.apiKeyDailyMu.Lock()
	defer p.apiKeyDailyMu.Unlock()
	p.maybeRotateAPIKeyDaily()
	date := p.apiKeyDailyDate
	out := make([]apiKeyDailyBucket, 0, len(p.apiKeyDaily))
	for _, b := range p.apiKeyDaily {
		if b == nil {
			continue
		}
		out = append(out, *b)
	}
	return date, out
}


var globalTokenStats = newTokenStatsPlugin()

func init() {
	usage.RegisterPlugin(globalTokenStats)
}

// HandleUsage implements usage.Plugin.
func (p *tokenStatsPlugin) HandleUsage(_ context.Context, rec usage.Record) {
	key := rec.AuthID
	if key == "" {
		key = rec.Source
	}
	if key == "" {
		return
	}
	defer persistTokenStatsSnapshot(p)

	// Upsert per-auth entry
	p.mu.RLock()
	entry, ok := p.byAuthID[key]
	p.mu.RUnlock()
	if !ok {
		p.mu.Lock()
		entry, ok = p.byAuthID[key]
		if !ok {
			entry = &tokenAuthEntry{AuthID: rec.AuthID}
			p.byAuthID[key] = entry
		}
		p.mu.Unlock()
	}
	if rec.Provider != "" && entry.Provider == "" {
		entry.Provider = rec.Provider
	}
	if apiKeyHash := hashAPIKey(rec.APIKey); apiKeyHash != "" && entry.APIKeyHash == "" {
		entry.APIKeyHash = apiKeyHash
	}
	entry.lastUsedUnix.Store(time.Now().Unix())

	// Today bucket
	p.today.mu.Lock()
	p.today.maybeReset()

	if rec.Failed {
		entry.FailedRequests.Add(1)
		p.globalFailed.Add(1)
		p.today.FailedRequests++
		p.today.mu.Unlock()
		if hash := entry.APIKeyHash; hash != "" {
			p.recordAPIKeyDaily(hash, usage.Detail{}, 0, true)
			notifyAPIKeyQuotaIfNeeded(hash)
		}
		return
	}

	d := rec.Detail
	cost := calcCostUSD(rec.Model, d)

	p.today.InputTokens += d.InputTokens
	p.today.OutputTokens += d.OutputTokens
	p.today.CachedTokens += d.CachedTokens
	p.today.ReasoningTokens += d.ReasoningTokens
	p.today.TotalTokens += d.TotalTokens
	p.today.EstimatedUSD += cost
	p.today.Requests++
	p.today.mu.Unlock()

	// Per-auth lifetime
	entry.InputTokens.Add(d.InputTokens)
	entry.OutputTokens.Add(d.OutputTokens)
	entry.CachedTokens.Add(d.CachedTokens)
	entry.ReasoningTokens.Add(d.ReasoningTokens)
	entry.TotalTokens.Add(d.TotalTokens)
	entry.Requests.Add(1)
	if cost > 0 {
		entry.costMu.Lock()
		entry.EstimatedUSD += cost
		entry.costMu.Unlock()
	}

	// Global lifetime
	p.globalIn.Add(d.InputTokens)
	p.globalOut.Add(d.OutputTokens)
	p.globalCached.Add(d.CachedTokens)
	p.globalReasoning.Add(d.ReasoningTokens)
	p.globalTotal.Add(d.TotalTokens)
	p.globalRequests.Add(1)
	if cost > 0 {
		p.globalCostMu.Lock()
		p.globalCostUSD += cost
		p.globalCostMu.Unlock()
	}

	// Per-API-key daily counters + soft-limit notification.
	if hash := entry.APIKeyHash; hash != "" {
		p.recordAPIKeyDaily(hash, d, cost, false)
		notifyAPIKeyQuotaIfNeeded(hash)
	}
}

func (p *tokenStatsPlugin) reset() {
	p.mu.Lock()
	p.byAuthID = make(map[string]*tokenAuthEntry)
	p.startedAt = time.Now()
	p.mu.Unlock()

	p.globalIn.Store(0)
	p.globalOut.Store(0)
	p.globalCached.Store(0)
	p.globalReasoning.Store(0)
	p.globalTotal.Store(0)
	p.globalRequests.Store(0)
	p.globalFailed.Store(0)

	p.globalCostMu.Lock()
	p.globalCostUSD = 0
	p.globalCostMu.Unlock()

	p.today.mu.Lock()
	p.today.date = todayDate()
	p.today.InputTokens = 0
	p.today.OutputTokens = 0
	p.today.CachedTokens = 0
	p.today.ReasoningTokens = 0
	p.today.TotalTokens = 0
	p.today.EstimatedUSD = 0
	p.today.Requests = 0
	p.today.FailedRequests = 0
	p.today.mu.Unlock()
	clearTokenStatsPersistence()
}

func (p *tokenStatsPlugin) snapshot() tokenStatsSnapshot {
	if p == nil {
		return tokenStatsSnapshot{Version: 1}
	}

	p.mu.RLock()
	entries := make([]tokenStatsEntrySnapshot, 0, len(p.byAuthID))
	for key, e := range p.byAuthID {
		if e == nil {
			continue
		}
		e.costMu.Lock()
		cost := e.EstimatedUSD
		e.costMu.Unlock()
		entries = append(entries, tokenStatsEntrySnapshot{
			Key:             key,
			AuthID:          e.AuthID,
			Provider:        e.Provider,
			Email:           e.Email,
			APIKeyHash:      e.APIKeyHash,
			InputTokens:     e.InputTokens.Load(),
			OutputTokens:    e.OutputTokens.Load(),
			CachedTokens:    e.CachedTokens.Load(),
			ReasoningTokens: e.ReasoningTokens.Load(),
			TotalTokens:     e.TotalTokens.Load(),
			EstimatedUSD:    math.Round(cost*1e6) / 1e6,
			Requests:        e.Requests.Load(),
			FailedRequests:  e.FailedRequests.Load(),
			LastUsedAt:      e.lastUsedUnix.Load(),
		})
	}
	startedAt := p.startedAt
	p.mu.RUnlock()

	p.globalCostMu.Lock()
	globalCost := p.globalCostUSD
	p.globalCostMu.Unlock()

	p.today.mu.Lock()
	today := tokenStatsTodaySnapshot{
		Date:            p.today.date,
		InputTokens:     p.today.InputTokens,
		OutputTokens:    p.today.OutputTokens,
		CachedTokens:    p.today.CachedTokens,
		ReasoningTokens: p.today.ReasoningTokens,
		TotalTokens:     p.today.TotalTokens,
		EstimatedUSD:    math.Round(p.today.EstimatedUSD*1e6) / 1e6,
		Requests:        p.today.Requests,
		FailedRequests:  p.today.FailedRequests,
	}
	p.today.mu.Unlock()

	return tokenStatsSnapshot{
		Version:   1,
		StartedAt: startedAt.Unix(),
		Entries:   entries,
		Totals: tokenStatsTotalsSnapshot{
			InputTokens:     p.globalIn.Load(),
			OutputTokens:    p.globalOut.Load(),
			CachedTokens:    p.globalCached.Load(),
			ReasoningTokens: p.globalReasoning.Load(),
			TotalTokens:     p.globalTotal.Load(),
			EstimatedUSD:    math.Round(globalCost*1e6) / 1e6,
			Requests:        p.globalRequests.Load(),
			FailedRequests:  p.globalFailed.Load(),
		},
		Today: today,
	}
}

func (p *tokenStatsPlugin) restore(snap tokenStatsSnapshot) {
	if p == nil {
		return
	}
	byAuthID := make(map[string]*tokenAuthEntry, len(snap.Entries))
	for _, item := range snap.Entries {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			key = strings.TrimSpace(item.AuthID)
		}
		if key == "" {
			continue
		}
		entry := &tokenAuthEntry{
			AuthID:       item.AuthID,
			Provider:     item.Provider,
			Email:        item.Email,
			APIKeyHash:   item.APIKeyHash,
			EstimatedUSD: item.EstimatedUSD,
		}
		entry.InputTokens.Store(item.InputTokens)
		entry.OutputTokens.Store(item.OutputTokens)
		entry.CachedTokens.Store(item.CachedTokens)
		entry.ReasoningTokens.Store(item.ReasoningTokens)
		entry.TotalTokens.Store(item.TotalTokens)
		entry.Requests.Store(item.Requests)
		entry.FailedRequests.Store(item.FailedRequests)
		entry.lastUsedUnix.Store(item.LastUsedAt)
		byAuthID[key] = entry
	}

	p.mu.Lock()
	p.byAuthID = byAuthID
	p.startedAt = unixOrNow(snap.StartedAt)
	p.mu.Unlock()

	p.globalIn.Store(snap.Totals.InputTokens)
	p.globalOut.Store(snap.Totals.OutputTokens)
	p.globalCached.Store(snap.Totals.CachedTokens)
	p.globalReasoning.Store(snap.Totals.ReasoningTokens)
	p.globalTotal.Store(snap.Totals.TotalTokens)
	p.globalRequests.Store(snap.Totals.Requests)
	p.globalFailed.Store(snap.Totals.FailedRequests)

	p.globalCostMu.Lock()
	p.globalCostUSD = snap.Totals.EstimatedUSD
	p.globalCostMu.Unlock()

	p.today.mu.Lock()
	p.today.date = snap.Today.Date
	if p.today.date == "" {
		p.today.date = todayDate()
	}
	p.today.InputTokens = snap.Today.InputTokens
	p.today.OutputTokens = snap.Today.OutputTokens
	p.today.CachedTokens = snap.Today.CachedTokens
	p.today.ReasoningTokens = snap.Today.ReasoningTokens
	p.today.TotalTokens = snap.Today.TotalTokens
	p.today.EstimatedUSD = snap.Today.EstimatedUSD
	p.today.Requests = snap.Today.Requests
	p.today.FailedRequests = snap.Today.FailedRequests
	p.today.maybeReset()
	p.today.mu.Unlock()
}

// ── JSON types ────────────────────────────────────────────────────────────────

type tokenStatJSON struct {
	AuthID          string  `json:"auth_id"`
	Provider        string  `json:"provider,omitempty"`
	Email           string  `json:"email,omitempty"`
	APIKeyHash      string  `json:"api_key_hash,omitempty"`
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
	Requests        int64   `json:"requests"`
	FailedRequests  int64   `json:"failed_requests"`
	LastUsedAt      int64   `json:"last_used_at,omitempty"`
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GetTokenStats returns accumulated token usage stats.
// GET /v0/management/token-stats
func (h *Handler) GetTokenStats(c *gin.Context) {
	p := globalTokenStats

	p.mu.RLock()
	entries := make([]tokenStatJSON, 0, len(p.byAuthID))
	for _, e := range p.byAuthID {
		e.costMu.Lock()
		cost := e.EstimatedUSD
		e.costMu.Unlock()
		j := tokenStatJSON{
			AuthID:          e.AuthID,
			Provider:        e.Provider,
			APIKeyHash:      e.APIKeyHash,
			InputTokens:     e.InputTokens.Load(),
			OutputTokens:    e.OutputTokens.Load(),
			CachedTokens:    e.CachedTokens.Load(),
			ReasoningTokens: e.ReasoningTokens.Load(),
			TotalTokens:     e.TotalTokens.Load(),
			EstimatedUSD:    math.Round(cost*1e6) / 1e6,
			Requests:        e.Requests.Load(),
			FailedRequests:  e.FailedRequests.Load(),
			LastUsedAt:      e.lastUsedUnix.Load(),
		}
		entries = append(entries, j)
	}
	startedAt := p.startedAt
	p.mu.RUnlock()

	// Enrich with email/provider from auth manager
	h.mu.Lock()
	mgr := h.authManager
	h.mu.Unlock()
	if mgr != nil {
		byID := make(map[string]struct{ Email, Provider, APIKeyHash string })
		for _, auth := range mgr.List() {
			if auth == nil {
				continue
			}
			email := ""
			if auth.Metadata != nil {
				if v, ok := auth.Metadata["email"].(string); ok {
					email = v
				}
			}
			apiKeyHash := ""
			if kind, apiKey := auth.AccountInfo(); strings.EqualFold(strings.TrimSpace(kind), "api_key") {
				apiKeyHash = hashAPIKey(apiKey)
			}
			if apiKeyHash == "" && auth.Attributes != nil {
				apiKeyHash = hashAPIKey(auth.Attributes["api_key"])
			}
			byID[auth.ID] = struct{ Email, Provider, APIKeyHash string }{email, auth.Provider, apiKeyHash}
		}
		for i := range entries {
			if info, ok := byID[entries[i].AuthID]; ok {
				if entries[i].Email == "" {
					entries[i].Email = info.Email
				}
				if entries[i].Provider == "" {
					entries[i].Provider = info.Provider
				}
				if entries[i].APIKeyHash == "" {
					entries[i].APIKeyHash = info.APIKeyHash
				}
			}
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].TotalTokens > entries[j].TotalTokens
	})

	p.globalCostMu.Lock()
	totalCost := math.Round(p.globalCostUSD*1e6) / 1e6
	p.globalCostMu.Unlock()

	p.today.mu.Lock()
	p.today.maybeReset()
	todaySnap := struct {
		Date            string
		InputTokens     int64
		OutputTokens    int64
		CachedTokens    int64
		ReasoningTokens int64
		TotalTokens     int64
		EstimatedUSD    float64
		Requests        int64
		FailedRequests  int64
	}{
		Date:            p.today.date,
		InputTokens:     p.today.InputTokens,
		OutputTokens:    p.today.OutputTokens,
		CachedTokens:    p.today.CachedTokens,
		ReasoningTokens: p.today.ReasoningTokens,
		TotalTokens:     p.today.TotalTokens,
		EstimatedUSD:    math.Round(p.today.EstimatedUSD*1e6) / 1e6,
		Requests:        p.today.Requests,
		FailedRequests:  p.today.FailedRequests,
	}
	p.today.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"entries": entries,
		"totals": gin.H{
			"input_tokens":     p.globalIn.Load(),
			"output_tokens":    p.globalOut.Load(),
			"cached_tokens":    p.globalCached.Load(),
			"reasoning_tokens": p.globalReasoning.Load(),
			"total_tokens":     p.globalTotal.Load(),
			"estimated_usd":    totalCost,
			"requests":         p.globalRequests.Load(),
			"failed_requests":  p.globalFailed.Load(),
		},
		"today": gin.H{
			"date":             todaySnap.Date,
			"input_tokens":     todaySnap.InputTokens,
			"output_tokens":    todaySnap.OutputTokens,
			"cached_tokens":    todaySnap.CachedTokens,
			"reasoning_tokens": todaySnap.ReasoningTokens,
			"total_tokens":     todaySnap.TotalTokens,
			"estimated_usd":    todaySnap.EstimatedUSD,
			"requests":         todaySnap.Requests,
			"failed_requests":  todaySnap.FailedRequests,
		},
		"started_at":   startedAt.Unix(),
		"pricing_note": "estimated_usd 使用 2026-05 公布的 OpenAI 官方 API 标准档价格 (<270K 上下文)；Codex OAuth 账号消耗的是配额，费用为参考估算值",
	})
}

// PostResetTokenStats clears all accumulated token stats.
// POST /v0/management/token-stats/reset
func (h *Handler) PostResetTokenStats(c *gin.Context) {
	globalTokenStats.reset()
	c.JSON(http.StatusOK, gin.H{"status": "ok", "message": "token stats reset"})
}
