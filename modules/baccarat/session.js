const sessions = new Map();

const SESSION_TIMEOUT = 10 * 60 * 1000;

function now() {
  return Date.now();
}

function createSession(userId) {
  const session = {
    userId,
    platform: null,
    room: null,
    capital: null,
    maxBet: null,
    mode: null,
    step: "platform",
    history: [],
    results: {
      win: 0,
      lose: 0,
      tie: 0,
    },
    lastPrediction: null,
    lastBet: 0,
    bankroll: null,
    startBankroll: null,
    tianmenLevel: 1,
    createdAt: now(),
    updatedAt: now(),
  };

  sessions.set(userId, session);
  return session;
}

function getSession(userId) {
  const session = sessions.get(userId);

  if (!session) {
    return createSession(userId);
  }

  if (now() - session.updatedAt > SESSION_TIMEOUT) {
    sessions.delete(userId);
    return createSession(userId);
  }

  session.updatedAt = now();
  sessions.set(userId, session);

  return session;
}

function setSession(userId, data) {
  const oldSession = getSession(userId);

  const nextSession = {
    ...oldSession,
    ...data,
    updatedAt: now(),
  };

  sessions.set(userId, nextSession);
  return nextSession;
}

function resetSession(userId) {
  sessions.delete(userId);
}

function hasActiveSession(userId) {
  const session = sessions.get(userId);

  if (!session) return false;

  if (now() - session.updatedAt > SESSION_TIMEOUT) {
    sessions.delete(userId);
    return false;
  }

  return true;
}

function pushHistory(userId, result) {
  const session = getSession(userId);

  session.history.push(result);

  if (session.history.length > 50) {
    session.history.shift();
  }

  session.updatedAt = now();
  sessions.set(userId, session);

  return session;
}

function setStep(userId, step) {
  return setSession(userId, { step });
}

function setPlatform(userId, platform) {
  return setSession(userId, {
    platform,
    step: "room",
  });
}

function setRoom(userId, room) {
  return setSession(userId, {
    room,
    step: "capital",
  });
}

function setCapital(userId, capital) {
  return setSession(userId, {
    capital,
    bankroll: capital,
    startBankroll: capital,
    step: "maxBet",
  });
}

function setMaxBet(userId, maxBet) {
  return setSession(userId, {
    maxBet,
    step: "mode",
  });
}

function setMode(userId, mode) {
  return setSession(userId, {
    mode,
    step: "playing",
  });
}

function updateAfterRound(userId, data) {
  return setSession(userId, data);
}

module.exports = {
  createSession,
  getSession,
  setSession,
  resetSession,
  hasActiveSession,
  pushHistory,
  setStep,
  setPlatform,
  setRoom,
  setCapital,
  setMaxBet,
  setMode,
  updateAfterRound,
};