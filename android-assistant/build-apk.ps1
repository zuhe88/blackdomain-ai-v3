param(
    [string]$ToolRoot = "$env:USERPROFILE\.cache\blackdomain-android",
    [string]$SigningRoot = "$env:USERPROFILE\.android\blackdomain-signing"
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repoRoot = Split-Path $projectRoot -Parent
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem -LiteralPath "$ToolRoot\jdk" -Directory | Select-Object -First 1
    if (-not $jdk) { throw 'Install JDK 17 and set JAVA_HOME before building.' }
    $env:JAVA_HOME = $jdk.FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$ToolRoot\sdk-build" }
if (-not (Test-Path "$env:ANDROID_HOME\platforms\android-35\android.jar")) {
    throw 'Install Android SDK platform 35 and build-tools 35.0.0 first. See README.md.'
}
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# Keep the signing identity outside the repository; updates MUST use this same key.
New-Item -ItemType Directory -Force -Path $SigningRoot | Out-Null
$secretFile = Join-Path $SigningRoot 'signing.json'
$keyFile = Join-Path $SigningRoot 'blackdomain-release.jks'
if (-not (Test-Path -LiteralPath $secretFile)) {
    if (Test-Path -LiteralPath $keyFile) { throw 'Existing signing key found without credentials. Restore signing.json; do not replace the key.' }
    $passwordBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($passwordBytes)
    $rng.Dispose()
    $password = [Convert]::ToBase64String($passwordBytes)
    @{ storePassword = $password; keyPassword = $password } | ConvertTo-Json | Set-Content -LiteralPath $secretFile -Encoding utf8
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $SigningRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the signing directory.' }
}
$secrets = Get-Content -LiteralPath $secretFile -Raw | ConvertFrom-Json
$env:BLACKDOMAIN_KEYSTORE = $keyFile
$env:BLACKDOMAIN_STORE_PASSWORD = $secrets.storePassword
$env:BLACKDOMAIN_KEY_PASSWORD = $secrets.keyPassword
try {
    if (-not (Test-Path -LiteralPath $keyFile)) {
        & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $keyFile -storetype JKS -alias blackdomain -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Blackdomain AI, OU=Android, O=Blackdomain AI' -storepass:env BLACKDOMAIN_STORE_PASSWORD -keypass:env BLACKDOMAIN_KEY_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
    }
    & "$projectRoot\gradlew.bat" -p $projectRoot --no-daemon :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android tests, lint or release build failed.' }
    $apk = Join-Path $projectRoot 'app\build\outputs\apk\release\app-release.apk'
    $metadata = Get-Content -LiteralPath (Join-Path $projectRoot 'app\build\outputs\apk\release\output-metadata.json') -Raw | ConvertFrom-Json
    $version = $metadata.elements[0].versionName
    $versionCode = $metadata.elements[0].versionCode
    & "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat" verify --verbose $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $output = Join-Path $repoRoot 'public\assistant\android'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    Copy-Item -LiteralPath $apk -Destination "$output\blackdomain-ai-assistant.apk" -Force
    $checksum = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$checksum  blackdomain-ai-assistant.apk" | Set-Content -LiteralPath "$output\blackdomain-ai-assistant.apk.sha256" -Encoding ascii
    @{ version = $version; versionCode = $versionCode; minAndroid = '8.0'; filename = 'blackdomain-ai-assistant.apk'; sha256 = $checksum } | ConvertTo-Json | Set-Content -LiteralPath "$output\release.json" -Encoding utf8
    Write-Output "Verified release APK: $output\blackdomain-ai-assistant.apk"
    Write-Output "Keep a secure backup of $SigningRoot to sign future updates."
} finally {
    Remove-Item Env:BLACKDOMAIN_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BLACKDOMAIN_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BLACKDOMAIN_KEYSTORE -ErrorAction SilentlyContinue
}
