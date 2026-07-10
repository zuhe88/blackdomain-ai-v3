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

function buildAnalysis(offset) {
  const prediction = deriveSet(offset);
  const hot = deriveSet("hot");
  const cold = deriveSet("cold", hot);

  return {
    date: formatDate(targetDate()),
    prediction,
    hot,
    cold,
    updatedAt: taiwanNowText(),
  };
}

module.exports = {
  targetDate,
  formatDate,
  deriveSet,
  buildAnalysis,
};
