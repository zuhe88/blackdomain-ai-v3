const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { isPermutation, normalizeHistory } = require("./service");
const platformAuth = require("./platformAuth");

const DEFAULT_SOCKET_URL = "wss://socket-lottery.godeebxp.com/socket.io/?EIO=4&transport=websocket";
const seedPath = path.join(__dirname, "history-seed.json");

let history = [];
let source = "unavailable";
let targetPeriodId = null;
let updatedAt = null;
let pendingDraw = null;
let socket = null;
let connecting = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let socketAuthToken = String(process.env.ATG_SOCKET_AUTH_TOKEN || "").trim();
let initialTimer = null;

function isNewerOrEqualPeriod(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  try {
    return BigInt(String(candidate)) >= BigInt(String(current));
  } catch {
    return String(candidate).localeCompare(String(current), "en", { numeric: true }) >= 0;
  }
}

function advanceTargetPeriod(candidate) {
  if (isNewerOrEqualPeriod(candidate, targetPeriodId)) targetPeriodId = String(candidate);
}

function loadSeed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    history = normalizeHistory(parsed.results || []);
    targetPeriodId = parsed.targetPeriodId || null;
    updatedAt = parsed.updatedAt || null;
    if (history.length) source = "seed";
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[ATG] Unable to load history seed:", error.message);
  }
}

function parseSocketEvent(message) {
  const value = String(message || "");
  if (!value.startsWith("42")) return null;
  try {
    const parsed = JSON.parse(value.slice(2));
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return null;
    return { name: parsed[0], payload: parsed[1] || {} };
  } catch {
    return null;
  }
}

function addResult(record) {
  if (!record?.periodId || !isPermutation(record.result)) return;
  history = normalizeHistory([{ periodId: String(record.periodId), time: record.time, result: record.result }, ...history]);
  updatedAt = new Date().toISOString();
  source = "live";
}

function ingestSnapshot(payload = {}) {
  const normalized = normalizeHistory(payload.results || []);
  if (!normalized.length) return false;
  history = normalizeHistory([...normalized, ...history]);
  advanceTargetPeriod(payload.targetPeriodId);
  updatedAt = new Date().toISOString();
  source = "relay";
  return true;
}

function ingestResult(payload = {}) {
  if (!payload.periodId || !isPermutation(payload.result)) return false;
  addResult({
    periodId: String(payload.periodId),
    time: Number(payload.time) || Date.now(),
    result: payload.result,
  });
  source = "relay";
  advanceTargetPeriod(payload.nextPeriodId);
  return true;
}

function ingestState(payload = {}) {
  if (!payload.targetPeriodId) return false;
  advanceTargetPeriod(payload.targetPeriodId);
  updatedAt = new Date().toISOString();
  source = "relay";
  return true;
}

function handleInitial(payload) {
  const engine = payload?.engine;
  if (!engine || !Array.isArray(engine.results)) return;
  const normalized = normalizeHistory(engine.results);
  if (!normalized.length) return;
  history = normalized;
  targetPeriodId = engine.periodId ? String(engine.periodId) : targetPeriodId;
  updatedAt = new Date().toISOString();
  source = "live";
  if (initialTimer) clearTimeout(initialTimer);
  initialTimer = null;
}

function handleDrawNotify(payload) {
  const data = payload?.data || {};
  pendingDraw = {
    periodId: data.periodId ? String(data.periodId) : null,
    time: Number(data.serverCurrentTime) || Date.now(),
  };
  if (data.nextPeriodId) targetPeriodId = String(data.nextPeriodId);
}

function handleHorseAnime(payload) {
  const data = payload?.data || {};
  if (!pendingDraw?.periodId || !isPermutation(data.result)) return;
  addResult({ periodId: pendingDraw.periodId, time: pendingDraw.time, result: data.result });
  pendingDraw = null;
}

function handleSocketMessage(raw) {
  const value = raw.toString();
  if (value.startsWith("0")) {
    socket.send(socketAuthToken ? `40${JSON.stringify({ token: socketAuthToken })}` : "40");
    return;
  }
  if (value === "2") {
    socket.send("3");
    return;
  }
  if (value.startsWith("44")) {
    if (platformAuth.isConfigured() && !process.env.ATG_SOCKET_AUTH_TOKEN) socketAuthToken = "";
    socket.close();
    return;
  }

  const event = parseSocketEvent(value);
  if (!event) return;
  if (event.name === "initial") handleInitial(event.payload);
  if (event.name === "drawNotify") handleDrawNotify(event.payload);
  if (event.name === "horseAnime") handleHorseAnime(event.payload);
}

function hasLiveCredentials() {
  return Boolean(
    String(process.env.ATG_SOCKET_AUTH_TOKEN || "").trim() ||
    platformAuth.isConfigured()
  );
}

function scheduleReconnect() {
  if (reconnectTimer || process.env.ATG_DISABLE_LIVE === "true" || !hasLiveCredentials()) return;
  const delay = Math.min(60000, 2000 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectTimer.unref();
}

async function connect() {
  if (process.env.ATG_DISABLE_LIVE === "true" || !hasLiveCredentials() || socket || connecting) return false;
  connecting = true;
  try {
    socketAuthToken = String(process.env.ATG_SOCKET_AUTH_TOKEN || "").trim() || await platformAuth.fetchAtgSocketToken();
  } catch (error) {
    console.error("[ATG] Platform login failed:", error.message);
    connecting = false;
    scheduleReconnect();
    return false;
  }
  if (!socketAuthToken) {
    connecting = false;
    scheduleReconnect();
    return false;
  }

  const options = {};
  const origin = String(process.env.ATG_SOCKET_ORIGIN || "").trim();
  if (origin) options.origin = origin;

  try {
    socket = new WebSocket(process.env.ATG_SOCKET_URL || DEFAULT_SOCKET_URL, options);
  } catch (error) {
    console.error("[ATG] Socket connection failed:", error.message);
    socket = null;
    connecting = false;
    scheduleReconnect();
    return false;
  }
  socket.on("open", () => {
    reconnectAttempt = 0;
    initialTimer = setTimeout(() => {
      if (platformAuth.isConfigured() && !process.env.ATG_SOCKET_AUTH_TOKEN) socketAuthToken = "";
      socket?.close();
    }, 20000);
    initialTimer.unref();
  });
  socket.on("message", handleSocketMessage);
  socket.on("error", (error) => {
    console.error("[ATG] Socket error:", error.message);
  });
  socket.on("close", () => {
    if (initialTimer) clearTimeout(initialTimer);
    initialTimer = null;
    socket = null;
    scheduleReconnect();
  });
  connecting = false;
  return true;
}

function start() {
  return connect();
}

function getSnapshot() {
  return {
    history: history.map((record) => ({ ...record, result: [...record.result] })),
    source,
    targetPeriodId,
    updatedAt,
    connectionMode: process.env.ATG_SOCKET_AUTH_TOKEN
      ? "service-token"
      : platformAuth.isConfigured()
        ? "platform-login"
        : "browser-relay",
  };
}

loadSeed();

if (process.env.ATG_DISABLE_LIVE !== "true" && hasLiveCredentials()) {
  const startupTimer = setTimeout(start, 0);
  startupTimer.unref();
}

module.exports = {
  parseSocketEvent,
  getSnapshot,
  ingestSnapshot,
  ingestResult,
  ingestState,
  start,
};
