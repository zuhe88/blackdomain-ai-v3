const crypto = require("crypto");
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const { createBrowserBridge, sanitizeTables } = require("./lib/mt-browser-bridge");

const PORT = Number(process.env.MT_RELAY_PORT || 43128);
const SOCKET_URL = process.env.MT_SOCKET_URL || "wss://a1.ofalive99.net/game/ws";
const ORIGIN = process.env.MT_ORIGIN || "https://gsa.ofalive99.net";
const INGEST_URL = process.env.MT_INGEST_URL
  || "https://blackdomain-ai-v3-production.up.railway.app/api/mt/ingest";
const TABLES_ACTION = "/api/v1/gametype/*/game/*/room/*/tables";
const freshnessSetting = Number(process.env.MT_DATA_FRESHNESS_MS);
const DATA_FRESHNESS_MS = Number.isFinite(freshnessSetting) && freshnessSetting >= 1000 ? freshnessSetting : 15000;

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
let lastHandshakeStatus = null;
let lastCloseCode = null;
let lastCloseReason = null;
let transport = "direct";
let browserDiagnostics = null;
let browserWatchdog = null;
const unconfiguredBridgeSecret = crypto.randomBytes(32).toString("hex");

const PERSIST_CONFIG = process.platform === "win32" && process.env.MT_PERSIST_CONFIG !== "false";
const CONFIG_PATH = process.env.MT_CONFIG_PATH
  || path.join(os.homedir(), "AppData", "Local", "BLACKDOMAIN", "mt-relay.json");

function runConfigPowerShell(script, input = "") {
  const powershellEnv = { ...process.env };
  for (const key of Object.keys(powershellEnv)) {
    if (key.toLowerCase() === "psmodulepath") delete powershellEnv[key];
  }
  powershellEnv.BLACKDOMAIN_MT_CONFIG_PATH = CONFIG_PATH;
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    env: powershellEnv,
    input,
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || "Unable to protect MT configuration.").trim());
  return String(result.stdout || "").trim();
}

function persistConfig(token, relayKey) {
  if (!PERSIST_CONFIG) return;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$value = [Console]::In.ReadToEnd() | ConvertFrom-Json",
    "$target = $env:BLACKDOMAIN_MT_CONFIG_PATH",
    "$folder = Split-Path -Parent $target",
    "New-Item -ItemType Directory -Force -Path $folder | Out-Null",
    "$protectedToken = ConvertTo-SecureString ([string]$value.token) -AsPlainText -Force | ConvertFrom-SecureString",
    "$protectedKey = ConvertTo-SecureString ([string]$value.relayKey) -AsPlainText -Force | ConvertFrom-SecureString",
    "@{ token = $protectedToken; relayKey = $protectedKey } | ConvertTo-Json -Compress | Set-Content -LiteralPath $target -Encoding UTF8",
  ].join("; ");
  runConfigPowerShell(script, JSON.stringify({ token, relayKey }));
}

function loadPersistedConfig() {
  if (!PERSIST_CONFIG || !fs.existsSync(CONFIG_PATH)) return null;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$value = Get-Content -Raw -LiteralPath $env:BLACKDOMAIN_MT_CONFIG_PATH | ConvertFrom-Json",
    "function Reveal([string]$text) {",
    "  $secure = ConvertTo-SecureString -String $text",
    "  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }",
    "}",
    "@{ token = (Reveal $value.token); relayKey = (Reveal $value.relayKey) } | ConvertTo-Json -Compress",
  ].join("; ");
  const output = runConfigPowerShell(script);
  return output ? JSON.parse(output) : null;
}

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

function normalizeToken(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(input);
    const token = parsed.searchParams.get("token");
    if (token) return token.trim();
  } catch {
    // Plain MT tokens are valid input and do not need URL parsing.
  }
  return input;
}

async function forwardTables(tables) {
  if (!tables.length) throw new Error("No MT tables to forward.");
  if (!activeToken && !activeRelayKey) throw new Error("MT forwarding credentials are missing.");
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
  const text = String(raw ?? "");
  if (!text.trim()) return;
  try {
    lastMessageAt = new Date().toISOString();
    const message = JSON.parse(text);
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
  transport = "direct";
  activeToken = normalizeToken(token);
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
  lastHandshakeStatus = null;
  lastCloseCode = null;
  lastCloseReason = null;
  const nextSocket = new WebSocket(SOCKET_URL, {
    origin: ORIGIN,
    handshakeTimeout: 15000,
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
      "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "websocket",
      "sec-fetch-site": "same-site",
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
  nextSocket.on("unexpected-response", (_request, response) => {
    lastHandshakeStatus = Number(response?.statusCode) || null;
    lastError = `MT WebSocket handshake failed (${lastHandshakeStatus || "unknown"}).`;
    response.resume();
    nextSocket.terminate();
  });
  nextSocket.on("error", (error) => {
    if (!lastHandshakeStatus) lastError = error.message || error.code || "MT WebSocket connection failed.";
  });
  nextSocket.on("close", (code, reason) => {
    lastCloseCode = Number(code) || null;
    lastCloseReason = String(reason || "") || null;
    if (socket === nextSocket) socket = null;
    connectedAt = null;
    stopTimers();
    if (activeToken && !tokenRejected && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(activeToken);
      }, lastHandshakeStatus === 403 ? 60000 : 5000);
    }
  });
}

function publicStatus() {
  const tablesFresh = Boolean(lastTablesAt) && Date.now() - Date.parse(lastTablesAt) < DATA_FRESHNESS_MS;
  const forwardFresh = Boolean(lastForwardAt) && Date.now() - Date.parse(lastForwardAt) < DATA_FRESHNESS_MS;
  const state = transport === "browser"
    ? tablesFresh ? "connected" : "browser_waiting"
    : socket?.readyState === WebSocket.OPEN
    ? connectedAt ? "connected" : "authenticating"
    : tokenRejected ? "token_rejected" : "disconnected";
  return {
    state,
    healthy: state === "connected" && tablesFresh && forwardFresh && !lastError,
    transport,
    freshnessMs: DATA_FRESHNESS_MS,
    browserDiagnostics,
    browserWatchdog,
    connectedAt,
    lastForwardAt,
    lastMessageAt,
    lastTablesAt,
    lastError,
    lastHandshakeStatus,
    lastCloseCode,
    lastCloseReason,
  };
}

function html() {
  return fs.readFileSync(path.join(__dirname, "mt-relay-page.html"), "utf8");
}

const browserBridge = createBrowserBridge({
  port: PORT,
  onHealth: (health) => { browserWatchdog = health; },
  getSecret: () => crypto.createHmac("sha256", activeRelayKey || activeToken || unconfiguredBridgeSecret)
    .update("blackdomain-mt-browser-bridge-v1").digest("hex"),
  onTables: async (tables, diagnostics) => {
    if (transport !== "browser") {
      transport = "browser";
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopTimers();
      if (socket) {
        socket.removeAllListeners();
        socket.on("error", () => {});
        socket.terminate();
        socket = null;
      }
      connectedAt = new Date().toISOString();
      lastHandshakeStatus = null;
      lastCloseCode = null;
      lastCloseReason = null;
      tokenRejected = false;
    }
    lastMessageAt = new Date().toISOString();
    lastTablesAt = lastMessageAt;
    browserDiagnostics = diagnostics;
    try {
      await forwardTables(tables);
    } catch (error) {
      lastError = error.message;
      throw error;
    }
  },
});

const server = http.createServer(async (req, res) => {
  if (await browserBridge(req, res)) return;
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
        const token = normalizeToken(new URLSearchParams(body).get("token"));
        const relayKey = new URLSearchParams(body).get("relayKey");
        persistConfig(token, relayKey || activeRelayKey);
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
  let startupToken = String(process.env.MT_TOKEN || "").trim();
  let startupRelayKey = String(process.env.MT_RELAY_KEY || "").trim();
  if (!startupToken && PERSIST_CONFIG) {
    try {
      const saved = loadPersistedConfig();
      startupToken = String(saved?.token || "").trim();
      startupRelayKey = String(saved?.relayKey || "").trim();
    } catch (error) {
      lastError = error.message;
    }
  }
  if (startupToken) {
    try {
      connect(startupToken, startupRelayKey);
    } catch (error) {
      lastError = error.message;
    }
  }
});
