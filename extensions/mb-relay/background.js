"use strict";

const ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/mb/ingest";
const ELECTRONIC_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/ingest";
const ATG_HORSE_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/atg/ingest";
const ELECTRONIC_WATCH_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/watch-rooms";
const WATCHDOG_ALARM = "blackdomain-relay-watchdog";
const WATCHDOG_PERIOD_MINUTES = 1;
const HEARTBEAT_TIMEOUT_MS = 90 * 1000;
const GAME_DATA_TIMEOUT_MS = 3 * 60 * 1000;
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
const TOKEN_RECOVERY_DELAY_MS = 90 * 1000;
const TOKEN_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const TOKEN_ERROR_RECOVERY_COOLDOWN_MS = 30 * 1000;
const SESSION_NOTICE_COOLDOWN_MS = 60 * 1000;
const RELAY_TABS = [
  { kind: "mb", url: "https://mbracing.cc/*" },
  { kind: "electronic", url: "https://play.godeebxp.com/egames/*" },
];
let lastExpiredSessionNoticeAt = 0;

async function invalidateRelaySession(reason = "3a-session-expired") {
  const now = Date.now();
  await chrome.storage.local.set({ blackdomain3aSessionExpired: true });
  if (now - lastExpiredSessionNoticeAt < SESSION_NOTICE_COOLDOWN_MS) return true;
  lastExpiredSessionNoticeAt = now;
  const saved = await chrome.storage.local.get([
    "blackdomainMbRelayKey",
    "blackdomainElectronicRelayKey",
  ]);
  const mbKey = String(saved.blackdomainMbRelayKey || "").trim();
  const electronicKey = String(saved.blackdomainElectronicRelayKey || mbKey).trim();
  const body = JSON.stringify({
    type: "session",
    state: "expired",
    reason,
    observedAt: new Date(now).toISOString(),
  });
  const requests = [];
  if (mbKey) requests.push(fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mb-relay-key": mbKey },
    body,
  }));
  if (electronicKey) requests.push(fetch(ELECTRONIC_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-electronic-relay-key": electronicKey },
    body,
  }));
  const responses = await Promise.allSettled(requests);
  return responses.length > 0 && responses.every((result) => (
    result.status === "fulfilled" && result.value.ok
  ));
}

async function restoreRelayGamesAfterLogin() {
  const saved = await chrome.storage.local.get("blackdomain3aSessionExpired");
  if (!saved.blackdomain3aSessionExpired) return true;
  await chrome.storage.local.set({ blackdomain3aSessionExpired: false });
  const [mbTabs, electronicTabs] = await Promise.all([
    chrome.tabs.query({ url: "https://mbracing.cc/*" }).catch(() => []),
    chrome.tabs.query({ url: "https://play.godeebxp.com/egames/*" }).catch(() => []),
  ]);
  await Promise.all(mbTabs.map((tab) => (
    Number.isInteger(tab.id) ? chrome.tabs.reload(tab.id).catch(() => {}) : null
  )));
  await Promise.all(electronicTabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const now = Date.now();
    if (isAtgLobby(tab.url)) {
      try {
        const lobby = new URL(tab.url);
        const key = healthKey(tab.id);
        const savedRecovery = await chrome.storage.local.get([key, "blackdomainAtgRecoveryLobbyUrl"]);
        const recovery = refreshRecoveryLobbyUrl(
          savedRecovery[key]?.recoveryLobbyUrl || savedRecovery.blackdomainAtgRecoveryLobbyUrl,
          now,
        );
        const recoveryGame = recovery
          ? new URL(recovery).searchParams.get("blackdomain_reopen")
          : "";
        if (recoveryGame) lobby.searchParams.set("blackdomain_reopen", recoveryGame);
        lobby.searchParams.set("blackdomain_recovered_at", String(now));
        await chrome.tabs.update(tab.id, { url: lobby.href });
      } catch {
        // The watchdog will retry an unavailable lobby tab.
      }
      return;
    }
    const key = healthKey(tab.id);
    const health = (await chrome.storage.local.get(key))[key] || {};
    await recoverAtgToken(tab, health, key, now);
  }));
  return true;
}

function healthKey(tabId) {
  return `blackdomainRelayHealth:${tabId}`;
}

async function rememberHeartbeat(kind, tabId, dataAt = 0) {
  if (!Number.isInteger(tabId)) return;
  const key = healthKey(tabId);
  const saved = await chrome.storage.local.get(key);
  const previous = saved[key] || {};
  await chrome.storage.local.set({
    [key]: {
      kind,
      heartbeatAt: Date.now(),
      dataAt: Math.max(Number(previous.dataAt) || 0, Number(dataAt) || 0),
      lastReloadAt: Number(previous.lastReloadAt) || 0,
      reloadDataAt: Number(previous.reloadDataAt) || 0,
      reloadAttempts: Number(previous.reloadAttempts) || 0,
      lastTokenRecoveryAt: Number(previous.lastTokenRecoveryAt) || 0,
      recoveryLobbyUrl: String(previous.recoveryLobbyUrl || ""),
      firstSeenAt: Number(previous.firstSeenAt) || Date.now(),
    },
  });
}

function isAtgLobby(url) {
  try {
    return new URL(url).pathname.includes("/egames/lobby/game/");
  } catch {
    return false;
  }
}

function atgGameId(url) {
  try {
    const match = new URL(url).pathname.match(/\/egames\/([^/]+)\/game\//i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function buildFreshTokenLobbyUrl(gameUrl, now) {
  try {
    const current = new URL(gameUrl);
    const rawLobbyUrl = current.searchParams.get("goback_url");
    if (!rawLobbyUrl) return "";
    const lobby = new URL(rawLobbyUrl);
    if (lobby.hostname !== current.hostname || !isAtgLobby(lobby.href)) return "";
    const gameId = atgGameId(current.href);
    if (!gameId) return "";
    lobby.searchParams.set("blackdomain_reopen", gameId);
    lobby.searchParams.set("blackdomain_recovered_at", String(now));
    return lobby.href;
  } catch {
    return "";
  }
}

function refreshRecoveryLobbyUrl(value, now) {
  try {
    const lobby = new URL(value);
    if (lobby.hostname !== "play.godeebxp.com" || !isAtgLobby(lobby.href)) return "";
    if (!lobby.searchParams.get("blackdomain_reopen")) return "";
    lobby.searchParams.set("blackdomain_recovered_at", String(now));
    return lobby.href;
  } catch {
    return "";
  }
}

async function recoverAtgToken(tab, health, key, now) {
  let lobbyUrl = buildFreshTokenLobbyUrl(tab.url, now);
  if (lobbyUrl) {
    await chrome.storage.local.set({ blackdomainAtgRecoveryLobbyUrl: lobbyUrl });
  } else {
    const saved = await chrome.storage.local.get("blackdomainAtgRecoveryLobbyUrl");
    lobbyUrl = refreshRecoveryLobbyUrl(
      health.recoveryLobbyUrl || saved.blackdomainAtgRecoveryLobbyUrl,
      now,
    );
  }
  if (!lobbyUrl) return false;
  await chrome.storage.local.set({
    [key]: {
      ...health,
      kind: "electronic",
      lastTokenRecoveryAt: now,
      reloadAttempts: 0,
      recoveryLobbyUrl: lobbyUrl,
    },
  });
  try {
    await chrome.tabs.update(tab.id, { url: lobbyUrl });
    return true;
  } catch {
    return false;
  }
}

async function pingRelayTab(tabId, kind) {
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "BLACKDOMAIN_RELAY_PING", kind }),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
  } catch {
    return null;
  }
}

async function inspectRelayTab(tab, kind) {
  if (!Number.isInteger(tab?.id)) return;
  const key = healthKey(tab.id);
  const saved = await chrome.storage.local.get(key);
  let health = saved[key] || {};
  const now = Date.now();
  if (!health.firstSeenAt) {
    health = { ...health, kind, firstSeenAt: now };
    await chrome.storage.local.set({ [key]: health });
  }
  if (now - Number(health.heartbeatAt || 0) > HEARTBEAT_TIMEOUT_MS) {
    const response = await pingRelayTab(tab.id, kind);
    if (response?.ok) {
      await rememberHeartbeat(kind, tab.id, response.dataAt);
      const refreshed = await chrome.storage.local.get(key);
      health = refreshed[key] || health;
    }
  }
  const heartbeatStale = now - Number(health.heartbeatAt || 0) > HEARTBEAT_TIMEOUT_MS;
  const gameDataStale = now - Number(health.dataAt || 0) > GAME_DATA_TIMEOUT_MS;
  const reloadAllowed = now - Number(health.lastReloadAt || 0) > RELOAD_COOLDOWN_MS;
  const dataAdvancedAfterReload = Number(health.dataAt || 0) > Number(health.reloadDataAt || 0);
  const tokenRecoveryDue = kind === "electronic"
    && gameDataStale
    && Number(health.reloadAttempts || 0) > 0
    && !dataAdvancedAfterReload
    && now - Number(health.lastReloadAt || 0) >= TOKEN_RECOVERY_DELAY_MS
    && now - Number(health.lastTokenRecoveryAt || 0) >= TOKEN_RECOVERY_COOLDOWN_MS;
  const initialGraceActive = !health.heartbeatAt
    && now - Number(health.firstSeenAt || now) <= HEARTBEAT_TIMEOUT_MS;
  if (tokenRecoveryDue && await recoverAtgToken(tab, health, key, now)) return;
  if ((!health.heartbeatAt || heartbeatStale || gameDataStale) && reloadAllowed && !initialGraceActive) {
    await chrome.storage.local.set({
      [key]: {
        ...health,
        kind,
        lastReloadAt: now,
        reloadDataAt: Number(health.dataAt) || 0,
        reloadAttempts: Number(health.reloadAttempts || 0) + 1,
      },
    });
    try {
      await chrome.tabs.reload(tab.id);
    } catch {
      // A later alarm retries tabs that are temporarily unavailable.
    }
  }
}

async function runRelayWatchdog() {
  for (const target of RELAY_TABS) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: target.url });
    } catch {
      continue;
    }
    await Promise.all(tabs.map((tab) => inspectRelayTab(tab, target.kind)));
  }
}

function installRelayWatchdog() {
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  runRelayWatchdog();
}

async function clickAtgCanvas(tab, x, y) {
  if (!Number.isInteger(tab?.id)) return false;
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return false;
  }
  if (url.hostname !== "play.godeebxp.com" || !url.pathname.includes("/egames/") || !url.pathname.includes("/game/")) {
    return false;
  }
  const clientX = Number(x);
  const clientY = Number(y);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || clientX < 0 || clientY < 0) return false;
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: clientX,
      y: clientY,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: clientX,
      y: clientY,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: clientX,
      y: clientY,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(installRelayWatchdog);
chrome.runtime.onStartup.addListener(installRelayWatchdog);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) runRelayWatchdog();
});
installRelayWatchdog();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BLACKDOMAIN_ATG_ENTRY_CLICK") {
    clickAtgCanvas(sender.tab, message.x, message.y)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "BLACKDOMAIN_3A_SESSION_STATE") {
    if (message.state === "active") {
      restoreRelayGamesAfterLogin()
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (message.state !== "expired") {
      sendResponse({ ok: false });
      return false;
    }
    invalidateRelaySession(message.reason)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "BLACKDOMAIN_ATG_SESSION_STALE") {
    const tab = sender.tab;
    const key = healthKey(tab?.id);
    chrome.storage.local.get(key)
      .then(async (saved) => {
        const health = saved[key] || {};
        const now = Date.now();
        if (now - Number(health.lastTokenRecoveryAt || 0) < TOKEN_ERROR_RECOVERY_COOLDOWN_MS) {
          return false;
        }
        return recoverAtgToken(tab, health, key, now);
      })
      .then((recovered) => sendResponse({ ok: Boolean(recovered) }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "BLACKDOMAIN_RELAY_HEARTBEAT") {
    rememberHeartbeat(message.kind, sender.tab?.id, message.dataAt)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  const isMb = message?.type === "BLACKDOMAIN_MB_FORWARD";
  const isElectronic = message?.type === "BLACKDOMAIN_ELECTRONIC_FORWARD";
  const isAtgHorse = message?.type === "BLACKDOMAIN_ATG_HORSE_FORWARD";
  const isElectronicWatches = message?.type === "BLACKDOMAIN_ELECTRONIC_WATCHES";
  if (!isMb && !isElectronic && !isAtgHorse && !isElectronicWatches) return false;
  const key = String(message.key || "").trim();
  const body = message.body;
  if (isElectronicWatches) {
    if (!key) {
      sendResponse({ ok: false, status: 400 });
      return false;
    }
    fetch(ELECTRONIC_WATCH_ENDPOINT, {
      headers: { "x-electronic-relay-key": key },
    })
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        sendResponse({ ok: response.ok, status: response.status, data });
      })
      .catch(() => sendResponse({ ok: false, status: 0 }));
    return true;
  }
  const allowedTypes = isMb
    ? ["roadmap", "socket"]
    : isAtgHorse ? ["snapshot", "state", "result"] : ["tables", "updates", "detail", "spin"];
  if (!key || !body || !allowedTypes.includes(body.type)) {
    sendResponse({ ok: false, status: 400 });
    return false;
  }

  const endpoint = isMb ? ENDPOINT : isAtgHorse ? ATG_HORSE_ENDPOINT : ELECTRONIC_ENDPOINT;
  const headerName = isMb ? "x-mb-relay-key" : isAtgHorse ? "x-atg-relay-key" : "x-electronic-relay-key";
  fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [headerName]: key,
    },
    body: JSON.stringify(body),
  })
    .then((response) => {
      if (isElectronic) chrome.storage.local.set({ blackdomainElectronicLastStatus: { status: response.status, at: Date.now() } });
      if (isAtgHorse) chrome.storage.local.set({ blackdomainAtgHorseLastStatus: { status: response.status, at: Date.now() } });
      sendResponse({ ok: response.ok, status: response.status });
    })
    .catch(() => {
      if (isElectronic) chrome.storage.local.set({ blackdomainElectronicLastStatus: { status: 0, at: Date.now() } });
      if (isAtgHorse) chrome.storage.local.set({ blackdomainAtgHorseLastStatus: { status: 0, at: Date.now() } });
      sendResponse({ ok: false, status: 0 });
    });
  return true;
});
