const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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

function encryptionSecret() {
  return String(process.env.DG_RELAY_KEY || process.env.ATG_RELAY_KEY || "").trim();
}

function sealToken(value) {
  if (!encryptionSecret()) throw new Error("MT token encryption is not configured.");
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(encryptionSecret()).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function unsealToken(value) {
  if (!encryptionSecret()) return "";
  try {
    const [version, iv, tag, encrypted] = String(value || "").trim().split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) return "";
    const key = crypto.createHash("sha256").update(encryptionSecret()).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function storedToken() {
  try {
    const file = path.join(__dirname, "../../config/mt-token.enc");
    return unsealToken(fs.readFileSync(file, "utf8"));
  } catch {
    return "";
  }
}

function token() {
  return String(process.env.MT_GAME_TOKEN || storedToken()).trim();
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

function validateToken(value) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (valid) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        validationSocket.close();
      } catch {
        // The timeout below remains the final guard.
      }
      resolve(valid);
    };
    const validationSocket = new WebSocket(process.env.MT_SOCKET_URL || DEFAULT_SOCKET_URL, {
      origin: process.env.MT_ORIGIN || DEFAULT_ORIGIN,
      handshakeTimeout: 10000,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
    });
    const timeout = setTimeout(() => finish(false), 12000);
    validationSocket.on("open", () => validationSocket.send(JSON.stringify({
      method: "POST",
      action: { name: "/api/v1/authenticate" },
      body: { type: 3, token: String(value || "") },
    })));
    validationSocket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        const action = typeof message.action === "string" ? message.action : message.action?.name;
        if (action === "/api/v1/authenticate") finish(Number(message.err) === 0);
        if (message.name === "/api/v1/member/logout") finish(false);
      } catch {
        finish(false);
      }
    });
    validationSocket.on("error", () => finish(false));
  });
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
  sealToken,
  start,
  unsealToken,
  validateToken,
};
