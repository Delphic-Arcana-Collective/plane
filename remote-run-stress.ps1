$ErrorActionPreference = "Stop"
$env:OPENSSL_CONF = ""

$RepoRoot = if ($env:PLANE_ROOT) { $env:PLANE_ROOT } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $RepoRoot

$env:ROUNDS = if ($env:ROUNDS) { $env:ROUNDS } else { "100" }
$env:WEB_URL = if ($env:WEB_URL) { $env:WEB_URL } else { "http://localhost:3000" }
$env:CHROME_PATH = if ($env:CHROME_PATH) { $env:CHROME_PATH } else { "C:\Program Files\Google\Chrome\Application\chrome.exe" }
$env:CLICK_DELAY_MS = if ($env:CLICK_DELAY_MS) { $env:CLICK_DELAY_MS } else { "0" }

$logDir = Join-Path $RepoRoot "stress-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$webLog = Join-Path $logDir "web-$stamp.log"
$stressLog = Join-Path $logDir "stress-$stamp.log"

# Start web dev if port 3000 is not listening
$port3000 = netstat -ano | Select-String ":3000\s"
if (-not $port3000) {
  Write-Host "[runner] starting web dev..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "set OPENSSL_CONF=&& cd /d $RepoRoot && pnpm --filter=web dev > `"$webLog`" 2>&1" -WindowStyle Hidden
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "http://localhost:3000/delphic/" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
} else {
  Write-Host "[runner] web already on :3000"
}

Write-Host "[runner] ROUNDS=$env:ROUNDS -> $stressLog"
pnpm --filter=bff test:navigation-stress 2>&1 | Tee-Object -FilePath $stressLog
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }
Write-Host "[runner] done"
