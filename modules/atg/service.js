const { PICK_COUNTS, RANK_LABELS } = require("./constants");

function isPermutation(result) {
  if (!Array.isArray(result) || result.length !== 10) return false;
  const values = result.map(Number);
  return values.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)
    && new Set(values).size === 10;
}

function normalizeHistory(records = []) {
  const seen = new Set();
  return records
    .filter((record) => record && record.periodId && isPermutation(record.result))
    .map((record) => ({
      periodId: String(record.periodId),
      time: Number(record.time) || null,
      result: record.result.map(Number),
    }))
    .filter((record) => {
      if (seen.has(record.periodId)) return false;
      seen.add(record.periodId);
      return true;
    })
    .sort((a, b) => {
      if (a.time && b.time && a.time !== b.time) return b.time - a.time;
      return b.periodId.localeCompare(a.periodId, "en", { numeric: true });
    })
    .slice(0, 200);
}

function weightedFrequency(history, rankIndex, horse, limit, baseWeight) {
  let score = 0;
  history.slice(0, limit).forEach((record, index) => {
    if (record.result[rankIndex] !== horse) return;
    score += baseWeight * (1 - (index / Math.max(limit, 1)) * 0.35);
  });
  return score;
}

function proximityScore(history, rankIndex, horse) {
  let score = 0;
  history.slice(0, 40).forEach((record, index) => {
    const actualRank = record.result.indexOf(horse);
    if (actualRank < 0) return;
    const distance = Math.abs(actualRank - rankIndex);
    if (distance > 2) return;
    const recency = 1 - (index / 40) * 0.5;
    score += (3 - distance) * recency * 0.55;
  });
  return score;
}

function transitionScore(history, rankIndex, horse) {
  if (history.length < 3) return 0;
  const latestHorse = history[0].result[rankIndex];
  let matches = 0;
  let transitions = 0;

  for (let index = history.length - 1; index > 0; index -= 1) {
    const older = history[index];
    const newer = history[index - 1];
    if (older.result[rankIndex] !== latestHorse) continue;
    transitions += 1;
    if (newer.result[rankIndex] === horse) matches += 1;
  }

  if (!transitions) return 0;
  return (matches / transitions) * 8 + Math.min(matches, 4) * 0.45;
}

function gapScore(history, rankIndex, horse) {
  const gap = history.findIndex((record) => record.result[rankIndex] === horse);
  const normalizedGap = gap < 0 ? history.length : gap;
  return Math.min(normalizedGap, 18) * 0.12;
}

function rankCandidates(history, rankIndex) {
  return Array.from({ length: 10 }, (_, index) => index + 1)
    .map((horse) => ({
      horse,
      score:
        weightedFrequency(history, rankIndex, horse, 12, 2.8)
        + weightedFrequency(history, rankIndex, horse, 35, 1.25)
        + weightedFrequency(history, rankIndex, horse, 100, 0.35)
        + proximityScore(history, rankIndex, horse)
        + transitionScore(history, rankIndex, horse)
        + gapScore(history, rankIndex, horse),
    }))
    .sort((a, b) => b.score - a.score || a.horse - b.horse);
}

function buildAnalysis(records, pickCount, metadata = {}) {
  const count = Number(pickCount);
  if (!PICK_COUNTS.includes(count)) throw new Error("ATG pick count must be between 3 and 6.");

  const history = normalizeHistory(records);
  if (history.length < 20) {
    return {
      available: false,
      count,
      historyCount: history.length,
      source: metadata.source || "unavailable",
      targetPeriodId: metadata.targetPeriodId || null,
      updatedAt: metadata.updatedAt || null,
      rows: [],
    };
  }

  return {
    available: true,
    count,
    historyCount: history.length,
    source: metadata.source || "history",
    targetPeriodId: metadata.targetPeriodId || null,
    updatedAt: metadata.updatedAt || null,
    latestPeriodId: history[0].periodId,
    recentResults: history.slice(0, 3).map((record) => ({
      periodId: record.periodId,
      time: record.time,
      result: [...record.result],
    })),
    rows: RANK_LABELS.map((label, rankIndex) => ({
      rank: rankIndex + 1,
      label,
      picks: rankCandidates(history, rankIndex).slice(0, count).map((item) => item.horse),
    })),
  };
}

module.exports = {
  isPermutation,
  normalizeHistory,
  rankCandidates,
  buildAnalysis,
};
