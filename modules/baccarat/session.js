const crypto = require("crypto");
const supabase = require("../../services/supabase");

const sessions = new Map();
const persistenceQueues = new Map();
const pendingCancellations = new Map();

const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
const SESSION_KEY_PREFIX = "baccarat_session:";

function now() {
  return Date.now();
}

function sessionKey(userId) {
  return `${SESSION_KEY_PREFIX}${userId}`;
}

function sessionEpoch() {
  return crypto.randomUUID();
}

function queuePersistence(userId, operation) {
  const previous = persistenceQueues.get(userId) || Promise.resolve();
  const raw = previous
    .catch(() => {})
    .then(operation);
  const tracked = raw.catch((error) => {
    console.error("[Baccarat] Session persistence failed:", error.message);
  });
  persistenceQueues.set(userId, tracked);
  const clear = () => {
    if (persistenceQueues.get(userId) === tracked) persistenceQueues.delete(userId);
  };
  tracked.then(clear, clear);
  return raw;
}

function persistSession(session) {
  if (!supabase || !session?.userId) return;
  const snapshot = JSON.parse(JSON.stringify(session));
  queuePersistence(snapshot.userId, async () => {
    const current = sessions.get(snapshot.userId);
    if (!current || current.sessionEpoch !== snapshot.sessionEpoch) return;
    const { error } = await supabase
      .from("lottery_settings")
      .upsert({
        key: sessionKey(snapshot.userId),
        value: snapshot,
        updated_at: new Date().toISOString(),
        updated_by: snapshot.userId,
      }, { onConflict: "key" });
    if (error) throw error;
  });
}

function persistCancellation(userId, cancelledEpoch = null) {
  if (!supabase || !userId) return Promise.resolve(true);
  return queuePersistence(userId, async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await supabase
        .from("lottery_settings")
        .upsert({
          key: sessionKey(userId),
          value: {
            userId,
            sessionEpoch: cancelledEpoch,
            cancelled: true,
            cancelledAt: now(),
          },
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, { onConflict: "key" });
      if (!error) return true;
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => {
          setTimeout(resolve, 100 * (3 ** attempt));
        });
      }
    }
    throw lastError || new Error("Session cancellation could not be persisted");
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
    if (session?.cancelled || session?.cancelledAt) continue;
    if (!session?.userId || now() - Number(session.updatedAt || 0) > SESSION_TIMEOUT) continue;
    session.sessionEpoch ||= sessionEpoch();
    sessions.set(session.userId, session);
    restored += 1;
  }
  return restored;
}

function createSession(userId) {
  const session = {
    userId,
    sessionEpoch: sessionEpoch(),
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
      observe: 0,
    },
    lastPrediction: null,
    lastBet: 0,
    lastLiveEventKey: null,
    lastLiveGameNo: null,
    lastLiveShoeKey: null,
    lastLiveRoundIndex: null,
    predictionAudit: [],
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
  const current = sessions.get(userId);
  const pending = pendingCancellations.get(userId);
  if (
    pending?.promise
    && (!current || current.sessionEpoch === pending.epoch)
  ) {
    return pending.promise;
  }
  if (!current && !pending) return Promise.resolve(false);
  const cancelledEpoch = current?.sessionEpoch || pending?.epoch || null;
  sessions.delete(userId);
  const entry = {
    epoch: cancelledEpoch,
    promise: null,
  };
  pendingCancellations.set(userId, entry);
  entry.promise = persistCancellation(userId, cancelledEpoch)
    .then(() => {
      if (pendingCancellations.get(userId) === entry) {
        pendingCancellations.delete(userId);
      }
      return true;
    })
    .catch((error) => {
      if (pendingCancellations.get(userId) === entry) entry.promise = null;
      throw error;
    });
  return entry.promise;
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
