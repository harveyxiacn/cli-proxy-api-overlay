# Pre-upgrade Removal Detector
# ----------------------------------------------------------
# Compares current HEAD vs origin/main and reports:
#   - Routes that upstream is REMOVING (or renaming) in server.go
#   - Exported handler functions removed in management/
#   - Cross-references with our frontend and overlay to flag breakage
#
# Run BEFORE overlay\update-cpa.bat to decide what to preserve.
# Read-only; does not modify anything.
#
# Usage:
#   overlay\detect-removed.bat                 # default: HEAD..origin/main
#   overlay\detect-removed.bat -Range "A..B"   # custom range (testing/audit)
#
# Exit codes:
#   0 = scan complete (regardless of findings)
#   1 = git fetch failed
#   2 = configuration error (CPA dir missing)

param(
    [string]$Range = ''
)

$ErrorActionPreference = 'Continue'
$scriptDir = $PSScriptRoot
$root = Split-Path -Parent $scriptDir
$cpa = Join-Path $root 'CLIProxyAPI'
$frontendSrc = Join-Path $root 'frontend\src'

if (-not (Test-Path (Join-Path $cpa '.git'))) {
    Write-Host "[error] $cpa is not a git repo" -ForegroundColor Red
    exit 2
}

function Write-Section($title) {
    Write-Host ""
    Write-Host $title
    Write-Host ('-' * [Math]::Min($title.Length, 60))
}

Write-Host "============================================================"
Write-Host " Pre-upgrade Removal Detection"
Write-Host " Compares HEAD vs origin/main; flags removals that would"
Write-Host " break our overlay or frontend if pulled blindly."
Write-Host "============================================================"

Push-Location $cpa
try {
    if ($Range) {
        Write-Section "[1/4] Using explicit range: $Range"
        $diffRange = $Range
    } else {
        Write-Section "[1/4] Fetching origin/main"
        git fetch origin main 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ! git fetch failed" -ForegroundColor Red
            exit 1
        }

        $aheadRaw = git rev-list 'HEAD..origin/main' --count 2>$null
        $ahead = if ($aheadRaw) { ($aheadRaw | Out-String).Trim() } else { '0' }
        if ($ahead -eq '0') {
            Write-Host "  - origin/main is at or behind HEAD; nothing to pull"
            Write-Host ""
            Write-Host "============================================================"
            Write-Host "  [INFO] No upcoming changes to analyse."
            Write-Host "============================================================"
            exit 0
        }
        Write-Host "  - $ahead upstream commit(s) ahead"
        $diffRange = 'HEAD..origin/main'
    }

    # ---- Routes removed from server.go ----
    Write-Section "[2/4] Routes being removed/renamed in server.go"
    $serverDiff = git diff $diffRange -- 'internal/api/server.go' 2>$null
    $removedRouteLines = @()
    if ($serverDiff) {
        $removedRouteLines = $serverDiff | Where-Object {
            $_ -match '^-' -and $_ -notmatch '^---' -and $_ -match '\bmgmt\.'
        }
    }
    if ($removedRouteLines.Count -gt 0) {
        foreach ($l in $removedRouteLines) {
            Write-Host ("  X " + $l.Substring(1).Trim()) -ForegroundColor Yellow
        }
    } else {
        Write-Host "  (none)"
    }

    # ---- Exported functions removed from management/ ----
    Write-Section "[3/4] Exported handler functions removed/renamed"
    $mgmtDiff = git diff $diffRange -- 'internal/api/handlers/management/' 2>$null
    $removedFuncLines = @()
    if ($mgmtDiff) {
        $removedFuncLines = $mgmtDiff | Where-Object {
            $_ -match '^-func\s+(\([^)]+\)\s+)?[A-Z]'
        }
    }
    if ($removedFuncLines.Count -gt 0) {
        foreach ($l in $removedFuncLines) {
            Write-Host ("  X " + $l.Substring(1).Trim()) -ForegroundColor Yellow
        }
    } else {
        Write-Host "  (none)"
    }

    # ---- Cross-reference with our overlay + frontend ----
    Write-Section "[4/4] Cross-reference: do we depend on these?"

    # Extract paths like "/v0/management/foo" or "/foo" from removed route lines
    $removedPaths = @()
    foreach ($l in $removedRouteLines) {
        if ($l -match '"(/[^"]+)"') {
            $removedPaths += $matches[1]
        }
    }
    $removedPaths = $removedPaths | Sort-Object -Unique

    # Extract function names from removed func lines
    $removedFuncNames = @()
    foreach ($l in $removedFuncLines) {
        if ($l -match '\)\s+([A-Z][A-Za-z0-9_]*)\s*\(') {
            $removedFuncNames += $matches[1]
        } elseif ($l -match '^-func\s+([A-Z][A-Za-z0-9_]*)\s*\(') {
            $removedFuncNames += $matches[1]
        }
    }
    $removedFuncNames = $removedFuncNames | Sort-Object -Unique

    if ($removedPaths.Count -eq 0 -and $removedFuncNames.Count -eq 0) {
        Write-Host "  (nothing to cross-reference)"
    } else {
        # Check frontend usage of each removed path
        if (Test-Path $frontendSrc) {
            foreach ($p in $removedPaths) {
                # boundary-aware match so `/usage` doesn't hit `/usage-daily`
                $boundedPattern = "(?<![A-Za-z0-9_\-])" + [regex]::Escape($p) + "(?![A-Za-z0-9_\-])"
                $hits = Get-ChildItem -Path $frontendSrc -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx -ErrorAction SilentlyContinue |
                        Select-String -Pattern $boundedPattern -ErrorAction SilentlyContinue
                if ($hits) {
                    Write-Host ("  ! FRONTEND uses route '$p' ($($hits.Count) refs)") -ForegroundColor Red
                    foreach ($h in ($hits | Select-Object -First 3)) {
                        $rel = $h.Path.Replace($root + '\', '')
                        Write-Host ("      ${rel}:$($h.LineNumber)") -ForegroundColor DarkGray
                    }
                } else {
                    Write-Host ("  ok route '$p' not referenced by frontend")
                }
            }
        }

        # Check overlay patches/files for function references
        $overlayPatches = Join-Path $scriptDir 'patches'
        $overlayFiles = Join-Path $scriptDir 'files'
        foreach ($fn in $removedFuncNames) {
            $hits = @()
            if (Test-Path $overlayPatches) {
                $hits += Get-ChildItem -Path $overlayPatches -File -ErrorAction SilentlyContinue |
                        Select-String -Pattern "\b$fn\b" -ErrorAction SilentlyContinue
            }
            if (Test-Path $overlayFiles) {
                $hits += Get-ChildItem -Path $overlayFiles -Recurse -File -ErrorAction SilentlyContinue |
                        Select-String -Pattern "\b$fn\b" -ErrorAction SilentlyContinue
            }
            if ($hits.Count -gt 0) {
                Write-Host ("  ! OVERLAY uses func '$fn' ($($hits.Count) refs)") -ForegroundColor Red
                foreach ($h in ($hits | Select-Object -First 3)) {
                    $rel = $h.Path.Replace($root + '\', '')
                    Write-Host ("      ${rel}:$($h.LineNumber)") -ForegroundColor DarkGray
                }
            } else {
                Write-Host ("  ok func '$fn' not used by overlay")
            }
        }
    }

    Write-Host ""
    Write-Host "============================================================"
    Write-Host " Decisions:"
    Write-Host "   ok  lines: safe to ignore (upstream removal won't break us)"
    Write-Host "   !   lines: WILL break after upgrade. Choose per-item:"
    Write-Host "       a) Preserve handler verbatim in overlay/files/<file>.go"
    Write-Host "          (rename func to avoid future collision)"
    Write-Host "       b) Re-implement using SDK primitives in extension"
    Write-Host "       c) Migrate frontend to call the replacement endpoint"
    Write-Host ""
    Write-Host " Note: a -func/-mgmt line followed soon by a +func/+mgmt with"
    Write-Host " similar name is a RENAME, not a deletion. Confirm with:"
    Write-Host "   cd CLIProxyAPI; git diff HEAD..origin/main"
    Write-Host "============================================================"
} finally {
    Pop-Location
}
