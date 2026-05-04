@echo off
:: Fix It In Prompt — Windows Installer
:: Double-click to run. Will prompt for administrator access automatically.

setlocal EnableDelayedExpansion

:: ── Self-elevate to admin if needed ──────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator access...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "SCRIPT_DIR=%~dp0"
set "HELPER_SRC=%SCRIPT_DIR%helper"
set "HELPER_DEST=%APPDATA%\AEImageGen\helper"
set "CEP_USER_DEST=%APPDATA%\Adobe\CEP\extensions\PremImageGen"

echo.
echo Fix It In Prompt -- Installer
echo ------------------------------
echo.

:: ── Check Node.js ─────────────────────────────────────────────────────────────
echo Checking for Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo Node.js not found.
    echo.
    echo Please install Node.js first, then run this installer again:
    echo https://nodejs.org  ^(download the LTS version^)
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo Found Node.js: %NODE_VER%

:: ── Install helper ────────────────────────────────────────────────────────────
echo.
echo Installing helper service...
if not exist "%HELPER_DEST%" mkdir "%HELPER_DEST%"
xcopy /E /I /Y "%HELPER_SRC%\*" "%HELPER_DEST%\" >nul

echo Installing dependencies (this may take a minute)...
cd /d "%HELPER_DEST%"
call npm install --production --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. Make sure you have an internet connection.
    pause
    exit /b 1
)
echo Done - dependencies installed.

:: ── Ensure launch-hidden.vbs exists ──────────────────────────────────────────
if not exist "%HELPER_DEST%\launch-hidden.vbs" (
    (
        echo Set WshShell = CreateObject("WScript.Shell"^)
        echo WshShell.Run "cmd /c node """ ^& WScript.Arguments(0^) ^& """ >> """ ^& WScript.Arguments(1^) ^& """ 2>&1", 0, False
    ) > "%HELPER_DEST%\launch-hidden.vbs"
)

:: ── Install CEP extension — user level ───────────────────────────────────────
echo.
echo Installing Premiere Pro extension...
if not exist "%CEP_USER_DEST%" mkdir "%CEP_USER_DEST%"
xcopy /E /I /Y "%SCRIPT_DIR%cep\*" "%CEP_USER_DEST%\" >nul
echo Done - extension installed (user^).

:: ── Install CEP extension — Premiere Pro program folder ──────────────────────
set "CEP_PP_DEST="
for /d %%D in ("C:\Program Files\Adobe\Adobe Premiere Pro*") do (
    if exist "%%D\CEP\extensions" (
        set "CEP_PP_DEST=%%D\CEP\extensions\PremImageGen"
    )
)

if defined CEP_PP_DEST (
    if not exist "%CEP_PP_DEST%" mkdir "%CEP_PP_DEST%"
    xcopy /E /I /Y "%SCRIPT_DIR%cep\*" "%CEP_PP_DEST%\" >nul
    echo Done - extension installed ^(Premiere Pro program folder^).
) else (
    echo Premiere Pro program folder not found -- user-level install is sufficient.
)

:: ── Enable unsigned extensions ────────────────────────────────────────────────
echo.
echo Enabling extension in Premiere Pro...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo Done - extension enabled.

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo ------------------------------
echo Installation complete!
echo.
echo Next steps:
echo   1. Restart Premiere Pro
echo   2. Open: Window ^> Extensions ^> Fix It In Prompt
echo   3. In the Settings tab, paste your fal.ai API key
echo.
pause
