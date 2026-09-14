param(
    [string]$Serial = 'emulator-5554',
    [string]$ToolRoot = "$env:USERPROFILE\.cache\blackdomain-android"
)
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-\d+$') { throw 'This script changes test permissions; use an Android emulator serial.' }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem "$ToolRoot\jdk" -Directory | Select-Object -First 1).FullName }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$ToolRoot\sdk-build" }
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& "$PSScriptRoot\gradlew.bat" -p $PSScriptRoot :app:assembleDebug :app:assembleDebugAndroidTest
if ($LASTEXITCODE -ne 0) { throw 'Test APK build failed.' }
& $adb -s $Serial install -r "$PSScriptRoot\app\build\outputs\apk\debug\app-debug.apk"
if ($LASTEXITCODE -ne 0) { throw 'Debug install failed. Use a test emulator without a release installation.' }
& $adb -s $Serial install -r "$PSScriptRoot\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk"
if ($LASTEXITCODE -ne 0) { throw 'Instrumentation install failed.' }
$result = & $adb -s $Serial shell am instrument -w ai.blackdomain.assistant.test/androidx.test.runner.AndroidJUnitRunner
$result | Write-Output
$output = Join-Path (Split-Path $PSScriptRoot -Parent) 'output\android-assistant'
New-Item -ItemType Directory -Force $output | Out-Null
$result | Set-Content -LiteralPath "$output\instrumentation-results.txt" -Encoding utf8
& $adb -s $Serial pull /sdcard/Android/data/ai.blackdomain.assistant/files/qa $output
if (($result -join "`n") -notmatch 'OK \(2 tests\)') { throw 'Android UI tests failed. See instrumentation-results.txt and screenshots.' }
Write-Output "UI checks passed. Screenshots: $output\qa"
