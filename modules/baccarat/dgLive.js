const crypto = require("crypto");
const WebSocket = require("ws");
const { decodePublicBean, encodePublicBean } = require("./dgProto");
const dgSource = require("./dgSource");

const DEFAULT_ORIGINS = [
  "https://new-dd-cn.20299999.com",
  "https://new-dd-cn.ahsy114.com",
];
const WS_KEY = "63dwReOhAlDbUoXiMFyZPgSvQc4JnTr7La0EjWf3Cu6NzBt9Ks1HxGq2Rd8Ym5Vp"
  .split("")
  .reverse()
  .join("");

let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let connecting = false;
let connectedAt = null;
let lastMessageAt = null;
let lastError = null;
let activeOrigin = null;

function origins() {
  const configured = String(process.env.DG_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
  return configured ? [configured] : DEFAULT_ORIGINS;
}

function encrypt(value) {
  const key = Buffer.from(WS_KEY, "utf8").subarray(0, 24);
  const cipher = crypto.createCipheriv("des-ede3", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]).toString("base64");
}

function signedToken(command, guestToken) {
  return encrypt(JSON.stringify({
    cmd: Number(command),
    token: guestToken,
    time: Date.now(),
  }));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      accept: "application/json",
      "user-agent": "BLACKDOMAIN-DG-Guest-Data/1.0",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function guestConnection() {
  let latestError = null;
  for (const origin of origins()) {
    try {
      const [tokenPayload, settings] = await Promise.all([
        fetchJson(`${origin}/apidata/game/h5`, { method: "POST" }),
        fetchJson(`${origin}/ddnewpc/game_settings.json`),
      ]);
      const token = String(tokenPayload.token || "");
      const socketUrl = String(
        process.env.DG_SOCKET_URL
          || settings.pc_h5?.game_wss_line2
          || settings.pc_h5?.game_wss_line3
          || settings.pc_h5?.game_wss_overseas
          || settings.pc_h5?.game_wss
          || "",
      );
      if (Number(tokenPayload.codeId) !== 0 || token.length < 16 || !socketUrl.startsWith("wss://")) {
        throw new Error("Invalid DG guest connection response.");
      }
      return { origin, socketUrl, token };
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError || new Error("DG guest connection is unavailable.");
}

function send(command, guestToken, fields = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(encodePublicBean({
    cmd: command,
    token: signedToken(command, guestToken),
    ...fields,
  }));
  return true;
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer || process.env.DG_DISABLE_LIVE === "true") return;
  const delay = Math.min(60000, 2000 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectTimer.unref();
}

function handleMessage(raw, guestToken) {
  try {
    const message = decodePublicBean(Buffer.from(raw));
    lastMessageAt = new Date().toISOString();
    lastError = null;
    dgSource.ingestMessage(message);
    if (Number(message.cmd) === 10086 && Number(message.codeId) === 0) {
      try {
        const login = JSON.parse(message.object || "{}");
        if (Array.isArray(login.tableList)) {
          dgSource.ingestMessage({ cmd: 27, table: login.tableList });
        }
      } catch {
        // The table snapshots below remain the source of truth.
      }
      send(2, guestToken, { lobbyId: 5, type: 0 });
      const secondLobbyTimer = setTimeout(() => {
        send(2, guestToken, { lobbyId: 6, type: 0 });
      }, 750);
      secondLobbyTimer.unref();
    }
  } catch (error) {
    lastError = `Decode: ${error.message}`;
  }
}

async function connect() {
  if (process.env.DG_DISABLE_LIVE === "true" || socket || connecting) return false;
  connecting = true;
  try {
    const connection = await guestConnection();
    const sign = encrypt(connection.token);
    const nextSocket = new WebSocket(`${connection.socketUrl}/?sign=${sign}`, {
      origin: connection.origin,
      handshakeTimeout: 15000,
    });
    socket = nextSocket;

    nextSocket.on("open", () => {
      reconnectAttempt = 0;
      connectedAt = new Date().toISOString();
      activeOrigin = connection.origin;
      lastError = null;
      send(10086, connection.token, { tableId: 1, type: 0, object: "PC" });
      stopHeartbeat();
      heartbeatTimer = setInterval(() => send(99, connection.token), 3000);
      heartbeatTimer.unref();
    });
    nextSocket.on("message", (raw) => handleMessage(raw, connection.token));
    nextSocket.on("error", (error) => {
      lastError = error.message;
    });
    nextSocket.on("close", () => {
      if (socket === nextSocket) socket = null;
      stopHeartbeat();
      connectedAt = null;
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
    enabled: process.env.DG_DISABLE_LIVE !== "true",
    state: socket?.readyState === WebSocket.OPEN ? "connected" : connecting ? "connecting" : "disconnected",
    connectedAt,
    lastMessageAt,
    lastError,
    origin: activeOrigin,
  };
}

function start() {
  return connect();
}

if (process.env.DG_DISABLE_LIVE !== "true") {
  const startupTimer = setTimeout(start, 0);
  startupTimer.unref();
}

module.exports = {
  connect,
  encrypt,
  getStatus,
  signedToken,
  start,
};
