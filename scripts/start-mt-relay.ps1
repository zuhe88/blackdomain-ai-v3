$ErrorActionPreference = "Stop"

$relayRoot = Join-Path $env:LOCALAPPDATA "BLACKDOMAIN"
$relayConfigPath = Join-Path $relayRoot "mt-relay.json"
$relayScriptPath = Join-Path $PSScriptRoot "mt-relay-client.js"

$existingRelay = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 43128 -State Listen -ErrorAction SilentlyContinue
if ($existingRelay) {
  exit 0
}

function ConvertFrom-ProtectedString {
  param([Parameter(Mandatory = $true)][string]$Value)

  $secureValue = ConvertTo-SecureString -String $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

while ($true) {
  try {
    if (-not (Test-Path -LiteralPath $relayConfigPath)) {
      throw "MT relay configuration is missing."
    }

    $relayConfig = Get-Content -Raw -LiteralPath $relayConfigPath | ConvertFrom-Json
    $env:MT_TOKEN = ConvertFrom-ProtectedString -Value $relayConfig.token
    $env:MT_RELAY_KEY = ConvertFrom-ProtectedString -Value $relayConfig.relayKey
    & node $relayScriptPath
  } catch {
    Write-Error $_ -ErrorAction Continue
  } finally {
    Remove-Item Env:MT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:MT_RELAY_KEY -ErrorAction SilentlyContinue
  }

  Start-Sleep -Seconds 5
}
