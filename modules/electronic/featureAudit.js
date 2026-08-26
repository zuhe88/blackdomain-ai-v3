const crypto = require("crypto");
const supabase = require("../../services/supabase");
const { findVipUserByLineUserId } = require("../vip/repository");

const STORAGE_KEY = "electronic_feature_audit";
const RECORD_LIMIT = 100;
let records = [];
let hydrated = false;
let hydration = null;
let persistQueue = Promise.resolve();

function normalizeRecord(record = {}) {
  return {
    id: String(record.id || crypto.randomUUID()),
    triggeredAt: record.triggeredAt || new Date().toISOString(),
    gameName: String(record.gameName || ""),
    roomNumber: Number(record.roomNumber) || 0,
    spinId: String(record.spinId || ""),
    featureTrigger: String(record.featureTrigger || ""),
    winnings: Number(record.winnings) || 0,
    member: {
      lineUserId: String(record.member?.lineUserId || ""),
      lineName: String(record.member?.lineName || ""),
      account3A: String(record.member?.account3A || ""),
    },
    notificationSucceeded: record.notificationSucceeded === true,
    notificationError: String(record.notificationError || ""),
    trackingAtNotification: record.trackingAtNotification !== false,
  };
}

async function hydrate() {
  if (hydrated) return;
  if (hydration) return hydration;
  hydration = (async () => {
    if (supabase) {
      const { data, error } = await supabase
        .from("lottery_settings")
        .select("value")
        .eq("key", STORAGE_KEY)
        .maybeSingle();
      if (error) console.error("[Electronic] Feature audit hydration failed:", error.message);
      const stored = data?.value?.records;
      if (Array.isArray(stored)) records = stored.map(normalizeRecord).slice(0, RECORD_LIMIT);
    }
    hydrated = true;
  })();
  try {
    await hydration;
  } finally {
    hydration = null;
  }
}

function persist() {
  if (!supabase) return Promise.resolve();
  persistQueue = persistQueue.then(async () => {
    const { error } = await supabase
      .from("lottery_settings")
      .upsert({
        key: STORAGE_KEY,
        value: { records },
        updated_at: new Date().toISOString(),
        updated_by: "electronic-feature-audit",
      }, { onConflict: "key" });
    if (error) console.error("[Electronic] Feature audit persistence failed:", error.message);
  }).catch((error) => {
    console.error("[Electronic] Feature audit persistence failed:", error.message);
  });
  return persistQueue;
}

async function recordFeatureNotification({ payload, watch, notificationSucceeded, notificationError }) {
  await hydrate();
  let member = null;
  try {
    member = await findVipUserByLineUserId(watch.userId);
  } catch (error) {
    console.error("[Electronic] Feature audit member lookup failed:", error.message);
  }
  const record = normalizeRecord({
    id: crypto.randomUUID(),
    triggeredAt: new Date().toISOString(),
    gameName: payload.gameName,
    roomNumber: payload.roomNumber,
    spinId: payload.spinId,
    featureTrigger: payload.featureTrigger,
    winnings: payload.totalWinnings,
    member: {
      lineUserId: watch.userId,
      lineName: member?.lineName,
      account3A: member?.account3A,
    },
    notificationSucceeded,
    notificationError,
    trackingAtNotification: true,
  });
  records = [record, ...records].slice(0, RECORD_LIMIT);
  await persist();
  return record;
}

async function listFeatureNotifications(limit = 30) {
  await hydrate();
  return records.slice(0, Math.max(1, Math.min(RECORD_LIMIT, Number(limit) || 30)))
    .map((record) => normalizeRecord(record));
}

module.exports = {
  listFeatureNotifications,
  recordFeatureNotification,
};
