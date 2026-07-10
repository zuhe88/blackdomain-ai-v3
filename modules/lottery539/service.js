const { askLottery539AI } = require("../../services/openai");
const { loadHistory } = require("./repository");

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

function deriveSet(offset, excluded = []) {
  const key = dateKey(targetDate());
  const blocked = new Set(excluded.map((item) => Number(item)));
  let seed = Array.from(`${key}:${offset}`).reduce((sum, char) => ((sum * 33) + char.charCodeAt(0)) >>> 0, 539);
  const numbers = [];

  while (numbers.length < 5 && numbers.length + blocked.size < 39) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const value = (seed % 39) + 1;
    if (!blocked.has(value) && !numbers.includes(value)) numbers.push(value);
  }

  return numbers.sort((a, b) => a - b).map((n) => String(n).padStart(2, "0"));
}

function taiwanNowText() {
  return new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function normalizeAiNumbers(value, excluded = []) {
  const blocked = new Set(excluded.map((item) => String(item).padStart(2, "0")));
  const source = Array.isArray(value) ? value : String(value || "").match(/\d{1,2}/g) || [];
  const result = [];

  for (const item of source) {
    const number = Number(String(item).replace(/\D/g, ""));
    const text = String(number).padStart(2, "0");
    if (number >= 1 && number <= 39 && !blocked.has(text) && !result.includes(text)) result.push(text);
    if (result.length >= 5) break;
  }

  return result;
}

function sameSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].sort().join(",");
  const right = [...b].sort().join(",");
  return left === right;
}

function mixedPrediction(rows, hot, cold, offset) {
  const seed = Array.from(String(offset || dateKey())).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
  const hotPool = rows
    .filter((item) => hot.includes(item.number))
    .sort((a, b) => b.frequency - a.frequency || Number(a.number) - Number(b.number));
  const coldPool = rows
    .filter((item) => cold.includes(item.number))
    .sort((a, b) => b.gap - a.gap || Number(a.number) - Number(b.number));
  const balancePool = rows
    .filter((item) => !hot.includes(item.number) && !cold.includes(item.number))
    .sort((a, b) => (b.frequency + Math.min(b.gap, 12)) - (a.frequency + Math.min(a.gap, 12)) || Number(a.number) - Number(b.number));
  const pools = [hotPool, balancePool, coldPool, balancePool, hotPool];
  const result = [];

  for (let index = 0; index < pools.length; index += 1) {
    const pool = pools[index];
    const item = pool[(seed + index * 2) % Math.max(1, pool.length)];
    if (item && !result.includes(item.number)) result.push(item.number);
  }

  for (const item of [...balancePool, ...hotPool, ...coldPool]) {
    if (result.length >= 5) break;
    if (!result.includes(item.number)) result.push(item.number);
  }

  return result.slice(0, 5).sort((a, b) => Number(a) - Number(b));
}

function statisticalAnalysis(history, offset) {
  const frequency = new Map();
  const lastSeen = new Map();
  for (let number = 1; number <= 39; number += 1) {
    const key = String(number).padStart(2, "0");
    frequency.set(key, 0);
    lastSeen.set(key, 999);
  }

  history.forEach((record, index) => {
    for (const number of record.numbers || []) {
      frequency.set(number, (frequency.get(number) || 0) + 1);
      if ((lastSeen.get(number) || 999) === 999) lastSeen.set(number, index);
    }
  });

  const rows = Array.from(frequency.keys()).map((number) => ({
    number,
    frequency: frequency.get(number) || 0,
    gap: lastSeen.get(number) || 999,
  }));

  const hot = rows
    .sort((a, b) => b.frequency - a.frequency || a.gap - b.gap || Number(a.number) - Number(b.number))
    .slice(0, 5)
    .map((item) => item.number);

  const cold = rows
    .filter((item) => !hot.includes(item.number))
    .sort((a, b) => a.frequency - b.frequency || b.gap - a.gap || Number(a.number) - Number(b.number))
    .slice(0, 5)
    .map((item) => item.number);

  const prediction = mixedPrediction(rows, hot, cold, offset);

  return {
    prediction,
    hot: hot.sort((a, b) => Number(a) - Number(b)),
    cold: cold.sort((a, b) => Number(a) - Number(b)),
    summary: `已分析最近 ${history.length} 期歷史資料。`,
    source: "history",
  };
}

async function gptAnalysis(history, offset) {
  const content = await askLottery539AI({
    targetDate: formatDate(targetDate()),
    history: history.slice(0, 60),
  });
  const jsonText = String(content || "").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(jsonText);
  const prediction = normalizeAiNumbers(parsed.prediction);
  const hot = normalizeAiNumbers(parsed.hot);
  const cold = normalizeAiNumbers(parsed.cold, hot);

  if (prediction.length < 5 || hot.length < 5 || cold.length < 5 || sameSet(prediction, hot) || sameSet(prediction, cold)) {
    throw new Error("GPT 539 analysis returned incomplete numbers.");
  }

  return {
    prediction,
    hot,
    cold,
    summary: parsed.summary || `已分析最近 ${history.length} 期歷史資料。`,
    source: "gpt",
  };
}

async function buildAnalysis(offset) {
  const history = await loadHistory();
  if (!history.length) {
    return {
      date: formatDate(targetDate()),
      prediction: [],
      hot: [],
      cold: [],
      summary: "目前尚未匯入可分析的歷史開獎資料。",
      source: "missing-history",
      updatedAt: taiwanNowText(),
    };
  }

  let result;
  try {
    result = await gptAnalysis(history, offset);
  } catch (error) {
    console.error("[539 AI] GPT analysis fallback:", error.message);
    result = statisticalAnalysis(history, offset);
  }

  if (sameSet(result.prediction, result.hot) || sameSet(result.prediction, result.cold)) {
    result = statisticalAnalysis(history, `${offset}:mixed`);
  }

  return {
    date: formatDate(targetDate()),
    ...result,
    updatedAt: taiwanNowText(),
  };
}

module.exports = {
  targetDate,
  formatDate,
  deriveSet,
  buildAnalysis,
};
