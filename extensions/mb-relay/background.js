"use strict";

const ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/mb/ingest";
const ELECTRONIC_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/ingest";
const ELECTRONIC_WATCH_ENDPOINT = "https://blackdomain-ai-v3-production.up.railway.app/api/electronic/watch-rooms";
const WATCHDOG_ALARM = "blackdomain-relay-watchdog";
const WATCHDOG_PERIOD_MINUTES = 1;
const HEARTBEAT_TIMEOUT_MS = 90 * 1000;
const GAME_DATA_TIMEOUT_MS = 3 * 60 * 1000;
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
const RELAY_TABS = [
  { kind: "mb", url: "https://mbracing.cc/*" },
  { kind: "electronic", url: "https://play.godeebxp.com/egames/*" },
];

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
      firstSeenAt: Number(previous.firstSeenAt) || Date.now(),
    },
  });
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
  const initialGraceActive = !health.heartbeatAt
    && now - Number(health.firstSeenAt || now) <= HEARTBEAT_TIMEOUT_MS;
  if ((!health.heartbeatAt || heartbeatStale || gameDataStale) && reloadAllowed && !initialGraceActive) {
    await chrome.storage.local.set({
      [key]: { ...health, kind, lastReloadAt: now },
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

chrome.runtime.onInstalled.addListener(installRelayWatchdog);
chrome.runtime.onStartup.addListener(installRelayWatchdog);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) runRelayWatchdog();
});
installRelayWatchdog();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BLACKDOMAIN_RELAY_HEARTBEAT") {
    rememberHeartbeat(message.kind, sender.tab?.id, message.dataAt)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  const isMb = message?.type === "BLACKDOMAIN_MB_FORWARD";
  const isElectronic = message?.type === "BLACKDOMAIN_ELECTRONIC_FORWARD";
  const isElectronicWatches = message?.type === "BLACKDOMAIN_ELECTRONIC_WATCHES";
  if (!isMb && !isElectronic && !isElectronicWatches) return false;
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
  const allowedTypes = isMb ? ["roadmap", "socket"] : ["tables", "updates", "detail", "spin"];
  if (!key || !body || !allowedTypes.includes(body.type)) {
    sendResponse({ ok: false, status: 400 });
    return false;
  }

  fetch(isMb ? ENDPOINT : ELECTRONIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [isMb ? "x-mb-relay-key" : "x-electronic-relay-key"]: key,
    },
    body: JSON.stringify(body),
  })
    .then((response) => {
      if (isElectronic) chrome.storage.local.set({ blackdomainElectronicLastStatus: { status: response.status, at: Date.now() } });
      sendResponse({ ok: response.ok, status: response.status });
    })
    .catch(() => {
      if (isElectronic) chrome.storage.local.set({ blackdomainElectronicLastStatus: { status: 0, at: Date.now() } });
      sendResponse({ ok: false, status: 0 });
    });
  return true;
});
