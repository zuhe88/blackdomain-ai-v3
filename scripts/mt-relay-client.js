const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.MT_RELAY_PORT || 43128);
const SOCKET_URL = process.env.MT_SOCKET_URL || "wss://a1.ofalive99.net/game/ws";
const ORIGIN = process.env.MT_ORIGIN || "https://gsa.ofalive99.net";
const INGEST_URL = process.env.MT_INGEST_URL
  || "https://blackdomain-ai-v3-production.up.railway.app/api/mt/ingest";
const TABLES_ACTION = "/api/v1/gametype/*/game/*/room/*/tables";

let socket = null;
let activeToken = "";
let activeRelayKey = "";
let refreshTimer = null;
let heartbeatTimer = null;
let watchdogTimer = null;
let reconnectTimer = null;
let connectedAt = null;
let lastForwardAt = null;
let lastMessageAt = null;
let lastTablesAt = null;
let lastError = null;
let tokenRejected = false;

function stopTimers() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  refreshTimer = null;
  heartbeatTimer = null;
  watchdogTimer = null;
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function requestTables() {
  return send({
    method: "GET",
    action: {
      name: TABLES_ACTION,
      data: { gametype_id: 3, game_id: 1, room_id: 1 },
    },
  });
}

function sanitizeTables(value) {
  return Object.values(value || {})
    .filter((table) => table?.table_type === "BAC" || table?.table_type === "BAS")
    .slice(0, 50)
    .map((table) => ({
      table_id: table.table_id,
      table_name: table.table_name,
      table_type: table.table_type,
      game_sn: table.game_sn,
      game_state: table.game_state,
      shoe: table.shoe,
      round: table.round,
      trend: {
        bead_plate2: table.trend?.bead_plate2,
        total_round_banker: table.trend?.total_round_banker,
        total_round_player: table.trend?.total_round_player,
        total_round_tie: table.trend?.total_round_tie,
      },
    }));
}

async function forwardTables(tables) {
  if (!tables.length || !activeToken) return;
  const body = JSON.stringify({ tables });
  const signature = crypto.createHmac("sha256", activeToken).update(body).digest("hex");
  const authorization = activeRelayKey
    ? { "x-dg-relay-key": activeRelayKey }
    : { "x-mt-relay-signature": signature };
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authorization,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Relay HTTP ${response.status}`);
  lastForwardAt = new Date().toISOString();
  lastError = null;
}

function handleMessage(raw) {
  try {
    lastMessageAt = new Date().toISOString();
    const message = JSON.parse(String(raw));
    const action = typeof message.action === "string" ? message.action : message.action?.name;
    if (action === "/api/v1/authenticate") {
      if (Number(message.err) !== 0) {
        lastError = `MT authentication failed (${message.err}).`;
        tokenRejected = true;
        socket?.close();
        return;
      }
      connectedAt = new Date().toISOString();
      requestTables();
      return;
    }
    if (message.name === "/api/v1/member/logout") {
      lastError = "MT token was rejected.";
      tokenRejected = true;
      socket?.close();
      return;
    }
    if (action === TABLES_ACTION) {
      lastTablesAt = new Date().toISOString();
      forwardTables(sanitizeTables(message.msg?.tables)).catch((error) => {
        lastError = error.message;
      });
      return;
    }
    if (typeof message.action === "object" && message.body?.table_id != null) requestTables();
  } catch (error) {
    lastError = error.message;
  }
}

function connect(token, relayKey = activeRelayKey) {
  activeToken = String(token || "").trim();
  activeRelayKey = String(relayKey || "").trim();
  if (activeToken.length < 16) throw new Error("MT token is invalid.");
  if (activeRelayKey && activeRelayKey.length < 16) throw new Error("Relay key is invalid.");
  tokenRejected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.terminate();
  }
  stopTimers();
  connectedAt = null;
  lastTablesAt = null;
  lastError = null;
  const nextSocket = new WebSocket(SOCKET_URL, {
    origin: ORIGIN,
    handshakeTimeout: 15000,
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
      "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
    },
  });
  socket = nextSocket;
  nextSocket.on("open", () => {
    send({
      method: "POST",
      action: { name: "/api/v1/authenticate" },
      body: { type: 3, token: activeToken },
    });
    heartbeatTimer = setInterval(() => send({
      method: "POST",
      action: { name: "/api/v1/ping" },
    }), 5000);
    refreshTimer = setInterval(requestTables, 2000);
    watchdogTimer = setInterval(() => {
      if (!connectedAt || !socket || socket.readyState !== WebSocket.OPEN) return;
      const lastTablesTime = Date.parse(lastTablesAt || connectedAt);
      if (Date.now() - lastTablesTime <= 30000) return;
      lastError = "MT table data timed out; reconnecting.";
      socket.close();
    }, 5000);
  });
  nextSocket.on("message", handleMessage);
  nextSocket.on("error", (error) => {
    lastError = error.message;
  });
  nextSocket.on("close", () => {
    if (socket === nextSocket) socket = null;
    connectedAt = null;
    stopTimers();
    if (activeToken && !tokenRejected && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(activeToken);
      }, 5000);
    }
  });
}

function publicStatus() {
  const state = socket?.readyState === WebSocket.OPEN
    ? connectedAt ? "connected" : "authenticating"
    : tokenRejected ? "token_rejected" : "disconnected";
  return {
    state,
    healthy: state === "connected" && Boolean(lastTablesAt),
    connectedAt,
    lastForwardAt,
    lastMessageAt,
    lastTablesAt,
    lastError,
  };
}

function html() {
  return `<!doctype html>
<html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BLACKDOMAIN MT Relay</title>
<style>
body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:20px;color:#171717}
.status{border:1px solid #ddd;border-radius:12px;padding:16px;margin-bottom:22px;background:#fafafa}
.state{font-size:20px;font-weight:700;margin-bottom:8px}.ok{color:#16803a}.bad{color:#c62828}.wait{color:#9a6700}
.detail{line-height:1.7;color:#555}label{display:block;margin:14px 0 6px;font-weight:600}
input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #999;border-radius:6px}
button{margin-top:14px;padding:11px 18px;border:0;border-radius:6px;background:#171717;color:white;font-weight:700}
.hint{color:#666;font-size:14px;line-height:1.6}
</style>
<body>
<h1>MT 背景轉發</h1>
<section class="status"><div id="state" class="state wait">正在讀取狀態…</div><div id="detail" class="detail"></div></section>
<form method="post"><label>MT 票證</label><input name="token" type="password" required autocomplete="off">
<label>固定轉送密鑰</label><input name="relayKey" type="password" autocomplete="off">
<button type="submit">更新票證並啟動</button></form>
<p class="hint">票證只保留在本機記憶體，不會寫入檔案。此頁會每 2 秒自動更新；顯示「即時轉送中」才代表 MT 資料正常送出。</p>
<script>
const state = document.querySelector("#state");
const detail = document.querySelector("#detail");
function age(value) { if (!value) return "尚未收到"; const seconds = Math.max(0, Math.round((Date.now()-Date.parse(value))/1000)); return seconds < 60 ? seconds+" 秒前" : Math.floor(seconds/60)+" 分鐘前"; }
async function refresh() { try { const value = await fetch("/status", { cache: "no-store" }).then(r => r.json());
  const labels = { connected: ["即時轉送中","ok"], authenticating: ["正在驗證 MT 票證…","wait"], token_rejected: ["MT 票證已失效，請在下方貼上新票證","bad"], disconnected: ["MT 連線中斷，系統正在自動重連","bad"] };
  const selected = labels[value.state] || labels.disconnected; state.textContent = selected[0]; state.className = "state "+selected[1];
  detail.textContent = "最近收到房表："+age(value.lastTablesAt)+"｜最近成功轉送："+age(value.lastForwardAt)+(value.lastError ? "｜狀態："+value.lastError : "");
} catch { state.textContent="無法讀取轉發器狀態"; state.className="state bad"; } }
refresh(); setInterval(refresh, 2000);
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(publicStatus()));
    return;
  }
  if (req.method === "POST" && req.url === "/") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (body.length < 4096) body += chunk;
    });
    req.on("end", () => {
      try {
        const token = new URLSearchParams(body).get("token");
        const relayKey = new URLSearchParams(body).get("relayKey");
        connect(token, relayKey || activeRelayKey);
        res.statusCode = 303;
        res.setHeader("location", "/");
        res.end();
      } catch (error) {
        res.statusCode = 400;
        res.end(error.message);
      }
    });
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`BLACKDOMAIN MT relay listening on http://127.0.0.1:${PORT}`);
  const startupToken = String(process.env.MT_TOKEN || "").trim();
  const startupRelayKey = String(process.env.MT_RELAY_KEY || "").trim();
  if (startupToken) {
    try {
      connect(startupToken, startupRelayKey);
    } catch (error) {
      lastError = error.message;
    }
  }
});
