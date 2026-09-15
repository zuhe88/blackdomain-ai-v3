importScripts("pairing.js", "watchdog.js");

const ALARM = "blackdomain-mt-recovery";
const STORAGE_KEY = "mtRecoveryTabs";
let records;
let loading;
let checking = false;
const localBase = new URL(MT_BRIDGE_CONFIG.endpoint).origin;
async function loadRecords() {
  if (!loading) loading = chrome.storage.session.get(STORAGE_KEY).then((value) => {
    records = value[STORAGE_KEY] || {};
    return records;
  });
  return loading;
}
function persist() { return chrome.storage.session.set({ [STORAGE_KEY]: records }); }
function allowedPage(url) {
  try { return new URL(url).origin === "https://gsa.ofalive99.net"; } catch { return false; }
}
async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}
function bounded(promise, milliseconds = 3000) {
  let timer;
  return Promise.race([promise.catch(() => null), new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
async function postLocal(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-blackdomain-bridge-key": MT_BRIDGE_CONFIG.bridgeKey },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  return response.ok ? value : { ok: false, error: value.error || `HTTP ${response.status}` };
}
async function track(tabId) {
  await loadRecords();
  const key = String(tabId);
  records[key] ||= { firstSeenAt: Date.now(), lastCapturedAt: 0, lastPollAt: 0, reloadTimes: [] };
  return records[key];
}
const notices = {
  receiving: "正在接收新桌況",
  request_tables: "自動修復：正在重新請求桌況",
  waiting_after_request: "自動修復：等待新桌況回應",
  reload_background: "自動修復：重新整理背景 MT 分頁",
  reload_cooldown: "已嘗試重新整理，正在等待 MT 恢復",
  login_required: "MT 登入已失效，請由平台重新進入 MT",
  recovery_limit: "本小時已自動修復兩次，請檢查 MT 登入或錯誤畫面",
  foreground_waiting: "MT 停止更新；目前分頁在前景，請自行確認是否重新整理",
  local_unavailable: "無法連接本機轉發器，請確認背景程式",
  tab_unavailable: "MT 分頁已關閉或離開 MT 網站",
};
async function checkTabs() {
  if (checking) return;
  checking = true;
  try {
    await loadRecords();
    if (!Object.keys(records).length) return;
    const localAvailable = await fetch(`${localBase}/status`, { signal: AbortSignal.timeout(5000), cache: "no-store" })
      .then((response) => response.ok).catch(() => false);
    for (const [key, record] of Object.entries(records)) {
      const tabId = Number(key);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const permitted = Boolean(tab && allowedPage(tab.url));
      const health = permitted ? await bounded(chrome.tabs.sendMessage(tabId, { type: "BLACKDOMAIN_MT_HEALTH" })) : null;
      const now = Date.now();
      const decision = MT_RECOVERY_DECISION(record, {
        tabExists: Boolean(tab), allowedPage: permitted, localAvailable,
        requiresLogin: health?.requiresLogin === true,
        hidden: health?.visibility === "hidden" || (!health && tab?.active === false),
      }, now);
      record.reloadTimes = (record.reloadTimes || []).filter((time) => now - time < 3600000);
      if (decision === "request_tables") record.lastPollAt = now;
      if (decision === "reload_background") {
        // Recheck the destination after the health request, in case the user navigated away.
        const latest = await chrome.tabs.get(tabId).catch(() => null);
        if (!latest || !allowedPage(latest.url)) continue;
        const latestHealth = await bounded(chrome.tabs.sendMessage(tabId, { type: "BLACKDOMAIN_MT_HEALTH" }));
        if (latestHealth?.requiresLogin || latestHealth?.visibility === "visible"
          || (!latestHealth && latest.active !== false)) continue;
        if (Date.now() - record.lastCapturedAt < 15000) continue;
        record.reloadTimes.push(now);
        await persist();
        await chrome.tabs.reload(tabId).catch(() => {});
      }
      if (permitted) await bounded(chrome.tabs.sendMessage(tabId, {
        type: "BLACKDOMAIN_MT_RECOVERY_NOTICE", text: notices[decision],
      }));
      await postLocal(`${localBase}/browser-health`, {
        state: decision, reloadCount: record.reloadTimes.length,
        lastReloadAt: record.reloadTimes.length ? new Date(record.reloadTimes[record.reloadTimes.length - 1]).toISOString() : null,
      }).catch(() => {});
      if (!permitted) delete records[key];
    }
    await persist();
  } finally { checking = false; }
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void checkTabs().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); });
void ensureAlarm().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let source;
  try { source = new URL(sender.url); } catch { return false; }
  if (source.origin !== "https://gsa.ofalive99.net" || sender.id !== chrome.runtime.id
    || !Number.isInteger(sender.tab?.id)) return false;
  if (message?.type === "BLACKDOMAIN_MT_REGISTER") {
    track(sender.tab.id).then(persist).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (message?.type !== "BLACKDOMAIN_MT_BROWSER_TABLES_V1"
    || !Array.isArray(message.tables) || !message.tables.length || message.tables.length > 50) return false;
  track(sender.tab.id).then(async (record) => {
    record.lastCapturedAt = Date.now();
    record.lastPollAt = 0;
    await persist();
    return postLocal(MT_BRIDGE_CONFIG.endpoint, { tables: message.tables, diagnostics: message.diagnostics });
  }).then(reply).catch(() => reply({ ok: false, error: "無法連到本機轉發器，請確認電腦上的轉發程式正在執行。" }));
  return true;
});
