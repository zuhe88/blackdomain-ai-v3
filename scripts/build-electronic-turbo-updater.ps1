$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $repo 'extensions\electronic-turbo\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = ([Version]$manifest.version).ToString()
$release = Join-Path $repo 'public\portal\turbo'
$archive = Join-Path $release "blackdomain-electronic-turbo-$version.zip"
if (!(Test-Path -LiteralPath $archive)) {
    Compress-Archive -Path (Join-Path $repo 'extensions\electronic-turbo\*') -DestinationPath $archive
}
$sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'electronic-turbo-updater.ps1') -Raw -Encoding UTF8
$source = $source.Replace('@VERSION@', $version).Replace('@SHA256@', $sha256)
$launcher = @'
@echo off
setlocal DisableDelayedExpansion
set "BLACKDOMAIN_TURBO_LAUNCHER=%~f0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -STA -Command "$source=[IO.File]::ReadAllText($env:BLACKDOMAIN_TURBO_LAUNCHER);$marker='### BLACKDOMAIN'+' POWERSHELL ###';$index=$source.IndexOf($marker,[StringComparison]::Ordinal);if($index -lt 0){throw 'Invalid updater'};& ([ScriptBlock]::Create($source.Substring($index+$marker.Length)))"
set "BLACKDOMAIN_TURBO_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BLACKDOMAIN_TURBO_EXIT%
### BLACKDOMAIN POWERSHELL ###
'@
$content = ($launcher + "`n" + $source) -replace '\r?\n', "`r`n"
$output = Join-Path $release "blackdomain-electronic-turbo-update-$version.cmd"
[IO.File]::WriteAllText($output, $content, [Text.UTF8Encoding]::new($false))
Write-Output $output

# Publish the entry badge and download links from the same manifest as the ZIP.
$installPath = Join-Path $release 'install.html'
$guide = [IO.File]::ReadAllText($installPath)
$old = [regex]::Match($guide, 'blackdomain-electronic-turbo-([\d.]+)\.zip').Groups[1].Value
if (!$old) { throw 'Missing extension ZIP link in the portal install guide.' }
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($installPath, $guide.Replace($old, $version), $utf8)
$badge = @"
@charset "UTF-8";
:root { --turbo-release-label: "新版 $version 可下載"; }
:root[data-turbo-installed] { --turbo-release-label: "可更新至 $version"; }
:root[data-turbo-installed="$version"] {
  --turbo-release-label: "已是最新版 $version";
  --turbo-badge-border: #526779;
  --turbo-badge-bg: #192734;
  --turbo-badge-text: #bbcad7;
}
"@
[IO.File]::WriteAllText((Join-Path $release 'release.css'), $badge, $utf8)
