@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  apply-overlay.bat
rem  ----------------------------------------------------------
rem  After `git pull` of the upstream CPA repo, run this script
rem  to re-apply our extension files and patches.
rem
rem  Workflow:
rem    1. cd CLIProxyAPI && git pull origin main
rem    2. cd ..
rem    3. overlay\apply-overlay.bat
rem    4. build.bat
rem =============================================================

set "ROOT=%~dp0.."
set "OVERLAY=%~dp0"
set "CPA=%ROOT%\CLIProxyAPI"

if not exist "%CPA%" (
    echo ERROR: CPA directory not found at %CPA%
    exit /b 1
)

echo ============================================================
echo  Applying overlay onto CPA tree
echo ============================================================
echo.

rem ---- Step 1: copy new files (mirroring tree) ----
echo [1/3] Copying %~n0 new files...
xcopy /e /i /y /q "%OVERLAY%files\*" "%CPA%\" >nul
if errorlevel 1 (
    echo   ! xcopy failed
    exit /b 1
)
echo   - new files copied to %CPA%\

rem ---- Step 2: apply patches ----
echo.
echo [2/3] Applying patches...
set FAIL=0
pushd "%CPA%"
for %%P in ("%OVERLAY%patches\*.patch") do (
    git apply --check "%%~fP" 2>nul
    if errorlevel 1 (
        echo   ! check failed:    %%~nxP
        set FAIL=1
    ) else (
        git apply "%%~fP"
        if errorlevel 1 (
            echo   ! apply failed:    %%~nxP
            set FAIL=1
        ) else (
            echo   + applied %%~nxP
        )
    )
)
popd

if %FAIL%==1 (
    echo.
    echo ! Some patches failed. The upstream may have changed near our edits.
    echo   Inspect failures with:   cd CLIProxyAPI ^&^& git status
    echo   Manual merge may be required for those files.
    exit /b 1
)

rem ---- Step 3: refresh frontend embed dist ----
echo.
echo [3/3] Refreshing frontend_dist embed...
if exist "%ROOT%\frontend\dist" (
    if exist "%CPA%\internal\api\frontend_dist" rmdir /s /q "%CPA%\internal\api\frontend_dist"
    xcopy /e /i /y /q "%ROOT%\frontend\dist" "%CPA%\internal\api\frontend_dist" >nul
    echo   - copied frontend\dist -^> internal\api\frontend_dist
) else (
    echo   - frontend\dist not found, run "cd frontend && pnpm run build" first
)

echo.
echo ============================================================
echo  Overlay applied successfully.
echo  Now run:   build.bat   to rebuild the binary
echo ============================================================
endlocal
