const $ = id => document.getElementById(id);
const portal = "https://blackdomain-ai-v3-production.up.railway.app";
const platforms = { dg: "DG", mt: "MT", ab: "歐博" };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw Error("無法讀取目前分頁");
  return tab;
}

async function inspect(tab, func) {
  const [value] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
  return value.result;
}

function show({ tables = [], selected, entries = [] }) {
  $("table").replaceChildren(...tables.map(table =>
    new Option(table.room + " · 第 " + table.round + " 局 · " + table.side, table.room)
  ));
  if (selected) $("table").value = selected;
  $("log").textContent = entries.map(row =>
    row.time + " " + row.platform + " " + row.room + " 第 " + row.round + " 局 · 模擬 " + row.side
  ).join("\n");
}

async function readPortal() {
  const tab = await activeTab();
  const url = new URL(tab.url);
  const match = url.pathname.match(/^\/portal\/baccarat\/(dg|mt|ab)\/multi\/?$/);
  if (url.origin !== portal || !match) throw Error("請先切到正式站的百家樂多桌頁");
  const tables = await inspect(tab, () => [...document.querySelectorAll(".multi-table-card")].flatMap(card => {
    const round = card.querySelector(".multi-table-prediction span")?.textContent.match(/第\s*(\d+)\s*局/);
    const side = card.querySelector(".multi-table-prediction b")?.textContent.trim();
    return round && ["莊", "閒"].includes(side) ? [{ room: card.dataset.room, round: Number(round[1]), side }] : [];
  }));
  await chrome.storage.local.set({ tables, platform: platforms[match[1]], sampledAt: Date.now(), selected: tables[0]?.room ?? "" });
  show(await chrome.storage.local.get());
  return tables.length ? "已讀取預測，請切到遊戲桌核對。" : "目前沒有莊／閒預測。";
}

async function simulate() {
  const tab = await activeTab();
  if (new URL(tab.url).origin === portal) throw Error("請切到遊戲桌分頁");
  const state = await chrome.storage.local.get();
  const table = state.tables?.find(table => table.room === $("table").value);
  if (!table || Date.now() - state.sampledAt > 30000) throw Error("預測已逾 30 秒，請重新讀取多桌頁");
  const selection = await inspect(tab, () => window.getSelection()?.toString().trim() || document.body?.innerText || "");
  const fields = [...selection.matchAll(/(?:桌號|房號|百家樂)\s*[:：]?\s*([A-Z]+\d+[A-Z]?(?:-L)?)(?![A-Z0-9-])/gi)];
  if (new Set(fields.map(match => match[1].toUpperCase())).size > 1) {
    throw Error("讀到多個桌號。請進入單一桌台，或只選取該桌的桌況文字。");
  }
  const visiblePlatform = selection.match(/\b(DG|MT)\b|(歐博|歐伯|ALLBET)/i)?.[0].toUpperCase();
  const platform = ["歐伯", "ALLBET"].includes(visiblePlatform) ? "歐博" : visiblePlatform;
  const room = selection.match(/(?:桌號|房號|百家樂)\s*[:：]?\s*([A-Z]+\d+[A-Z]?(?:-L)?)(?![A-Z0-9-])/i)?.[1].toUpperCase();
  const round = Number(selection.match(/第\s*(\d+)\s*局|局號\s*[:：]?\s*(\d+)/)?.slice(1).find(Boolean));
  const seconds = Number(selection.match(/(?:剩餘|倒數)\s*[:：]?\s*(\d+)\s*秒/)?.[1]);
  if (!selection.trim()) throw Error("目前分頁沒有可讀取的桌況文字。請確認已進入遊戲桌。");
  const issues = [];
  if (platform !== state.platform) issues.push("平台 " + (platform ?? "未讀到") + "，預期 " + state.platform);
  if (room !== table.room) issues.push("桌號 " + (room ?? "未讀到") + "，預期 " + table.room);
  if (round !== table.round) issues.push("局號 " + (Number.isFinite(round) ? round : "未讀到") + "，預期 " + table.round);
  if (!(seconds > 0)) issues.push(Number.isFinite(seconds) ? "倒數已結束" : "未讀到倒數");
  if (issues.length) throw Error(issues.join("；") + "。本次未記錄。");
  const entries = state.entries || [];
  const key = [state.platform, room, round, state.sampledAt].join(":");
  if (entries.some(row => row.key === key)) return "已記錄這筆模擬";
  entries.unshift({ key, platform: state.platform, ...table, time: new Date().toLocaleString("zh-TW") });
  await chrome.storage.local.set({ entries: entries.slice(0, 50) });
  show(await chrome.storage.local.get());
  return "已記錄模擬結果";
}

$("table").onchange = () => chrome.storage.local.set({ selected: $("table").value });
for (const [id, action] of [["read", readPortal], ["check", simulate]]) {
  $(id).onclick = async () => {
    $("read").disabled = $("check").disabled = true;
    try { $("status").textContent = await action(); }
    catch (error) { $("status").textContent = error.message; }
    finally { $("read").disabled = $("check").disabled = false; }
  };
}
chrome.storage.local.get().then(show);
