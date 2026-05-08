package management

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.POST("/events-token", h.PostEventsToken)
		rg.GET("/events", h.GetEvents)
	})
}

const (
	defaultManagementEventCapacity = 1000
	defaultManagementEventTokenTTL = time.Minute
)

type managementEvent struct {
	ID      int64     `json:"id"`
	Type    string    `json:"type"`
	TS      int64     `json:"ts"`
	Source  string    `json:"source"`
	Payload any       `json:"payload"`
	created time.Time `json:"-"`
}

type eventToken struct {
	Value     string
	ExpiresAt time.Time
}

type managementEventBus struct {
	mu          sync.RWMutex
	nextID      int64
	capacity    int
	events      []managementEvent
	subscribers map[chan managementEvent]struct{}
	tokens      map[string]time.Time
}

func newManagementEventBus(capacity int) *managementEventBus {
	if capacity <= 0 {
		capacity = defaultManagementEventCapacity
	}
	return &managementEventBus{
		capacity:    capacity,
		subscribers: make(map[chan managementEvent]struct{}),
		tokens:      make(map[string]time.Time),
	}
}

var globalManagementEvents = newManagementEventBus(defaultManagementEventCapacity)

func (b *managementEventBus) publish(eventType string, payload any) managementEvent {
	if b == nil {
		return managementEvent{}
	}
	eventType = strings.TrimSpace(eventType)
	if eventType == "" {
		eventType = "system.event"
	}
	ev := managementEvent{
		Type:    eventType,
		TS:      time.Now().Unix(),
		Source:  "management",
		Payload: payload,
		created: time.Now(),
	}

	b.mu.Lock()
	b.nextID++
	ev.ID = b.nextID
	b.events = append(b.events, ev)
	if len(b.events) > b.capacity {
		copy(b.events, b.events[len(b.events)-b.capacity:])
		b.events = b.events[:b.capacity]
	}
	subscribers := make([]chan managementEvent, 0, len(b.subscribers))
	for ch := range b.subscribers {
		subscribers = append(subscribers, ch)
	}
	b.mu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- ev:
		default:
		}
	}
	return ev
}

func PublishManagementEvent(eventType string, payload any) managementEvent {
	return globalManagementEvents.publish(eventType, payload)
}

func (b *managementEventBus) replayAfter(lastID int64) ([]managementEvent, bool) {
	if b == nil {
		return nil, true
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if len(b.events) == 0 {
		return nil, true
	}
	oldest := b.events[0].ID
	if lastID > 0 && lastID < oldest-1 {
		return nil, false
	}
	out := make([]managementEvent, 0)
	for _, ev := range b.events {
		if ev.ID > lastID {
			out = append(out, ev)
		}
	}
	return out, true
}

func (b *managementEventBus) subscribe() chan managementEvent {
	ch := make(chan managementEvent, 64)
	b.mu.Lock()
	if b.subscribers == nil {
		b.subscribers = make(map[chan managementEvent]struct{})
	}
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *managementEventBus) unsubscribe(ch chan managementEvent) {
	if b == nil || ch == nil {
		return
	}
	b.mu.Lock()
	delete(b.subscribers, ch)
	close(ch)
	b.mu.Unlock()
}

func (b *managementEventBus) createToken(ttl time.Duration) string {
	if b == nil {
		return ""
	}
	if ttl <= 0 {
		ttl = defaultManagementEventTokenTTL
	}
	token := uuid.NewString()
	expires := time.Now().Add(ttl)
	b.mu.Lock()
	if b.tokens == nil {
		b.tokens = make(map[string]time.Time)
	}
	b.tokens[token] = expires
	now := time.Now()
	for existing, expiry := range b.tokens {
		if now.After(expiry) {
			delete(b.tokens, existing)
		}
	}
	b.mu.Unlock()
	return token
}

func (b *managementEventBus) validateToken(token string) bool {
	token = strings.TrimSpace(token)
	if b == nil || token == "" {
		return false
	}
	b.mu.Lock()
	expires, ok := b.tokens[token]
	if !ok {
		b.mu.Unlock()
		return false
	}
	if time.Now().After(expires) {
		delete(b.tokens, token)
		b.mu.Unlock()
		return false
	}
	b.mu.Unlock()
	return true
}

func validateManagementEventToken(token string) bool {
	return globalManagementEvents.validateToken(token)
}

func (h *Handler) PostEventsToken(c *gin.Context) {
	token := globalManagementEvents.createToken(defaultManagementEventTokenTTL)
	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_at": time.Now().Add(defaultManagementEventTokenTTL).Unix(),
	})
}

func (h *Handler) GetEvents(c *gin.Context) {
	lastID := int64(0)
	if header := strings.TrimSpace(c.GetHeader("Last-Event-ID")); header != "" {
		if parsed, err := strconv.ParseInt(header, 10, 64); err == nil && parsed > 0 {
			lastID = parsed
		}
	}
	if raw := strings.TrimSpace(c.Query("last_event_id")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			lastID = parsed
		}
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)

	writeEvent := func(ev managementEvent) bool {
		data, err := json.Marshal(ev)
		if err != nil {
			return true
		}
		_, err = fmt.Fprintf(c.Writer, "id: %d\nevent: %s\ndata: %s\n\n", ev.ID, ev.Type, data)
		if err != nil {
			return false
		}
		c.Writer.Flush()
		return true
	}

	replay, ok := globalManagementEvents.replayAfter(lastID)
	if !ok {
		writeEvent(managementEvent{ID: 0, Type: "system.resync_required", TS: time.Now().Unix(), Source: "management", Payload: gin.H{"reason": "event buffer no longer contains requested id"}})
		return
	}
	for _, ev := range replay {
		if !writeEvent(ev) {
			return
		}
	}

	ch := globalManagementEvents.subscribe()
	defer globalManagementEvents.unsubscribe(ch)
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case ev := <-ch:
			if !writeEvent(ev) {
				return
			}
		case <-ping.C:
			_, _ = fmt.Fprint(c.Writer, "event: ping\ndata: {}\n\n")
			c.Writer.Flush()
		}
	}
}
