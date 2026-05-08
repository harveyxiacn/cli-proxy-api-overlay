package management

// maintenance_rules.go — overlay §4 Maintenance Rules dry-run.
//
// Operators express repetitive maintenance as rules (conditions + action).
// Default mode is dry_run; apply requires a fresh dry_run_token + action_ids
// so the server never re-evaluates conditions implicitly between preview and
// execution. v1 has no automatic scheduler — apply only fires when the user
// explicitly POSTs /apply.

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/maintenance-rules", h.GetMaintenanceRules)
		rg.PUT("/maintenance-rules",
			auditingHandler("maintenance_rule.upsert", "maintenance_rule", nil, h.PutMaintenanceRule))
		rg.DELETE("/maintenance-rules/:id",
			auditingHandlerParam("maintenance_rule.delete", "maintenance_rule", "id", h.DeleteMaintenanceRule))
		rg.POST("/maintenance-rules/dry-run", h.PostMaintenanceRulesDryRun)
		rg.POST("/maintenance-rules/apply",
			auditingHandler("maintenance_rule.apply", "maintenance_rule", nil, h.PostMaintenanceRulesApply))
	})
}

const (
	maintenanceRulesFilename = "maintenance-rules.json"
	dryRunTokenTTL           = 10 * time.Minute
)

// ── Public types ──────────────────────────────────────────────────────────────

type MaintenanceCondition struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

type MaintenanceAction struct {
	Type   string         `json:"type"`
	Params map[string]any `json:"params,omitempty"`
}

type MaintenanceScope struct {
	Providers []string `json:"providers,omitempty"`
	Groups    []string `json:"groups,omitempty"`
	TagsAny   []string `json:"tags_any,omitempty"`
}

type MaintenanceRule struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name"`
	Enabled    bool                   `json:"enabled"`
	Mode       string                 `json:"mode"`
	Conditions []MaintenanceCondition `json:"conditions"`
	Action     MaintenanceAction      `json:"action"`
	Scope      MaintenanceScope       `json:"scope"`
	CreatedAt  int64                  `json:"created_at"`
	UpdatedAt  int64                  `json:"updated_at"`
}

type MaintenanceDryRunActionItem struct {
	ID          string `json:"id"`
	RuleID      string `json:"rule_id"`
	Target      string `json:"target"`
	Action      string `json:"action"`
	Risk        string `json:"risk"`
	WouldChange bool   `json:"would_change"`
	Reason      string `json:"reason"`
}

type MaintenanceDryRunResponse struct {
	DryRunToken     string                        `json:"dry_run_token"`
	ComputedAt      int64                         `json:"computed_at"`
	ExpiresAt       int64                         `json:"expires_at"`
	Rules           int                           `json:"rules"`
	MatchedAccounts int                           `json:"matched_accounts"`
	Actions         []MaintenanceDryRunActionItem `json:"actions"`
}

type MaintenanceApplyResultItem struct {
	ID       string `json:"id"`
	Target   string `json:"target"`
	Action   string `json:"action"`
	OK       bool   `json:"ok"`
	Message  string `json:"message,omitempty"`
	Skipped  bool   `json:"skipped,omitempty"`
}

type MaintenanceApplyResponse struct {
	Status    string                       `json:"status"`
	Total     int                          `json:"total"`
	Succeeded int                          `json:"succeeded"`
	Failed    int                          `json:"failed"`
	Skipped   int                          `json:"skipped"`
	Results   []MaintenanceApplyResultItem `json:"results"`
}

// ── Risk classification ───────────────────────────────────────────────────────

var actionRisk = map[string]string{
	"select":         "none",
	"warmup":         "low",
	"add_tag":        "low",
	"move_group":     "low",
	"lower_priority": "low",
	"disable":        "medium",
	"enable":         "medium",
	"relogin":        "medium",
	"delete":         "high",
}

// ── Storage ───────────────────────────────────────────────────────────────────

type maintenanceRuleStore struct {
	mu      sync.RWMutex
	rules   map[string]*MaintenanceRule
	dirHint string
	loaded  bool
}

var globalMaintenanceRuleStore = &maintenanceRuleStore{rules: make(map[string]*MaintenanceRule)}

func (s *maintenanceRuleStore) ensureLoaded(authDir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded && s.dirHint != "" {
		return
	}
	if authDir != "" {
		s.dirHint = authDir
	}
	s.loadLocked()
	s.loaded = true
}

func (s *maintenanceRuleStore) loadLocked() {
	if s.dirHint == "" {
		return
	}
	path := filepath.Join(s.dirHint, maintenanceRulesFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var rules []*MaintenanceRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return
	}
	for _, r := range rules {
		if r == nil || strings.TrimSpace(r.ID) == "" {
			continue
		}
		s.rules[r.ID] = r
	}
}

func (s *maintenanceRuleStore) saveLocked() error {
	if s.dirHint == "" {
		return errors.New("auth dir not set")
	}
	if err := os.MkdirAll(s.dirHint, 0o755); err != nil {
		return err
	}
	all := make([]*MaintenanceRule, 0, len(s.rules))
	for _, r := range s.rules {
		all = append(all, r)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	data, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dirHint, maintenanceRulesFilename+".tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dirHint, maintenanceRulesFilename))
}

func (s *maintenanceRuleStore) snapshot() []MaintenanceRule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]MaintenanceRule, 0, len(s.rules))
	for _, r := range s.rules {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// ── Dry-run cache ─────────────────────────────────────────────────────────────

type cachedDryRun struct {
	actions     []MaintenanceDryRunActionItem
	actionsByID map[string]MaintenanceDryRunActionItem
	expiresAt   time.Time
}

type dryRunCache struct {
	mu      sync.Mutex
	entries map[string]*cachedDryRun
}

var globalDryRunCache = &dryRunCache{entries: make(map[string]*cachedDryRun)}

func (d *dryRunCache) put(token string, actions []MaintenanceDryRunActionItem) {
	d.mu.Lock()
	defer d.mu.Unlock()
	idx := make(map[string]MaintenanceDryRunActionItem, len(actions))
	for _, a := range actions {
		idx[a.ID] = a
	}
	d.entries[token] = &cachedDryRun{
		actions:     actions,
		actionsByID: idx,
		expiresAt:   time.Now().Add(dryRunTokenTTL),
	}
	// Opportunistic eviction of expired tokens.
	for k, v := range d.entries {
		if time.Now().After(v.expiresAt) {
			delete(d.entries, k)
		}
	}
}

func (d *dryRunCache) get(token string) (*cachedDryRun, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	entry, ok := d.entries[token]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(d.entries, token)
		return nil, false
	}
	return entry, true
}

func newDryRunToken() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("dr_%d_%s", time.Now().Unix(), hex.EncodeToString(buf))
}

// ── Handlers: rule CRUD ───────────────────────────────────────────────────────

func (h *Handler) authDirHint() string {
	if h == nil || h.cfg == nil {
		return ""
	}
	return strings.TrimSpace(h.cfg.AuthDir)
}

func (h *Handler) GetMaintenanceRules(c *gin.Context) {
	globalMaintenanceRuleStore.ensureLoaded(h.authDirHint())
	rules := globalMaintenanceRuleStore.snapshot()
	c.JSON(http.StatusOK, gin.H{"items": rules, "count": len(rules)})
}

func (h *Handler) PutMaintenanceRule(c *gin.Context) {
	var rule MaintenanceRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body", "code": "invalid_body"})
		return
	}
	if err := validateMaintenanceRule(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_rule"})
		return
	}
	globalMaintenanceRuleStore.ensureLoaded(h.authDirHint())
	globalMaintenanceRuleStore.mu.Lock()
	now := time.Now().Unix()
	if existing, ok := globalMaintenanceRuleStore.rules[rule.ID]; ok {
		rule.CreatedAt = existing.CreatedAt
	} else {
		rule.CreatedAt = now
	}
	rule.UpdatedAt = now
	if rule.Mode == "" {
		rule.Mode = "dry_run"
	}
	globalMaintenanceRuleStore.rules[rule.ID] = &rule
	err := globalMaintenanceRuleStore.saveLocked()
	globalMaintenanceRuleStore.mu.Unlock()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "code": "save_failed"})
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) DeleteMaintenanceRule(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
		return
	}
	globalMaintenanceRuleStore.ensureLoaded(h.authDirHint())
	globalMaintenanceRuleStore.mu.Lock()
	if _, ok := globalMaintenanceRuleStore.rules[id]; !ok {
		globalMaintenanceRuleStore.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}
	delete(globalMaintenanceRuleStore.rules, id)
	err := globalMaintenanceRuleStore.saveLocked()
	globalMaintenanceRuleStore.mu.Unlock()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": id})
}

// ── Handlers: dry-run ─────────────────────────────────────────────────────────

func (h *Handler) PostMaintenanceRulesDryRun(c *gin.Context) {
	globalMaintenanceRuleStore.ensureLoaded(h.authDirHint())
	rules := globalMaintenanceRuleStore.snapshot()
	enabledRules := make([]MaintenanceRule, 0, len(rules))
	for _, r := range rules {
		if r.Enabled {
			enabledRules = append(enabledRules, r)
		}
	}

	if h.authManager == nil {
		c.JSON(http.StatusOK, MaintenanceDryRunResponse{DryRunToken: "", Rules: 0})
		return
	}
	now := time.Now()
	healthResp := h.buildAccountHealth(now)
	healthByName := make(map[string]AccountHealthItem, len(healthResp.Items))
	for _, item := range healthResp.Items {
		healthByName[item.Name] = item
	}

	authsByName := make(map[string]*coreauth.Auth)
	for _, auth := range h.authManager.List() {
		if auth == nil {
			continue
		}
		authsByName[authDisplayName(auth)] = auth
	}

	matchedAccounts := make(map[string]struct{})
	actions := make([]MaintenanceDryRunActionItem, 0)
	for _, rule := range enabledRules {
		for name, item := range healthByName {
			auth := authsByName[name]
			if !inScope(rule.Scope, auth, item) {
				continue
			}
			facts := buildAccountFacts(auth, item, now)
			if !matchAllConditions(rule.Conditions, facts) {
				continue
			}
			matchedAccounts[name] = struct{}{}
			act := MaintenanceDryRunActionItem{
				ID:          fmt.Sprintf("act_%s_%s", shortHashOf(rule.ID+":"+name), shortHashOf(name)),
				RuleID:      rule.ID,
				Target:      name,
				Action:      rule.Action.Type,
				Risk:        actionRisk[rule.Action.Type],
				WouldChange: actionWouldChange(rule.Action.Type, auth, item),
				Reason:      summarizeMatch(rule.Conditions, facts),
			}
			if act.Risk == "" {
				act.Risk = "low"
			}
			actions = append(actions, act)
		}
	}

	token := newDryRunToken()
	globalDryRunCache.put(token, actions)

	resp := MaintenanceDryRunResponse{
		DryRunToken:     token,
		ComputedAt:      now.Unix(),
		ExpiresAt:       now.Add(dryRunTokenTTL).Unix(),
		Rules:           len(enabledRules),
		MatchedAccounts: len(matchedAccounts),
		Actions:         actions,
	}
	c.JSON(http.StatusOK, resp)
}

// ── Handlers: apply ───────────────────────────────────────────────────────────

func (h *Handler) PostMaintenanceRulesApply(c *gin.Context) {
	var req struct {
		DryRunToken string   `json:"dry_run_token"`
		ActionIDs   []string `json:"action_ids"`
		Confirmed   bool     `json:"confirmed"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body", "code": "invalid_body"})
		return
	}
	if strings.TrimSpace(req.DryRunToken) == "" || len(req.ActionIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dry_run_token and action_ids are required", "code": "missing_token_or_ids"})
		return
	}
	cached, ok := globalDryRunCache.get(req.DryRunToken)
	if !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "dry_run_token expired or unknown — please re-run dry-run", "code": "dry_run_token_invalid"})
		return
	}

	resp := MaintenanceApplyResponse{Status: "ok", Results: make([]MaintenanceApplyResultItem, 0, len(req.ActionIDs))}
	for _, actID := range req.ActionIDs {
		act, ok := cached.actionsByID[actID]
		if !ok {
			resp.Results = append(resp.Results, MaintenanceApplyResultItem{ID: actID, OK: false, Message: "action not in dry-run set"})
			resp.Failed++
			continue
		}
		if act.Risk == "high" && !req.Confirmed {
			resp.Results = append(resp.Results, MaintenanceApplyResultItem{ID: actID, Target: act.Target, Action: act.Action, OK: false, Skipped: true, Message: "high-risk action requires confirmed=true"})
			resp.Skipped++
			continue
		}
		ok, msg := h.dispatchMaintenanceAction(c, act)
		resp.Results = append(resp.Results, MaintenanceApplyResultItem{ID: actID, Target: act.Target, Action: act.Action, OK: ok, Message: msg})
		if ok {
			resp.Succeeded++
		} else {
			resp.Failed++
		}
	}
	resp.Total = len(req.ActionIDs)
	if resp.Failed > 0 && resp.Succeeded == 0 {
		resp.Status = "failed"
	} else if resp.Failed > 0 {
		resp.Status = "partial"
	}
	c.JSON(http.StatusOK, resp)
}

// dispatchMaintenanceAction executes a single dry-run action against the right
// handler. Internal calls go through synthesized gin contexts so we re-use the
// existing batch handlers (status-batch, fields-batch, repair-session-batch).
func (h *Handler) dispatchMaintenanceAction(parent *gin.Context, act MaintenanceDryRunActionItem) (bool, string) {
	switch act.Action {
	case "select":
		return true, "selected"
	case "warmup":
		return h.callInternal(parent, "POST", "/v0/management/auth-files/warmup",
			map[string]any{"names": []string{act.Target}}, h.PostWarmup)
	case "disable":
		return h.callInternal(parent, "POST", "/v0/management/auth-files/status-batch",
			map[string]any{"names": []string{act.Target}, "disabled": true}, h.PostStatusAuthFilesBatch)
	case "enable":
		return h.callInternal(parent, "POST", "/v0/management/auth-files/status-batch",
			map[string]any{"names": []string{act.Target}, "disabled": false}, h.PostStatusAuthFilesBatch)
	case "move_group":
		group, _ := act.actionParam("group", parent, h)
		if group == "" {
			return false, "missing group param"
		}
		return h.callInternal(parent, "POST", "/v0/management/auth-files/fields-batch",
			map[string]any{"names": []string{act.Target}, "set": map[string]any{"group": group}}, h.PostAuthFilesFieldsBatch)
	case "add_tag":
		tag, _ := act.actionParam("tag", parent, h)
		if tag == "" {
			return false, "missing tag param"
		}
		return h.callInternal(parent, "POST", "/v0/management/auth-files/fields-batch",
			map[string]any{"names": []string{act.Target}, "add_tags": []string{tag}}, h.PostAuthFilesFieldsBatch)
	case "lower_priority":
		return h.callInternal(parent, "POST", "/v0/management/auth-files/fields-batch",
			map[string]any{"names": []string{act.Target}, "set": map[string]any{"priority": -1}}, h.PostAuthFilesFieldsBatch)
	case "relogin":
		auth := h.findAuthByName(act.Target)
		if auth == nil {
			return false, "auth not found"
		}
		return h.callInternal(parent, "POST", "/v0/management/oauth/repair-session-batch",
			map[string]any{
				"provider": auth.Provider,
				"mode":     "replace",
				"targets":  []map[string]any{{"target_name": act.Target, "provider": auth.Provider}},
			},
			h.PostOAuthRepairSessionBatch)
	case "delete":
		return false, "v1: delete is not auto-applied; review manually"
	}
	return false, "unsupported action: " + act.Action
}

// actionParam fetches a value from the rule's action.params for this dry-run
// action. Looking up the original rule keeps params attached to the apply call
// even though the dry-run snapshot only stores per-target metadata.
func (item MaintenanceDryRunActionItem) actionParam(key string, _ *gin.Context, h *Handler) (string, bool) {
	globalMaintenanceRuleStore.mu.RLock()
	rule, ok := globalMaintenanceRuleStore.rules[item.RuleID]
	globalMaintenanceRuleStore.mu.RUnlock()
	if !ok || rule == nil {
		return "", false
	}
	if v, ok := rule.Action.Params[key]; ok {
		if s, ok := v.(string); ok {
			return s, true
		}
	}
	return "", false
}

func (h *Handler) callInternal(parent *gin.Context, method, path string, body any, handler gin.HandlerFunc) (bool, string) {
	bodyBytes, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, path, bytes.NewReader(bodyBytes))
	c.Request.Header.Set("Content-Type", "application/json")
	if parent != nil && parent.Request != nil {
		c.Request.Header.Set("Authorization", parent.Request.Header.Get("Authorization"))
	}
	handler(c)
	if rec.Code >= 200 && rec.Code < 400 {
		return true, "ok"
	}
	var errPayload struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &errPayload)
	if errPayload.Error == "" {
		errPayload.Error = http.StatusText(rec.Code)
	}
	return false, errPayload.Error
}

// ── Validation ────────────────────────────────────────────────────────────────

var allowedConditionFields = map[string]bool{
	"level": true, "score": true, "needs_relogin": true, "unavailable": true,
	"disabled": true, "failure_rate_24h": true, "requests_24h": true,
	"quota_primary_remaining": true, "quota_secondary_remaining": true,
	"last_success_age_hours": true, "provider": true, "group": true, "tag": true,
}

var allowedConditionOps = map[string]bool{
	"==": true, "!=": true, ">=": true, "<=": true, ">": true, "<": true,
	"in": true, "notin": true, "contains": true,
}

var allowedActionTypes = map[string]bool{
	"select": true, "warmup": true, "disable": true, "enable": true,
	"move_group": true, "add_tag": true, "lower_priority": true,
	"relogin": true, "delete": true,
}

func validateMaintenanceRule(r *MaintenanceRule) error {
	if r == nil {
		return errors.New("rule is required")
	}
	if strings.TrimSpace(r.ID) == "" {
		return errors.New("rule.id is required")
	}
	if !allowedActionTypes[r.Action.Type] {
		return fmt.Errorf("unsupported action type: %s", r.Action.Type)
	}
	for i, cond := range r.Conditions {
		if !allowedConditionFields[cond.Field] {
			return fmt.Errorf("conditions[%d]: unsupported field %s", i, cond.Field)
		}
		if !allowedConditionOps[cond.Op] {
			return fmt.Errorf("conditions[%d]: unsupported op %s", i, cond.Op)
		}
	}
	return nil
}

// ── Conditions evaluation ─────────────────────────────────────────────────────

type accountFacts struct {
	level                   string
	score                   int
	needsRelogin            bool
	unavailable             bool
	disabled                bool
	failureRate24h          float64
	requests24h             int64
	quotaPrimaryRemaining   *float64
	quotaSecondaryRemaining *float64
	lastSuccessAgeHours     *float64
	provider                string
	group                   string
	tags                    []string
}

func buildAccountFacts(auth *coreauth.Auth, item AccountHealthItem, now time.Time) accountFacts {
	facts := accountFacts{
		level:          item.Level,
		score:          item.Score,
		failureRate24h: item.RequestWindow.FailureRate24h,
		requests24h:    item.RequestWindow.Requests24h,
		provider:       item.Provider,
		group:          item.Group,
		tags:           item.Tags,
	}
	for _, r := range item.Reasons {
		switch r.Code {
		case "needs_relogin":
			facts.needsRelogin = true
		case "unavailable":
			facts.unavailable = true
		case "disabled":
			facts.disabled = true
		}
	}
	if auth != nil {
		facts.disabled = facts.disabled || auth.Disabled
	}
	if item.Quota != nil {
		facts.quotaPrimaryRemaining = item.Quota.PrimaryRemaining
		facts.quotaSecondaryRemaining = item.Quota.SecondaryRemaining
	}
	if item.LastRequestAt > 0 {
		hours := float64(now.Unix()-item.LastRequestAt) / 3600.0
		facts.lastSuccessAgeHours = &hours
	}
	return facts
}

func factValue(field string, f accountFacts) (any, bool) {
	switch field {
	case "level":
		return f.level, true
	case "score":
		return float64(f.score), true
	case "needs_relogin":
		return f.needsRelogin, true
	case "unavailable":
		return f.unavailable, true
	case "disabled":
		return f.disabled, true
	case "failure_rate_24h":
		return f.failureRate24h, true
	case "requests_24h":
		return float64(f.requests24h), true
	case "quota_primary_remaining":
		if f.quotaPrimaryRemaining == nil {
			return nil, false
		}
		return *f.quotaPrimaryRemaining, true
	case "quota_secondary_remaining":
		if f.quotaSecondaryRemaining == nil {
			return nil, false
		}
		return *f.quotaSecondaryRemaining, true
	case "last_success_age_hours":
		if f.lastSuccessAgeHours == nil {
			return nil, false
		}
		return *f.lastSuccessAgeHours, true
	case "provider":
		return f.provider, true
	case "group":
		return f.group, true
	case "tag":
		return f.tags, true
	}
	return nil, false
}

func matchAllConditions(conditions []MaintenanceCondition, f accountFacts) bool {
	for _, cond := range conditions {
		if !matchOne(cond, f) {
			return false
		}
	}
	return true
}

func matchOne(cond MaintenanceCondition, f accountFacts) bool {
	left, ok := factValue(cond.Field, f)
	if !ok {
		// Missing fact only matches !=, notin (i.e. "not present is OK").
		return cond.Op == "!=" || cond.Op == "notin"
	}
	right := cond.Value
	switch cond.Op {
	case "==":
		return equalAny(left, right)
	case "!=":
		return !equalAny(left, right)
	case ">=", "<=", ">", "<":
		ln, lok := numericAny(left)
		rn, rok := numericAny(right)
		if !lok || !rok {
			return false
		}
		switch cond.Op {
		case ">=":
			return ln >= rn
		case "<=":
			return ln <= rn
		case ">":
			return ln > rn
		case "<":
			return ln < rn
		}
	case "in":
		arr, ok := right.([]any)
		if !ok {
			return false
		}
		for _, v := range arr {
			if equalAny(left, v) {
				return true
			}
		}
		return false
	case "notin":
		arr, ok := right.([]any)
		if !ok {
			return true
		}
		for _, v := range arr {
			if equalAny(left, v) {
				return false
			}
		}
		return true
	case "contains":
		switch v := left.(type) {
		case []string:
			rs, ok := right.(string)
			if !ok {
				return false
			}
			for _, x := range v {
				if x == rs {
					return true
				}
			}
			return false
		case string:
			rs, ok := right.(string)
			if !ok {
				return false
			}
			return strings.Contains(v, rs)
		}
		return false
	}
	return false
}

func equalAny(a, b any) bool {
	if an, aok := numericAny(a); aok {
		if bn, bok := numericAny(b); bok {
			return an == bn
		}
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

func numericAny(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	}
	return 0, false
}

func inScope(scope MaintenanceScope, auth *coreauth.Auth, item AccountHealthItem) bool {
	if len(scope.Providers) > 0 && !contains(scope.Providers, item.Provider) {
		return false
	}
	if len(scope.Groups) > 0 && !contains(scope.Groups, item.Group) {
		return false
	}
	if len(scope.TagsAny) > 0 {
		hit := false
		for _, t := range scope.TagsAny {
			if contains(item.Tags, t) {
				hit = true
				break
			}
		}
		if !hit {
			return false
		}
	}
	_ = auth // reserved for future scope refinements
	return true
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func actionWouldChange(actionType string, auth *coreauth.Auth, item AccountHealthItem) bool {
	switch actionType {
	case "disable":
		return auth != nil && !auth.Disabled
	case "enable":
		return auth != nil && auth.Disabled
	case "select", "warmup", "relogin":
		return true
	case "delete":
		return false // never auto-changed in v1
	}
	return true
}

func summarizeMatch(conditions []MaintenanceCondition, _ accountFacts) string {
	if len(conditions) == 0 {
		return "matched (no conditions)"
	}
	parts := make([]string, 0, len(conditions))
	for _, c := range conditions {
		parts = append(parts, fmt.Sprintf("%s%s%v", c.Field, c.Op, c.Value))
	}
	return strings.Join(parts, " && ")
}

func shortHashOf(s string) string {
	const sep = "abcdef0123456789"
	hash := uint32(2166136261)
	for i := 0; i < len(s); i++ {
		hash ^= uint32(s[i])
		hash *= 16777619
	}
	out := make([]byte, 8)
	for i := 0; i < 8; i++ {
		out[i] = sep[hash%uint32(len(sep))]
		hash /= uint32(len(sep))
	}
	return string(out)
}
