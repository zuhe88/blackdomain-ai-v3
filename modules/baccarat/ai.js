function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
  const clean = history.filter((x) => x !== "和");

  if (clean.length < 2) {
    return pick(["莊", "閒"]);
  }

  const last = clean[clean.length - 1];
  const secondLast = clean[clean.length - 2];

  if (last === secondLast) {
    return last;
  }

  return last === "莊" ? "閒" : "莊";
}

function calculateBet(session) {
  if (session.mode === "自由配注") {
    return 0;
  }

  if (session.mode === "天門") {
    const base = getBaseBet(session);
    const levels = [1, 3, 7, 15, 31];
    const level = session.tianmenLevel || 1;
    return clampBet(base * levels[level - 1], session.maxBet);
  }

  return getBaseBet(session);
}

function applyResult(session, opened) {
  const lastPrediction = session.lastPrediction;
  const lastBet = Number(session.lastBet || 0);

  if (!lastPrediction) {
    return session;
  }

  if (opened === "和") {
    session.results.tie += 1;
    return session;
  }

  if (opened === lastPrediction) {
    session.results.win += 1;

    if (session.mode !== "自由配注") {
      session.bankroll += opened === "莊" ? lastBet * 0.95 : lastBet;
    }

    if (session.mode === "天門") {
      session.tianmenLevel = 1;
    }
  } else {
    session.results.lose += 1;

    if (session.mode !== "自由配注") {
      session.bankroll -= lastBet;
    }

    if (session.mode === "天門") {
      session.tianmenLevel = Math.min(5, (session.tianmenLevel || 1) + 1);
    }
  }

  return session;
}

function nextAnalysis(session, opened) {
  session.history.push(opened);

  if (session.history.length > 50) {
    session.history.shift();
  }

  session = applyResult(session, opened);

  const prediction = predict(session.history);
  const bet = calculateBet(session);

  session.lastPrediction = prediction;
  session.lastBet = bet;

  return {
    session,
    prediction,
    bet,
  };
}

function firstAnalysis(session) {
  const prediction = predict(session.history);
  const bet = calculateBet(session);

  session.lastPrediction = prediction;
  session.lastBet = bet;

  return {
    session,
    prediction,
    bet,
  };
}

module.exports = {
  firstAnalysis,
  nextAnalysis,
};