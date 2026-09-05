const electronicSource = require("../electronic/source");

const GAME_IMAGES = {
  戰神賽特1: "/images/electronic/seth1-hd.webp",
  戰神賽特2: "/images/electronic/seth2-hd.webp",
  古神巴風特: "/images/electronic/baphomet-hd.webp",
  虎小妹: "/images/electronic/tiger-girl-hd.webp",
  赤三國: "/images/electronic/red-three-kingdoms-hd.webp",
};

const EXCLUSIVE_GAMES = ["戰神賽特1", "戰神賽特2"];
const LEGAL_BETS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 30, 32, 36, 40,
  42, 48, 54, 56, 60, 64, 72, 80, 96, 100, 112, 120, 128, 140, 144, 160, 180,
  200, 240, 280, 300, 320, 360, 400, 420, 480, 500, 540, 560, 600, 640, 700, 720,
  800, 840, 900, 960, 980, 1000, 1080, 1120, 1200, 1260, 1280, 1400, 1440, 1600,
  1800, 2000,
];

function legalBetAtOrBelow(target) {
  const numeric = Math.max(0, Number(target) || 0);
  return [...LEGAL_BETS].reverse().find((value) => value <= numeric) || LEGAL_BETS[0];
}

function reportedRate(value, win, bet) {
  const winnings = Number(win);
  const stake = Number(bet);
  if (value != null && value !== "") {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    if (direct === 0 && (!Number.isFinite(winnings) || winnings <= 0 || !Number.isFinite(stake) || stake <= 0)) return 0;
  }
  if (!Number.isFinite(winnings) || !Number.isFinite(stake) || stake <= 0) return null;
  return (winnings / stake) * 100;
}


function roomMetric(room) {
  const detail = room.detail || {};
  const todayBet = Math.max(0, Number(detail.todayBet) || Number(detail.hourBet) || 0);
  const todayWin = Math.max(0, Number(detail.todayWin) || Number(detail.hourWin) || 0);
  const monthBet = Math.max(0, Number(detail.dayBet) || 0);
  const monthWin = Math.max(0, Number(detail.dayWin) || 0);
  const todayRtp = reportedRate(detail.todayRtp, todayWin, todayBet);
  const monthRtp = reportedRate(detail.dayRtp, monthWin, monthBet);
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

function playbook(gameName, bankroll) {
  const principal = Math.max(0, Number(bankroll) || 0);
  const regularBet = principal ? legalBetAtOrBelow(principal * 0.005) : null;
  const freeGameBet = principal ? legalBetAtOrBelow((principal * 0.12) / 200) : null;
  const freeGameCost = freeGameBet ? freeGameBet * 200 : null;
  const awakeningBet = gameName === "戰神賽特2" && principal ? legalBetAtOrBelow((principal * 0.05) / 500) : null;
  const awakeningCost = awakeningBet ? awakeningBet * 500 : null;
  const shared = {
    board: "6×5 無賠付線・8 個以上同符號消除",
    rtp: "96.89%",
    volatility: "高波動",
    staking: principal ? {
      bankroll: principal,
      regularBet,
      freeGameMultiplier: 200,
      freeGameBet,
      freeGameCost,
      freeGameEligible: freeGameCost <= principal * 0.12,
      awakeningMultiplier: gameName === "戰神賽特2" ? 500 : null,
      awakeningBet,
      awakeningCost,
      awakeningEligible: awakeningCost != null && awakeningCost <= principal * 0.05,
      legalTier: true,
    } : null,
  };
  if (gameName === "戰神賽特1") {
    return {
      ...shared,
      edition: "靈魂之火",
      maxMultiplier: "最高 51,000×",
      trigger: "4 個聖甲蟲 SCATTER 觸發免費遊戲",
      symbolNote: "賽特1僅使用一般聖甲蟲 SCATTER，沒有戰神分裂與女神鎖定機制。",
    };
  }
  return {
    ...shared,
    edition: "覺醒之力",
    maxMultiplier: "最高 81,000×",
    trigger: "4 個以上 SCATTER；含覺醒 SCATTER 進入覺醒模式",
    symbolNote: "賽特2同時使用一般與覺醒 SCATTER；戰神分裂、女神鎖定只屬於覺醒機制。",
  };
}

function analyze(gameName, bankroll = 0, selection = {}) {
  if (!EXCLUSIVE_GAMES.includes(gameName)) throw new Error("目前僅開放戰神賽特1與戰神賽特2。");
  if (!electronicSource.hasReadyData(gameName)) throw new Error("即時資料正在同步，請稍後再試。");
  const candidates = electronicSource.getEmptyRooms(gameName)
    .filter((room) => electronicSource.hasFreshRoomDetail(room))
    .map((room) => ({ room, metric: roomMetric(room) }))
    .sort((a, b) => b.metric.score - a.metric.score || String(a.room.number).localeCompare(String(b.room.number), "en", { numeric: true }));
  if (!candidates.length) throw new Error("目前沒有完成即時核對的空房，請稍後再分析。");
  const currentIndex = candidates.findIndex(({ room }) => String(room.number) === String(selection.roomNumber));
  if (selection.recheck === true && currentIndex < 0) throw new Error("目前沒有可核對的原房間資料，該房可能已有人或資料過期，請重新啟動 AI 戰術掃描。");
  const selected = selection.next === true
    ? candidates[(currentIndex + 1) % candidates.length]
    : candidates[Math.max(0, currentIndex)];
  const confidence = selected.metric.score >= 82 ? "高" : selected.metric.score >= 62 ? "中" : "低";
  const principal = Math.max(0, Number(bankroll) || 0);
  const unit = principal ? Math.max(1, Math.floor(principal * 0.01)) : null;
  const result = {
    gameName,
    image: GAME_IMAGES[gameName],
    roomNumber: selected.room.number,
    availableRooms: candidates.length,
    confidence,
    signal: confidence === "高" ? "資料完整・可列入觀察" : confidence === "中" ? "條件一般・建議等待確認" : "樣本不足・本輪觀望",
    updatedAt: selected.room.detailUpdatedAt,
    metrics: {
      todayRtp: selected.metric.todayRtp,
      monthRtp: selected.metric.monthRtp,
      todayBet: selected.metric.todayBet,
      monthBet: selected.metric.monthBet,
    },
    playbook: playbook(gameName, principal),
    plan: unit ? {
      unit,
      entry: `固定 1 單位（${unit.toLocaleString("zh-TW")}）`,
      stopLoss: `${(unit * 5).toLocaleString("zh-TW")}（5 單位）`,
      takeProfit: `${(unit * 3).toLocaleString("zh-TW")}（3 單位）`,
    } : null,
    note: "可信度代表資料新鮮度與樣本完整度，不代表中獎機率；請勿追損。",
  };
  // Aggregate room statistics do not contain a live symbol board. Never invent
  // symbol combinations or purchase signals from those statistics.
  result.predictionSignal = null;
  return result;
}

module.exports = { EXCLUSIVE_GAMES, LEGAL_BETS, gameStatus, analyze, playbook, legalBetAtOrBelow, reportedRate };
