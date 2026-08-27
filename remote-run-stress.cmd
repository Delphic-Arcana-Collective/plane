@echo off
setlocal EnableDelayedExpansion
set OPENSSL_CONF=
cd /d "%~dp0"

if not defined ROUNDS set ROUNDS=100
if not defined WEB_URL set WEB_URL=http://127.0.0.1:3000
if not defined CHROME_PATH set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
if not defined CLICK_DELAY_MS set CLICK_DELAY_MS=0

if not exist stress-logs mkdir stress-logs

curl -sf -o NUL "%WEB_URL%/delphic/" >nul 2>&1
if errorlevel 1 (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8799" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
  timeout /t 2 /nobreak >nul
  echo [runner] starting web dev...
  start "plane-web" /B cmd /c "set OPENSSL_CONF=&& cd /d %~dp0&& pnpm --filter=web dev > stress-logs\web-dev.log 2>&1"
  echo [runner] waiting for web...
  set WAIT_TRIES=0
  :waitweb
  set /a WAIT_TRIES+=1
  if !WAIT_TRIES! GTR 120 (
    echo [runner] web timeout after 4 min, see stress-logs\web-dev.log
    exit /b 1
  )
  curl -sf -o NUL "%WEB_URL%/delphic/" >nul 2>&1
  if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto waitweb
  )
) else (
  echo [runner] web already up on :3000
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8799" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
)

echo [runner] ROUNDS=%ROUNDS% CLICK_DELAY_MS=%CLICK_DELAY_MS%
call pnpm --filter=bff test:navigation-stress
set EXITCODE=%ERRORLEVEL%
echo [runner] exit %EXITCODE%
exit /b %EXITCODE%
