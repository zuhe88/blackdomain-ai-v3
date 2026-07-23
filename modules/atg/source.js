const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { isPermutation, normalizeHistory } = require("./service");

const DEFAULT_SOCKET_URL = "wss://socket-lottery.godeebxp.com/socket.io/?EIO=4&transport=websocket";
const seedPath = path.join(__dirname, "history-seed.json");

let history = [];
let source = "unavailable";
let targetPeriodId = null;
let updatedAt = null;
let pendingDraw = null;
let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

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
  history = normalized;
  targetPeriodId = payload.targetPeriodId ? String(payload.targetPeriodId) : targetPeriodId;
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
  if (payload.nextPeriodId) targetPeriodId = String(payload.nextPeriodId);
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
    const authToken = String(process.env.ATG_SOCKET_AUTH_TOKEN || "").trim();
    socket.send(authToken ? `40${JSON.stringify({ token: authToken })}` : "40");
    return;
  }
  if (value === "2") {
    socket.send("3");
    return;
  }

  const event = parseSocketEvent(value);
  if (!event) return;
  if (event.name === "initial") handleInitial(event.payload);
  if (event.name === "drawNotify") handleDrawNotify(event.payload);
  if (event.name === "horseAnime") handleHorseAnime(event.payload);
}

function scheduleReconnect() {
  if (reconnectTimer || process.env.ATG_DISABLE_LIVE === "true" || !process.env.ATG_SOCKET_AUTH_TOKEN) return;
  const delay = Math.min(60000, 2000 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectTimer.unref();
}

function connect() {
  const authToken = String(process.env.ATG_SOCKET_AUTH_TOKEN || "").trim();
  if (process.env.ATG_DISABLE_LIVE === "true" || !authToken || socket) return false;

  const options = {};
  const origin = String(process.env.ATG_SOCKET_ORIGIN || "").trim();
  if (origin) options.origin = origin;

  socket = new WebSocket(process.env.ATG_SOCKET_URL || DEFAULT_SOCKET_URL, options);
  socket.on("open", () => {
    reconnectAttempt = 0;
  });
  socket.on("message", handleSocketMessage);
  socket.on("error", (error) => {
    console.error("[ATG] Socket error:", error.message);
  });
  socket.on("close", () => {
    socket = null;
    scheduleReconnect();
  });
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
  };
}

loadSeed();

if (process.env.ATG_DISABLE_LIVE !== "true" && process.env.ATG_SOCKET_AUTH_TOKEN) {
  const startupTimer = setTimeout(start, 0);
  startupTimer.unref();
}

module.exports = {
  parseSocketEvent,
  getSnapshot,
  ingestSnapshot,
  ingestResult,
  start,
};
