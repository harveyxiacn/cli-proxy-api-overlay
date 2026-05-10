package management

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	usageDataDirName           = "data"
	requestHistoryFileName     = "request_history.jsonl"
	tokenStatsSnapshotFileName = "token_stats.json"
)

type requestHistoryPersistence struct {
	mu   sync.Mutex
	path string
}

var globalRequestHistoryPersistence requestHistoryPersistence

func (h *Handler) configureUsagePersistence() {
	if h == nil || strings.TrimSpace(h.configFilePath) == "" {
		return
	}
	baseDir := filepath.Dir(h.configFilePath)
	dataDir := filepath.Join(baseDir, usageDataDirName)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return
	}
	_ = configureRequestHistoryPersistence(filepath.Join(dataDir, requestHistoryFileName))
	_ = configureTokenStatsPersistence(filepath.Join(dataDir, tokenStatsSnapshotFileName))
	configureDailyHistoryPersistence(filepath.Join(dataDir, tokenStatsDailyHistoryFileName))
	configureAuditLogPersistence(filepath.Join(dataDir, auditLogFileName))
	LoadOverlayConfig(h.configFilePath)
}

func configureRequestHistoryPersistence(path string) error {
	path = strings.TrimSpace(path)
	globalRequestHistoryPersistence.mu.Lock()
	globalRequestHistoryPersistence.path = path
	globalRequestHistoryPersistence.mu.Unlock()
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	globalRequestLogBuf.reset()
	return loadRequestHistoryFile(path, globalRequestLogBuf)
}

func appendRequestHistoryPersisted(rec *RequestRecord) {
	globalRequestHistoryPersistence.mu.Lock()
	path := globalRequestHistoryPersistence.path
	globalRequestHistoryPersistence.mu.Unlock()
	if path == "" || rec == nil {
		return
	}
	_ = appendRequestHistoryRecord(path, rec)
}

func clearRequestHistoryPersistence() {
	globalRequestHistoryPersistence.mu.Lock()
	path := globalRequestHistoryPersistence.path
	globalRequestHistoryPersistence.mu.Unlock()
	if path == "" {
		return
	}
	_ = clearRequestHistoryFile(path)
}

func appendRequestHistoryRecord(path string, rec *RequestRecord) error {
	if strings.TrimSpace(path) == "" || rec == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	enc := json.NewEncoder(f)
	return enc.Encode(rec)
}

func loadRequestHistoryFile(path string, buf *requestRingBuffer) error {
	if strings.TrimSpace(path) == "" || buf == nil {
		return nil
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	loaded := make([]*RequestRecord, 0, requestLogCapacity)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var rec RequestRecord
		if errDecode := json.Unmarshal([]byte(line), &rec); errDecode != nil {
			return fmt.Errorf("decode request history line: %w", errDecode)
		}
		loaded = append(loaded, &rec)
		if len(loaded) > requestLogCapacity {
			copy(loaded, loaded[len(loaded)-requestLogCapacity:])
			loaded = loaded[:requestLogCapacity]
		}
	}
	if errScan := scanner.Err(); errScan != nil {
		return errScan
	}
	for _, rec := range loaded {
		buf.push(rec)
	}
	return nil
}

func clearRequestHistoryFile(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, nil, 0o600)
}

type tokenStatsPersistence struct {
	mu   sync.Mutex
	path string
}

var globalTokenStatsPersistence tokenStatsPersistence

type tokenStatsSnapshot struct {
	Version   int                       `json:"version"`
	StartedAt int64                     `json:"started_at"`
	Entries   []tokenStatsEntrySnapshot `json:"entries"`
	Totals    tokenStatsTotalsSnapshot  `json:"totals"`
	Today     tokenStatsTodaySnapshot   `json:"today"`
}

type tokenStatsEntrySnapshot struct {
	Key             string  `json:"key"`
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

type tokenStatsTotalsSnapshot struct {
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
	Requests        int64   `json:"requests"`
	FailedRequests  int64   `json:"failed_requests"`
}

type tokenStatsTodaySnapshot struct {
	Date            string  `json:"date"`
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	CachedTokens    int64   `json:"cached_tokens"`
	ReasoningTokens int64   `json:"reasoning_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	EstimatedUSD    float64 `json:"estimated_usd"`
	Requests        int64   `json:"requests"`
	FailedRequests  int64   `json:"failed_requests"`
}

func configureTokenStatsPersistence(path string) error {
	path = strings.TrimSpace(path)
	globalTokenStatsPersistence.mu.Lock()
	globalTokenStatsPersistence.path = path
	globalTokenStatsPersistence.mu.Unlock()
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	snap, ok, err := loadTokenStatsSnapshot(path)
	if err != nil || !ok {
		return err
	}
	globalTokenStats.restore(snap)
	return nil
}

func persistTokenStatsSnapshot(p *tokenStatsPlugin) {
	globalTokenStatsPersistence.mu.Lock()
	path := globalTokenStatsPersistence.path
	globalTokenStatsPersistence.mu.Unlock()
	if path == "" || p == nil {
		return
	}
	_ = saveTokenStatsSnapshot(path, p.snapshot())
}

func clearTokenStatsPersistence() {
	globalTokenStatsPersistence.mu.Lock()
	path := globalTokenStatsPersistence.path
	globalTokenStatsPersistence.mu.Unlock()
	if path == "" {
		return
	}
	_ = os.Remove(path)
}

func saveTokenStatsSnapshot(path string, snap tokenStatsSnapshot) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func loadTokenStatsSnapshot(path string) (tokenStatsSnapshot, bool, error) {
	var snap tokenStatsSnapshot
	if strings.TrimSpace(path) == "" {
		return snap, false, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return snap, false, nil
	}
	if err != nil {
		return snap, false, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return snap, false, nil
	}
	if err := json.Unmarshal(data, &snap); err != nil {
		return snap, false, err
	}
	return snap, true, nil
}

func unixOrNow(ts int64) time.Time {
	if ts <= 0 {
		return time.Now()
	}
	return time.Unix(ts, 0)
}
