function roundBet(amount) {
  if (amount < 1) return 1;
  return Math.round(amount * 100) / 100;
}

function clampBet(amount, maxBet) {
  return Math.min(roundBet(amount), maxBet);
}

function getBaseBet(session) {
  const capital = Number(session.bankroll || session.capital || 0);
  const maxBet = Number(session.maxBet || capital);
  let base = capital * 0.03;
  if (capital >= 5000) base = capital * 0.04;
  if (capital >= 10000) base = capital * 0.05;
  return clampBet(base, maxBet);
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
  if (session.mode === "天門") {
    const levels = [1, 3, 7, 15, 31];
    const level = session.tianmenLevel || 1;
    return clampBet(100 * levels[level - 1], Math.min(session.maxBet, session.bankroll));
  }
  return clampBet(getBaseBet(session), Math.min(session.maxBet, session.bankroll));
}

function applyResult(session, outcome) {
  const lastBet = Number(session.lastBet || 0);
  if (!session.lastPrediction) return session;

  if (!session.results.player && session.results.player !== 0) session.results.player = 0;
  if (!session.results.banker && session.results.banker !== 0) session.results.banker = 0;
  if (!session.results.tie && session.results.tie !== 0) session.results.tie = 0;

  if (outcome === "和") {
    session.results.tie += 1;
    return session;
  }

  if (outcome === "閒") session.results.player += 1;
  if (outcome === "莊") session.results.banker += 1;

  const isWin = outcome === session.lastPrediction;
  if (isWin) {
    if (session.mode !== "自由配注") session.bankroll += outcome === "莊" ? lastBet * 0.95 : lastBet;
    if (session.mode === "天門") session.tianmenLevel = 1;
  } else {
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
  if (session.mode === "天門") return "天門模式依原五關節奏執行，下注金額會受到單注上限與目前本金限制。";
  return "AI已依目前紀錄完成監測，建議以單注上限與本金控管為優先。";
}

module.exports = {
  firstAnalysis,
  nextAnalysis,
  getReason,
};
