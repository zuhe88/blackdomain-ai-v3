const HISTORY_APIS = [
  "https://api.taiwanlottery.com/TLCAPIWeB/Lottery/539Result",
  "https://www.taiwanlottery.com/api/Lottery/539Result",
];

function taiwanParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function addTaiwanDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function targetDate(now = new Date()) {
  const parts = taiwanParts(now);
  const shouldUseNextDraw = parts.hour > 20 || (parts.hour === 20 && parts.minute >= 30);
  const target = addTaiwanDays(parts, shouldUseNextDraw ? 1 : 0);
  return new Date(Date.UTC(target.year, target.month - 1, target.day, 12, 0, 0));
}

function formatDate(date) {
  const value = date instanceof Date ? date : targetDate();
  return `${value.getUTCFullYear()}/${value.getUTCMonth() + 1}/${value.getUTCDate()}`;
}

function dateKey(date = targetDate()) {
  const value = date instanceof Date ? date : targetDate();
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deriveSet(offset) {
  const key = dateKey(targetDate());
  let seed = Array.from(`${key}:${offset}`).reduce((sum, char) => sum + char.charCodeAt(0), 539);
  const numbers = [];

  while (numbers.length < 5) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const value = (seed % 39) + 1;
    if (!numbers.includes(value)) numbers.push(value);
  }

  return numbers.sort((a, b) => a - b).map((n) => String(n).padStart(2, "0"));
}

function taiwanNowText() {
  return new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function buildAnalysis(offset) {
  return {
    date: formatDate(targetDate()),
    prediction: deriveSet(offset),
    hot: deriveSet("hot"),
    cold: deriveSet("cold"),
    stable: deriveSet("stable"),
    updatedAt: taiwanNowText(),
  };
}

function normalizeNumbers(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).padStart(2, "0")).filter((item) => /^\d{2}$/.test(item)).slice(0, 5);
  }
  const matches = String(value || "").match(/\d{1,2}/g) || [];
  return matches.map((item) => item.padStart(2, "0")).filter((item) => Number(item) >= 1 && Number(item) <= 39).slice(0, 5);
}

function findHistoryRecord(payload) {
  const candidates = [];
  if (Array.isArray(payload)) candidates.push(...payload);
  if (Array.isArray(payload?.content)) candidates.push(...payload.content);
  if (Array.isArray(payload?.data)) candidates.push(...payload.data);
  if (Array.isArray(payload?.result)) candidates.push(...payload.result);
  if (payload?.content && !Array.isArray(payload.content)) candidates.push(payload.content);
  if (payload?.data && !Array.isArray(payload.data)) candidates.push(payload.data);

  for (const item of candidates) {
    const fields = [item?.drawNumber, item?.lotteryNo, item?.numbers, item?.開獎號碼, item?.DrawNumber, item?.Number];
    const numbers = fields.map(normalizeNumbers).find((list) => list.length >= 5) || [];
    if (numbers.length >= 5) {
      return {
        date: item?.drawTerm || item?.drawDate || item?.date || item?.期別 || "最新一期",
        numbers,
      };
    }
  }

  return null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "BLACKDOMAIN-AI/3.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHistory() {
  for (const url of HISTORY_APIS) {
    try {
      const payload = await fetchJson(url);
      const record = findHistoryRecord(payload);
      if (record) return { ok: true, ...record };
    } catch (error) {
      // Try next API.
    }
  }

  return {
    ok: false,
    message: "目前無法取得最新歷史開獎資料。",
  };
}

module.exports = {
  targetDate,
  formatDate,
  deriveSet,
  buildAnalysis,
  loadHistory,
};
