package management

// capacity_forecast.go — overlay §8 Capacity Forecast.
//
// Predicts how many days the codex pool can sustain current burn at the
// secondary (7-day) window granularity. AE = Account-Equivalent. 1 AE is one
// account's full secondary capacity in a 7-day window. We never sum across
// windows of different sizes; primary (5h) is reported separately as a
// pressure metric only.

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	RegisterExtensionRoute(func(rg *gin.RouterGroup, h *Handler) {
		rg.GET("/capacity-forecast", h.GetCapacityForecast)
	})
}

type CapacityGroupRow struct {
	Group                  string  `json:"group"`
	Accounts               int     `json:"accounts"`
	RemainingAE            float64 `json:"remaining_ae"`
	BurnRateAEPerDay       float64 `json:"burn_rate_ae_per_day"`
	EstimatedDaysRemaining float64 `json:"estimated_days_remaining"`
	PoolRisk               string  `json:"pool_risk"`
}

type CapacityForecastSummary struct {
	AvailableAccounts            int     `json:"available_accounts"`
	SecondaryCapacityRemainingAE float64 `json:"secondary_capacity_remaining_ae"`
	BurnRateAEPerDay             float64 `json:"burn_rate_ae_per_day"`
	EstimatedDaysRemaining       float64 `json:"estimated_days_remaining"`
	PrimaryPressurePct           float64 `json:"primary_pressure_pct"`
	PoolRisk                     string  `json:"pool_risk"`
}

type CapacityForecastResponse struct {
	Range          string                  `json:"range"`
	Summary        CapacityForecastSummary `json:"summary"`
	Groups         []CapacityGroupRow      `json:"groups"`
	Recommendations []string               `json:"recommendations,omitempty"`
}

func classifyPoolRisk(days float64, hasData bool) string {
	if !hasData {
		return "unknown"
	}
	switch {
	case days >= 7:
		return "green"
	case days >= 2:
		return "amber"
	default:
		return "red"
	}
}

func (h *Handler) GetCapacityForecast(c *gin.Context) {
	rangeRaw := strings.ToLower(strings.TrimSpace(c.Query("range")))
	if rangeRaw == "" {
		rangeRaw = "24h"
	}
	wantedGroup := strings.TrimSpace(c.Query("group"))

	// Build per-account quota snapshot view, filtered to "available" accounts.
	type acctRow struct {
		group                string
		secondaryRemainingAE float64
		primaryUsedPct       float64
		hasSecondary         bool
		hasPrimary           bool
	}
	rows := make([]acctRow, 0)

	if h != nil && h.authManager != nil {
		for _, auth := range h.authManager.List() {
			if auth == nil {
				continue
			}
			if auth.Disabled || auth.Unavailable || authNeedsRelogin(auth) {
				continue
			}
			snap, ok := loadCodexQuotaSnapshotFor(auth.ID)
			if !ok {
				continue
			}
			r := acctRow{group: authGroup(auth)}
			if r.group == "" {
				r.group = "ungrouped"
			}
			if snap.SecondaryWindow != nil {
				r.hasSecondary = true
				r.secondaryRemainingAE = snap.SecondaryWindow.RemainingPercent / 100.0
			}
			if snap.PrimaryWindow != nil {
				r.hasPrimary = true
				r.primaryUsedPct = snap.PrimaryWindow.UsedPercent
			}
			rows = append(rows, r)
		}
	}

	// Burn rate uses average secondary used% across all accounts that have a
	// secondary window. burn_per_day = avg_used_pct / window_days.
	// Window for secondary is 7 days unless the snapshot says otherwise.
	const secondaryWindowDays = 7.0
	totalSecondaryUsedAE := 0.0
	totalSecondaryRemainingAE := 0.0
	primaryPressureSum := 0.0
	primaryPressureCount := 0
	availableAccounts := 0
	for _, r := range rows {
		if wantedGroup != "" && !strings.EqualFold(r.group, wantedGroup) {
			continue
		}
		availableAccounts++
		if r.hasSecondary {
			totalSecondaryRemainingAE += r.secondaryRemainingAE
			totalSecondaryUsedAE += 1.0 - r.secondaryRemainingAE
		}
		if r.hasPrimary {
			primaryPressureSum += r.primaryUsedPct
			primaryPressureCount++
		}
	}
	burnRateAEPerDay := 0.0
	if availableAccounts > 0 {
		burnRateAEPerDay = totalSecondaryUsedAE / secondaryWindowDays
	}
	estimatedDays := 0.0
	hasData := totalSecondaryRemainingAE > 0 && burnRateAEPerDay > 0
	if hasData {
		estimatedDays = totalSecondaryRemainingAE / burnRateAEPerDay
	}
	primaryPressure := 0.0
	if primaryPressureCount > 0 {
		primaryPressure = primaryPressureSum / float64(primaryPressureCount)
	}
	risk := classifyPoolRisk(estimatedDays, hasData)

	// Per-group breakdown.
	groupAgg := make(map[string]*CapacityGroupRow)
	for _, r := range rows {
		if wantedGroup != "" && !strings.EqualFold(r.group, wantedGroup) {
			continue
		}
		row := groupAgg[r.group]
		if row == nil {
			row = &CapacityGroupRow{Group: r.group}
			groupAgg[r.group] = row
		}
		row.Accounts++
		if r.hasSecondary {
			row.RemainingAE += r.secondaryRemainingAE
		}
	}
	groups := make([]CapacityGroupRow, 0, len(groupAgg))
	for _, row := range groupAgg {
		used := float64(row.Accounts) - row.RemainingAE
		row.BurnRateAEPerDay = used / secondaryWindowDays
		hasD := row.RemainingAE > 0 && row.BurnRateAEPerDay > 0
		if hasD {
			row.EstimatedDaysRemaining = row.RemainingAE / row.BurnRateAEPerDay
		}
		row.PoolRisk = classifyPoolRisk(row.EstimatedDaysRemaining, hasD)
		row.RemainingAE = roundTo(row.RemainingAE, 2)
		row.BurnRateAEPerDay = roundTo(row.BurnRateAEPerDay, 2)
		row.EstimatedDaysRemaining = roundTo(row.EstimatedDaysRemaining, 1)
		groups = append(groups, *row)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Group < groups[j].Group })

	resp := CapacityForecastResponse{
		Range: rangeRaw,
		Summary: CapacityForecastSummary{
			AvailableAccounts:            availableAccounts,
			SecondaryCapacityRemainingAE: roundTo(totalSecondaryRemainingAE, 2),
			BurnRateAEPerDay:             roundTo(burnRateAEPerDay, 2),
			EstimatedDaysRemaining:       roundTo(estimatedDays, 1),
			PrimaryPressurePct:           roundTo(primaryPressure, 1),
			PoolRisk:                     risk,
		},
		Groups: groups,
	}
	resp.Recommendations = recommendCapacity(resp.Summary)
	_ = time.Now
	c.JSON(http.StatusOK, resp)
}

func recommendCapacity(s CapacityForecastSummary) []string {
	out := make([]string, 0, 2)
	switch s.PoolRisk {
	case "green":
		out = append(out, "容量充足，无需补账号。")
	case "amber":
		out = append(out, "容量偏紧，建议本周内补充账号或降低消耗。")
	case "red":
		out = append(out, "容量危急，建议立即补充账号或暂停非关键工作。")
	case "unknown":
		out = append(out, "无足够 quota 缓存数据。请先运行一次 /codex-quota 拉取，或检查 auth 池状态。")
	}
	if s.PrimaryPressurePct >= 70 {
		out = append(out, "5h primary 窗口压力高（>70%），短窗口可能在峰值时拒绝请求。")
	}
	return out
}

func roundTo(v float64, decimals int) float64 {
	mul := 1.0
	for i := 0; i < decimals; i++ {
		mul *= 10
	}
	return float64(int(v*mul+0.5)) / mul
}
