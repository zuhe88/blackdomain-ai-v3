const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const WebSocket = require("ws");
const { isPermutation } = require("../modules/atg/service");
const platformAuth = require("../modules/atg/platformAuth");

const SOCKET_URL = "wss://socket-lottery.godeebxp.com/socket.io/?EIO=4&transport=websocket";
const SOCKET_ORIGIN = "https://play.godeebxp.com";
const localDataDirectory = path.join(process.env.LOCALAPPDATA || process.cwd(), "BLACKDOMAIN");
const logPath = path.join(localDataDirectory, "atg-relay.log");
const secretsReader = path.join(__dirname, "read-atg-local-secrets.ps1");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let secrets;
let socket = null;
let socketToken = "";
let pendingDraw = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let watchdogTimer = null;
let lastSocketEventAt = 0;

function log(level, message) {
  fs.mkdirSync(localDataDirectory, { recursive: true });
  try {
    if (fs.statSync(logPath).size >= MAX_LOG_BYTES) {
      const previousLogPath = `${logPath}.previous`;
      fs.rmSync(previousLogPath, { force: true });
      fs.renameSync(logPath, previousLogPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.error(error.message);
  }
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
  console.log(line);
}

function loadSecrets() {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    secretsReader,
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "Unable to read encrypted settings.").trim());
  return JSON.parse(String(result.stdout).replace(/^\uFEFF/, "").trim());
}

async function sendToRailway(body, attempt = 0) {
  try {
    const response = await fetch(`${secrets.relayUrl}/api/atg/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atg-relay-key": secrets.relayKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    log("SYNC", `${body.type} ${body.periodId || body.targetPeriodId || ""}`.trim());
  } catch (error) {
    if (attempt >= 5) {
      log("ERROR", `Railway sync failed: ${error.message}`);
      return;
    }
    const delay = Math.min(30000, 1000 * (2 ** attempt));
    setTimeout(() => sendToRailway(body, attempt + 1), delay).unref();
  }
}

function parseEvent(value) {
  if (!value.startsWith("42")) return null;
  try {
    const packet = JSON.parse(value.slice(2));
    return Array.isArray(packet) ? { name: packet[0], payload: packet[1] || {} } : null;
  } catch {
    return null;
  }
}

function handlePacket(value) {
  lastSocketEventAt = Date.now();
  if (value.startsWith("0")) {
    socket.send(`40${JSON.stringify({ token: socketToken })}`);
    return;
  }
  if (value === "2") {
    socket.send("3");
    return;
  }
  if (value.startsWith("44")) {
    log("WARN", "ATG socket rejected the launch token.");
    socketToken = "";
    socket.close();
    return;
  }

  const event = parseEvent(value);
  if (!event) return;
  if (event.name === "initial" && Array.isArray(event.payload.engine?.results)) {
    const engine = event.payload.engine;
    sendToRailway({
      type: "snapshot",
      targetPeriodId: String(engine.periodId || ""),
      results: engine.results.map((item) => ({
        periodId: String(item.periodId || ""),
        time: Number(item.time) || null,
        result: item.result,
      })),
    });
    return;
  }
  if (event.name === "drawNotify") {
    const data = event.payload.data || {};
    pendingDraw = {
      periodId: String(data.periodId || ""),
      nextPeriodId: String(data.nextPeriodId || ""),
      time: Number(data.serverCurrentTime) || Date.now(),
    };
    if (data.nextPeriodId) {
      sendToRailway({
        type: "state",
        targetPeriodId: String(data.nextPeriodId),
        currentPeriodId: String(data.periodId || ""),
        time: pendingDraw.time,
      });
    }
    return;
  }
  if (event.name === "horseAnime" && pendingDraw && isPermutation(event.payload.data?.result)) {
    sendToRailway({
      type: "result",
      ...pendingDraw,
      result: event.payload.data.result,
    });
    pendingDraw = null;
  }
}

function handleMessage(buffer) {
  String(buffer)
    .split("\x1e")
    .filter(Boolean)
    .forEach(handlePacket);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(60000, 2000 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  log("INFO", `Reconnect scheduled in ${Math.round(delay / 1000)} seconds.`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function connect() {
  if (socket) return;
  try {
    process.env.ATG_PLATFORM_URL = secrets.platformUrl;
    process.env.ATG_PLATFORM_USERNAME = secrets.username;
    process.env.ATG_PLATFORM_PASSWORD = secrets.password;
    process.env.ATG_PLATFORM_DEVICE_ID = secrets.deviceId;
    socketToken = await platformAuth.fetchAtgSocketToken();
    socket = new WebSocket(SOCKET_URL, { origin: SOCKET_ORIGIN });
    socket.on("open", () => {
      reconnectAttempt = 0;
      lastSocketEventAt = Date.now();
      log("INFO", "ATG socket connected.");
    });
    socket.on("message", handleMessage);
    socket.on("error", (error) => log("ERROR", `ATG socket error: ${error.message}`));
    socket.on("close", () => {
      socket = null;
      socketToken = "";
      scheduleReconnect();
    });
  } catch (error) {
    log("ERROR", `ATG login failed: ${error.message}`);
    scheduleReconnect();
  }
}

function startWatchdog() {
  watchdogTimer = setInterval(() => {
    if (!socket || Date.now() - lastSocketEventAt < 150000) return;
    log("WARN", "No ATG socket data for 150 seconds; reconnecting.");
    socket.close();
  }, 30000);
  watchdogTimer.unref();
}

function shutdown() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (socket) socket.close();
  process.exit(0);
}

try {
  secrets = loadSecrets();
  log("INFO", "BLACKDOMAIN ATG background relay starting.");
  startWatchdog();
  connect();
} catch (error) {
  log("ERROR", error.message);
  process.exitCode = 1;
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
