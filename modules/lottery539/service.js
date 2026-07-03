function targetDate() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const result = new Date(now);

  if (now.getHours() > 20 || (now.getHours() === 20 && now.getMinutes() >= 20)) {
    result.setDate(result.getDate() + 1);
  }

  return result;
}

function formatDate(date) {
  return date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

function deriveSet(offset) {
  const key = targetDate().toISOString().slice(0, 10);
  let seed = Array.from(`${key}:${offset}`).reduce((sum, char) => sum + char.charCodeAt(0), 539);
  const numbers = [];

  while (numbers.length < 5) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const value = (seed % 39) + 1;
    if (!numbers.includes(value)) numbers.push(value);
  }

  return numbers.sort((a, b) => a - b).map((n) => String(n).padStart(2, "0"));
}

function buildAnalysis(offset) {
  return {
    date: formatDate(targetDate()),
    prediction: deriveSet(offset),
    hot: deriveSet("hot"),
    cold: deriveSet("cold"),
    stable: deriveSet("stable"),
    updatedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
  };
}

module.exports = {
  targetDate,
  formatDate,
  deriveSet,
  buildAnalysis,
};
