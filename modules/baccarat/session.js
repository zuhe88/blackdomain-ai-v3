const supabase = require("../../services/supabase");

const sessions = new Map();

const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
const SESSION_KEY_PREFIX = "baccarat_session:";

function now() {
  return Date.now();
}

function sessionKey(userId) {
  return `${SESSION_KEY_PREFIX}${userId}`;
}

function persistSession(session) {
  if (!supabase || !session?.userId) return;
  supabase
    .from("lottery_settings")
    .upsert({
      key: sessionKey(session.userId),
      value: session,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    }, { onConflict: "key" })
    .then(({ error }) => {
      if (error) console.error("[Baccarat] Session persistence failed:", error.message);
    });
}

function deletePersistedSession(userId) {
  if (!supabase || !userId) return;
  supabase
    .from("lottery_settings")
    .delete()
    .eq("key", sessionKey(userId))
    .then(({ error }) => {
      if (error) console.error("[Baccarat] Session deletion failed:", error.message);
    });
}

async function hydrateSessions() {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("key,value")
    .like("key", `${SESSION_KEY_PREFIX}%`);
  if (error) {
    console.error("[Baccarat] Session hydration failed:", error.message);
    return 0;
  }

  let restored = 0;
  for (const row of data || []) {
    const session = row?.value;
    if (!session?.userId || now() - Number(session.updatedAt || 0) > SESSION_TIMEOUT) continue;
    sessions.set(session.userId, session);
    restored += 1;
  }
  return restored;
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
      pass: 0,
      fail: 0,
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
  persistSession(session);
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
  persistSession(nextSession);
  return nextSession;
}

function resetSession(userId) {
  sessions.delete(userId);
  deletePersistedSession(userId);
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

function listActiveSessions() {
  const active = [];
  sessions.forEach((session, userId) => {
    if (now() - session.updatedAt > SESSION_TIMEOUT) {
      sessions.delete(userId);
    } else {
      active.push(session);
    }
  });
  return active;
}

function pushHistory(userId, result) {
  const session = getSession(userId);

  session.history.push(result);

  if (session.history.length > 50) {
    session.history.shift();
  }

  session.updatedAt = now();
  sessions.set(userId, session);
  persistSession(session);

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
    step: "mode",
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
    step: "playing",
  });
}

function setMode(userId, mode) {
  return setSession(userId, {
    mode,
    capital: null,
    maxBet: null,
    bankroll: null,
    startBankroll: null,
    step: mode === "自由配注" ? "playing" : "capital",
  });
}

function updateAfterRound(userId, data) {
  return setSession(userId, data);
}

module.exports = {
  createSession,
  hydrateSessions,
  getSession,
  setSession,
  resetSession,
  hasActiveSession,
  listActiveSessions,
  pushHistory,
  setStep,
  setPlatform,
  setRoom,
  setCapital,
  setMaxBet,
  setMode,
  updateAfterRound,
};
