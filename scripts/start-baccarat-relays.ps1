# Starts the existing relay tasks and reports local listener and portal data health.
$relays = @(
    @{ Id = 'mt'; Name = 'MT'; Task = 'BLACKDOMAIN MT Relay'; Port = 43128 }
    @{ Id = 'ab'; Name = '歐博'; Task = 'BLACKDOMAIN-ALLBET-Extension'; Port = 19487 }
    @{ Id = 't9'; Name = 'T9'; Task = 'BLACKDOMAIN-T9-Relay'; Port = 19489 }
)
$taskPath = '\'
$ports = @($relays | ForEach-Object { $_.Port })
$errorsById = @{}
$started = $false

function Get-RelayListeners {
    Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
        Select-Object -ExpandProperty LocalPort
}

Write-Host '黑域 AI  |  MT・歐博・T9 一鍵啟動' -ForegroundColor Cyan
$listening = @(Get-RelayListeners)
foreach ($relay in $relays) {
    try {
        $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $relay.Task -ErrorAction Stop
        if ($task.State -eq 'Disabled') {
            throw '排程已停用'
        }
        if ($task.State -eq 'Running' -or $listening -contains $relay.Port) {
            continue
        }
        Start-ScheduledTask -TaskPath $taskPath -TaskName $relay.Task -ErrorAction Stop
        $started = $true
    } catch {
        $errorsById[$relay.Id] = $_.Exception.Message
    }
}

if ($started) {
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        $listening = @(Get-RelayListeners)
        if (@($ports | Where-Object { $_ -notin $listening }).Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
}

$statusUrl = 'https://blackdomain-ai-v3-production.up.railway.app/api/connections'
$liveById = @{}
try {
    $liveStatus = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 8 -ErrorAction Stop
    foreach ($provider in $liveStatus.providers) { $liveById[$provider.id] = $provider }
} catch {
    Write-Host '暫時無法讀取黑域 AI 線上連線狀態。' -ForegroundColor Yellow
}

$labels = @{ healthy = '更新中'; stale = '資料逾時'; offline = '離線' }
$localFailure = $false
Write-Host ''
foreach ($relay in $relays) {
    $provider = $liveById[$relay.Id]
    $live = '無法確認'
    if ($provider -and $labels.ContainsKey([string]$provider.state)) {
        $live = $labels[$provider.state]
        if ($null -ne $provider.ageSeconds) { $live += "（$($provider.ageSeconds) 秒前）" }
    }
    $ready = $listening -contains $relay.Port
    $local = if ($ready) { '運作中' } else { '未連上' }
    $color = if ($ready -and $provider.state -eq 'healthy') { 'Green' } else { 'Yellow' }
    if (!$ready -or $errorsById.ContainsKey($relay.Id)) { $localFailure = $true }
    Write-Host "$($relay.Name)  |  本機中繼 $local  |  線上資料 $live" -ForegroundColor $color
    if ($errorsById.ContainsKey($relay.Id)) {
        Write-Host "  啟動失敗：$($errorsById[$relay.Id])" -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '保持 Chrome 中的 MT、歐博、T9 分頁開著並登入。此視窗可關閉。'
Write-Host '線上狀態：https://blackdomain-ai-v3-production.up.railway.app/connections'
if ($localFailure) { exit 1 }
