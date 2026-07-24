const PICK_COUNTS = [3, 4, 5, 6];
const RANK_LABELS = ["冠軍", "亞軍", "第三名"];

function normalizeHistory(records = []) {
  const seen = new Set();
  return records
    .filter((record) => record?.periodId && Array.isArray(record.result) && record.result.length >= 3)
    .map((record) => ({
      ...record,
      periodId: String(record.periodId),
      result: record.result.slice(0, 3).map(Number),
    }))
    .filter((record) => (
      record.result.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)
      && new Set(record.result).size === 3
      && !seen.has(record.periodId)
      && seen.add(record.periodId)
    ))
    .sort((left, right) => right.periodId.localeCompare(left.periodId, "en", { numeric: true }))
    .slice(0, 200);
}

function weightedFrequency(history, rankIndex, marble, limit, weight) {
  return history.slice(0, limit).reduce((score, record, index) => (
    score + (record.result[rankIndex] === marble
      ? weight * (1 - (index / Math.max(limit, 1)) * 0.35)
      : 0)
  ), 0);
}

function nearbyScore(history, rankIndex, marble) {
  return history.slice(0, 40).reduce((score, record, index) => {
    const actualRank = record.result.indexOf(marble);
    if (actualRank < 0) return score;
    const distance = Math.abs(actualRank - rankIndex);
    if (distance > 1) return score;
    return score + (2 - distance) * (1 - (index / 80)) * 0.7;
  }, 0);
}

function transitionScore(history, rankIndex, marble) {
  if (history.length < 3) return 0;
  const latest = history[0].result[rankIndex];
  let matches = 0;
  let transitions = 0;
  for (let index = history.length - 1; index > 0; index -= 1) {
    if (history[index].result[rankIndex] !== latest) continue;
    transitions += 1;
    if (history[index - 1].result[rankIndex] === marble) matches += 1;
  }
  return transitions ? (matches / transitions) * 8 + Math.min(matches, 4) * 0.45 : 0;
}

function gapScore(history, rankIndex, marble) {
  const gap = history.findIndex((record) => record.result[rankIndex] === marble);
  return Math.min(gap < 0 ? history.length : gap, 18) * 0.12;
}

function rankCandidates(history, rankIndex) {
  return Array.from({ length: 10 }, (_, index) => index + 1)
    .map((marble) => ({
      marble,
      score:
        weightedFrequency(history, rankIndex, marble, 12, 2.8)
        + weightedFrequency(history, rankIndex, marble, 35, 1.25)
        + weightedFrequency(history, rankIndex, marble, 100, 0.35)
        + nearbyScore(history, rankIndex, marble)
        + transitionScore(history, rankIndex, marble)
        + gapScore(history, rankIndex, marble),
    }))
    .sort((left, right) => right.score - left.score || left.marble - right.marble);
}

function buildAnalysis(track, pickCount) {
  const count = Number(pickCount);
  if (!PICK_COUNTS.includes(count)) throw new Error("MB pick count must be between 3 and 6.");
  const history = normalizeHistory(track?.history || []);
  const base = {
    available: history.length >= 20,
    count,
    gameName: track?.gameName || null,
    trackName: track?.name || "MB彈珠",
    state: track?.state || "Unknown",
    historyCount: history.length,
    targetPeriodId: track?.targetPeriodId || null,
    latestPeriodId: history[0]?.periodId || null,
    updatedAt: track?.liveUpdatedAt || track?.updatedAt || null,
    recentResults: history.slice(0, 3),
    rows: [],
  };
  if (!base.available) return base;
  base.rows = RANK_LABELS.map((label, rankIndex) => ({
    rank: rankIndex + 1,
    label,
    picks: rankCandidates(history, rankIndex).slice(0, count).map((item) => item.marble),
  }));
  return base;
}

module.exports = {
  PICK_COUNTS,
  RANK_LABELS,
  buildAnalysis,
  normalizeHistory,
  rankCandidates,
};
