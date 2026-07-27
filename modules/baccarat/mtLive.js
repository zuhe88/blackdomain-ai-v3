const WebSocket = require("ws");
const mtSource = require("./mtSource");

const DEFAULT_SOCKET_URL = "wss://a1.ofalive99.net/game/ws";
const DEFAULT_ORIGIN = "https://gsa.ofalive99.net";
const TABLES_ACTION = "/api/v1/gametype/*/game/*/room/*/tables";

let socket = null;
let heartbeatTimer = null;
let refreshTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let connecting = false;
let authenticated = false;
let connectedAt = null;
let lastMessageAt = null;
let lastError = null;

function token() {
  return String(process.env.MT_GAME_TOKEN || "").trim();
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

function clearTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  heartbeatTimer = null;
  refreshTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer || process.env.MT_DISABLE_LIVE === "true" || !token()) return;
  const delay = Math.min(60000, 2000 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectTimer.unref();
}

function handleMessage(raw) {
  try {
    const message = JSON.parse(String(raw));
    const action = typeof message.action === "string" ? message.action : message.action?.name;
    lastMessageAt = new Date().toISOString();
    if (action === "/api/v1/authenticate") {
      if (Number(message.err) !== 0) {
        authenticated = false;
        lastError = `MT authentication failed (${message.err ?? "unknown"}).`;
        socket?.close();
        return;
      }
      authenticated = true;
      lastError = null;
      requestTables();
      return;
    }
    if (action === TABLES_ACTION) {
      mtSource.ingestMessage(message);
      lastError = null;
      return;
    }
    if (authenticated && typeof message.action === "object" && message.body?.table_id != null) {
      requestTables();
    }
  } catch (error) {
    lastError = `MT decode failed: ${error.message}`;
  }
}

async function connect() {
  if (process.env.MT_DISABLE_LIVE === "true" || !token() || socket || connecting) return false;
  connecting = true;
  try {
    const nextSocket = new WebSocket(process.env.MT_SOCKET_URL || DEFAULT_SOCKET_URL, {
      origin: process.env.MT_ORIGIN || DEFAULT_ORIGIN,
      handshakeTimeout: 15000,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
    });
    socket = nextSocket;
    nextSocket.on("open", () => {
      reconnectAttempt = 0;
      connectedAt = new Date().toISOString();
      lastError = null;
      send({
        method: "POST",
        action: { name: "/api/v1/authenticate" },
        body: { type: 3, token: token() },
      });
      heartbeatTimer = setInterval(() => send({
        method: "POST",
        action: { name: "/api/v1/ping" },
      }), 5000);
      refreshTimer = setInterval(requestTables, 2000);
      heartbeatTimer.unref();
      refreshTimer.unref();
    });
    nextSocket.on("message", handleMessage);
    nextSocket.on("error", (error) => {
      lastError = error.message;
    });
    nextSocket.on("close", () => {
      if (socket === nextSocket) socket = null;
      authenticated = false;
      connectedAt = null;
      clearTimers();
      scheduleReconnect();
    });
    return true;
  } catch (error) {
    lastError = error.message;
    scheduleReconnect();
    return false;
  } finally {
    connecting = false;
  }
}

function getStatus() {
  return {
    enabled: process.env.MT_DISABLE_LIVE !== "true",
    configured: Boolean(token()),
    state: socket?.readyState === WebSocket.OPEN
      ? authenticated ? "connected" : "authenticating"
      : connecting ? "connecting" : "disconnected",
    connectedAt,
    lastMessageAt,
    lastError,
    origin: process.env.MT_ORIGIN || DEFAULT_ORIGIN,
  };
}

function start() {
  return connect();
}

if (process.env.MT_DISABLE_LIVE !== "true" && token()) {
  const startupTimer = setTimeout(start, 0);
  startupTimer.unref();
}

module.exports = {
  connect,
  getStatus,
  handleMessage,
  requestTables,
  start,
};
