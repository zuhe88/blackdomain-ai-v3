# Android 1.0.0 驗證紀錄

驗證日期：2026-09-14。

## 已完成

- Release APK 建置成功；Android lint：0 errors（僅測試套件較新版本提示）。
- APK Signature Scheme v2 驗證通過，正式套件未啟用 debuggable。
- 4 項 URL／裝置識別碼單元測試通過。
- Android 15 / API 35 Pixel 6 模擬器 2 項操作測試通過：
  - 拒絕懸浮授權：說明及返回正常，沒有啟動浮球。
  - 真實會員登入頁可載入並輸入測試文字；未送出帳號。
  - 輸入框完整位於鍵盤上方。
  - 縮小、保留輸入內容、桌面上拖曳浮球、實際橫向畫面及關閉服務。
- 另外安裝正式簽章 release APK：冷啟動成功，載入正式登入頁，前景懸浮服務正常。
- 本機 `/assistant/android/` HTTP 下載測試通過：APK MIME type 正確、下載內容等於本機檔案、SHA-256 符合 release.json。
- 既有 `npm test`、`npm run lint` 及 `git diff --check` 通過。

## 實際畫面

截圖存放於專案 `output/android-assistant/qa/`（不提交 Git），下載頁使用其中 App 首頁截圖。

## 尚未驗證

- 實體手機廠牌的省電／懸浮權限差異。
- 真實開通會員的登入與後續牌局。測試只載入公開登入頁，沒有使用會員帳號或送出登入請求。

## 網站發佈

下載頁：`https://blackdomain-ai-v3-production.up.railway.app/assistant/android/`。LINE 分享時使用 `?openExternalBrowser=1`。每次部署後須重新核對 HTTP 回應及下載 APK 的 SHA-256；本檔記錄的模擬器測試不代表網站部署檢查。

APK 的 SHA-256、版本及檔名以 `public/assistant/android/release.json` 為準。正式簽章金鑰保存在本機私有資料夾，未放入下載目錄或 Git。
