const electronicSource = require("../electronic/source");

const GAME_IMAGES = {
  戰神賽特1: "/images/electronic/seth1-hd.webp",
  戰神賽特2: "/images/electronic/seth2-hd.webp",
  古神巴風特: "/images/electronic/baphomet-hd.webp",
  虎小妹: "/images/electronic/tiger-hd.webp",
  赤三國: "/images/electronic/red-three-kingdoms-hd.webp",
};

function roomMetric(room) {
  const detail = room.detail || {};
  const todayRtp = Number(detail.todayRtp);
  const monthRtp = Number(detail.dayRtp);
  const todayBet = Math.max(0, Number(detail.todayBet) || Number(detail.hourBet) || 0);
  const monthBet = Math.max(0, Number(detail.dayBet) || 0);
  const ageMs = Date.now() - Date.parse(room.detailUpdatedAt || "");
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 120000;
  const sampleScore = Math.min(30, Math.log10(Math.max(10, todayBet + monthBet)) * 7);
  const balanceScore = Number.isFinite(todayRtp) && Number.isFinite(monthRtp)
    ? Math.max(0, 30 - Math.abs(todayRtp - monthRtp) * 1.5)
    : 0;
  const activityScore = Number.isFinite(todayRtp) ? Math.max(0, 35 - Math.abs(todayRtp - 100)) : 0;
  return { score: sampleScore + balanceScore + activityScore + (fresh ? 15 : 0), todayRtp, monthRtp, todayBet, monthBet, fresh };
}

function gameStatus(gameName) {
  const snapshot = electronicSource.getGame(gameName);
  const ready = electronicSource.hasReadyData(gameName);
  const rooms = ready ? electronicSource.getEmptyRooms(gameName) : [];
  const detailed = rooms.filter((room) => electronicSource.hasFreshRoomDetail(room));
  return {
    gameName,
    image: GAME_IMAGES[gameName],
    ready,
    updatedAt: snapshot?.updatedAt || null,
    availableRooms: detailed.length,
  };
}

function analyze(gameName, bankroll = 0) {
  if (!electronicSource.GAME_NAMES.includes(gameName)) throw new Error("請重新選擇 ATG 遊戲。");
  if (!electronicSource.hasReadyData(gameName)) throw new Error("即時資料正在同步，請稍後再試。");
  const candidates = electronicSource.getEmptyRooms(gameName)
    .filter((room) => electronicSource.hasFreshRoomDetail(room))
    .map((room) => ({ room, metric: roomMetric(room) }))
    .sort((a, b) => b.metric.score - a.metric.score);
  if (!candidates.length) throw new Error("目前沒有完成即時核對的空房，請稍後再分析。");
  const selected = candidates[0];
  const confidence = selected.metric.score >= 82 ? "高" : selected.metric.score >= 62 ? "中" : "低";
  const principal = Math.max(0, Number(bankroll) || 0);
  const unit = principal ? Math.max(1, Math.floor(principal * 0.01)) : null;
  return {
    gameName,
    image: GAME_IMAGES[gameName],
    roomNumber: selected.room.number,
    confidence,
    signal: confidence === "高" ? "資料完整・可列入觀察" : confidence === "中" ? "條件一般・建議等待確認" : "樣本不足・本輪觀望",
    updatedAt: selected.room.detailUpdatedAt,
    metrics: {
      todayRtp: selected.metric.todayRtp,
      monthRtp: selected.metric.monthRtp,
      todayBet: selected.metric.todayBet,
      monthBet: selected.metric.monthBet,
    },
    plan: unit ? {
      unit,
      entry: `固定 1 單位（${unit.toLocaleString("zh-TW")}）`,
      stopLoss: `${(unit * 5).toLocaleString("zh-TW")}（5 單位）`,
      takeProfit: `${(unit * 3).toLocaleString("zh-TW")}（3 單位）`,
    } : null,
    note: "可信度代表資料新鮮度與樣本完整度，不代表中獎機率；請勿追損。",
  };
}

module.exports = { gameStatus, analyze };
