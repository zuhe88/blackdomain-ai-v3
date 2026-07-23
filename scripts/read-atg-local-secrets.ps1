$ErrorActionPreference = "Stop"

$configPath = Join-Path $env:LOCALAPPDATA "BLACKDOMAIN\atg-relay-secrets.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "ATG background relay is not configured."
}

$encrypted = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json

function Unprotect-Value([string]$value) {
  $secure = ConvertTo-SecureString $value
  return [System.Net.NetworkCredential]::new("", $secure).Password
}

[ordered]@{
  platformUrl = [string]$encrypted.platformUrl
  username = Unprotect-Value ([string]$encrypted.username)
  password = Unprotect-Value ([string]$encrypted.password)
  relayKey = Unprotect-Value ([string]$encrypted.relayKey)
  deviceId = [string]$encrypted.deviceId
  relayUrl = [string]$encrypted.relayUrl
} | ConvertTo-Json -Compress
