# MT 背景瀏覽器

從專案目錄執行：

```powershell
npm run mt-headless
```

保留終端機，按 Ctrl+C 停止背景瀏覽器。需要本機已安裝 Google Chrome、Node.js，以及 `npm install` 安裝的專案套件。

程式會先檢查本機轉發器，必要時啟動既有的背景轉發程序，再開啟獨立的無畫面 Chrome。它使用 `%LOCALAPPDATA%\BLACKDOMAIN\mt-relay.json` 內以 Windows 加密保存的 MT 票證，不使用或複製日常 Chrome 個人資料。沒有設定時，先到本機轉發中心 `http://127.0.0.1:43128/` 更新 MT 設定。票證失效後，需要從原平台重新進入 MT，更新本機設定，再重啟背景瀏覽器。

狀態：

- `http://127.0.0.1:43129/status`：只計算這個背景瀏覽器的擷取與轉送時間，可避免原本 MT 分頁的正常資料造成誤判。
- `http://127.0.0.1:43128/status`：本機轉發器的整體狀態。載入新版本機轉發程式後，`browserDiagnostics.browserMode` 會標明 `headless` 或 `extension`。
- `healthy: true`：桌況擷取時間與成功轉送時間皆在 15 秒內。
- `login_required`：登入失效，需要更新登入票證。
- `access_denied`：上游拒絕存取，`accessDenied` 只顯示拒絕階段、HTTP 狀態碼及服務類別；不自動重試或處理驗證挑戰。
- `local_unavailable`：無法接上本機轉發器或轉送失敗。
- `recovery_limit`：已達每小時兩次復原上限。

停止收到桌況時先重新請求；超過 90 秒才嘗試重新載入或重建專用瀏覽器，每小時最多兩次，間隔至少三分鐘。只轉送新收到的百家樂桌況與牌路，不重播快取，不執行下注。電腦仍須連網且保持喚醒。

確認背景瀏覽器連續有新桌況且兩個時間均持續更新後，才可關閉原本可見的 MT 分頁。

## 本次實測限制

2026-09-18：無畫面 Chrome 成功啟動，但 MT 主頁導覽遭 Cloudflare HTTP 403 拒絕。背景來源沒有桌況或成功轉送，`healthy: false`。因此尚未證明可取代現有 MT 分頁；需要平台允許此存取方式或提供可用的授權入口。沒有停用瀏覽器安全檢查、偽裝驗證或複製其他瀏覽器的登入資料。

驗證指令：

```powershell
npm run test:mt
npm test
npm run lint
git diff --check
```
