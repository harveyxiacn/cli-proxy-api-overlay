@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  update-cpa.bat
rem  ----------------------------------------------------------
rem  Orchestrates the full CPA upstream upgrade workflow:
rem
rem    1. Stash our local changes (safety net)
rem    2. Pull upstream
rem    3. Apply overlay
rem    4. Verify consistency
rem    5. Run focused tests
rem    6. Build the binary
rem    7. Drop the stash if everything succeeded
rem
rem  Aborts on any failure to leave the user in a recoverable state.
rem =============================================================

set "ROOT=%~dp0.."
set "OVERLAY=%~dp0"
set "CPA=%ROOT%\CLIProxyAPI"

echo ============================================================
echo  CPA Upstream Upgrade Workflow
echo ============================================================

rem ---- Step 1: Stash ----
echo.
echo [1/7] git stash (safety snapshot)...
pushd "%CPA%"
git stash push --include-untracked -m "pre-update-cpa snapshot" 2>nul
if errorlevel 1 (
    echo   - nothing to stash (or stash failed)
)
popd

rem ---- Step 2: Pull upstream ----
echo.
echo [2/7] git pull origin main...
pushd "%CPA%"
git pull origin main
if errorlevel 1 (
    echo.
    echo   ! git pull failed. Aborting. Restore via:
    echo     cd CLIProxyAPI ^&^& git stash pop
    popd
    exit /b 1
)
popd
echo   - upstream synced

rem ---- Step 3: Apply overlay ----
echo.
echo [3/7] Re-applying overlay onto fresh upstream...
call "%OVERLAY%apply-overlay.bat"
if errorlevel 1 (
    echo.
    echo   ! Some patches failed. Likely upstream changed near our edits.
    echo   Recover by:
    echo     1. Inspect failures: cd CLIProxyAPI ^&^& git status
    echo     2. Manually merge the conflicting hunks.
    echo     3. Run: overlay\refresh-overlay.bat (regenerate overlay).
    exit /b 1
)

rem ---- Step 4: Verify ----
echo.
echo [4/7] Verifying overlay consistency...
call "%OVERLAY%verify-overlay.bat"
if errorlevel 1 exit /b 1

rem ---- Step 5: Run focused tests ----
echo.
echo [5/7] Running focused Go tests...
pushd "%CPA%"
go test ./internal/api/handlers/management -count=1 -timeout 90s
if errorlevel 1 (
    popd
    echo.
    echo   ! Management tests failed after upgrade. Investigate above.
    exit /b 1
)
popd
echo   - go test ./internal/api/handlers/management : PASS

rem ---- Step 6: Build binary ----
echo.
echo [6/7] Building binary with embedded frontend...
if not exist "%ROOT%\frontend\dist" (
    echo   - frontend/dist not found, skipping pnpm build
) else (
    rem refresh embed first
    if exist "%CPA%\internal\api\frontend_dist" rmdir /s /q "%CPA%\internal\api\frontend_dist"
    xcopy /e /i /y /q "%ROOT%\frontend\dist" "%CPA%\internal\api\frontend_dist" >nul
)
pushd "%CPA%"
set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64
go build -tags embed_frontend -ldflags="-s -w" -o "%ROOT%\cli-proxy-api-new.exe" ./cmd/server
if errorlevel 1 (
    popd
    echo.
    echo   ! Go build failed. Source likely needs updating for upstream changes.
    exit /b 1
)
popd
echo   - cli-proxy-api-new.exe built

rem ---- Step 7: Drop stash ----
echo.
echo [7/7] Dropping safety stash...
pushd "%CPA%"
git stash drop 2>nul
popd
echo   - stash dropped

rem ---- Verdict ----
echo.
echo ============================================================
echo  [SUCCESS] CPA upgraded cleanly. New binary built.
echo  Restart server: cli-proxy-api-new.exe -config config.yaml
echo ============================================================
endlocal & exit /b 0
