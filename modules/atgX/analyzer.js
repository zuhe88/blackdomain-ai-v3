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

const SHARED_PAY_SYMBOLS = [
  { id: "eye", label: "荷魯斯之眼", payout: "8–9: 10×｜10–11: 25×｜12+: 50×", sheet: "primary", left: -56, top: -108 },
  { id: "staff", label: "眼鏡蛇權杖", payout: "8–9: 2.5×｜10–11: 10×｜12+: 25×", sheet: "primary", left: -236, top: -110 },
  { id: "bow", label: "弓箭", payout: "8–9: 2×｜10–11: 5×｜12+: 25×", sheet: "primary", left: -416, top: -110 },
  { id: "blade", label: "沙漠之刃", payout: "8–9: 1.5×｜10–11: 2×｜12+: 12×", sheet: "primary", left: -57, top: -320 },
  { id: "yellow", label: "黃寶石", payout: "8–9: 1×｜10–11: 1.5×｜12+: 10×", sheet: "gems", left: -66, top: -87 },
  { id: "red", label: "紅寶石", payout: "8–9: 0.8×｜10–11: 1.2×｜12+: 8×", sheet: "gems", left: -246, top: -87 },
  { id: "purple", label: "紫寶石", payout: "8–9: 0.5×｜10–11: 1×｜12+: 5×", sheet: "gems", left: -426, top: -87 },
  { id: "blue", label: "藍寶石", payout: "8–9: 0.4×｜10–11: 0.9×｜12+: 4×", sheet: "gems", left: -66, top: -299 },
  { id: "green", label: "綠寶石", payout: "8–9: 0.25×｜10–11: 0.75×｜12+: 2×", sheet: "gems", left: -246, top: -299 },
];

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

function playbook(gameName, bankroll) {
  const principal = Math.max(0, Number(bankroll) || 0);
  const regularBet = principal ? legalBetAtOrBelow(principal * 0.005) : null;
  const featureBet = principal ? legalBetAtOrBelow(principal * 0.0005) : null;
  const shared = {
    board: "6×5 無賠付線・8 個以上同符號消除",
    rtp: "96.89%",
    volatility: "高波動",
    featurePrice: "投注額 ×100",
    staking: principal ? {
      bankroll: principal,
      regularBet,
      featureBet,
      featureCost: featureBet * 100,
      featureEligible: featureBet * 100 <= principal * 0.05,
      legalTier: true,
      stopLoss: Math.max(1, Math.floor(principal * 0.05)),
      takeProfit: Math.max(1, Math.floor(principal * 0.03)),
    } : null,
  };
  if (gameName === "戰神賽特1") {
    return {
      ...shared,
      edition: "靈魂之火",
      maxMultiplier: "最高 51,000×",
      trigger: "4 個聖甲蟲 SCATTER 觸發免費遊戲",
      symbolNote: "賽特1僅使用一般聖甲蟲 SCATTER，沒有戰神分裂與女神鎖定機制。",
      symbols: [
        { id: "scatter3", label: "3 個 SCATTER", icon: "/atg-x/assets/symbols/scatter-standard.png" },
        { id: "scatter4", label: "4 個以上 SCATTER", icon: "/atg-x/assets/symbols/scatter-standard.png" },
        { id: "multiplier", label: "高倍數球密集", icon: null },
        ...SHARED_PAY_SYMBOLS,
      ],
    };
  }
  return {
    ...shared,
    edition: "覺醒之力",
    maxMultiplier: "最高 81,000×",
    trigger: "4 個以上 SCATTER；含覺醒 SCATTER 進入覺醒模式",
    symbolNote: "賽特2同時使用一般與覺醒 SCATTER；戰神分裂、女神鎖定只屬於覺醒機制。",
    symbols: [
      { id: "scatter3", label: "3 個 SCATTER", icon: "/atg-x/assets/symbols/scatter-standard.png" },
      { id: "scatter4", label: "4 個以上 SCATTER", icon: "/atg-x/assets/symbols/scatter-standard.png" },
      { id: "awakening", label: "覺醒 SCATTER", icon: "/atg-x/assets/symbols/scatter-awakening.png" },
      { id: "seth", label: "3 個戰神＋倍數球", payout: "觸發倍數球分裂", sheet: "primary", left: -236, top: -320 },
      { id: "goddess", label: "3 個女神＋倍數球", payout: "觸發倍數球鎖定", sheet: "primary", left: -416, top: -320 },
      ...SHARED_PAY_SYMBOLS,
    ],
  };
}

function analyze(gameName, bankroll = 0) {
  if (!EXCLUSIVE_GAMES.includes(gameName)) throw new Error("目前僅開放戰神賽特1與戰神賽特2。");
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
    playbook: playbook(gameName, principal),
    plan: unit ? {
      unit,
      entry: `固定 1 單位（${unit.toLocaleString("zh-TW")}）`,
      stopLoss: `${(unit * 5).toLocaleString("zh-TW")}（5 單位）`,
      takeProfit: `${(unit * 3).toLocaleString("zh-TW")}（3 單位）`,
    } : null,
    note: "可信度代表資料新鮮度與樣本完整度，不代表中獎機率；請勿追損。",
  };
}

module.exports = { EXCLUSIVE_GAMES, LEGAL_BETS, gameStatus, analyze, playbook, legalBetAtOrBelow };
