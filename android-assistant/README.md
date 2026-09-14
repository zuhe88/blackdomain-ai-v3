# 黑域 AI Android 懸浮助手

Android 8.0 以上的原生浮球 App。使用現有黑域會員登入與預測網站，無須 Chrome 書籤。原生介面、浮球與前景服務以 Java 實作；會員頁使用同源 HTTPS WebView，不提供 JavaScript 原生橋接，也不讀取其他 App 的資料。

## 會員使用

1. 從 `/assistant/android/` 下載並安裝 APK。
2. 開啟 App，按「啟動懸浮助手」，允許顯示在其他應用程式上層。
3. 通知權限可讓通知列提供「關閉助手」按鈕；拒絕通知仍可使用浮球。
4. 在助手登入已開通的 3A 帳號，按「縮小」再進入遊戲。
5. 點浮球展開、按住拖曳；面板、本 App 或通知列皆能關閉助手。

登入保存在 App 私有 WebView 儲存空間；裝置識別碼隨機產生，停用 Android 備份，避免跨裝置複製登入。清除 App 資料／重新安裝會重設識別碼。更新 APK 應直接覆蓋安裝，不要先解除安裝。

## 建置

- JDK 17
- Android SDK platform 35、build-tools 35.0.0、platform-tools
- Gradle 8.11.1（wrapper），Android Gradle Plugin 8.9.2

設定 `JAVA_HOME`、`ANDROID_HOME` 後，在 PowerShell 執行：

```powershell
.\android-assistant\build-apk.ps1
```

本機工具預設放在 `%USERPROFILE%\.cache\blackdomain-android`，建置 SDK 位於其中的 `sdk-build`。腳本執行單元測試、Android lint、release 建置及 APK 簽章驗證，最後輸出至 `public/assistant/android/`，並產生 SHA-256 與版本資料。

首次建置會在 `%USERPROFILE%\.android\blackdomain-signing` 產生正式簽章金鑰及隨機密碼，限制該資料夾的 Windows ACL。**請安全備份整個簽章資料夾；後續更新必須使用相同金鑰。** 金鑰與密碼不得提交 Git。也可透過 `-SigningRoot` 指定既有備份位置。若改版，需提高 `app/build.gradle` 的 versionCode/versionName 並更新下載頁版本；release.json 會自動採用 APK 建置版本。

```powershell
.\android-assistant\gradlew.bat -p android-assistant :app:connectedDebugAndroidTest
# 保留實際畫面與測試結果（只接受 emulator-*，不修改實體手機權限）
.\android-assistant\test-emulator.ps1
```

上述測試需已啟動 Android 模擬器或連接授權的測試手機。測試只使用模擬器自己的 App 權限，不需要真實會員帳號。

## 行為與限制

- 由使用者從 App 啟動前景服務，使用 `specialUse` 類型；不申請開機自啟、無障礙、螢幕錄製或遊戲帳密存取。
- 本機小視窗顯示現有會員網站；遊戲資料新鮮度仍由後端資料來源決定。
- 收起面板保留 WebView 與預測狀態。系統終止 App 後不自動重啟，會員可從 App 再啟動。
- 網路錯誤、HTTP 錯誤、SSL 錯誤及 WebView 程序終止提供重試。憑證錯誤不略過驗證。
- 只允許正式黑域 HTTPS 網站留在 WebView；使用者點擊的其他 HTTPS 連結交给外部瀏覽器。禁用 file/content 存取與混合內容。
- 部分手機省電策略或遊戲安全畫面可能關閉／隱藏浮窗，需要實機驗證。App 登入與真實會員續局驗證需使用已開通會員帳號。

## Android 官方依據

- [懸浮權限](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context))
- [前景服務類型](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use)
- [AGP 8.9 相容版本](https://developer.android.com/build/releases/agp-8-9-0-release-notes)
