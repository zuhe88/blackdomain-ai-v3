# 同一 3A 帳號換 LINE

## 會員

用**新 LINE 私訊官方帳號**：`申請轉移LINE abc123`。
將回覆的完整申請編號交給管理員，24 小時內審核。核准前原權限保持不變，不要先解除綁定。

## 管理員

- `待轉移LINE`：最近 10 筆有效待審申請。
- `查轉移LINE 完整申請編號`：核對帳號、狀態及新舊 LINE 名稱和 ID。
- **人工核對原會員本人及新 LINE**後，輸入 `核准轉移LINE 完整申請編號 abc123`。
- 不是本人或資料不符：`拒絕轉移LINE 完整申請編號 abc123`。

知道 3A 帳號不能作為身分證明。系統不會自動核准，不會自動推送申請給管理員。
核准保留原帳號、VIP 狀態、AI 權限與到期日，不新增天數、不提升權限。永久仍永久，過期仍過期。
新 LINE 輸入 `VIP` 確認，重新取得網站登入連結。

舊 LINE 的網站 API 及登入連結會被拒絕，即使全線開放權限也不能繞過；分析狀態清理且網站事件連線關閉。
轉出過的 LINE 不接受再次轉入，避免舊登入憑證復活；需要轉回時另行設計有憑證版本的復原流程。
此功能轉移 VIP 授權與綁定，不搬移歷史分析、抽獎紀錄或裝置登入。

## 部署順序

1. 在正式 Supabase 先確認 `information_schema.columns` 中 `vip_users`、`vip_requests`、`lottery_settings`、`admin_logs` 欄位與 migration 相容。
2. 先確認 `20261003_vip_binding_admin.sql` 已套用，再執行 `database/20261006_vip_line_transfer.sql`。
3. 驗證新表 RLS 以及兩個 RPC 僅 service_role 可執行；anon/authenticated 無讀寫表或執行 RPC 權限。
4. 部署程式，確認正式 `/health` 的 `vipLineTransferControls` 為 `20261006.01`。
5. 以專用測試 LINE 驗證申請/拒絕；只有獲得特定會員轉移授權後才操作其正式核准。

執行 `npm test`、`npm run lint`、`git diff --check` 驗證。資料庫交易測試涵蓋保留權限、重複核准、過期、衝突、競爭申請及失敗回復。
