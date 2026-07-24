const TRACKS = [
  { gameName: "PK-MBRACE-1", dcsId: 368, name: "賭城賽車" },
  { gameName: "PK-MBRACE-2", dcsId: 369, name: "雪地賽車" },
  { gameName: "PK-MBRACE-3", dcsId: 370, name: "運動賽車" },
  { gameName: "PK-MBRACE-4", dcsId: 371, name: "海洋賽車" },
];

const trackByGameName = new Map(TRACKS.map((track) => [track.gameName, track]));
const trackByDcsId = new Map(TRACKS.map((track) => [track.dcsId, track]));
const states = new Map(TRACKS.map((track) => [
  track.gameName,
  {
    ...track,
    state: "Unknown",
    targetPeriodId: null,
    latestPeriodId: null,
    history: [],
    updatedAt: null,
    liveUpdatedAt: null,
  },
]));

function isRank(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10;
}

function isFullResult(result) {
  if (!Array.isArray(result) || result.length !== 10) return false;
  const values = result.map(Number);
  return values.every(isRank) && new Set(values).size === 10;
}

function periodCompare(left, right) {
  return String(right.periodId).localeCompare(String(left.periodId), "en", { numeric: true });
}

function nextPeriodId(value) {
  if (!value) return null;
  try {
    return (BigInt(String(value)) + 1n).toString();
  } catch {
    return null;
  }
}

function laterPeriodId(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return String(left).localeCompare(String(right), "en", { numeric: true }) >= 0
    ? String(left)
    : String(right);
}

function normalizeRoadmapRecord(record = {}) {
  const topThree = [
    record.champion?.rank_value,
    record.second?.rank_value,
    record.third?.rank_value,
  ].map(Number);
  if (!record.draw_num || !topThree.every(isRank) || new Set(topThree).size !== 3) return null;
  return {
    periodId: String(record.draw_num),
    time: null,
    result: topThree,
    sum: Number(record.sum?.rank_value) || topThree[0] + topThree[1],
    overUnder: String(record.sum?.over_under || ""),
    oddEven: String(record.sum?.odd_even || ""),
    complete: false,
  };
}

function normalizeLiveResult(data = {}) {
  if (!data.draw_num || !isFullResult(data.result)) return null;
  const result = data.result.map(Number);
  return {
    periodId: String(data.draw_num),
    time: (Number(data.result_time || data.sended_at || data.public_result_at) || 0) * 1000 || Date.now(),
    result,
    sum: Number(data.result_display?.sum) || result[0] + result[1],
    overUnder: String(data.result_display?.over_under || ""),
    oddEven: String(data.result_display?.odd_even || ""),
    complete: true,
  };
}

function mergeHistory(current, incoming) {
  const records = new Map();
  [...current, ...incoming].forEach((record) => {
    if (!record?.periodId || !Array.isArray(record.result)) return;
    const key = String(record.periodId);
    const existing = records.get(key);
    if (!existing || (!existing.complete && record.complete)) records.set(key, record);
  });
  return [...records.values()].sort(periodCompare).slice(0, 200);
}

function resolveTrack(data = {}) {
  const current = data.current || {};
  return trackByGameName.get(String(data.game_name || current.game_name || ""))
    || trackByDcsId.get(Number(data.dcs_id || current.dcs_id))
    || null;
}

function ingestRoadmap(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  let accepted = 0;
  items.forEach((item) => {
    const track = resolveTrack(item);
    const state = track && states.get(track.gameName);
    if (!state || !Array.isArray(item.roadmap)) return;
    const history = item.roadmap.map(normalizeRoadmapRecord).filter(Boolean);
    if (!history.length) return;
    const previousLatest = state.history[0]?.periodId || null;
    const previousCount = state.history.length;
    state.history = mergeHistory(state.history, history);
    state.latestPeriodId = state.history[0]?.periodId || state.latestPeriodId;
    state.targetPeriodId = laterPeriodId(
      state.targetPeriodId,
      nextPeriodId(state.latestPeriodId),
    );
    if (state.latestPeriodId !== previousLatest || state.history.length !== previousCount) {
      state.updatedAt = new Date().toISOString();
    }
    accepted += 1;
  });
  return accepted > 0;
}

function ingestSocketEvent(payload = {}) {
  const event = String(payload.event || "");
  const data = payload.data || {};
  const track = resolveTrack(data);
  const state = track && states.get(track.gameName);
  if (!state) return false;

  if (event === "RESULT_PUBLIC") {
    const record = normalizeLiveResult(data);
    if (!record) return false;
    state.history = mergeHistory(state.history, [record]);
    state.latestPeriodId = record.periodId;
    state.targetPeriodId = data.next_draw_num
      ? String(data.next_draw_num)
      : nextPeriodId(record.periodId) || state.targetPeriodId;
    state.state = "Settlement";
  } else if (event === "OPEN" || event === "CLOSE") {
    const current = data.current || data;
    if (current.draw_num) state.targetPeriodId = String(current.draw_num);
    state.state = event === "OPEN" ? "Ready" : "Closed";
  } else if (event === "TABLE_STATE_CHANGED") {
    state.state = String(data.state_string || data.state || "Unknown");
  } else {
    return false;
  }

  state.updatedAt = new Date().toISOString();
  state.liveUpdatedAt = state.updatedAt;
  return true;
}

function getSnapshot() {
  return {
    source: [...states.values()].some((state) => state.updatedAt) ? "relay" : "unavailable",
    tracks: TRACKS.map((track) => {
      const state = states.get(track.gameName);
      return {
        gameName: state.gameName,
        dcsId: state.dcsId,
        name: state.name,
        state: state.state,
        targetPeriodId: state.targetPeriodId,
        latestPeriodId: state.latestPeriodId,
        historyCount: state.history.length,
        updatedAt: state.updatedAt,
        liveUpdatedAt: state.liveUpdatedAt,
        history: state.history.map((record) => ({
          ...record,
          result: [...record.result],
        })),
      };
    }),
  };
}

function resetForTest() {
  states.forEach((state) => {
    state.state = "Unknown";
    state.targetPeriodId = null;
    state.latestPeriodId = null;
    state.history = [];
    state.updatedAt = null;
    state.liveUpdatedAt = null;
  });
}

module.exports = {
  TRACKS,
  getSnapshot,
  ingestRoadmap,
  ingestSocketEvent,
  isFullResult,
  normalizeRoadmapRecord,
  resetForTest,
};
