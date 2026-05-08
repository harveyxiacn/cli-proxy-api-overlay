package management

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/oauth/repair-session",
			auditingHandler("oauth.repair_session", "auth", nil, h.PostOAuthRepairSession))
		rg.POST("/oauth/repair-session-batch",
			auditingHandler("oauth.repair_session_batch", "auth", nil, h.PostOAuthRepairSessionBatch))
		rg.GET("/oauth/sessions/:id", h.GetOAuthRepairSession)
		rg.POST("/oauth/sessions/:id/warmup",
			auditingHandlerParam("oauth.session_warmup", "oauth_session", "id", h.PostOAuthRepairSessionWarmup))
		rg.POST("/oauth/sessions/:id/cancel",
			auditingHandlerParam("oauth.session_cancel", "oauth_session", "id", h.PostOAuthRepairSessionCancel))
	})
}

const oauthRepairSessionTTL = 10 * time.Minute

type OAuthRepairSession struct {
	SessionID  string `json:"session_id"`
	Provider   string `json:"provider"`
	TargetName string `json:"target_name"`
	Mode       string `json:"mode"`
	Status     string `json:"status"`
	AuthURL    string `json:"auth_url"`
	Error      string `json:"error,omitempty"`
	CreatedAt  int64  `json:"created_at"`
	ExpiresAt  int64  `json:"expires_at"`
	UpdatedAt  int64  `json:"updated_at"`
}

type oauthRepairSessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*OAuthRepairSession
}

var globalOAuthRepairSessions = &oauthRepairSessionStore{sessions: make(map[string]*OAuthRepairSession)}

func oauthRepairAuthPath(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "codex":
		return "/v0/management/codex-auth-url?is_webui=1"
	case "anthropic", "claude":
		return "/v0/management/anthropic-auth-url"
	case "gemini", "gemini-cli":
		return "/v0/management/gemini-cli-auth-url"
	case "antigravity":
		return "/v0/management/antigravity-auth-url"
	case "kimi":
		return "/v0/management/kimi-auth-url"
	default:
		return ""
	}
}

func (s *oauthRepairSessionStore) put(session *OAuthRepairSession) {
	if s == nil || session == nil || session.SessionID == "" {
		return
	}
	s.mu.Lock()
	if s.sessions == nil {
		s.sessions = make(map[string]*OAuthRepairSession)
	}
	now := time.Now().Unix()
	for id, existing := range s.sessions {
		if existing != nil && existing.ExpiresAt > 0 && existing.ExpiresAt < now {
			delete(s.sessions, id)
		}
	}
	clone := *session
	s.sessions[session.SessionID] = &clone
	s.mu.Unlock()
}

func (s *oauthRepairSessionStore) get(id string) (*OAuthRepairSession, bool) {
	id = strings.TrimSpace(id)
	if s == nil || id == "" {
		return nil, false
	}
	s.mu.RLock()
	session, ok := s.sessions[id]
	s.mu.RUnlock()
	if !ok || session == nil {
		return nil, false
	}
	if session.ExpiresAt > 0 && session.ExpiresAt < time.Now().Unix() {
		return nil, false
	}
	clone := *session
	return &clone, true
}

func (s *oauthRepairSessionStore) update(id string, update func(*OAuthRepairSession)) (*OAuthRepairSession, bool) {
	id = strings.TrimSpace(id)
	if s == nil || id == "" {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[id]
	if !ok || session == nil {
		return nil, false
	}
	if session.ExpiresAt > 0 && session.ExpiresAt < time.Now().Unix() {
		delete(s.sessions, id)
		return nil, false
	}
	update(session)
	session.UpdatedAt = time.Now().Unix()
	clone := *session
	return &clone, true
}

func (h *Handler) PostOAuthRepairSession(c *gin.Context) {
	var req struct {
		Provider   string `json:"provider"`
		TargetName string `json:"target_name"`
		Mode       string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	targetName := strings.TrimSpace(req.TargetName)
	mode := strings.TrimSpace(req.Mode)
	if mode == "" {
		mode = "replace"
	}
	authPath := oauthRepairAuthPath(provider)
	if authPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}
	if targetName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_name is required"})
		return
	}
	now := time.Now()
	id := uuid.NewString()
	authURL := authPath + "&repair_session=" + id
	if !strings.Contains(authPath, "?") {
		authURL = authPath + "?repair_session=" + id
	}
	session := &OAuthRepairSession{
		SessionID:  id,
		Provider:   provider,
		TargetName: targetName,
		Mode:       mode,
		Status:     "pending",
		AuthURL:    authURL,
		CreatedAt:  now.Unix(),
		UpdatedAt:  now.Unix(),
		ExpiresAt:  now.Add(oauthRepairSessionTTL).Unix(),
	}
	globalOAuthRepairSessions.put(session)
	PublishManagementEvent("oauth.session_created", session)
	c.JSON(http.StatusOK, session)
}

func (h *Handler) GetOAuthRepairSession(c *gin.Context) {
	session, ok := globalOAuthRepairSessions.get(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *Handler) PostOAuthRepairSessionWarmup(c *gin.Context) {
	session, ok := globalOAuthRepairSessions.update(c.Param("id"), func(s *OAuthRepairSession) {
		s.Status = "warmup_completed"
	})
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	PublishManagementEvent("oauth.warmup_completed", session)
	c.JSON(http.StatusOK, session)
}

type oauthRepairBatchTarget struct {
	Provider   string `json:"provider"`
	TargetName string `json:"target_name"`
	Mode       string `json:"mode,omitempty"`
}

type oauthRepairBatchSlot struct {
	TargetName string              `json:"target_name"`
	Provider   string              `json:"provider"`
	Session    *OAuthRepairSession `json:"session,omitempty"`
	Error      string              `json:"error,omitempty"`
}

// PostOAuthRepairSessionBatch creates multiple OAuth repair sessions in one call.
// Each target gets its own session_id and auth_url; failures on individual
// targets do not abort the batch. The frontend drives them sequentially.
func (h *Handler) PostOAuthRepairSessionBatch(c *gin.Context) {
	var req struct {
		Provider string                   `json:"provider,omitempty"`
		Mode     string                   `json:"mode,omitempty"`
		Targets  []oauthRepairBatchTarget `json:"targets"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if len(req.Targets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "targets is required"})
		return
	}
	if len(req.Targets) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "too many targets (max 200)"})
		return
	}
	defaultProvider := strings.ToLower(strings.TrimSpace(req.Provider))
	defaultMode := strings.TrimSpace(req.Mode)
	if defaultMode == "" {
		defaultMode = "replace"
	}

	now := time.Now()
	results := make([]oauthRepairBatchSlot, 0, len(req.Targets))
	successCount := 0
	for _, t := range req.Targets {
		provider := strings.ToLower(strings.TrimSpace(t.Provider))
		if provider == "" {
			provider = defaultProvider
		}
		targetName := strings.TrimSpace(t.TargetName)
		mode := strings.TrimSpace(t.Mode)
		if mode == "" {
			mode = defaultMode
		}
		slot := oauthRepairBatchSlot{TargetName: targetName, Provider: provider}
		authPath := oauthRepairAuthPath(provider)
		if authPath == "" {
			slot.Error = "unsupported provider"
			results = append(results, slot)
			continue
		}
		if targetName == "" {
			slot.Error = "target_name is required"
			results = append(results, slot)
			continue
		}
		id := uuid.NewString()
		authURL := authPath + "&repair_session=" + id
		if !strings.Contains(authPath, "?") {
			authURL = authPath + "?repair_session=" + id
		}
		session := &OAuthRepairSession{
			SessionID:  id,
			Provider:   provider,
			TargetName: targetName,
			Mode:       mode,
			Status:     "pending",
			AuthURL:    authURL,
			CreatedAt:  now.Unix(),
			UpdatedAt:  now.Unix(),
			ExpiresAt:  now.Add(oauthRepairSessionTTL).Unix(),
		}
		globalOAuthRepairSessions.put(session)
		PublishManagementEvent("oauth.session_created", session)
		clone := *session
		slot.Session = &clone
		results = append(results, slot)
		successCount++
	}
	PublishManagementEvent("oauth.batch_created", map[string]any{
		"total":     len(req.Targets),
		"succeeded": successCount,
		"failed":    len(req.Targets) - successCount,
	})
	c.JSON(http.StatusOK, gin.H{
		"sessions":  results,
		"total":     len(req.Targets),
		"succeeded": successCount,
		"failed":    len(req.Targets) - successCount,
	})
}

func (h *Handler) PostOAuthRepairSessionCancel(c *gin.Context) {
	session, ok := globalOAuthRepairSessions.update(c.Param("id"), func(s *OAuthRepairSession) {
		s.Status = "cancelled"
	})
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	PublishManagementEvent("oauth.cancelled", session)
	c.JSON(http.StatusOK, session)
}
