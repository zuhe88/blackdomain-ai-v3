$ErrorActionPreference = "Stop"
Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
$relayPort = if ($env:MT_RELAY_PORT) { [int]$env:MT_RELAY_PORT } else { 43128 }
$backgroundPort = if ($env:MT_HEADLESS_PORT) { [int]$env:MT_HEADLESS_PORT } else { 43129 }

try {
  $existing = Invoke-RestMethod "http://127.0.0.1:$backgroundPort/status" -TimeoutSec 2
  if ($existing.mode -eq "headless") {
    Write-Host "MT background browser is already running. Status: http://127.0.0.1:$backgroundPort/status"
    exit 0
  }
} catch { }

$relayReady = $false
try {
  $null = Invoke-RestMethod "http://127.0.0.1:$relayPort/status" -TimeoutSec 2
  $relayReady = $true
} catch { }
if (-not $relayReady) {
  if ($relayPort -ne 43128) { throw "Start the local relay on the configured MT_RELAY_PORT first." }
  $relayLauncher = Join-Path $PSScriptRoot "start-mt-relay.ps1"
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoProfile", "-File", "`"$relayLauncher`"")
  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Seconds 1
    try {
      $null = Invoke-RestMethod "http://127.0.0.1:$relayPort/status" -TimeoutSec 2
      $relayReady = $true
      break
    } catch { }
  }
}
if (-not $relayReady) { throw "Local relay is unavailable. Configure MT in http://127.0.0.1:43128/ first." }
Write-Host "Starting MT background browser. Keep this terminal open; Ctrl+C stops the background browser."
& node (Join-Path $PSScriptRoot "mt-headless-client.js")
exit $LASTEXITCODE
