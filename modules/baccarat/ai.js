const MAX_RISK_RATIO = 0.2;
const PREDICTION_MODEL_VERSION = "baccarat-recent-road-v4";
const OBSERVE = "觀望";
const PREDICTION_WINDOW = 8;
const MIN_SETTLED_ROUNDS = 2;
const MIN_ALTERNATION_RUN = 3;
const MIN_WEIGHTED_MARGIN_RATIO = 0.18;
const TIANMEN_MULTIPLIERS = [1, 3, 7, 15, 31];
const MIN_BET_UNIT = 100;
const TIANMEN_TOTAL_MULTIPLIER = TIANMEN_MULTIPLIERS.reduce((sum, value) => sum + value, 0);
const MIN_TIANMEN_BANKROLL = TIANMEN_TOTAL_MULTIPLIER * MIN_BET_UNIT;

function roundBet(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric < 100) return 0;
  const unit = numeric > 10000 ? 1000 : 100;
  return Math.floor(numeric / unit) * unit;
}

function clampBet(amount, maxBet) {
  const limit = Number(maxBet);
  if (!Number.isFinite(limit) || limit < 100) return 0;
  return Math.max(0, Math.min(roundBet(amount), roundBet(limit), limit));
}

function getBaseBetAmount(capital) {
  if (capital >= 30000) return roundBet(capital * 0.15);
  if (capital >= 20000) return 3500;
  if (capital >= 15000) return 2500;
  if (capital >= 10000) return 1800;
  if (capital >= 7000) return 1500;
  if (capital >= 5000) return 1000;
  if (capital >= 4000) return 700;
  if (capital >= 3000) return 500;
  if (capital >= 2000) return 300;
  if (capital >= 1000) return 200;
  return roundBet(Math.max(100, capital * 0.15));
}

function getRiskLimit(capital) {
  return roundBet(Number(capital || 0) * MAX_RISK_RATIO);
}

function riskLevelForBet(bet, capital) {
  const ratio = capital > 0 ? bet / capital : 0;
  if (ratio <= 0.08) return "🟢 保守";
  if (ratio <= 0.14) return "🟡 穩健";
  return "🟠 積極";
}

function dynamicBetFromBase(base, limit) {
  const variants = [-0.1, 0, 0.1]
    .map((rate) => clampBet(base * (1 + rate), limit))
    .filter((amount) => amount > 0);
  const unique = Array.from(new Set(variants));
  return unique[Math.floor(Math.random() * unique.length)] || clampBet(base, limit);
}

function getBankroll(session) {
  const raw = session.bankroll !== undefined && session.bankroll !== null && session.bankroll !== ""
    ? session.bankroll
    : session.capital;
  const bankroll = Number(raw);
  return Number.isFinite(bankroll) ? Math.max(0, bankroll) : 0;
}

function getConfiguredMaxBet(session, bankroll) {
  const raw = session.maxBet;
  if (raw === undefined || raw === null || raw === "") return bankroll;
  const maxBet = Number(raw);
  return Number.isFinite(maxBet) ? Math.max(0, maxBet) : 0;
}

function getLimit(session) {
  const bankroll = getBankroll(session);
  const maxBet = getConfiguredMaxBet(session, bankroll);
  const riskLimit = getRiskLimit(bankroll);
  return Math.max(0, Math.min(maxBet, bankroll, riskLimit));
}

function getHeavenLimit(session) {
  const bankroll = getBankroll(session);
  const maxBet = getConfiguredMaxBet(session, bankroll);
  return Math.max(0, Math.min(maxBet, bankroll));
}

function getTianmenRequirements(capital) {
  const bankroll = Math.max(0, Number(capital) || 0);
  const baseBet = roundBet(bankroll / TIANMEN_TOTAL_MULTIPLIER);
  return {
    minBankroll: MIN_TIANMEN_BANKROLL,
    baseBet,
    requiredMaxBet: baseBet > 0 ? baseBet * TIANMEN_MULTIPLIERS.at(-1) : 0,
    sufficientBankroll: bankroll >= MIN_TIANMEN_BANKROLL && baseBet >= MIN_BET_UNIT,
  };
}

function getTianmenFundingIssue(session) {
  if (session.mode !== "天門") return null;
  const startingCapital = Number(session.startBankroll ?? session.capital ?? getBankroll(session)) || 0;
  const requirements = getTianmenRequirements(startingCapital);
  if (!requirements.sufficientBankroll) {
    return { reasonCode: "INSUFFICIENT_TIANMEN_BANKROLL", ...requirements, startingCapital };
  }
  const maxBet = getConfiguredMaxBet(session, startingCapital);
  if (maxBet < requirements.requiredMaxBet) {
    return { reasonCode: "INSUFFICIENT_TIANMEN_MAX_BET", ...requirements, startingCapital, maxBet };
  }
  return null;
}

function getBaseBet(session) {
  const capital = getBankroll(session);
  const limit = getLimit(session);
  const base = getBaseBetAmount(capital);
  const bet = dynamicBetFromBase(base, limit);
  session.lastBetMeta = {
    baseBet: clampBet(base, limit),
    riskLevel: riskLevelForBet(bet, capital),
    strategy: "動態配注",
    maxRiskRatio: MAX_RISK_RATIO,
  };
  return bet;
}

function getHeavenBet(session) {
  const capital = getBankroll(session);
  const startingCapital = Number(session.startBankroll ?? session.capital ?? capital) || 0;
  const level = Math.max(1, Math.min(5, Number(session.tianmenLevel || 1)));
  // Tianmen is one fixed five-stage 1-3-7-15-31 sequence. Recalculating the
  // base from the remaining bankroll after a loss made the second stage zero
  // at the minimum valid bankroll (5,700 -> 5,600), causing endless observes.
  const base = roundBet(startingCapital / TIANMEN_TOTAL_MULTIPLIER);
  const limit = getHeavenLimit(session);
  const bet = clampBet(base * TIANMEN_MULTIPLIERS[level - 1], limit);

  session.lastBetMeta = {
    baseBet: clampBet(base, limit),
    riskLevel: riskLevelForBet(bet, capital),
    strategy: `天門五關 第${level}關`,
    maxRiskRatio: MAX_RISK_RATIO,
  };

  return bet;
}

function predictionResult({
  prediction = OBSERVE,
  confidence = 0.5,
  sampleSize = 0,
  historySize = 0,
  reasonCode,
  evidence = null,
}) {
  return {
    prediction,
    confidence: Number(confidence.toFixed(4)),
    sampleSize,
    historySize,
    modelVersion: PREDICTION_MODEL_VERSION,
    reasonCode,
    ...(evidence ? { evidence } : {}),
  };
}

function tailStreakLength(history) {
  if (!history.length) return 0;
  const latest = history[history.length - 1];
  let length = 1;
  for (let index = history.length - 2; index >= 0; index -= 1) {
    if (history[index] !== latest) break;
    length += 1;
  }
  return length;
}

function tailAlternationLength(history) {
  if (!history.length) return 0;
  let length = 1;
  for (let index = history.length - 1; index > 0; index -= 1) {
    if (history[index] === history[index - 1]) break;
    length += 1;
  }
  return length;
}

function opposite(side) {
  return side === "莊" ? "閒" : "莊";
}

function signalConfidence(margin, totalWeight, patternBonus = 0) {
  if (totalWeight <= 0) return 0.5;
  const weightedStrength = Math.min(0.08, (Math.abs(margin) / totalWeight) * 0.08);
  return Math.min(0.62, 0.5 + weightedStrength + patternBonus);
}

function analyzePrediction(history = []) {
  const source = Array.isArray(history) ? history : [];
  const clean = source
    .map((item) => (typeof item === "string" ? item : item?.result))
    .filter((item) => item === "莊" || item === "閒");
  const historySize = clean.length;
  const recent = clean.slice(-PREDICTION_WINDOW);
  const sampleSize = recent.length;
  const bankerCount = recent.filter((item) => item === "莊").length;
  const playerCount = recent.length - bankerCount;
  const streakLength = tailStreakLength(recent);
  const alternationLength = tailAlternationLength(recent);
  const evidence = {
    windowSize: PREDICTION_WINDOW,
    recentSequence: recent.join(""),
    bankerCount,
    playerCount,
    streakLength,
    alternationLength,
  };

  if (sampleSize < MIN_SETTLED_ROUNDS) {
    return predictionResult({
      sampleSize,
      historySize,
      reasonCode: "INSUFFICIENT_SETTLED_HISTORY",
      evidence,
    });
  }

  const latest = recent[recent.length - 1];
  const totalWeight = (sampleSize * (sampleSize + 1)) / 2;

  if (streakLength >= 2) {
    return predictionResult({
      prediction: latest,
      confidence: signalConfidence(streakLength, sampleSize, Math.min(0.04, streakLength * 0.01)),
      sampleSize,
      historySize,
      reasonCode: "RECENT_STREAK",
      evidence,
    });
  }

  if (alternationLength >= MIN_ALTERNATION_RUN) {
    return predictionResult({
      prediction: opposite(latest),
      confidence: signalConfidence(
        alternationLength,
        sampleSize,
        Math.min(0.04, alternationLength * 0.008),
      ),
      sampleSize,
      historySize,
      reasonCode: "RECENT_ALTERNATION",
      evidence,
    });
  }

  let bankerWeight = 0;
  let playerWeight = 0;
  recent.forEach((result, index) => {
    const weight = index + 1;
    if (result === "莊") bankerWeight += weight;
    else playerWeight += weight;
  });
  const margin = bankerWeight - playerWeight;
  const marginRatio = Math.abs(margin) / totalWeight;
  const weightedEvidence = {
    ...evidence,
    bankerWeight,
    playerWeight,
    marginRatio: Number(marginRatio.toFixed(4)),
  };

  if (margin === 0) {
    return predictionResult({
      sampleSize,
      historySize,
      reasonCode: "RECENT_SIGNAL_TIED",
      evidence: weightedEvidence,
    });
  }

  if (marginRatio < MIN_WEIGHTED_MARGIN_RATIO) {
    return predictionResult({
      sampleSize,
      historySize,
      reasonCode: "RECENT_SIGNAL_WEAK",
      evidence: weightedEvidence,
    });
  }

  return predictionResult({
    prediction: margin > 0 ? "莊" : "閒",
    confidence: signalConfidence(margin, totalWeight),
    sampleSize,
    historySize,
    reasonCode: "RECENT_WEIGHTED_TREND",
    evidence: weightedEvidence,
  });
}

function predict(history = []) {
  return analyzePrediction(history).prediction;
}

function calculateBet(session, prediction = session.lastPrediction) {
  if (prediction === OBSERVE) return 0;
  if (session.mode === "自由配注") return 0;
  if (session.mode === "天門") return getHeavenBet(session);
  return clampBet(getBaseBet(session), getLimit(session));
}

function applyResult(session, outcome) {
  const lastBet = Number(session.lastBet || 0);
  if (!session.lastPrediction) return session;

  session.results = session.results || {};
  session.results.pass = Number.isFinite(Number(session.results.pass))
    ? Number(session.results.pass) : 0;
  session.results.fail = Number.isFinite(Number(session.results.fail))
    ? Number(session.results.fail) : 0;
  session.results.tie = Number.isFinite(Number(session.results.tie))
    ? Number(session.results.tie) : 0;
  session.results.observe = Number.isFinite(Number(session.results.observe))
    ? Number(session.results.observe) : 0;

  if (outcome !== "莊" && outcome !== "閒" && outcome !== "和") return session;

  if (outcome === "和") {
    session.results.tie += 1;
    session.lastSettlement = {
      prediction: session.lastPrediction,
      actual: outcome,
      verdict: "和",
    };
    return session;
  }

  if (session.lastPrediction === OBSERVE) {
    session.results.observe += 1;
    session.lastSettlement = {
      prediction: OBSERVE,
      actual: outcome,
      verdict: OBSERVE,
    };
    return session;
  }

  const isWin = outcome === session.lastPrediction;
  session.lastSettlement = {
    prediction: session.lastPrediction,
    actual: outcome,
    verdict: isWin ? "過" : "倒",
  };
  if (isWin) {
    session.results.pass += 1;
    if (session.mode !== "自由配注") session.bankroll += outcome === "莊" ? lastBet * 0.95 : lastBet;
    if (session.mode === "天門") session.tianmenLevel = 1;
  } else {
    session.results.fail += 1;
    if (session.mode !== "自由配注") session.bankroll -= lastBet;
    if (session.mode === "天門") session.tianmenLevel = Math.min(5, (session.tianmenLevel || 1) + 1);
  }
  return session;
}

function nextAnalysis(session, opened) {
  if (!Array.isArray(session.history)) session.history = [];
  if (opened === "莊" || opened === "閒" || opened === "和") session.history.push(opened);
  if (session.history.length > 50) session.history.shift();
  session = applyResult(session, opened);
  let analysis = analyzePrediction(session.history);
  let prediction = analysis.prediction;
  let bet = calculateBet(session, prediction);
  const fundingIssue = getTianmenFundingIssue(session);
  if (fundingIssue) {
    prediction = OBSERVE;
    bet = 0;
    analysis = { ...analysis, prediction, ...fundingIssue };
  } else if (session.mode !== "自由配注" && prediction !== OBSERVE && bet <= 0) {
    prediction = OBSERVE;
    bet = 0;
    analysis = {
      ...analysis,
      prediction,
      reasonCode: "INSUFFICIENT_BET_LIMIT",
    };
  }
  session.lastPrediction = prediction;
  session.lastPredictionMeta = analysis;
  session.lastBet = bet;
  return { session, prediction, bet, analysis };
}

function firstAnalysis(session) {
  let analysis = analyzePrediction(session.history);
  let prediction = analysis.prediction;
  let bet = calculateBet(session, prediction);
  const fundingIssue = getTianmenFundingIssue(session);
  if (fundingIssue) {
    prediction = OBSERVE;
    bet = 0;
    analysis = { ...analysis, prediction, ...fundingIssue };
  } else if (session.mode !== "自由配注" && prediction !== OBSERVE && bet <= 0) {
    prediction = OBSERVE;
    bet = 0;
    analysis = {
      ...analysis,
      prediction,
      reasonCode: "INSUFFICIENT_BET_LIMIT",
    };
  }
  session.lastPrediction = prediction;
  session.lastPredictionMeta = analysis;
  session.lastBet = bet;
  return { session, prediction, bet, analysis };
}

function getReason(session) {
  if (session.lastPredictionMeta?.reasonCode === "INSUFFICIENT_TIANMEN_BANKROLL") {
    const minimum = Number(session.lastPredictionMeta.minBankroll || MIN_TIANMEN_BANKROLL).toLocaleString("en-US");
    const current = Number(session.lastPredictionMeta.startingCapital || 0).toLocaleString("en-US");
    return `天門五關最低本金為 ${minimum}，目前本金 ${current} 不足，請重新設定本金後再開始。`;
  }
  if (session.lastPredictionMeta?.reasonCode === "INSUFFICIENT_TIANMEN_MAX_BET") {
    const minimum = Number(session.lastPredictionMeta.requiredMaxBet || 0).toLocaleString("en-US");
    return `依目前本金，天門五關的單注上限至少需為 ${minimum}，請重新設定後再開始。`;
  }
  if (session.lastPredictionMeta?.reasonCode === "INSUFFICIENT_BET_LIMIT") {
    return "本金或單注上限低於最低下注單位，本局不下注。";
  }
  if (session.lastPredictionMeta?.reasonCode === "INSUFFICIENT_SETTLED_HISTORY") {
    return "目前牌路資料不足，本局先觀望；開獎後會自動更新。";
  }
  if (
    session.lastPredictionMeta?.reasonCode === "RECENT_SIGNAL_TIED"
    || session.lastPredictionMeta?.reasonCode === "RECENT_SIGNAL_WEAK"
  ) {
    return "近期路勢訊號接近，本局先觀望；開獎後會自動更新。";
  }
  if (session.lastPrediction === OBSERVE) return "目前無法安全下注，本局觀望。";

  const direction = session.lastPrediction;
  const reasonByCode = {
    RECENT_STREAK: `近期連續路勢偏${direction}；`,
    RECENT_ALTERNATION: `近期交替節奏偏${direction}；`,
    RECENT_WEIGHTED_TREND: `近期加權路勢偏${direction}；`,
  };
  const reason = reasonByCode[session.lastPredictionMeta?.reasonCode]
    || `近期路勢偏${direction}；`;
  return `${reason}結果仍具隨機性。`;
}

module.exports = {
  firstAnalysis,
  nextAnalysis,
  getReason,
  calculateBet,
  getBaseBetAmount,
  analyzePrediction,
  predict,
  applyResult,
  getTianmenRequirements,
  MIN_TIANMEN_BANKROLL,
};
