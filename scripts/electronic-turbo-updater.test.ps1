$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$release = Join-Path $repo 'public\portal\turbo'
$version = (Get-Content -LiteralPath (Join-Path $repo 'extensions\electronic-turbo\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$archive = Join-Path $release "blackdomain-electronic-turbo-$version.zip"
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$launcher = [IO.File]::ReadAllText((Join-Path $release "blackdomain-electronic-turbo-update-$version.cmd"))
$embedded = @($launcher -split '(?m)^### BLACKDOMAIN POWERSHELL ###\r?$', 2)[1]
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'electronic-turbo-updater.ps1') -Raw -Encoding UTF8
$source = $source.Replace('@VERSION@', $version).Replace('@SHA256@', $hash)
if (($embedded.Trim() -replace '\r?\n', "`n") -cne ($source.Trim() -replace '\r?\n', "`n")) {
    throw 'Launcher must be rebuilt.'
}
. ([scriptblock]::Create(($embedded -split '(?m)^# LAUNCHER_ENTRY\r?$', 2)[0]))

function Assert-True([bool]$condition, [string]$message) {
    if (!$condition) { throw $message }
}
function Capture-Hashes([string]$folder) {
    foreach ($name in $releaseFiles) {
        if (!(Test-Path -LiteralPath (Join-Path $folder $name))) { "missing $name"; continue }
        (Get-FileHash -LiteralPath (Join-Path $folder $name) -Algorithm SHA256).Hash
    }
}
function Expect-InstallFailure([string]$folder, [string]$zipPath) {
    try { $null = Install-TurboArchive -Folder $folder -ZipPath $zipPath }
    catch { return }
    throw 'Update unexpectedly succeeded.'
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$scratch = Join-Path $tempRoot ('blackdomain-updater-test-' + [guid]::NewGuid().ToString('N'))
$job = $null
try {
    $install = Join-Path $scratch 'Installation folder'
    $outside = Join-Path $scratch 'Other extension'
    $oldArchive = Join-Path $release 'blackdomain-electronic-turbo-0.7.1.zip'
    Expand-Archive -LiteralPath $oldArchive -DestinationPath $install
    $null = New-Item -Path $outside -ItemType Directory
    [IO.File]::WriteAllText((Join-Path $outside 'manifest.json'), '{"manifest_version":3,"version":"0.7.1","name":"Other"}')
    $prefs = @{ extensions = @{ settings = @{
        valid = @{ path = $install; location = 4 }
        unrelated = @{ path = $outside; location = 4 }
    } } } | ConvertTo-Json -Depth 8
    $chrome = Join-Path $scratch 'Chrome'
    $edge = Join-Path $scratch 'Edge'
    foreach ($browser in @($chrome, $edge)) {
        $null = New-Item -Path (Join-Path $browser 'Profile 1') -ItemType Directory
        [IO.File]::WriteAllText((Join-Path $browser 'Profile 1\Secure Preferences'), $prefs)
    }
    $found = @(Find-TurboFolders @($chrome, $edge))
    Assert-True ($found.Count -eq 1 -and $found[0].Folder -eq $install) 'Automatic detection did not deduplicate the original extension path.'
    $before = (Capture-Hashes $install) -join ','
    [IO.File]::WriteAllText((Join-Path $install 'local-settings.txt'), 'keep')

    $badZip = Join-Path $scratch 'tampered.zip'
    [IO.File]::WriteAllText($badZip, 'invalid archive')
    Expect-InstallFailure $install $badZip
    Assert-True (((Capture-Hashes $install) -join ',') -ceq $before) 'Hash failure touched the installation.'

    $lockedFile = [IO.File]::Open((Join-Path $install 'popup.js'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try { Expect-InstallFailure $install $archive }
    finally { $lockedFile.Dispose() }
    Assert-True (((Capture-Hashes $install) -join ',') -ceq $before) 'Rollback did not restore the complete 0.7.1 install.'

    $sha = [Security.Cryptography.SHA256]::Create()
    try { $mutexKey = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($install.ToUpperInvariant()))).Replace('-', '') }
    finally { $sha.Dispose() }
    $marker = Join-Path $scratch 'mutex-ready'
    $releaseLock = Join-Path $scratch 'mutex-release'
    $job = Start-Job -ArgumentList "Local\BlackdomainTurbo-$mutexKey", $marker, $releaseLock -ScriptBlock {
        param($name, $signal, $release)
        $holder = [Threading.Mutex]::new($false, $name)
        if (!$holder.WaitOne(3000)) { throw 'Could not obtain test lock.' }
        try {
            [IO.File]::WriteAllText($signal, 'ready')
            $deadline = [DateTime]::UtcNow.AddSeconds(15)
            while (!(Test-Path -LiteralPath $release) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        } finally { $holder.ReleaseMutex(); $holder.Dispose() }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (!(Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert-True (Test-Path -LiteralPath $marker) 'Mutex fixture did not start.'
    Expect-InstallFailure $install $archive
    [IO.File]::WriteAllText($releaseLock, 'release')
    $null = Wait-Job -Job $job -Timeout 10
    Receive-Job -Job $job -ErrorAction Stop
    Assert-True (((Capture-Hashes $install) -join ',') -ceq $before) 'Concurrent update touched the installation.'

    $currentVersion = Install-TurboArchive -Folder $install -ZipPath $archive
    Assert-True ($currentVersion -eq [Version]$version -and (Get-TurboManifest $install).Version -eq [Version]$version) 'No version upgrade occurred.'
    $expected = Join-Path $scratch 'Expected'
    Expand-Archive -LiteralPath $archive -DestinationPath $expected
    Assert-True (((Capture-Hashes $install) -join ',') -ceq ((Capture-Hashes $expected) -join ',')) 'Installed files differ from release.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $install 'local-settings.txt')) -ceq 'keep') 'Unrelated settings were overwritten.'
    Assert-True (@(Get-ChildItem -LiteralPath $install -Force -Directory).Count -eq 0) 'Staging was left behind.'
    Assert-True ((Install-TurboArchive -Folder $install -ZipPath $badZip) -eq [Version]$version) 'Repeat update did not skip.'
    Write-Output 'Updater detection, hash validation, rollback, locking, upgrade, and repeat run passed.'
} finally {
    if ($job) { Remove-Job -Job $job -Force }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ($resolved.StartsWith((Join-Path $tempRoot 'blackdomain-updater-test-'), [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $resolved -PathType Container)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
