"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, ".tmp", "cloud-relay-bootstrap.ps1");
const embeddedFiles = [
  ["scripts/mt-relay-client.js", "mt-relay-client.js"],
  ["extensions/mb-relay/manifest.json", "extension/manifest.json"],
  ["extensions/mb-relay/background.js", "extension/background.js"],
  ["extensions/mb-relay/bridge.js", "extension/bridge.js"],
  ["extensions/mb-relay/relay.js", "extension/relay.js"],
  ["extensions/mb-relay/atg-bridge.js", "extension/atg-bridge.js"],
  ["extensions/mb-relay/atg-relay.js", "extension/atg-relay.js"],
  ["extensions/mb-relay/setup.html", "extension/setup.html"],
];

function psSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const writes = embeddedFiles.map(([source, destination]) => {
  const data = fs.readFileSync(path.join(root, source)).toString("base64");
  return `Write-EmbeddedFile ${psSingleQuoted(destination)} ${psSingleQuoted(data)}`;
}).join("\n");

const script = String.raw`$ErrorActionPreference = "Stop"
$relayRoot = "C:\BLACKDOMAIN\relay"
$extensionRoot = Join-Path $relayRoot "extension"
$logRoot = "C:\BLACKDOMAIN\logs"
New-Item -ItemType Directory -Force -Path $relayRoot, $extensionRoot, $logRoot | Out-Null

function Write-EmbeddedFile {
  param([string]$RelativePath, [string]$Base64)
  $target = Join-Path $relayRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($Base64))
}

${writes}

@'
{
  "name": "blackdomain-cloud-relay",
  "private": true,
  "version": "1.0.0",
  "dependencies": { "ws": "^8.18.2" }
}
'@ | Set-Content -LiteralPath (Join-Path $relayRoot "package.json") -Encoding UTF8

$nodeVersion = "24.18.1"
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $msi = Join-Path $env:TEMP "node-v$nodeVersion-x64.msi"
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi" -OutFile $msi
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $msi, "/qn", "/norestart") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Node.js installation failed with exit code $($process.ExitCode)." }
  Remove-Item -LiteralPath $msi -Force -ErrorAction SilentlyContinue
}

$npm = "C:\Program Files\nodejs\npm.cmd"
Push-Location $relayRoot
try {
  & $npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$runner = Join-Path $relayRoot "start-cloud-relay.ps1"
@'
$ErrorActionPreference = "Continue"
$env:MT_PERSIST_CONFIG = "true"
$env:MT_CONFIG_PATH = "C:\BLACKDOMAIN\config\mt-relay.json"
New-Item -ItemType Directory -Force -Path "C:\BLACKDOMAIN\logs" | Out-Null
while ($true) {
  & "C:\Program Files\nodejs\node.exe" "C:\BLACKDOMAIN\relay\mt-relay-client.js" *>> "C:\BLACKDOMAIN\logs\mt-relay.log"
  Start-Sleep -Seconds 5
}
'@ | Set-Content -LiteralPath $runner -Encoding UTF8

$relayArgument = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '"'
$relayAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $relayArgument
$relayTrigger = New-ScheduledTaskTrigger -AtStartup
$relayPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$relaySettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "BLACKDOMAIN MT Relay" -Action $relayAction -Trigger $relayTrigger -Principal $relayPrincipal -Settings $relaySettings -Force | Out-Null

$edgePolicy = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
New-Item -Path $edgePolicy -Force | Out-Null
New-ItemProperty -Path $edgePolicy -Name "HideFirstRunExperience" -PropertyType DWord -Value 1 -Force | Out-Null
New-ItemProperty -Path $edgePolicy -Name "DefaultBrowserSettingEnabled" -PropertyType DWord -Value 0 -Force | Out-Null

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$edgeArgs = '--no-first-run --load-extension="' + $extensionRoot + '" https://sn058.3a1788.bet/game?type=live https://mbracing.cc/'
$edgeAction = New-ScheduledTaskAction -Execute $edge -Argument $edgeArgs
$edgeTrigger = New-ScheduledTaskTrigger -AtLogOn -User "zhouyang9812"
$edgePrincipal = New-ScheduledTaskPrincipal -UserId "zhouyang9812" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "BLACKDOMAIN 3A Browser" -Action $edgeAction -Trigger $edgeTrigger -Principal $edgePrincipal -Force | Out-Null

$shell = New-Object -ComObject WScript.Shell
$publicDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
$shortcut = $shell.CreateShortcut((Join-Path $publicDesktop "BLACKDOMAIN 3A Relay.lnk"))
$shortcut.TargetPath = $edge
$shortcut.Arguments = $edgeArgs
$shortcut.WorkingDirectory = $relayRoot
$shortcut.Save()

$statusShortcut = $shell.CreateShortcut((Join-Path $publicDesktop "BLACKDOMAIN MT Status.lnk"))
$statusShortcut.TargetPath = $edge
$statusShortcut.Arguments = "--no-first-run http://127.0.0.1:43128"
$statusShortcut.Save()

Start-ScheduledTask -TaskName "BLACKDOMAIN MT Relay"
"$(Get-Date -Format o) bootstrap complete" | Set-Content -LiteralPath (Join-Path $logRoot "bootstrap-complete.txt") -Encoding UTF8
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, script, "utf8");
console.log(outputPath);
