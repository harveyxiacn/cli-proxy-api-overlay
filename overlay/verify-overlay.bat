@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  verify-overlay.bat
rem  ----------------------------------------------------------
rem  Reports whether the current CPA tree matches what overlay
rem  expects. Doesn't modify anything (read-only check).
rem
rem  Exit codes:
rem    0 = consistent (overlay matches tree)
rem    1 = drift detected (run refresh-overlay.bat or apply-overlay.bat)
rem    2 = configuration error (CPA dir missing, etc.)
rem =============================================================

set "ROOT=%~dp0.."
set "OVERLAY=%~dp0"
set "CPA=%ROOT%\CLIProxyAPI"

if not exist "%CPA%\.git" (
    echo [error] %CPA% is not a git repo
    exit /b 2
)

echo ============================================================
echo  Overlay Consistency Check
echo ============================================================

rem ---- Check 1: each file in overlay/files/ exists in CPA tree ----
echo.
echo [1] Files in overlay/files/ vs CPA tree...
set MISSING=0
set DIFFERS=0
pushd "%OVERLAY%files"
for /f "delims=" %%f in ('dir /s /b /a-d 2^>nul') do (
    set "abs=%%f"
    set "rel=!abs:%OVERLAY%files\=!"
    set "cpaPath=%CPA%\!rel!"
    if not exist "!cpaPath!" (
        echo   ! MISSING in CPA: !rel!
        set /a MISSING+=1
    ) else (
        fc /b "!abs!" "!cpaPath!" >nul 2>&1
        if errorlevel 1 (
            echo   ~ DIFFERS: !rel!
            set /a DIFFERS+=1
        )
    )
)
popd
if "%MISSING%"=="0" if "%DIFFERS%"=="0" echo   - all files present and identical

rem ---- Check 2: each patch can be reverse-applied ----
echo.
echo [2] Patches reverse-apply check (would they revert cleanly?)...
set PATCH_FAIL=0
pushd "%CPA%"
for %%P in ("%OVERLAY%patches\*.patch") do (
    git apply --check --reverse "%%~fP" >nul 2>&1
    if errorlevel 1 (
        echo   ! CANNOT REVERSE: %%~nxP
        set /a PATCH_FAIL+=1
    )
)
popd
if "%PATCH_FAIL%"=="0" echo   - all patches can be reverse-applied cleanly

rem ---- Check 3: no untracked files outside overlay/files/ ----
echo.
echo [3] CPA untracked files vs overlay snapshot...
set EXTRA=0
pushd "%CPA%"
for /f "delims=" %%f in ('git ls-files --others --exclude-standard') do (
    set "rel=%%f"
    if /i not "!rel!"=="NUL" (
        echo !rel! | findstr /i "frontend_dist" >nul
        if errorlevel 1 (
            set "rel=!rel:/=\!"
            if not exist "%OVERLAY%files\!rel!" (
                echo   + EXTRA in CPA, not in overlay: %%f
                set /a EXTRA+=1
            )
        )
    )
)
popd
if "%EXTRA%"=="0" echo   - no extra files outside overlay snapshot

rem ---- Verdict ----
echo.
echo ============================================================
set TOTAL=0
set /a TOTAL=%MISSING%+%DIFFERS%+%PATCH_FAIL%+%EXTRA%
if %TOTAL%==0 (
    echo   [PASS] Overlay matches CPA tree perfectly
    endlocal & exit /b 0
) else (
    echo   [DRIFT] %TOTAL% inconsistencies:
    echo     - missing in CPA: %MISSING%
    echo     - file content differs: %DIFFERS%
    echo     - patches won't reverse: %PATCH_FAIL%
    echo     - extra untracked in CPA: %EXTRA%
    echo.
    echo   Hint: run "refresh-overlay.bat" to capture current state,
    echo         or "apply-overlay.bat" to restore overlay state.
    endlocal & exit /b 1
)
