const electronicSource = require("../electronic/source");
const { randomInt } = require("crypto");

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

const SYMBOLS = {
  scatter: { id: "scatter", label: "SCATTER", icon: "/atg-x/assets/symbols/scatter-standard.png" },
  awakening: { id: "awakening", label: "覺醒 SCATTER", icon: "/atg-x/assets/symbols/scatter-awakening.png" },
  eye: { id: "eye", label: "荷魯斯之眼", icon: "/atg-x/assets/symbols/extracted/eye.png" },
  staff: { id: "staff", label: "眼鏡蛇權杖", icon: "/atg-x/assets/symbols/extracted/staff.png" },
  bow: { id: "bow", label: "弓箭", icon: "/atg-x/assets/symbols/extracted/bow.png" },
  blade: { id: "blade", label: "沙漠之刃", icon: "/atg-x/assets/symbols/extracted/blade.png" },
  yellow: { id: "yellow", label: "黃寶石", icon: "/atg-x/assets/symbols/extracted/yellow.png" },
  red: { id: "red", label: "紅寶石", icon: "/atg-x/assets/symbols/extracted/red.png" },
  purple: { id: "purple", label: "紫寶石", icon: "/atg-x/assets/symbols/extracted/purple.png" },
  blue: { id: "blue", label: "藍寶石", icon: "/atg-x/assets/symbols/extracted/blue.png" },
  green: { id: "green", label: "綠寶石", icon: "/atg-x/assets/symbols/extracted/green.png" },
};

const SIGNAL_CATALOG = {
  戰神賽特1: [
    { code: "S1-SCATTER-3", level: "強", action: "buy", symbols: [["scatter", 3]] },
    { code: "S1-BLADE-RED", level: "強", action: "buy", symbols: [["blade", 5], ["red", 3]] },
    { code: "S1-EYE-YELLOW", level: "中", action: "spin", symbols: [["eye", 6], ["yellow", 2]] },
    { code: "S1-STAFF-PURPLE", level: "中", action: "spin", symbols: [["staff", 4], ["purple", 4]] },
    { code: "S1-BOW-BLUE", level: "中", action: "spin", symbols: [["bow", 5], ["blue", 3]] },
    { code: "S1-GEMS", level: "低", action: "wait", symbols: [["yellow", 4], ["green", 4]] },
  ],
  戰神賽特2: [
    { code: "S2-SCATTER-3", level: "強", action: "buy", symbols: [["scatter", 3]] },
    { code: "S2-AWAKENING-3", level: "強", action: "awakening", weight: 1, symbols: [["scatter", 2], ["awakening", 1]] },
    { code: "S2-BLADE-RED", level: "強", action: "buy", symbols: [["blade", 5], ["red", 3]] },
    { code: "S2-EYE-YELLOW", level: "中", action: "spin", symbols: [["eye", 6], ["yellow", 2]] },
    { code: "S2-STAFF-BLUE", level: "中", action: "spin", symbols: [["staff", 5], ["blue", 3]] },
    { code: "S2-BOW-GREEN", level: "低", action: "wait", symbols: [["bow", 4], ["green", 4]] },
  ],
};

function generateSignal(gameName, staking) {
  const catalog = SIGNAL_CATALOG[gameName];
  const weighted = catalog.flatMap((item) => Array.from({ length: item.weight || 3 }, () => item));
  const template = weighted[randomInt(weighted.length)];
  const symbols = template.symbols.map(([id, count]) => ({ ...SYMBOLS[id], count }));
  const total = symbols.reduce((sum, symbol) => sum + symbol.count, 0);
  const scatterTotal = symbols
    .filter((symbol) => symbol.id === "scatter" || symbol.id === "awakening")
    .reduce((sum, symbol) => sum + symbol.count, 0);
  if (total > 8 || scatterTotal > 3 || symbols.some((symbol) => symbol.id !== "scatter" && symbol.id !== "awakening" && symbol.count >= 8)) {
    throw new Error("訊號組合超出盤面限制。");
  }

  if (template.action === "buy" || template.action === "awakening") {
    const awakening = template.action === "awakening";
    const bet = awakening ? staking?.awakeningBet : staking?.freeGameBet;
    const cost = awakening ? staking?.awakeningCost : staking?.freeGameCost;
    const eligible = awakening ? staking?.awakeningEligible : staking?.freeGameEligible;
    const product = awakening ? "覺醒之力" : "免費遊戲";
    if (staking && !eligible) {
      return {
        ...template,
        action: "wait",
        level: "低",
        symbols,
        total,
        recommendation: "本輪平轉，不購買",
        detail: `${product}最低成本 ${cost.toLocaleString("zh-TW")} 對目前本金過高。`,
        purchase: { product, multiplier: awakening ? 500 : 200, bet, cost, allowed: false },
      };
    }
    return {
      ...template,
      symbols,
      total,
      recommendation: `建議購買${product}`,
      detail: staking
        ? `單轉底注 ${bet.toLocaleString("zh-TW")}，購買金額 ${cost.toLocaleString("zh-TW")}。`
        : `本輪屬於${product}訊號；輸入本金後會自動換算可購買金額。`,
      purchase: { product, multiplier: awakening ? 500 : 200, bet: bet ?? null, cost: cost ?? null, allowed: true },
    };
  }
  if (template.action === "spin") {
    return {
      ...template,
      symbols,
      total,
      recommendation: "建議固定注試轉",
      detail: staking ? `平轉金額 ${staking.regularBet.toLocaleString("zh-TW")}。` : "輸入本金後會自動換算平轉金額。",
      purchase: { product: "免費遊戲", multiplier: 200, bet: null, cost: null, allowed: false },
    };
  }
  return { ...template, symbols, total, recommendation: "本輪觀望", detail: "訊號密度不足，本輪維持平轉。", purchase: { product: "免費遊戲", multiplier: 200, bet: null, cost: null, allowed: false } };
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
  const result = {
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
  result.predictionSignal = generateSignal(gameName, result.playbook.staking);
  return result;
}

module.exports = { EXCLUSIVE_GAMES, LEGAL_BETS, SIGNAL_CATALOG, gameStatus, analyze, playbook, legalBetAtOrBelow, generateSignal, reportedRate };
