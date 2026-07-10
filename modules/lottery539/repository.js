const fs = require("fs");
const path = require("path");

const PILIO_HISTORY_URL = "https://www.pilio.idv.tw/lto539/list539BIG.asp";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let historyCache = { expiresAt: 0, data: [] };

function normalizeNumbers(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,\s、|/]+/);
  const numbers = [];

  for (const item of source) {
    const number = Number(String(item).replace(/\D/g, ""));
    if (number >= 1 && number <= 39 && !numbers.includes(number)) numbers.push(number);
    if (numbers.length >= 5) break;
  }

  return numbers.length === 5 ? numbers.map((number) => String(number).padStart(2, "0")) : [];
}

function normalizeRecord(record, index = 0) {
  if (Array.isArray(record)) {
    const numbers = normalizeNumbers(record);
    return numbers.length ? { date: `第${index + 1}筆`, numbers } : null;
  }

  if (typeof record === "string") {
    const [date, numbersText] = record.includes(":") ? record.split(/:(.+)/) : [`第${index + 1}筆`, record];
    const numbers = normalizeNumbers(numbersText);
    return numbers.length ? { date: String(date || `第${index + 1}筆`).trim(), numbers } : null;
  }

  if (record && typeof record === "object") {
    const numbers = normalizeNumbers(record.numbers || record.number || record.drawNumber || record.開獎號碼);
    const date = record.date || record.drawDate || record.drawTerm || record.期別 || `第${index + 1}筆`;
    return numbers.length ? { date: String(date), numbers } : null;
  }

  return null;
}

function parseHistoryText(value) {
  return String(value || "")
    .split(/[;\n]+/)
    .map((item, index) => normalizeRecord(item, index))
    .filter(Boolean);
}

function parseHistoryJson(value) {
  try {
    const payload = JSON.parse(value);
    const list = Array.isArray(payload) ? payload : payload.history || payload.data || payload.records || [];
    return Array.isArray(list) ? list.map(normalizeRecord).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function parsePilioHtml(html) {
  const text = String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+/g, " ");
  const records = [];
  const pattern = /(\d{4}\/\d{2}\/\d{2})[\s\S]{0,80}?(\d{1,2})\s*[,，]\s*(\d{1,2})\s*[,，]\s*(\d{1,2})\s*[,，]\s*(\d{1,2})\s*[,，]\s*(\d{1,2})/g;
  let match;

  while ((match = pattern.exec(text)) && records.length < 80) {
    const numbers = normalizeNumbers(match.slice(2, 7));
    if (numbers.length === 5) records.push({ date: match[1], numbers });
  }

  return records;
}

async function fetchPilioHistory() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(PILIO_HISTORY_URL, {
      headers: {
        "User-Agent": "BLACKDOMAIN-AI/3.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const html = buffer.toString("utf8");
    const records = parsePilioHtml(html);
    if (!records.length) throw new Error("No 539 history records parsed.");
    return records;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHistory() {
  if (historyCache.data.length && Date.now() < historyCache.expiresAt) return historyCache.data;

  try {
    const records = await fetchPilioHistory();
    historyCache = { data: records, expiresAt: Date.now() + CACHE_TTL_MS };
    return records;
  } catch (error) {
    console.error("[539 history] pilio fetch failed:", error.message);
  }

  const envHistory = process.env.LOTTERY539_HISTORY || process.env.LOTTERY_539_HISTORY || "";
  const fromEnv = envHistory.trim().startsWith("[") || envHistory.trim().startsWith("{")
    ? parseHistoryJson(envHistory)
    : parseHistoryText(envHistory);
  if (fromEnv.length) {
    historyCache = { data: fromEnv.slice(0, 120), expiresAt: Date.now() + CACHE_TTL_MS };
    return historyCache.data;
  }

  const filePath = path.join(__dirname, "..", "..", "data", "lottery539-history.json");
  if (fs.existsSync(filePath)) {
    const fromFile = parseHistoryJson(fs.readFileSync(filePath, "utf8"));
    if (fromFile.length) {
      historyCache = { data: fromFile.slice(0, 120), expiresAt: Date.now() + CACHE_TTL_MS };
      return historyCache.data;
    }
  }

  return [];
}

module.exports = {
  loadHistory,
  parsePilioHtml,
};
