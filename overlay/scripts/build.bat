@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  build.bat  —  full build (frontend + Go binary, Windows)
rem
rem  Run from anywhere; this script jumps to project root by
rem  walking up two levels from its own location.
rem =============================================================

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%..\.."
pushd "%ROOT%" || ( echo failed to cd into project root & exit /b 1 )

echo ============================================
echo  CPA Full Build (Frontend + Go Binary)
echo  project root: %CD%
echo ============================================

echo.
echo [1/4] Installing frontend dependencies...
pushd frontend
call pnpm install
if errorlevel 1 ( popd & popd & echo FAILED: pnpm install & exit /b 1 )

echo.
echo [2/4] Building React frontend...
call pnpm run build
if errorlevel 1 ( popd & popd & echo FAILED: pnpm build & exit /b 1 )
popd

echo.
echo [3/4] Copying frontend dist to Go embed directory...
if exist "CLIProxyAPI\internal\api\frontend_dist" (
    rmdir /s /q "CLIProxyAPI\internal\api\frontend_dist"
)
xcopy /e /i /y /q "frontend\dist" "CLIProxyAPI\internal\api\frontend_dist" >nul
if errorlevel 1 ( popd & echo FAILED: xcopy & exit /b 1 )

echo.
echo [4/4] Building Go binary with embedded frontend...
pushd CLIProxyAPI
set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64

rem Inject build identity (main.Version etc.) so /system/status reports a real version
for /f %%v in ('git -C . describe --tags --always 2^>nul') do set "VER=%%v"
if "%VER%"=="" set "VER=dev"
for /f %%c in ('git -C . rev-parse --short HEAD 2^>nul') do set "CMT=%%c"
if "%CMT%"=="" set "CMT=none"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-ddTHH:mm:ssZ"') do set "BD=%%d"

go build -tags embed_frontend -ldflags="-s -w -X main.Version=!VER!-overlay -X main.Commit=!CMT! -X main.BuildDate=!BD!" -o "..\cli-proxy-api-new.exe" .\cmd\server\
if errorlevel 1 ( popd & popd & echo FAILED: go build & exit /b 1 )
popd

echo.
echo ============================================
echo  Build complete: cli-proxy-api-new.exe
echo  Version: !VER!-overlay (!CMT!)
echo  Management UI: http://127.0.0.1:8317/cpa-management
echo ============================================
popd
endlocal
