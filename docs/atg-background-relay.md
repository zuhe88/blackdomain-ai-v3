# ATG Windows 背景轉送程式

這個程式讓 ATG 開獎資料由 Windows 背景同步到 Railway，不需要保持 Chrome 或 ATG 網頁開啟。電腦仍須保持開機並連上網路。

## 安裝

在 PowerShell 執行：

```powershell
cd C:\Users\User\Documents\GitHub\blackdomain-ai-v3
powershell -ExecutionPolicy Bypass -File .\scripts\install-atg-background-relay.ps1
```

依序輸入：

1. 3A 平台網址（直接按 Enter 使用預設值）
2. 3A 登入帳號
3. 3A 登入密碼
4. Railway 的 `ATG_RELAY_KEY`
5. 瀏覽器的 `device_id`（選填；一般可直接按 Enter）
6. Railway 網址（直接按 Enter 使用預設值）

密碼與 Relay Key 會由目前的 Windows 使用者透過 DPAPI 加密，儲存在：

```text
%LOCALAPPDATA%\BLACKDOMAIN\atg-relay-secrets.json
```

安裝程式會立即啟動背景轉送，並建立登入 Windows 後自動執行的排程工作。

## 查看同步狀態

```powershell
Get-Content "$env:LOCALAPPDATA\BLACKDOMAIN\atg-relay.log" -Tail 30 -Wait
```

正常時會看到 `ATG socket connected`、`SYNC snapshot`、`SYNC state` 和 `SYNC result`。

## 解除安裝

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-atg-background-relay.ps1 -Uninstall
```

解除安裝只會移除開機自動執行的排程工作，不會自動刪除加密設定與記錄檔。
