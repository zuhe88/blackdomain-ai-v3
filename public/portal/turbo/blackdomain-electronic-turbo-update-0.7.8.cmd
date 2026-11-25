@echo off
setlocal DisableDelayedExpansion
set "BLACKDOMAIN_TURBO_LAUNCHER=%~f0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -STA -Command "$source=[IO.File]::ReadAllText($env:BLACKDOMAIN_TURBO_LAUNCHER);$marker='### BLACKDOMAIN'+' POWERSHELL ###';$index=$source.IndexOf($marker,[StringComparison]::Ordinal);if($index -lt 0){throw 'Invalid updater'};& ([ScriptBlock]::Create($source.Substring($index+$marker.Length)))"
set "BLACKDOMAIN_TURBO_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BLACKDOMAIN_TURBO_EXIT%
### BLACKDOMAIN POWERSHELL ###
$ErrorActionPreference = 'Stop'
$version = '0.7.8'
$archiveSha256 = 'F166DF60B62F748ABEE2BF9B66969033E1251CE335C8396F176DA62336A3F33D'
$downloadUrl = "https://blackdomain-ai-v3-production.up.railway.app/portal/turbo/blackdomain-electronic-turbo-$version.zip"
$expectedName = '黑域 AI 電子加速器'
$officialPortal = 'https://blackdomain-ai-v3-production.up.railway.app/*'
$releaseFiles = @(
    'atg-scope.js', 'bankroll.js', 'demo.html', 'demo.js', 'extension.css',
    'game.js', 'membership.js', 'panel.js', 'popup.html', 'popup.js', 'portal-version.js',
    'README.md', 'seth2-canvas.js', 'speed.js', 'manifest.json'
)

function Get-TurboManifest([string]$folder) {
    if ($folder -notmatch '^[A-Za-z]:[\\/]') { return }
    $directory = Get-Item -LiteralPath $folder -Force -ErrorAction SilentlyContinue
    if ($directory -isnot [IO.DirectoryInfo]) { return }
    for ($parent = $directory; $parent; $parent = $parent.Parent) {
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
    }
    $manifest = Get-Item -LiteralPath (Join-Path $directory.FullName 'manifest.json') -Force -ErrorAction SilentlyContinue
    if ($manifest -isnot [IO.FileInfo] -or $manifest.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
    try {
        $value = Get-Content -LiteralPath $manifest.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($value.name -cne $expectedName -or $value.manifest_version -ne 3 -or
            $value.action.default_popup -ne 'popup.html' -or $value.host_permissions -notcontains $officialPortal) { return }
        [PSCustomObject]@{ Folder = $directory.FullName; Version = [Version]$value.version }
    } catch { return }
}

function Find-TurboFolders([string[]]$userDataRoots) {
    Add-Type -AssemblyName System.Web.Extensions
    $json = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
    $json.MaxJsonLength = [int]::MaxValue
    $verified = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($root in $userDataRoots) {
        foreach ($profile in Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue) {
            foreach ($file in @('Secure Preferences', 'Preferences')) {
                $path = Join-Path $profile.FullName $file
                if (!(Test-Path -LiteralPath $path -PathType Leaf)) { continue }
                try {
                    $prefs = $json.DeserializeObject([IO.File]::ReadAllText($path))
                    foreach ($entry in $prefs['extensions']['settings'].Values) {
                        if ($entry['location'] -ne 4) { continue }
                        $candidate = Get-TurboManifest $entry['path']
                        if ($candidate -and $verified.Add($candidate.Folder)) { $candidate }
                    }
                } catch { continue }
            }
        }
    }
}

function Select-TurboFolder([object[]]$candidates) {
    if ($candidates.Count -eq 1) { return $candidates[0] }
    Add-Type -AssemblyName System.Windows.Forms
    $picker = [Windows.Forms.FolderBrowserDialog]::new()
    try {
        $picker.Description = '選擇 Chrome 或 Edge 原本載入的黑域 AI 電子加速器資料夾。資料夾內應有 manifest.json。'
        $picker.ShowNewFolderButton = $false
        if ($candidates.Count -gt 1) { $picker.SelectedPath = $candidates[0].Folder }
        if ($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }
        $selected = Get-TurboManifest $picker.SelectedPath
        if (!$selected) { throw '所選的資料夾不是黑域 AI 電子加速器的安裝資料夾。' }
        if ($candidates.Count -gt 1 -and $candidates.Folder -notcontains $selected.Folder) {
            throw '請選擇目前已載入的加速器資料夾。'
        }
        $selected
    } finally { $picker.Dispose() }
}

function Install-TurboArchive([string]$folder, [string]$zipPath) {
    $target = Get-TurboManifest $folder
    if (!$target) { throw '找不到原本的加速器安裝。' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($target.Folder.TrimEnd('\').ToUpperInvariant()))).Replace('-', '')
    } finally { $sha.Dispose() }
    $mutex = [Threading.Mutex]::new($false, "Local\BlackdomainTurbo-$key")
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $locked = $true }
        if (!$locked) { throw '其他更新工具正在使用這個資料夾。請等它執行完成。' }
        $current = Get-TurboManifest $target.Folder
        if (!$current) { throw '找不到原本的加速器安裝。' }
        if ($current.Version -ge [Version]$version) { return $current.Version }
        Replace-TurboFiles -Folder $current.Folder -ZipPath $zipPath
        return [Version]$version
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Replace-TurboFiles([string]$folder, [string]$zipPath) {
    $file = [IO.File]::OpenRead($zipPath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $actualSha256 = [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-', '')
        if ($actualSha256 -ne $archiveSha256) {
            throw '新版安裝檔的完整性驗證失敗。請重新從黑域 AI 取得更新工具。'
        }
    } finally { $sha.Dispose(); $file.Dispose() }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stage = Join-Path $folder ('.blackdomain-update-' + [Guid]::NewGuid().ToString('N'))
    $installed = [System.Collections.Generic.List[string]]::new()
    $keepBackup = $false
    try {
        $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            if ($archive.Entries.Count -ne $releaseFiles.Count) { throw '新版安裝檔的內容不符。' }
            $null = New-Item -Path $stage -ItemType Directory
            foreach ($name in $releaseFiles) {
                $destination = Get-Item -LiteralPath (Join-Path $folder $name) -Force -ErrorAction SilentlyContinue
                if ($destination -and ($destination -isnot [IO.FileInfo] -or
                    $destination.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                    throw "無法安全更新檔案 $name。"
                }
                $entry = $archive.GetEntry($name)
                if (!$entry) { throw "新版缺少檔案 $name。" }
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $stage $name), $false)
            }
        } finally { $archive.Dispose() }
        $candidate = Get-TurboManifest $stage
        if (!$candidate -or $candidate.Version -ne [Version]$version) { throw '新版描述檔的版本不符。' }
        foreach ($name in $releaseFiles) {
            $source = Join-Path $stage $name
            $target = Join-Path $folder $name
            if ([IO.File]::Exists($target)) {
                [IO.File]::Replace($source, $target, (Join-Path $stage ($name + '.original')))
            } else {
                [IO.File]::Move($source, $target)
            }
            $installed.Add($name)
        }
    } catch {
        for ($index = $installed.Count - 1; $index -ge 0; $index--) {
            $name = $installed[$index]
            $original = Join-Path $stage ($name + '.original')
            $target = Join-Path $folder $name
            try {
                if ([IO.File]::Exists($original)) { [IO.File]::Replace($original, $target, [NullString]::Value) }
                else { [IO.File]::Delete($target) }
            } catch { $keepBackup = $true }
        }
        if ($keepBackup) { throw "更新未完成，備份保留在 $stage。" }
        throw
    } finally {
        if (!$keepBackup -and [IO.Directory]::Exists($stage)) {
            try {
                foreach ($name in $releaseFiles) {
                    [IO.File]::Delete((Join-Path $stage $name))
                    [IO.File]::Delete((Join-Path $stage ($name + '.original')))
                }
                [IO.Directory]::Delete($stage)
            } catch { Write-Warning "暫存資料夾保留在 $stage。" }
        }
    }
}

function Invoke-TurboUpdate {
    $profileRoots = @(
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')
    )
    $candidates = @(Find-TurboFolders $profileRoots)
    $target = Select-TurboFolder $candidates
    if (!$target) { Write-Host '已取消更新。'; return }
    if ($target.Version -ge [Version]$version) {
        Write-Host "此資料夾已是 $($target.Version)。若瀏覽器仍顯示舊版，請按擴充功能卡片上的「重新載入」。"
        return
    }
    $zipPath = Join-Path ([IO.Path]::GetTempPath()) ('blackdomain-turbo-' + [Guid]::NewGuid().ToString('N') + '.zip')
    try {
        Write-Host "正在下載黑域 AI 電子加速器 $version…"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 45 -OutFile $zipPath
        $installedVersion = Install-TurboArchive -Folder $target.Folder -ZipPath $zipPath
        Write-Host "加速器版本為 $installedVersion，原本資料夾及設定仍可使用。"
        Write-Host '請到 chrome://extensions 或 edge://extensions 按卡片上的「重新載入」，再重新整理遊戲頁。'
    } finally {
        try { [IO.File]::Delete($zipPath) } catch { Write-Warning "下載暫存檔保留在 $zipPath。" }
    }
}

# LAUNCHER_ENTRY
try {
    Invoke-TurboUpdate
} catch {
    Write-Host "更新失敗：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
