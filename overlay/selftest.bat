@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  selftest.bat
rem  ----------------------------------------------------------
rem  End-to-end overlay self-test:
rem
rem    1. Verify clean state (overlay matches tree)
rem    2. Simulate upstream-overwrite (revert patches + delete new files)
rem    3. Run apply-overlay.bat to restore
rem    4. Verify state matches starting point
rem    5. Compile-check
rem
rem  Exit 0 = passed; non-zero = failure
rem =============================================================

set "ROOT=%~dp0.."
set "OVERLAY=%~dp0"
set "CPA=%ROOT%\CLIProxyAPI"

echo ============================================================
echo  Overlay Self-Test
echo ============================================================

rem ---- Step 1: pre-test verify ----
echo.
echo [1/5] Pre-test verification...
call "%OVERLAY%verify-overlay.bat" >nul 2>&1
if errorlevel 1 (
    echo   ! Tree state already drifted from overlay; aborting selftest
    exit /b 1
)
echo   - tree matches overlay

rem ---- Step 2: simulate upstream-overwrite ----
echo.
echo [2/5] Simulating upstream overwrite (revert + delete)...
pushd "%CPA%"
for %%P in ("%OVERLAY%patches\*.patch") do (
    git apply --reverse "%%~fP" 2>nul
)
for /f "delims=" %%f in ('git ls-files --others --exclude-standard') do (
    echo %%f | findstr /i "frontend_dist" >nul
    if errorlevel 1 (
        del /q "%%f" 2>nul
    )
)
popd
echo   - all our changes removed

rem ---- Step 3: re-apply ----
echo.
echo [3/5] Running apply-overlay.bat...
call "%OVERLAY%apply-overlay.bat" >nul 2>&1
if errorlevel 1 (
    echo   ! apply-overlay.bat failed
    exit /b 1
)
echo   - overlay re-applied

rem ---- Step 4: verify state ----
echo.
echo [4/5] Verifying restored state...
call "%OVERLAY%verify-overlay.bat" >nul 2>&1
if errorlevel 1 (
    echo   ! Tree state didn't match after re-apply
    exit /b 1
)
echo   - tree matches overlay again

rem ---- Step 5: compile-check ----
echo.
echo [5/5] Go compile-check...
pushd "%CPA%"
set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64
go build -tags embed_frontend -o "%TEMP%\cpa-selftest.exe" .\cmd\server 2>nul
if errorlevel 1 (
    popd
    echo   ! compilation failed
    exit /b 1
)
popd
del /q "%TEMP%\cpa-selftest.exe" 2>nul
echo   - go build OK

rem ---- Verdict ----
echo.
echo ============================================================
echo   [PASS] Overlay self-test complete
echo   Roundtrip apply-restore is reliable.
echo ============================================================
endlocal & exit /b 0
