const MAX_RISK_RATIO = 0.2;

function roundBet(amount) {
  const numeric = Number(amount || 0);
  if (numeric < 100) return 100;
  const unit = numeric > 10000 ? 1000 : 100;
  return Math.floor(numeric / unit) * unit;
}

function clampBet(amount, maxBet) {
  const capped = Math.min(roundBet(amount), roundBet(maxBet));
  return Math.max(0, capped);
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

function getLimit(session) {
  const bankroll = Number(session.bankroll || session.capital || 0);
  const maxBet = Number(session.maxBet || bankroll);
  const riskLimit = getRiskLimit(bankroll);
  return Math.min(maxBet, bankroll, riskLimit || bankroll);
}

function getHeavenLimit(session) {
  const bankroll = Number(session.bankroll || session.capital || 0);
  const maxBet = Number(session.maxBet || bankroll);
  return Math.min(maxBet, bankroll);
}

function getBaseBet(session) {
  const capital = Number(session.bankroll || session.capital || 0);
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
  const capital = Number(session.bankroll || session.capital || 0);
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

function predict(history = []) {
  const clean = history.filter((item) => item !== "和");
  if (clean.length < 2) return clean[0] === "莊" ? "閒" : "莊";
  const last = clean[clean.length - 1];
  const secondLast = clean[clean.length - 2];
  if (last === secondLast) return last;
  return last === "莊" ? "閒" : "莊";
}

function calculateBet(session) {
  if (session.mode === "自由配注") return 0;
  if (session.mode === "天門") return getHeavenBet(session);
  return clampBet(getBaseBet(session), getLimit(session));
}

function applyResult(session, outcome) {
  const lastBet = Number(session.lastBet || 0);
  if (!session.lastPrediction) return session;

  if (!session.results.pass && session.results.pass !== 0) session.results.pass = session.results.pass || 0;
  if (!session.results.fail && session.results.fail !== 0) session.results.fail = session.results.fail || 0;
  if (!session.results.tie && session.results.tie !== 0) session.results.tie = 0;

  if (outcome === "和") {
    session.results.tie += 1;
    return session;
  }

  const isWin = outcome === session.lastPrediction;
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
  session.history.push(opened);
  if (session.history.length > 50) session.history.shift();
  session = applyResult(session, opened);
  const prediction = opened === "和" ? session.lastPrediction || predict(session.history) : predict(session.history);
  const bet = calculateBet(session);
  session.lastPrediction = prediction;
  session.lastBet = bet;
  return { session, prediction, bet };
}

function firstAnalysis(session) {
  const prediction = predict(session.history);
  const bet = calculateBet(session);
  session.lastPrediction = prediction;
  session.lastBet = bet;
  return { session, prediction, bet };
}

function getReason(session) {
  if (session.mode === "自由配注") return "自由配注模式下，AI只負責紀錄與統計，不主動建議下注。";
  if (session.mode === "天門") return "天門模式依五關節奏執行，第一關會由目前本金反推，確保本金可支撐完整五關，並受單注上限限制。";
  return "AI已依目前紀錄完成監測，建議以單注上限與本金控管為優先。";
}

module.exports = {
  firstAnalysis,
  nextAnalysis,
  getReason,
  calculateBet,
  getBaseBetAmount,
};
