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
let refreshTimer = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let connectedAt = null;
let lastForwardAt = null;
let lastError = null;

function stopTimers() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  refreshTimer = null;
  heartbeatTimer = null;
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
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mt-relay-signature": signature,
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
    const message = JSON.parse(String(raw));
    const action = typeof message.action === "string" ? message.action : message.action?.name;
    if (action === "/api/v1/authenticate") {
      if (Number(message.err) !== 0) throw new Error(`MT authentication failed (${message.err}).`);
      connectedAt = new Date().toISOString();
      requestTables();
      return;
    }
    if (message.name === "/api/v1/member/logout") {
      throw new Error("MT token was rejected.");
    }
    if (action === TABLES_ACTION) {
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

function connect(token) {
  activeToken = String(token || "").trim();
  if (activeToken.length < 16) throw new Error("MT token is invalid.");
  if (socket) {
    socket.removeAllListeners();
    socket.terminate();
  }
  stopTimers();
  connectedAt = null;
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
  });
  nextSocket.on("message", handleMessage);
  nextSocket.on("error", (error) => {
    lastError = error.message;
  });
  nextSocket.on("close", () => {
    if (socket === nextSocket) socket = null;
    connectedAt = null;
    stopTimers();
    if (activeToken && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(activeToken);
      }, 5000);
    }
  });
}

function html() {
  return `<!doctype html>
<html lang="zh-Hant"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BLACKDOMAIN MT Relay</title>
<body style="font-family:sans-serif;max-width:520px;margin:48px auto;padding:20px">
<h1>MT 背景轉發</h1>
<form method="post">
  <label>MT 票證<input name="token" type="password" required
    style="display:block;width:100%;margin:10px 0;padding:10px"></label>
  <button type="submit" style="padding:10px 16px">啟動</button>
</form>
<p>票證只保留在本機記憶體，不會寫入檔案。</p>
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      state: socket?.readyState === WebSocket.OPEN ? connectedAt ? "connected" : "authenticating" : "disconnected",
      connectedAt,
      lastForwardAt,
      lastError,
    }));
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
        connect(token);
        res.statusCode = 303;
        res.setHeader("location", "/status");
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
});
