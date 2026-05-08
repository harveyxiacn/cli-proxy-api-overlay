@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  build-dev.bat  —  fast Go-only build (no frontend embed)
rem
rem  For when you're iterating on the Go layer and the frontend
rem  is being served separately by `pnpm dev` on :5173.
rem =============================================================

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%..\.."
pushd "%ROOT%" || ( echo failed to cd into project root & exit /b 1 )

echo Building Go binary (no frontend embed)...
pushd CLIProxyAPI
set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64
go build -o "..\cli-proxy-api-new.exe" .\cmd\server\
if errorlevel 1 ( popd & popd & echo Build FAILED & exit /b 1 )
popd
echo Build complete: cli-proxy-api-new.exe
echo Frontend: cd frontend ^&^& pnpm dev  (serves on :5173)
echo Management UI direct (built-in if there's an old frontend_dist): http://127.0.0.1:8317/cpa-management
popd
endlocal
