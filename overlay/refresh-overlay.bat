@echo off
setlocal enabledelayedexpansion

rem =============================================================
rem  refresh-overlay.bat
rem  ----------------------------------------------------------
rem  Re-snapshot the current state of CPA tree (relative to its
rem  last commit) into overlay/. Run this whenever you make new
rem  changes to CPA tree that you want to preserve.
rem
rem  Effect:
rem    - overlay/files/         re-populated from `git ls-files --others`
rem    - overlay/patches/       regenerated from `git diff`
rem =============================================================

set "ROOT=%~dp0.."
set "OVERLAY=%~dp0"
set "CPA=%ROOT%\CLIProxyAPI"

if not exist "%CPA%\.git" (
    echo ERROR: %CPA% is not a git repo
    exit /b 1
)

echo ============================================================
echo  Refreshing overlay from current CPA tree state
echo ============================================================

rem ---- Clean overlay ----
if exist "%OVERLAY%files" rmdir /s /q "%OVERLAY%files"
if exist "%OVERLAY%patches" rmdir /s /q "%OVERLAY%patches"
mkdir "%OVERLAY%files" 2>nul
mkdir "%OVERLAY%patches" 2>nul

rem ---- Snapshot new (untracked) files ----
echo.
echo [1/2] Capturing new files...
pushd "%CPA%"
for /f "delims=" %%f in ('git ls-files --others --exclude-standard') do (
    set "rel=%%f"
    rem skip frontend_dist (it's a build artifact) and Windows reserved NUL entries
    if /i not "!rel!"=="NUL" (
        echo !rel! | findstr /i "frontend_dist" >nul
        if errorlevel 1 (
            set "src=!rel:/=\!"
            set "dst=%OVERLAY%files\!src!"
            rem use xcopy /i which auto-creates intermediate dirs and handles single-file copy
            for %%D in ("!dst!") do set "dstDir=%%~dpD"
            if not exist "!dstDir!" mkdir "!dstDir!" 2>nul
            xcopy /y /q "!src!" "!dstDir!" >nul 2>&1
            if errorlevel 1 (
                echo   ! FAILED: !rel!
            ) else (
                echo   + !rel!
            )
        )
    )
)
popd

rem ---- Generate patches for modified files ----
echo.
echo [2/2] Generating patches for modified files...
pushd "%CPA%"
rem use `git diff HEAD --` to force unified diff format even after a 3-way merge
rem (plain `git diff` on a merged file emits `diff --cc` which git apply rejects)
for /f "delims=" %%f in ('git diff HEAD --name-only') do (
    set "rel=%%f"
    set "patchName=!rel:/=__!"
    set "patchName=!patchName:.go=.go.patch!"
    rem redirect stderr to NUL to keep patch clean (no git warnings)
    git diff HEAD -- "%%f" 2>nul > "%OVERLAY%patches\!patchName!"
    echo   + !patchName!
)
popd

echo.
echo ============================================================
echo  Overlay refreshed. Commit overlay\ to preserve.
echo ============================================================
endlocal
