const fs = require("fs");
const path = require("path");

async function main() {
  const port = Number(process.env.MT_RELAY_PORT || 43128);
  const response = await fetch(`http://127.0.0.1:${port}/browser-config`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Local pairing failed (${response.status}).`);
  const pairing = await response.json();
  if (pairing.endpoint !== `http://127.0.0.1:${port}/browser-ingest`
    || !/^[a-f0-9]{64}$/.test(pairing.bridgeKey)) throw new Error("Invalid local pairing response.");
  const root = path.resolve(__dirname, "..");
  const source = path.join(root, "extensions", "mt-browser-relay");
  const destination = path.join(root, "output", "MT-賀哥轉發");
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ["manifest.json", "capture.js", "relay.js", "background.js", "watchdog.js"]) {
    fs.copyFileSync(path.join(source, name), path.join(destination, name));
  }
  fs.writeFileSync(path.join(destination, "pairing.js"),
    `const MT_BRIDGE_CONFIG = Object.freeze(${JSON.stringify(pairing)});\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(destination, "安裝說明.txt"), [
    "BLACKDOMAIN MT 賀哥轉發",
    "",
    "在目前開著 MT 的『賀哥』Chrome 視窗進行：",
    "1. 另開分頁，在網址列輸入 chrome://extensions。",
    "2. 開啟右上角『開發人員模式』。",
    "3. 按『載入未封裝項目』，選擇這個資料夾：",
    destination,
    "4. 回到原本的 MT 大廳，按 F5 重新整理一次。",
    "5. 畫面左下角顯示『已成功轉送』，且秒數持續更新，才代表轉送成功。",
    "",
    `本機狀態：http://127.0.0.1:${port}/`,
    "請保持賀哥的 MT 分頁開啟、電腦連網且不睡眠，本機背景轉發器也必須繼續執行。",
    "1.2.0 會定期檢查資料：先重新請求桌況，停送超過 90 秒且分頁在背景時才嘗試重新整理。",
    "每個分頁每小時最多自動重新整理 2 次，間隔至少 3 分鐘；登入失效則提示手動登入。",
    "Chrome 的背景排程可能延後，這不保證 90 秒內一定恢復，也不能代替有效登入。",
    "此擴充功能讀取 MT 百家樂桌況與牌路，轉交本機，再使用既有設定傳送到 BLACKDOMAIN 雲端。",
    "不讀取帳密、票證、餘額或下注紀錄，也不會執行下注。",
    "此資料夾包含本機配對檔，請勿公開分享。若更換轉送密鑰，需重新產生套件。",
    "移除此擴充功能並重新整理 MT，即可停止瀏覽器轉發。",
    "",
  ].join("\r\n"), "utf8");
  console.log(`MT browser relay package ready: ${destination}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
