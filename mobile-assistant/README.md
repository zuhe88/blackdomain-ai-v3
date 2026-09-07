# 黑域 AI 手機助手原型

原生 React Native / Expo 專案，遊戲在頂層 WebView 載入，分析在第二個 WebView 展開。沒有 iframe、封包攔截、網站程式注入或跨 App 浮窗。

## 本機測試

```powershell
cd mobile-assistant
npm ci
npm start
```

使用與 SDK 相容的 Expo Go 在 iPhone、Android 掃描開發伺服器 QR code。電腦與手機需網路互通；Expo Go 僅供開發測試，不是使用者正式安裝包。Windows 無法執行 iOS 模擬器。正式安裝需要 Android/iOS 建置、簽署與分發設定，尚未建立或上架。

正式識別：Android package 與 iOS bundle identifier 均為 `com.blackdomain.aiassistant`。`preview` 產生會員可直接安裝的 Android APK；`production` 產生商店／TestFlight 版本。

## 目前行為

- 3A 入口：`https://sn058.3a1788.bet/`；分析：現有黑域 `/portal/`，保留既有會員驗證。
- 開關助手不變更遊戲 source/key，也不卸載遊戲。助手首次開啟後也保留掛載；不因關閉面板自動登出。
- 網站新視窗的 HTTPS 目標在遊戲 WebView 中開啟；需要 `window.opener` 或 POST 新視窗的流程尚待實機驗證。
- 不自動刷新失效遊戲或自動操作投注。載入失敗顯示手動重試。
- 外部 LINE 等連結由使用者確認後開啟，離開 App 仍可能使遊戲暫停。
- 不保存或記錄遊戲 URL、票證、密碼；WebView 使用系統 cookie 儲存。遊戲與分析 WebView 不交換資料；分析頁只將會員登入／權限布林狀態回報給原生介面。
- 助手以 3A 帳號核對既有會員資料。只有已開通且未到期的帳號會把 6 位數一次性驗證碼傳到原綁定 LINE；驗證成功後才在分析 WebView 建立網站工作階段。單憑公開帳號名稱無法登入。
- 黑域 AI Logo 浮動按鈕可拖曳；點一下展開分析，轉向後會自動限制在可見畫面內。

## 必須完成的實機驗收（尚未執行）

在 iPhone 與 Android 各自執行並記錄裝置、系統版本、結果：

1. 3A 登入／驗證碼可正常完成，再進 ATG、MT；不實際投注。
2. 反覆開關助手 20 次，確認遊戲沒有重新載入、票證被替換或連線中斷。
3. 保持遊戲前景 15 分鐘並使用助手，確認遊戲端沒有逾時。
4. 旋轉直橫式、返回遊戲大廳、開啟遊戲新視窗，確認返回與登入狀態。
5. 分析會員登入可完成（尤其 LINE 登入回跳）；目前未配置原生 deep link，若回跳失敗需額外整合，不能視為已通過。
6. 斷網、切背景、鎖屏、記憶體回收後，確認失效提示與手動恢復，不宣稱背景永不斷線。
7. 正式 iOS／Android build 重跑以上案例；Expo Go 通過不等於正式包通過。

只有上述測試通過後，才能確認此助手能減少使用者回報的切頁逾時。目前沒有證據證明 ATG/MT 接受原生 WebView 或不會限制多重工作階段。

## 依賴檢查

2026-09-07 已通過 `npm run typecheck`、`npx expo install --check`、`npx expo export --platform ios --platform android`。匯出的 JS/Hermes bundle 不是已簽署 APK/IPA，尚未進行手機畫面或登入驗證。

本次區域網路測試入口：`exp://192.168.103.33:8082`，QR code 在 `test-qr.svg`。僅開發伺服器持續執行且手機能連到這台電腦時有效；IP 改變後須重新產生。

初次安裝的 npm audit 回報 10 個 moderate 項目，根源為 Expo 的 Xcode 建置工具鏈相依 `uuid <11.1.1`（GHSA-w5hq-g745-h8pq），並非 10 個互不相關的問題。未以強制降級 Expo 的方式處理；正式發佈前需重新檢查上游修復與建置工具鏈。
