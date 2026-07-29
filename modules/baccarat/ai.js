const MAX_RISK_RATIO = 0.2;
const PREDICTION_MODEL_VERSION = "baccarat-banker-baseline-v3";
const OBSERVE = "觀望";
const BANKER_BASE_PROBABILITY = 0.5068;

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
  const levelMultipliers = [1, 3, 7, 15, 31];
  const level = Math.max(1, Math.min(5, Number(session.tianmenLevel || 1)));
  const totalMultiplier = levelMultipliers.reduce((sum, value) => sum + value, 0);
  const base = roundBet(capital / totalMultiplier);
  const limit = getHeavenLimit(session);
  const bet = clampBet(base * levelMultipliers[level - 1], limit);

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

function analyzePrediction(history = []) {
  const source = Array.isArray(history) ? history : [];
  const clean = source.filter((item) => item === "莊" || item === "閒").slice(-60);
  const historySize = clean.length;

  return predictionResult({
    prediction: "莊",
    confidence: BANKER_BASE_PROBABILITY,
    sampleSize: historySize,
    historySize,
    reasonCode: "BANKER_MATHEMATICAL_BASELINE",
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
  if (session.mode !== "自由配注" && prediction !== OBSERVE && bet <= 0) {
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
  if (session.mode !== "自由配注" && prediction !== OBSERVE && bet <= 0) {
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
  if (session.lastPredictionMeta?.reasonCode === "INSUFFICIENT_BET_LIMIT") {
    return "本金或單注上限低於最低下注單位，本局不下注。";
  }
  if (session.lastPrediction === OBSERVE) return "目前無法安全下注，本局觀望。";
  if (session.mode === "自由配注") return "莊家數學基準；AI 提供方向，下注金額由玩家決定。";
  if (session.mode === "天門") return "莊家數學基準；配注依天門五關節奏與單注上限執行。";
  return "莊家數學基準；短期路單不視為高信心訊號。";
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
};
