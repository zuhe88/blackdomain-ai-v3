param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$taskName = "BLACKDOMAIN ATG Background Relay"
$projectRoot = Split-Path -Parent $PSScriptRoot
$relayScript = Join-Path $PSScriptRoot "atg-background-relay.js"
$configDirectory = Join-Path $env:LOCALAPPDATA "BLACKDOMAIN"
$configPath = Join-Path $configDirectory "atg-relay-secrets.json"

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "ATG background relay startup task removed."
  exit 0
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$platformUrl = Read-Host "3A platform URL [https://sn058.3a1788.bet]"
if (-not $platformUrl) { $platformUrl = "https://sn058.3a1788.bet" }
$usernamePlain = Read-Host "3A username"
$passwordSecure = Read-Host "3A password" -AsSecureString
$relayKeySecure = Read-Host "Railway ATG_RELAY_KEY" -AsSecureString
$deviceId = Read-Host "Browser device_id (optional)"
$relayUrl = Read-Host "Railway URL [https://blackdomain-ai-v3-production.up.railway.app]"
if (-not $relayUrl) { $relayUrl = "https://blackdomain-ai-v3-production.up.railway.app" }

if (-not $usernamePlain) { throw "3A username is required." }
if ($passwordSecure.Length -eq 0) { throw "3A password is required." }
if ($relayKeySecure.Length -eq 0) { throw "ATG_RELAY_KEY is required." }

$usernameSecure = ConvertTo-SecureString $usernamePlain -AsPlainText -Force
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
[ordered]@{
  platformUrl = $platformUrl.TrimEnd("/")
  username = ConvertFrom-SecureString $usernameSecure
  password = ConvertFrom-SecureString $passwordSecure
  relayKey = ConvertFrom-SecureString $relayKeySecure
  deviceId = $deviceId.Trim()
  relayUrl = $relayUrl.TrimEnd("/")
} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $configPath

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument "`"$relayScript`"" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Keeps BLACKDOMAIN ATG results synchronized without an open Chrome window." `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "ATG background relay installed and started."
Write-Host "Encrypted settings: $configPath"
Write-Host "Log: $(Join-Path $configDirectory 'atg-relay.log')"
