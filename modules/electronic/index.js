const crypto = require("crypto");
const {
  reply,
  pushStrict,
  quickReply,
} = require("../../services/line");
const { COLORS, bubble, button, note, section, text } = require("../../ui/flex/premium");
const {
  electronicRecommendFlex,
  electronicFeatureResultFlex,
} = require("../../ui/flex/electronicResult");
const supabase = require("../../services/supabase");
const electronicSource = require("./source");
const electronicAvailability = require("./availability");
const { isAdminLineUserId } = require("../../config/admin");

const electronicSessions = new Map();
const cycleCache = new Map();
const recommendCursorStore = new Map();
const roomRecommendationLeases = new Map();
const recommendInFlight = new Map();
const pendingRecommendations = new Map();
const recommendationProbes = new Map();
const liveWatches = new Map();
const stoppedWatchKeys = new Map();
const notifiedSpins = new Set();
const notifyingSpins = new Set();
const recentFeatureResults = new Map();
const notifyingFeatureResults = new Set();
const SESSION_TIMEOUT = 30 * 60 * 1000;
const LIVE_WATCH_TIMEOUT = 6 * 60 * 60 * 1000;
const FEATURE_RESULT_LIFECYCLE_MS = 10 * 60 * 1000;
const FEATURE_RESULT_CLOSED_GRACE_MS = 30 * 1000;
const RECOMMEND_LEASE_MS = 2 * 60 * 1000;
const WATCH_KEY_PREFIX = "electronic_watch:";
const SESSION_KEY_PREFIX = "electronic_session:";
const PENDING_KEY_PREFIX = "electronic_pending:";
const RECOMMEND_HISTORY_KEY_PREFIX = "electronic_recommend_history:";
const DETAIL_WAIT_MS = Math.max(1000, Number(process.env.ELECTRONIC_DETAIL_WAIT_MS) || 20000);
const PENDING_RECOMMEND_RETRY_MS = 5000;
const PENDING_RECOMMEND_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.ELECTRONIC_PENDING_TIMEOUT_MS) || 90 * 1000,
);
const FIRST_SCAN_ESTIMATE = "正在掃描房間中並計算 RTP";
const RTP_WAIT_ESTIMATE = "通常約 15～45 秒，最長等待 90 秒";
const RECOMMEND_PROBE_BATCH_SIZE = 12;
const BACKGROUND_PROBE_OWNER = "electronic-background-pool";
const BACKGROUND_PROBE_ROTATE_MS = 45 * 1000;
const RECOMMEND_HISTORY_LIMIT = 500;
const FALLBACK_ROOM_HISTORY_LIMIT = 100;
const recommendHistoryHydrated = new Set();
const backgroundProbeSeededAt = new Map();

const GAME_CONFIG = {
  戰神賽特1: { name: "戰神賽特1", min: 1, max: 1300, pad: 3 },
  戰神賽特2: { name: "戰神賽特2", min: 1, max: 4000, pad: 4 },
  古神巴風特: { name: "古神巴風特", min: 1, max: 1000, pad: 3 },
  虎小妹: { name: "虎小妹", min: 1, max: 3000, pad: 4 },
  赤三國: { name: "赤三國", min: 1, max: 200, pad: 3 },
};
function isElectronicGameEnabled(gameName) {
  return electronicAvailability.isGameEnabled(gameName);
}

function unavailableGameFlex(gameName) {
  return electronicPromptFlex(`${gameName} 暫未開放`, [
    "此遊戲目前暫停提供 AI 功能",
    "目前僅開放戰神賽特2",
    "請返回電子首頁選擇戰神賽特2",
  ]);
}

const MAIN_COMMANDS = new Set(["ATG", "ATGAI", "ATG AI", "電子", "電子AI", "Electronic", "electronic", "⚡ 電子AI"]);
const RECOMMEND_COMMANDS = new Set(["AI推薦房", "推薦房", "重新推薦"]);
const REMOVED_CUSTOM_COMMANDS = new Set(["自選分析", "自選房分析", "自選房號分析"]);
const BACK_TO_GAME_COMMANDS = new Set(["返回電子首頁", "返回遊戲選單"]);
const ADMIN_REFRESH_COMMANDS = new Set([
  "更新房間數據",
  "更新房間資料",
  "更新房間統計",
  "刷新房間數據",
  "刷新房間資料",
  "刷新房間統計",
]);
const STOP_WATCH_COMMAND = "結束房間監控";
const CANCEL_RECOMMEND_COMMANDS = new Set(["取消推薦", "停止推薦"]);

function watchKey(watch = {}) {
  return `${watch.userId || ""}:${watch.gameName || ""}:${Number(watch.roomNumber) || 0}`;
}

function isStopWatchCommand(value) {
  return value === "結束該房間"
    || value === STOP_WATCH_COMMAND
    || String(value || "").startsWith(`${STOP_WATCH_COMMAND} `);
}

function isCancelRecommendationCommand(value) {
  return CANCEL_RECOMMEND_COMMANDS.has(String(value || "").trim());
}

function recommendHistoryKey(userId, gameName) {
  return `${RECOMMEND_HISTORY_KEY_PREFIX}${userId}:${gameName}`;
}

function persistRecommendHistory(userId, gameName, recentRooms) {
  if (!supabase || !userId || !gameName) return;
  const rooms = [...new Set((recentRooms || []).map(Number).filter(Number.isInteger))]
    .slice(0, RECOMMEND_HISTORY_LIMIT);
  const updatedAt = Date.now();
  supabase
    .from("lottery_settings")
    .upsert({
      key: recommendHistoryKey(userId, gameName),
      value: { userId, gameName, recentRooms: rooms, updatedAt },
      updated_at: new Date(updatedAt).toISOString(),
      updated_by: userId,
    }, { onConflict: "key" })
    .then(({ error }) => {
      if (error) console.error("[Electronic] Recommendation history persistence failed:", error.message);
    });
}

async function hydrateRecommendHistory(userId, gameName) {
  const hydrationKey = `${userId}:${gameName}`;
  if (!supabase || recommendHistoryHydrated.has(hydrationKey)) return false;
  const key = `${userId || "guest"}:${gameName}:live`;
  if (recommendCursorStore.has(key)) {
    recommendHistoryHydrated.add(hydrationKey);
    return false;
  }
  recommendHistoryHydrated.add(hydrationKey);
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("value")
    .eq("key", recommendHistoryKey(userId, gameName))
    .maybeSingle();
  if (error) {
    recommendHistoryHydrated.delete(hydrationKey);
    console.error("[Electronic] Recommendation history hydration failed:", error.message);
    return false;
  }
  const stored = data?.value;
  if (!Array.isArray(stored?.recentRooms)) return false;
  recommendCursorStore.set(key, {
    recentRooms: [...new Set(stored.recentRooms.map(Number).filter(Number.isInteger))]
      .slice(0, RECOMMEND_HISTORY_LIMIT),
    updatedAt: Number(stored.updatedAt) || Date.now(),
  });
  return true;
}

function removePendingPersistence(userId) {
  if (!supabase || !userId) return;
  supabase
    .from("lottery_settings")
    .delete()
    .eq("key", `${PENDING_KEY_PREFIX}${userId}`)
    .then(({ error }) => {
      if (error) console.error("[Electronic] Pending recommendation removal failed:", error.message);
    });
}

function cancelPendingRecommendation(userId, { removePersistent = true } = {}) {
  const pending = pendingRecommendations.get(userId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  clearInterval(pending.retryTimer);
  pendingRecommendations.delete(userId);
  clearRecommendationProbes(userId);
  if (removePersistent) removePendingPersistence(userId);
  return true;
}

function clearRecommendationProbes(userId) {
  const owner = String(userId || "guest");
  for (const [key, probe] of recommendationProbes.entries()) {
    if (probe.userId === owner) recommendationProbes.delete(key);
  }
}

function watchRecommendationCandidate(userId, gameName, roomNumber) {
  const owner = String(userId || "guest");
  const number = Number(roomNumber);
  if (!Number.isInteger(number)) return false;
  clearRecommendationProbes(owner);
  recommendationProbes.set(`${owner}:${gameName}:${number}`, {
    userId: owner,
    gameName,
    roomNumber: number,
    updatedAt: Date.now(),
  });
  return true;
}

function seedRecommendationProbes(userId, gameName, limit = RECOMMEND_PROBE_BATCH_SIZE) {
  if (!requiresLiveRtp(gameName)) return 0;
  const owner = String(userId || "guest");
  clearRecommendationProbes(owner);
  const rooms = electronicSource.getEmptyRooms(gameName)
    .filter((room) => scoreSethRoomByRtp(room) == null)
    .sort((left, right) => (
      hashScore(`${owner}:${left.number}`) - hashScore(`${owner}:${right.number}`)
    ));
  if (!rooms.length) return 0;
  const cursorKey = `${owner}:${gameName}:probe-cursor`;
  const cursor = Number(recommendCursorStore.get(cursorKey)?.cursor) || 0;
  const batchSize = Math.min(Math.max(1, Number(limit) || 1), rooms.length);
  const selectedRooms = Array.from({ length: batchSize }, (_, index) => (
    rooms[(cursor + index) % rooms.length]
  ));
  recommendCursorStore.set(cursorKey, {
    cursor: (cursor + batchSize) % rooms.length,
    updatedAt: Date.now(),
  });
  const updatedAt = Date.now();
  selectedRooms.forEach((room) => {
    const probe = {
      userId: owner,
      gameName,
      roomNumber: room.number,
      updatedAt,
    };
    recommendationProbes.set(`${owner}:${gameName}:${room.number}`, probe);
  });
  return selectedRooms.length;
}

function refreshBackgroundRecommendationProbes(now = Date.now()) {
  electronicSource.GAME_NAMES.filter(requiresLiveRtp).forEach((gameName) => {
    const owner = `${BACKGROUND_PROBE_OWNER}:${gameName}`;
    const hasActiveBatch = [...recommendationProbes.values()].some((probe) => (
      probe.userId === owner && probe.gameName === gameName
    ));
    const seededAt = Number(backgroundProbeSeededAt.get(gameName)) || 0;
    if (hasActiveBatch && now - seededAt < BACKGROUND_PROBE_ROTATE_MS) return;
    seedRecommendationProbes(owner, gameName);
    backgroundProbeSeededAt.set(gameName, now);
  });
}

function refreshPendingRecommendationProbes(gameName) {
  for (const pending of pendingRecommendations.values()) {
    if (pending.gameName === gameName && !hasRecommendableRoomData(gameName)) {
      seedRecommendationProbes(pending.userId, gameName);
    }
  }
}

async function cancelRecommendation(userId) {
  const pendingCancelled = cancelPendingRecommendation(userId);
  const inFlight = recommendInFlight.get(userId);
  if (inFlight) inFlight.cancelled = true;
  if (inFlight) clearRecommendationProbes(userId);
  releaseRoomRecommendationLeases(userId);
  return pendingCancelled || Boolean(inFlight);
}

function recommendationWaitingFlex(title, gameName, message, eta) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    quickReply: quickReply([
      { label: "取消推薦", text: "取消推薦" },
      { label: "返回首頁", text: "首頁" },
    ]),
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      section([
        text(gameName, {
          size: "sm",
          weight: "bold",
          color: COLORS.gold,
          align: "center",
        }),
        text(message, {
          size: "md",
          weight: "bold",
          color: COLORS.white,
          align: "center",
        }),
        text("完成後會自動回傳推薦房間", {
          size: "sm",
          color: COLORS.green,
          align: "center",
        }),
        { type: "separator", color: "#4C3C1E" },
        note(`${eta}｜請勿重複點擊`),
      ]),
      button("取消推薦", "取消推薦", "danger"),
    ],
  });
}

function recommendationTimeoutFlex(gameName) {
  return electronicPromptFlex("本次推薦已停止", [
    gameName,
    "90 秒內仍未取得足夠的即時空房與 RTP 資料",
    "本次不會使用舊資料或無 RTP 房間產生推薦",
    "資料恢復後可再次按「AI推薦房」",
  ], electronicModeQuickReply());
}

function persistPendingRecommendation(pending) {
  if (!supabase || !pending?.userId) return;
  supabase
    .from("lottery_settings")
    .upsert({
      key: `${PENDING_KEY_PREFIX}${pending.userId}`,
      value: {
        userId: pending.userId,
        gameName: pending.gameName,
        requestedAt: pending.requestedAt,
        deadlineAt: pending.deadlineAt,
      },
      updated_at: new Date(pending.requestedAt).toISOString(),
      updated_by: pending.userId,
    }, { onConflict: "key" })
    .then(({ error }) => {
      if (error) console.error("[Electronic] Pending recommendation persistence failed:", error.message);
    });
}

function queuePendingRecommendation(userId, gameName, options = {}) {
  cancelPendingRecommendation(userId, { removePersistent: false });
  electronicSource.requestFullRefresh();
  const requestedAt = Number(options.requestedAt) || Date.now();
  const deadlineAt = Number(options.deadlineAt) || requestedAt + PENDING_RECOMMEND_TIMEOUT_MS;
  if (deadlineAt <= Date.now()) return null;
  const pending = {
    userId,
    gameName,
    requestedAt,
    deadlineAt,
    timer: null,
    retryTimer: null,
  };
  seedRecommendationProbes(userId, gameName);
  pending.retryTimer = setInterval(() => {
    if (pendingRecommendations.get(userId) !== pending) return;
    if (hasRecommendableRoomData(gameName)) {
      handleElectronicDataReady(gameName).catch((error) => {
        console.error("[Electronic] Pending recommendation recovery failed:", error.message);
      });
      return;
    }
    seedRecommendationProbes(userId, gameName);
    electronicSource.requestFullRefresh();
  }, PENDING_RECOMMEND_RETRY_MS);
  pending.retryTimer.unref?.();
  pending.timer = setTimeout(async () => {
    if (pendingRecommendations.get(userId) !== pending) return;
    try {
      await pushStrict(userId, recommendationTimeoutFlex(gameName));
    } catch (error) {
      console.error("[Electronic] Recommendation timeout notice failed:", error.message);
    } finally {
      cancelPendingRecommendation(userId);
    }
  }, Math.max(1, deadlineAt - Date.now()));
  pending.timer.unref?.();
  pendingRecommendations.set(userId, pending);
  persistPendingRecommendation(pending);
  return pending;
}

async function hydratePendingRecommendations() {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("value")
    .like("key", `${PENDING_KEY_PREFIX}%`);
  if (error) {
    console.error("[Electronic] Pending recommendation hydration failed:", error.message);
    return 0;
  }
  let restored = 0;
  for (const row of data || []) {
    const pending = row?.value;
    if (!pending?.userId) continue;
    if (
      !isElectronicGameEnabled(pending.gameName)
      || Number(pending.deadlineAt) <= Date.now()
    ) {
      removePendingPersistence(pending.userId);
      continue;
    }
    if (queuePendingRecommendation(pending.userId, pending.gameName, pending)) restored += 1;
  }
  return restored;
}

function rememberLiveWatch(watch) {
  if (!watch?.userId || stoppedWatchKeys.has(watchKey(watch))) return false;
  liveWatches.set(watch.userId, watch);
  if (!supabase) return true;
  supabase
    .from("lottery_settings")
    .upsert({
      key: `${WATCH_KEY_PREFIX}${watch.userId}`,
      value: watch,
      updated_at: new Date(watch.updatedAt).toISOString(),
      updated_by: watch.userId,
    }, { onConflict: "key" })
    .then(({ error }) => {
      if (error) console.error("[Electronic] Watch persistence failed:", error.message);
    });
  return true;
}

function allowNewLiveWatch(userId) {
  const ownerPrefix = `${String(userId || "")}:`;
  for (const key of stoppedWatchKeys.keys()) {
    if (key.startsWith(ownerPrefix)) stoppedWatchKeys.delete(key);
  }
  const stopped = liveWatches.get(userId);
  if (stopped?.stoppedAt) liveWatches.delete(userId);
}

async function stopLiveWatch(userId, expectedGameName = "", expectedRoomNumber = null) {
  let watch = liveWatches.get(userId) || null;
  if (!watch && supabase) {
    const { data } = await supabase
      .from("lottery_settings")
      .select("value")
      .eq("key", `${WATCH_KEY_PREFIX}${userId}`)
      .maybeSingle();
    watch = data?.value || null;
  }
  if (!watch || watch.stoppedAt) return { stopped: false, reason: "none" };
  if (
    (expectedGameName && watch.gameName !== expectedGameName)
    || (
      expectedRoomNumber != null
      && Number(watch.roomNumber) !== Number(expectedRoomNumber)
    )
  ) {
    return { stopped: false, reason: "changed", watch };
  }

  const stoppedAt = Date.now();
  liveWatches.delete(userId);
  releaseRoomRecommendationLeases(userId, watch.gameName);
  stoppedWatchKeys.set(watchKey(watch), stoppedAt);
  if (supabase) {
    const { error } = await supabase
      .from("lottery_settings")
      .upsert({
        key: `${WATCH_KEY_PREFIX}${userId}`,
        value: { ...watch, stoppedAt },
        updated_at: new Date(stoppedAt).toISOString(),
        updated_by: userId,
      }, { onConflict: "key" });
    if (error) console.error("[Electronic] Watch stop persistence failed:", error.message);
  }
  return { stopped: true, watch };
}

function rememberElectronicSession(userId, session) {
  if (!userId || !session?.gameName || !supabase) return;
  supabase
    .from("lottery_settings")
    .upsert({
      key: `${SESSION_KEY_PREFIX}${userId}`,
      value: { gameName: session.gameName, updatedAt: session.updatedAt },
      updated_at: new Date(session.updatedAt).toISOString(),
      updated_by: userId,
    }, { onConflict: "key" })
    .then(({ error }) => {
      if (error) console.error("[Electronic] Session persistence failed:", error.message);
    });
}

async function restoreElectronicSession(userId) {
  const current = getUserSession(userId);
  if (current.gameName || !supabase) return current;
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("value")
    .eq("key", `${SESSION_KEY_PREFIX}${userId}`)
    .maybeSingle();
  if (error || !data?.value?.gameName) return current;
  const stored = data.value;
  if (
    !GAME_CONFIG[stored.gameName]
    || Date.now() - Number(stored.updatedAt || 0) > SESSION_TIMEOUT
  ) return current;
  return setGameSession(userId, stored.gameName);
}

async function getLiveWatchers(gameName, roomNumber) {
  const watchers = new Map();
  const now = Date.now();
  for (const watch of liveWatches.values()) {
    if (
      watch.gameName === gameName
      && Number(watch.roomNumber) === roomNumber
      && !watch.stoppedAt
      && now - Number(watch.updatedAt || 0) <= LIVE_WATCH_TIMEOUT
    ) watchers.set(watch.userId, watch);
  }
  if (!supabase) {
    return [...watchers.values()].filter((watch) => !stoppedWatchKeys.has(watchKey(watch)));
  }
  const { data, error } = await supabase
    .from("lottery_settings")
    .select("value")
    .like("key", `${WATCH_KEY_PREFIX}%`);
  if (error) {
    console.error("[Electronic] Watch hydration failed:", error.message);
    return [...watchers.values()].filter((watch) => !stoppedWatchKeys.has(watchKey(watch)));
  }
  for (const row of data || []) {
    const watch = row?.value;
    if (
      watch?.userId
      && watch.gameName === gameName
      && Number(watch.roomNumber) === roomNumber
      && !watch.stoppedAt
      && now - Number(watch.updatedAt || 0) <= LIVE_WATCH_TIMEOUT
    ) {
      watchers.set(watch.userId, watch);
      liveWatches.set(watch.userId, watch);
    }
  }
  return [...watchers.values()].filter((watch) => !stoppedWatchKeys.has(watchKey(watch)));
}

async function getActiveWatchRooms() {
  const watches = new Map();
  const now = Date.now();
  // Keep expanding the Seth 2 RTP candidate pool even after the first usable
  // room is found. Previously the probe queue stopped as soon as room 2001
  // produced RTP, leaving every recommendation with the same sole candidate.
  refreshBackgroundRecommendationProbes(now);
  for (const watch of liveWatches.values()) {
    if (watch?.userId && !watch.stoppedAt && now - Number(watch.updatedAt || 0) <= LIVE_WATCH_TIMEOUT) {
      watches.set(watch.userId, { ...watch, purpose: "feature" });
    }
  }
  for (const probe of recommendationProbes.values()) {
    if (probe?.userId && now - Number(probe.updatedAt || 0) <= SESSION_TIMEOUT) {
      watches.set(`probe:${probe.userId}:${probe.roomNumber}`, { ...probe, purpose: "rtp" });
    }
  }
  if (supabase) {
    const { data, error } = await supabase
      .from("lottery_settings")
      .select("value")
      .like("key", `${WATCH_KEY_PREFIX}%`);
    if (error) {
      console.error("[Electronic] Active watch lookup failed:", error.message);
    } else {
      for (const row of data || []) {
        const watch = row?.value;
        if (watch?.userId && !watch.stoppedAt && now - Number(watch.updatedAt || 0) <= LIVE_WATCH_TIMEOUT) {
          watches.set(watch.userId, { ...watch, purpose: "feature" });
          liveWatches.set(watch.userId, watch);
        }
      }
    }
  }
  const rooms = new Map();
  for (const watch of watches.values()) {
    const roomNumber = Number(watch.roomNumber);
    if (
      stoppedWatchKeys.has(watchKey(watch))
      || !electronicSource.SUPPORTED_GAMES.has(watch.gameName)
      || !Number.isInteger(roomNumber)
    ) continue;
    const key = `${watch.gameName}:${roomNumber}`;
    const existing = rooms.get(key);
    if (!existing || watch.purpose === "feature") {
      rooms.set(key, {
        gameName: watch.gameName,
        roomNumber,
        priority: watch.purpose === "feature" ? "feature" : "rtp",
      });
    }
  }
  return [...rooms.values()];
}

function taipeiNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function getCycleKey() {
  const now = taipeiNow();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = now.getMinutes() >= 30 ? "30" : "00";
  return `${year}${month}${date}${hour}${minute}`;
}

function getUpdateTimeText() {
  const now = taipeiNow();
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = now.getMinutes() >= 30 ? "30" : "00";
  return `${hour}:${minute}`;
}

function formatRoom(gameName, room) {
  const config = GAME_CONFIG[gameName];
  return String(room).padStart(config?.pad || 3, "0");
}

function parseRoomInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const room = Number(raw);
  return Number.isInteger(room) ? room : null;
}

function validateRoom(gameName, room) {
  const config = GAME_CONFIG[gameName];
  if (!config) return { ok: false, message: "遊戲不存在，請重新選擇電子AI遊戲。" };
  if (!Number.isInteger(room)) return { ok: false, message: "房號格式不正確，請輸入數字房號。" };
  if (room < config.min || room > config.max) {
    return { ok: false, message: `房號不存在。${gameName} 房號範圍為 ${formatRoom(gameName, config.min)} ~ ${formatRoom(gameName, config.max)}。` };
  }
  return { ok: true };
}

function selectedRoomNumber(selected) {
  return selected && typeof selected === "object" ? selected.number : selected;
}

function hashScore(input, max = 2147483647) {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash = (hash ^ (hash >>> 16)) >>> 0;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 3266489909) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return (hash % max) || 1;
}

function seededRandom(seedText) {
  let seed = hashScore(seedText, 2147483647);
  if (seed <= 0) seed += 2147483646;
  return function random() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function shuffleBySeed(list, seedText) {
  const arr = [...list];
  const random = seededRandom(seedText);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function scoreRoom(gameName, cycleKey, room, purpose = "AI") {
  return hashScore(`${purpose}:${gameName}:${cycleKey}:${room}`, 1000000);
}

function pickSpreadRooms(scored, count, minRoom, maxRoom, seedText) {
  const range = Math.max(1, maxRoom - minRoom + 1);
  const bucketCount = Math.max(count, Math.min(12, Math.ceil(range / 120)));
  const buckets = Array.from({ length: bucketCount }, () => []);

  for (const item of scored) {
    const index = Math.min(bucketCount - 1, Math.floor(((item.room - minRoom) / range) * bucketCount));
    buckets[index].push(item);
  }

  const candidates = buckets
    .flatMap((bucket) => bucket.sort((a, b) => b.score - a.score).slice(0, 3))
    .filter(Boolean);

  const result = [];
  const minGap = Math.max(3, Math.floor(range / 25));

  for (const item of shuffleBySeed(candidates, `RANK:${seedText}`)) {
    if (result.length >= count) break;
    if (result.every((picked) => Math.abs(picked.room - item.room) >= minGap)) result.push(item);
  }

  for (const item of shuffleBySeed(scored, `RANK:FILL:${seedText}`)) {
    if (result.length >= count) break;
    if (!result.some((picked) => picked.room === item.room)) result.push(item);
  }

  return result.slice(0, count).map((item) => item.room);
}

function buildRecommendRooms(scored, gameName, cycleKey, minRoom, maxRoom) {
  const range = Math.max(1, maxRoom - minRoom + 1);
  const bucketCount = Math.max(6, Math.min(16, Math.ceil(range / 180)));
  const buckets = Array.from({ length: bucketCount }, () => []);

  for (const item of scored) {
    const index = Math.min(bucketCount - 1, Math.floor(((item.room - minRoom) / range) * bucketCount));
    buckets[index].push(item);
  }

  const perBucket = Math.max(3, Math.ceil(Math.min(60, Math.max(20, range * 0.04)) / bucketCount));
  const candidates = buckets.flatMap((bucket) =>
    bucket
      .sort((a, b) => b.recommendScore - a.recommendScore)
      .slice(0, perBucket)
      .map((item) => item.room)
  );

  return shuffleBySeed(candidates, `RECOMMEND:${gameName}:${cycleKey}`);
}

function buildCyclePools(gameName, cycleKey) {
  const config = GAME_CONFIG[gameName];
  const allRooms = [];
  for (let room = config.min; room <= config.max; room += 1) allRooms.push(room);

  const scored = allRooms
    .map((room) => ({
      room,
      score: scoreRoom(gameName, cycleKey, room, "RANK"),
      recommendScore: scoreRoom(gameName, cycleKey, room, "RECOMMEND_POOL"),
    }))
    .sort((a, b) => b.score - a.score);

  const goodRooms = buildRecommendRooms(scored, gameName, cycleKey, config.min, config.max);
  const recommendRooms = shuffleBySeed(goodRooms, `RECOMMEND:${gameName}:${cycleKey}`);
  const rankRooms = pickSpreadRooms(scored, 5, config.min, config.max, `${gameName}:${cycleKey}`);

  return { goodRooms, recommendRooms, rankRooms };
}

function getGameCycle(gameName) {
  const cycleKey = getCycleKey();
  const cacheKey = `${gameName}:${cycleKey}`;
  if (!cycleCache.has(cacheKey)) {
    cycleCache.set(cacheKey, { gameName, cycleKey, ...buildCyclePools(gameName, cycleKey), createdAt: Date.now() });
  }
  return cycleCache.get(cacheKey);
}

function getUserSession(userId) {
  const existing = electronicSessions.get(userId);
  if (existing && Date.now() - existing.updatedAt <= SESSION_TIMEOUT) {
    existing.updatedAt = Date.now();
    electronicSessions.set(userId, existing);
    return existing;
  }
  if (existing) electronicSessions.delete(userId);
  const session = { gameName: null, mode: null, waitingCustomRoom: false, updatedAt: Date.now() };
  electronicSessions.set(userId, session);
  return session;
}

function setGameSession(userId, gameName) {
  const session = getUserSession(userId);
  session.gameName = gameName;
  session.mode = "menu";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  rememberElectronicSession(userId, session);
  return session;
}

function electronicPromptFlex(title, lines = [], quickReplyData = null) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    quickReply: quickReplyData,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: lines.length
      ? [section(lines.map((line, index) => text(line, {
          size: "sm",
          color: index === 0 ? COLORS.gold : COLORS.white,
          align: "center",
        })))]
      : [],
  });
}

function electronicStopMonitoringFlex(result, quickReplyData = null) {
  const watch = result.watch || {};
  const room = formatRoom(watch.gameName, watch.roomNumber);
  return bubble({
    altText: "已結束房間監控",
    title: "監控已結束",
    subtitle: watch.gameName || "電子 AI",
    quickReply: quickReplyData,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: [
      {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "18px",
        cornerRadius: "18px",
        backgroundColor: "#121714",
        borderColor: "#315B46",
        borderWidth: "1px",
        contents: [
          text("✓ 已停止接收通知", { size: "md", weight: "bold", color: COLORS.green, align: "center" }),
          text(room, { size: "xxl", weight: "bold", color: COLORS.white, align: "center" }),
          text("後續特色遊戲結果不會再傳送給您", {
            size: "xs",
            color: COLORS.muted,
            align: "center",
            wrap: true,
          }),
        ],
      },
      note("需要其他房間時，可直接使用下方的「重新推薦」。"),
    ],
  });
}

function reportedRtp(value, win, bet) {
  const direct = Number(value);
  if (value != null && value !== "" && Number.isFinite(direct) && direct >= 0) return direct;
  const winnings = Number(win);
  const stake = Number(bet);
  if (!Number.isFinite(winnings) || !Number.isFinite(stake) || stake <= 0) return null;
  return (winnings / stake) * 100;
}

function scoreSethRoomByRtp(room) {
  if (!electronicSource.hasFreshRoomDetail(room)) return null;
  const detail = room?.detail;
  if (!detail) return null;
  const todayBet = Number(detail.todayBet ?? detail.hourBet) || 0;
  const todayWin = Number(detail.todayWin ?? detail.hourWin) || 0;
  const dayBet = Number(detail.dayBet) || 0;
  const dayWin = Number(detail.dayWin) || 0;
  const todayRtp = reportedRtp(detail.todayRtp, todayWin, todayBet);
  const monthRtp = reportedRtp(detail.dayRtp, dayWin, dayBet);
  if (todayRtp == null && monthRtp == null) return null;
  if (todayRtp == null) return monthRtp;
  if (monthRtp == null) return todayRtp;
  return (todayRtp * 0.65) + (monthRtp * 0.35);
}

function requiresLiveRtp(gameName) {
  return electronicSource.SUPPORTED_GAMES.has(gameName)
    && gameName !== electronicSource.GAME_NAMES[0];
}

function hasRecommendableRoomData(gameName) {
  if (!electronicSource.hasReadyData(gameName)) return false;
  if (!requiresLiveRtp(gameName)) return true;
  return electronicSource.getEmptyRooms(gameName)
    .some((room) => scoreSethRoomByRtp(room) != null);
}

function roomLeaseKey(gameName, roomNumber) {
  return `${gameName}:${Number(roomNumber)}`;
}

function pruneRoomRecommendationLeases(now = Date.now()) {
  for (const [key, lease] of roomRecommendationLeases.entries()) {
    if (!lease?.expiresAt || lease.expiresAt <= now) roomRecommendationLeases.delete(key);
  }
}

function releaseRoomRecommendationLeases(userId, gameName = "") {
  const owner = String(userId || "guest");
  for (const [key, lease] of roomRecommendationLeases.entries()) {
    if (lease.userId === owner && (!gameName || lease.gameName === gameName)) {
      roomRecommendationLeases.delete(key);
    }
  }
}

function roomIsLeasedByAnotherUser(userId, gameName, roomNumber) {
  const lease = roomRecommendationLeases.get(roomLeaseKey(gameName, roomNumber));
  return Boolean(lease && lease.userId !== String(userId || "guest"));
}

function leaseRecommendedRoom(userId, gameName, roomNumber) {
  if (!Number.isInteger(Number(roomNumber))) return;
  const owner = String(userId || "guest");
  roomRecommendationLeases.set(roomLeaseKey(gameName, roomNumber), {
    userId: owner,
    gameName,
    roomNumber: Number(roomNumber),
    expiresAt: Date.now() + RECOMMEND_LEASE_MS,
  });
}

function getNextRecommendRoom(userId, gameName) {
  pruneRoomRecommendationLeases();
  releaseRoomRecommendationLeases(userId, gameName);
  if (
    gameName === electronicSource.GAME_NAMES[0]
    && !electronicSource.hasReadyData(gameName)
  ) {
    const config = GAME_CONFIG[gameName];
    const key = `${userId || "guest"}:${gameName}:room-pool`;
    const existing = recommendCursorStore.get(key);
    const recentRooms = Array.isArray(existing?.recentRooms) ? existing.recentRooms : [];
    let room = crypto.randomInt(config.min, config.max + 1);
    for (
      let attempt = 0;
      attempt < 50 && (
        recentRooms.includes(room)
        || roomIsLeasedByAnotherUser(userId, gameName, room)
      );
      attempt += 1
    ) {
      room = crypto.randomInt(config.min, config.max + 1);
    }
    if (roomIsLeasedByAnotherUser(userId, gameName, room)) return null;
    recommendCursorStore.set(key, {
      recentRooms: [room, ...recentRooms.filter((value) => value !== room)]
        .slice(0, FALLBACK_ROOM_HISTORY_LIMIT),
      updatedAt: Date.now(),
    });
    persistRecommendHistory(userId, gameName, recommendCursorStore.get(key).recentRooms);
    leaseRecommendedRoom(userId, gameName, room);
    return room;
  }
  if (electronicSource.SUPPORTED_GAMES.has(gameName)) {
    const emptyRooms = electronicSource.getEmptyRooms(gameName);
    if (!emptyRooms.length) return null;
    const rtpRankedRooms = requiresLiveRtp(gameName)
      ? emptyRooms
        .map((room) => ({ room, rtpScore: scoreSethRoomByRtp(room) }))
        .filter((item) => item.rtpScore != null)
        .sort((a, b) => b.rtpScore - a.rtpScore || a.room.number - b.room.number)
        .map((item) => item.room)
      : [];
    if (requiresLiveRtp(gameName) && !rtpRankedRooms.length) return null;
    const detailedRooms = emptyRooms.filter((room) => room.detail);
    const candidates = requiresLiveRtp(gameName)
      ? rtpRankedRooms
      : (detailedRooms.length ? detailedRooms.slice(0, 10) : emptyRooms);
    const key = `${userId || "guest"}:${gameName}:live`;
    const existing = recommendCursorStore.get(key);
    const recentRooms = Array.isArray(existing?.recentRooms) ? existing.recentRooms : [];
    const unleasedCandidates = candidates.filter((room) => (
      !roomIsLeasedByAnotherUser(userId, gameName, room.number)
    ));
    if (!unleasedCandidates.length) return null;
    const freshCandidates = unleasedCandidates.filter((room) => !recentRooms.includes(room.number));
    const pool = freshCandidates.length ? freshCandidates : unleasedCandidates;
    const qualityPoolSize = rtpRankedRooms.length
      ? Math.min(pool.length, Math.max(10, Math.ceil(pool.length * 0.5)))
      : pool.length;
    const qualityPool = pool.slice(0, qualityPoolSize);
    const selected = qualityPool[crypto.randomInt(qualityPool.length)];
    const recentLimit = Math.min(RECOMMEND_HISTORY_LIMIT, candidates.length);
    recommendCursorStore.set(key, {
      recentRooms: [selected.number, ...recentRooms.filter((room) => room !== selected.number)].slice(0, recentLimit),
      updatedAt: Date.now(),
    });
    persistRecommendHistory(userId, gameName, recommendCursorStore.get(key).recentRooms);
    leaseRecommendedRoom(userId, gameName, selected.number);
    return selected;
  }
  const cycle = getGameCycle(gameName);
  if (!Array.isArray(cycle.recommendRooms) || cycle.recommendRooms.length === 0) {
    const config = GAME_CONFIG[gameName];
    return config?.min || 1;
  }
  const key = `${userId || "guest"}:${gameName}:${cycle.cycleKey}`;
  const existing = recommendCursorStore.get(key);
  const initialCursor = hashScore(`START:${key}`, cycle.recommendRooms.length);
  const cursor = Number.isInteger(existing?.cursor) ? existing.cursor : initialCursor;
  const availableRooms = cycle.recommendRooms.filter((candidate) => (
    !roomIsLeasedByAnotherUser(userId, gameName, candidate)
  ));
  if (!availableRooms.length) return null;
  const room = availableRooms[cursor % availableRooms.length];

  recommendCursorStore.set(key, { cursor: cursor + 1, updatedAt: Date.now() });
  leaseRecommendedRoom(userId, gameName, room);

  return Number.isInteger(room) ? room : GAME_CONFIG[gameName]?.min || 1;
}

function electronicModeQuickReply() {
  return quickReply([
    { label: "AI推薦房", text: "AI推薦房" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function afterRecommendQuickReply() {
  return quickReply([
    { label: "重新推薦", text: "重新推薦" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

async function showElectronicMain(event) {
  const electronicMenuFlex = require("../../ui/flex/electronicMenu");
  return reply(event.replyToken, electronicMenuFlex(isElectronicGameEnabled));
}

function enforceGameAvailability() {
  for (const [userId, session] of electronicSessions.entries()) {
    if (session?.gameName && !isElectronicGameEnabled(session.gameName)) {
      resetElectronicSession(userId);
    }
  }
  for (const [userId, pending] of pendingRecommendations.entries()) {
    if (!isElectronicGameEnabled(pending.gameName)) cancelPendingRecommendation(userId);
  }
}

async function stopRoomMonitoring(event) {
  const value = event.message?.text?.trim() || "";
  const match = value.match(/^結束房間監控(?:\s+(\S+)\s+(\d+))?$/);
  if (value !== "結束該房間" && value !== STOP_WATCH_COMMAND && !match) {
    return reply(event.replyToken, electronicPromptFlex("無法辨識房間", [
      "請使用推薦卡下方的「結束該房間」按鈕",
      "目前監控不受影響",
    ], afterRecommendQuickReply()));
  }
  const result = await stopLiveWatch(
    event.source?.userId || "",
    match?.[1] || "",
    match?.[2] == null ? null : Number(match[2]),
  );
  if (result.stopped) {
    return reply(event.replyToken, electronicStopMonitoringFlex(result, afterRecommendQuickReply()));
  }
  if (result.reason === "changed") {
    return reply(event.replyToken, electronicPromptFlex("目前監控房間已變更", [
      "這是較早的推薦卡",
      `目前監控：${result.watch.gameName} ${formatRoom(result.watch.gameName, result.watch.roomNumber)}`,
      "目前房間不受這次操作影響",
    ], afterRecommendQuickReply()));
  }
  return reply(event.replyToken, electronicPromptFlex("目前沒有監控中的房間", [
    "無需進一步操作",
  ], afterRecommendQuickReply()));
}

async function handleCancelRecommendation(event) {
  const cancelled = await cancelRecommendation(event.source?.userId || "");
  if (cancelled) {
    return reply(event.replyToken, electronicPromptFlex("已取消推薦", [
      "本次等待與自動回傳已停止",
      "需要時可重新按「AI推薦房」",
    ], electronicModeQuickReply()));
  }
  return reply(event.replyToken, electronicPromptFlex("目前沒有等待中的推薦", [
    "若要停止房間特色遊戲通知",
    "請使用推薦卡下方的「結束該房間」",
  ], afterRecommendQuickReply()));
}

function formatSnapshotTime(value) {
  if (!value) return "尚未取得";
  return new Date(value).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

async function handleAdminRefreshCommand(event) {
  const userId = event.source?.userId || "";
  if (!isAdminLineUserId(userId)) {
    return reply(event.replyToken, electronicPromptFlex("權限不足", [
      "此功能僅限管理員使用。",
    ]));
  }

  const snapshots = electronicSource.getSnapshot();
  const refresh = electronicSource.requestFullRefresh(userId);
  if (!refresh.accepted) {
    return reply(event.replyToken, electronicPromptFlex("房間數據更新中", [
      "目前已有刷新請求正在處理",
      `約 ${refresh.retryAfterSeconds} 秒後可再次操作`,
      `請求編號：${refresh.id}`,
    ]));
  }
  return reply(event.replyToken, electronicPromptFlex("房間數據更新", [
    "已發送強制刷新指令",
    "系統將在數秒內開始重新掃描",
    "完成後會自動更新房間統計",
    ...snapshots.map((snapshot) => (
      `${snapshot.gameName}：${snapshot.tables.length} 房／上次 ${formatSnapshotTime(snapshot.fullScanAt || snapshot.updatedAt)}`
    )),
    `請求編號：${refresh.id}`,
  ]));
}

async function pushRoomSyncWaiting(userId, gameName) {
  try {
    await pushStrict(userId, recommendationWaitingFlex(
      "即時房間數據同步中",
      gameName,
      FIRST_SCAN_ESTIMATE,
      RTP_WAIT_ESTIMATE,
    ));
    return true;
  } catch (error) {
    console.error("[Electronic] Room sync waiting message failed:", error.message);
    return false;
  }
}

async function notifyAdminRefreshComplete(refresh) {
  if (!refresh?.requestedBy) return false;
  const snapshots = electronicSource.getSnapshot();
  try {
    await pushStrict(refresh.requestedBy, electronicPromptFlex("房間數據更新完成", [
      ...snapshots.map((snapshot) => (
        `${snapshot.gameName}：${snapshot.tables.length} 房／更新 ${formatSnapshotTime(snapshot.fullScanAt || snapshot.updatedAt)}`
      )),
      `完成時間：${formatSnapshotTime(refresh.completedAt)}`,
      `請求編號：${refresh.id}`,
    ]));
    return true;
  } catch (error) {
    console.error("[Electronic] Admin refresh notification failed:", error.message);
    return false;
  }
}

async function selectGame(event, gameName) {
  const userId = event.source.userId;
  if (!GAME_CONFIG[gameName]) return reply(event.replyToken, electronicPromptFlex("遊戲不存在", ["請重新選擇電子AI遊戲。"]));
  if (!isElectronicGameEnabled(gameName)) {
    cancelPendingRecommendation(userId);
    resetElectronicSession(userId);
    return reply(event.replyToken, unavailableGameFlex(gameName));
  }
  cancelPendingRecommendation(userId);
  setGameSession(userId, gameName);
  const electronicGameMenu = require("../../ui/flex/electronicGameMenu");
  const message = electronicGameMenu(gameName);
  message.quickReply = electronicModeQuickReply();
  return reply(event.replyToken, message);
}

async function showGameMenu(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  if (!isElectronicGameEnabled(session.gameName)) {
    resetElectronicSession(userId);
    return reply(event.replyToken, unavailableGameFlex(session.gameName));
  }
  session.mode = "menu";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  const electronicGameMenu = require("../../ui/flex/electronicGameMenu");
  const message = electronicGameMenu(session.gameName);
  message.quickReply = electronicModeQuickReply();
  return reply(event.replyToken, message);
}

async function deliverRecommendation(event, message) {
  if (event.recommendationRequest?.cancelled) return false;
  if (event.autoPush) {
    await pushStrict(event.source.userId, message);
    return true;
  }
  await reply(event.replyToken, message);
  return true;
}

async function stopIfRecommendationCancelled(event, userId) {
  if (!event.recommendationRequest?.cancelled) return false;
  clearRecommendationProbes(userId);
  return true;
}

async function performRecommendRoom(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  if (!isElectronicGameEnabled(session.gameName)) {
    resetElectronicSession(userId);
    return deliverRecommendation(event, unavailableGameFlex(session.gameName));
  }
  await hydrateRecommendHistory(userId, session.gameName);
  session.mode = "recommend";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  const requiresRoomConfirmation = session.gameName === electronicSource.GAME_NAMES[0]
    && !electronicSource.hasReadyData(session.gameName);
  let selected = getNextRecommendRoom(userId, session.gameName);
  if (!selected) {
    if (
      electronicSource.SUPPORTED_GAMES.has(session.gameName)
      && !hasRecommendableRoomData(session.gameName)
    ) {
      queuePendingRecommendation(userId, session.gameName);
      if (event.waitingAlreadySent) return false;
      return deliverRecommendation(event, recommendationWaitingFlex(
        "房間數據整理中",
        session.gameName,
        FIRST_SCAN_ESTIMATE,
        RTP_WAIT_ESTIMATE,
      ));
    }
    return deliverRecommendation(event, electronicPromptFlex("目前沒有可推薦的空房", [
      session.gameName,
      "系統只推薦狀態為空房的房間。",
      "客滿、鎖定與關閉房間均已排除，請稍後再試。",
    ], afterRecommendQuickReply()));
  }
  let roomNumber = selectedRoomNumber(selected);
  if (typeof selected === "object") {
    const detailDeadline = Math.min(
      Date.now() + DETAIL_WAIT_MS,
      Number(event.recommendationDeadline) || Number.POSITIVE_INFINITY,
    );
    const selectedHasUsableRtp = requiresLiveRtp(session.gameName)
      && scoreSethRoomByRtp(selected) != null;
    if (!selectedHasUsableRtp && !event.waitingAlreadySent) {
      await pushRoomSyncWaiting(userId, session.gameName);
    }
    if (!selectedHasUsableRtp) watchRecommendationCandidate(userId, session.gameName, roomNumber);
    const firstWaitMs = detailDeadline - Date.now();
    let refreshed = selectedHasUsableRtp
      ? selected
      : firstWaitMs > 0
        ? await electronicSource.waitForRoomDetail(
          session.gameName,
          roomNumber,
          firstWaitMs,
        )
        : null;
    if (await stopIfRecommendationCancelled(event, userId)) return false;
    // ATG does not consistently emit a new detail response for every empty
    // room. A previously captured valid RTP snapshot remains usable, but live
    // ATG recommendations must never fall back to a room without statistics.
    if (
      !refreshed
      && selected.status === "Empty"
      && selected.occupied !== true
    ) {
      refreshed = selected;
    }
    if (!refreshed || refreshed.status !== "Empty" || refreshed.occupied === true) {
      selected = getNextRecommendRoom(userId, session.gameName);
      roomNumber = selectedRoomNumber(selected);
      if (selected && typeof selected === "object") {
        watchRecommendationCandidate(userId, session.gameName, roomNumber);
        const remainingWaitMs = detailDeadline - Date.now();
        selected = remainingWaitMs > 0
          ? await electronicSource.waitForRoomDetail(
            session.gameName,
            roomNumber,
            remainingWaitMs,
          )
          : null;
        if (await stopIfRecommendationCancelled(event, userId)) return false;
      }
    } else {
      selected = refreshed;
    }
    const missingRequiredRtp = requiresLiveRtp(session.gameName)
      && scoreSethRoomByRtp(selected) == null;
    if (!selected || missingRequiredRtp || (typeof selected === "object" && (
      selected.status !== "Empty" || selected.occupied === true
    ))) {
      clearRecommendationProbes(userId);
      if (electronicSource.SUPPORTED_GAMES.has(session.gameName)) {
        queuePendingRecommendation(userId, session.gameName);
        if (event.waitingAlreadySent) return false;
        return deliverRecommendation(event, recommendationWaitingFlex(
          "房間數據整理中",
          session.gameName,
          FIRST_SCAN_ESTIMATE,
          RTP_WAIT_ESTIMATE,
        ));
      }
      return false;
    }
    roomNumber = selectedRoomNumber(selected);
  }
  if (await stopIfRecommendationCancelled(event, userId)) return false;
  const room = formatRoom(session.gameName, roomNumber);
  clearRecommendationProbes(userId);
  const watch = {
    userId,
    gameName: session.gameName,
    roomNumber,
    updatedAt: Date.now(),
  };
  const delivered = await deliverRecommendation(event, electronicRecommendFlex(
    session.gameName,
    room,
    getUpdateTimeText(),
    afterRecommendQuickReply(),
    typeof selected === "object" ? selected : null,
    { requiresRoomConfirmation },
  ));
  if (!delivered || event.recommendationRequest?.cancelled) return false;
  rememberLiveWatch(watch);
  return true;
}

async function recommendRoom(event) {
  const userId = event.source.userId;
  const pending = pendingRecommendations.get(userId);
  if (pending && !event.autoPush) {
    return reply(event.replyToken, recommendationWaitingFlex(
      "房間數據仍在整理中",
      pending.gameName,
      FIRST_SCAN_ESTIMATE,
      RTP_WAIT_ESTIMATE,
    ));
  }
  if (recommendInFlight.has(userId)) {
    if (event.autoPush) return false;
    const currentGame = getUserSession(userId).gameName || "電子AI";
    return reply(event.replyToken, recommendationWaitingFlex(
      "房間數據仍在整理中",
      currentGame,
      FIRST_SCAN_ESTIMATE,
      RTP_WAIT_ESTIMATE,
    ));
  }
  if (!event.autoPush) allowNewLiveWatch(userId);
  const currentGame = getUserSession(userId).gameName;
  if (!event.autoPush && requiresLiveRtp(currentGame)) {
    const request = { id: crypto.randomUUID(), cancelled: false };
    recommendInFlight.set(userId, request);
    await reply(event.replyToken, recommendationWaitingFlex(
      "房間數據整理中",
      currentGame,
      FIRST_SCAN_ESTIMATE,
      RTP_WAIT_ESTIMATE,
    ));
    setImmediate(() => {
      performRecommendRoom({
        ...event,
        autoPush: true,
        waitingAlreadySent: true,
        recommendationDeadline: Date.now() + PENDING_RECOMMEND_TIMEOUT_MS,
        recommendationRequest: request,
      }).catch((error) => {
        console.error("[Electronic] Background recommendation failed:", error.message);
        if (!request.cancelled) {
          pushStrict(userId, recommendationTimeoutFlex(currentGame)).catch((pushError) => {
            console.error("[Electronic] Background failure notice failed:", pushError.message);
          });
        }
      }).finally(() => {
        if (recommendInFlight.get(userId) === request) recommendInFlight.delete(userId);
      });
    });
    return true;
  }
  const request = { id: crypto.randomUUID(), cancelled: false };
  recommendInFlight.set(userId, request);
  try {
    const result = await performRecommendRoom({ ...event, recommendationRequest: request });
    return request.cancelled ? false : result;
  } finally {
    if (recommendInFlight.get(userId) === request) recommendInFlight.delete(userId);
  }
}

async function handleElectronicDataReady(gameName) {
  if (!isElectronicGameEnabled(gameName)) return 0;
  if (!hasRecommendableRoomData(gameName)) {
    refreshPendingRecommendationProbes(gameName);
    return 0;
  }
  const pending = [...pendingRecommendations.values()]
    .filter((item) => item.gameName === gameName);
  if (!pending.length) return 0;
  const results = await Promise.allSettled(pending.map(async (item) => {
    const delivered = await recommendRoom({
      source: { userId: item.userId },
      message: { type: "text", text: "自動推薦" },
      autoPush: true,
      waitingAlreadySent: true,
    });
    if (delivered && pendingRecommendations.get(item.userId) === item) {
      cancelPendingRecommendation(item.userId);
    }
    return delivered;
  }));
  return results.filter((result) => result.status === "fulfilled" && result.value).length;
}

async function handleElectronicSpin(payload = {}) {
  if (!isElectronicGameEnabled(payload.gameName)) return false;
  const featureTrigger = String(payload.featureTrigger || "");
  const isConfirmedFeature = featureTrigger === "purchased"
    || featureTrigger === "room-monitor"
    || featureTrigger === "natural";
  if (!isConfirmedFeature) return false;
  const roomNumber = Number(payload.roomNumber);
  if (!Number.isInteger(roomNumber)) return false;
  const winnings = Number(
    payload.totalWinnings
    ?? payload.freespinWinnings
    ?? payload.currentWinnings
    ?? payload.win,
  );
  if (!Number.isFinite(winnings) || winnings <= 0) return false;
  const watchers = await getLiveWatchers(payload.gameName, roomNumber);
  if (!watchers.length) return false;
  const spinKey = `${payload.gameName}:${payload.spinId || roomNumber}`;
  const normalizedWinnings = Math.round(winnings * 1e6) / 1e6;
  const now = Date.now();
  const pendingWatchers = watchers.filter((watch) => {
    const notificationKey = `${spinKey}:${watch.userId}`;
    const roomResultKey = `${watch.userId}:${payload.gameName}:${roomNumber}`;
    const resultKey = `${roomResultKey}:${normalizedWinnings}`;
    const recent = recentFeatureResults.get(roomResultKey);
    const sameSpin = recent
      && String(recent.spinId || "") === String(payload.spinId || "");
    const sameResult = recent?.winnings === normalizedWinnings;
    const withinLifecycle = recent
      && now - recent.deliveredAt <= FEATURE_RESULT_LIFECYCLE_MS;
    const withinClosedGrace = recent?.closedAt
      && now - recent.closedAt <= FEATURE_RESULT_CLOSED_GRACE_MS;
    const duplicateResult = sameResult && (
      sameSpin
      || (!recent.closedAt && withinLifecycle)
      || withinClosedGrace
    );
    if (duplicateResult) {
      recent.lastSeenAt = now;
      if (!sameSpin && !recent.closedAt) recent.closedAt = now;
      recentFeatureResults.set(roomResultKey, recent);
    }
    return !duplicateResult
      && !notifyingFeatureResults.has(resultKey)
      && !notifiedSpins.has(notificationKey)
      && !notifyingSpins.has(notificationKey);
  });
  if (!pendingWatchers.length) return false;
  pendingWatchers.forEach((watch) => {
    notifyingSpins.add(`${spinKey}:${watch.userId}`);
    notifyingFeatureResults.add(`${watch.userId}:${payload.gameName}:${roomNumber}:${normalizedWinnings}`);
  });
  const message = electronicFeatureResultFlex(
    payload.gameName,
    formatRoom(payload.gameName, roomNumber),
    winnings,
    afterRecommendQuickReply(),
  );
  const results = await Promise.allSettled(
    pendingWatchers.map((watch) => pushStrict(watch.userId, message)),
  );
  let delivered = false;
  results.forEach((result, index) => {
    const watcher = pendingWatchers[index];
    const notificationKey = `${spinKey}:${watcher.userId}`;
    const roomResultKey = `${watcher.userId}:${payload.gameName}:${roomNumber}`;
    const resultKey = `${roomResultKey}:${normalizedWinnings}`;
    notifyingSpins.delete(notificationKey);
    notifyingFeatureResults.delete(resultKey);
    if (result.status === "fulfilled") {
      delivered = true;
      notifiedSpins.add(notificationKey);
      recentFeatureResults.set(roomResultKey, {
        winnings: normalizedWinnings,
        deliveredAt: Date.now(),
        lastSeenAt: Date.now(),
        closedAt: 0,
        spinId: String(payload.spinId || ""),
        featureTrigger,
      });
    } else {
      console.error("[Electronic] Feature notification failed:", result.reason?.message || result.reason);
    }
  });
  while (notifiedSpins.size > 500) notifiedSpins.delete(notifiedSpins.values().next().value);
  return delivered;
}

async function changeRecommendRoom(event) {
  return recommendRoom(event);
}

async function handleElectronicMessage(event) {
  const value = event.message.text.trim();
  const session = getUserSession(event.source.userId);
  if (isCancelRecommendationCommand(value)) return handleCancelRecommendation(event);
  if (isStopWatchCommand(value)) return stopRoomMonitoring(event);
  if (MAIN_COMMANDS.has(value)) return showElectronicMain(event);
  if (GAME_CONFIG[value]) return selectGame(event, value);
  if (REMOVED_CUSTOM_COMMANDS.has(value)) {
    session.mode = "menu";
    session.waitingCustomRoom = false;
    return reply(event.replyToken, electronicPromptFlex("請使用 AI 推薦房", [
      "電子自選房分析已關閉",
      "系統只會推薦具備即時房況資料的房間",
    ], electronicModeQuickReply()));
  }
  if (RECOMMEND_COMMANDS.has(value)) {
    await restoreElectronicSession(event.source.userId);
    return recommendRoom(event);
  }
  if (BACK_TO_GAME_COMMANDS.has(value)) {
    await restoreElectronicSession(event.source.userId);
    return showGameMenu(event);
  }
  return false;
}

function isElectronicCommand(value) {
  if (!value) return false;
  return MAIN_COMMANDS.has(value)
    || Boolean(GAME_CONFIG[value])
    || RECOMMEND_COMMANDS.has(value)
    || REMOVED_CUSTOM_COMMANDS.has(value)
    || BACK_TO_GAME_COMMANDS.has(value)
    || isStopWatchCommand(value)
    || isCancelRecommendationCommand(value);
}

function hasActiveElectronicSession(userId) {
  return electronicSessions.has(userId);
}

function getCurrentGame(userId) {
  return getUserSession(userId).gameName;
}

function resetElectronicSession(userId) {
  cancelPendingRecommendation(userId);
  releaseRoomRecommendationLeases(userId);
  const inFlight = recommendInFlight.get(userId);
  if (inFlight) inFlight.cancelled = true;
  stopLiveWatch(userId).catch((error) => {
    console.error("[Electronic] Watch reset failed:", error.message);
  });
  electronicSessions.delete(userId);
  if (supabase) {
    supabase
      .from("lottery_settings")
      .delete()
      .eq("key", `${SESSION_KEY_PREFIX}${userId}`)
      .then(({ error }) => {
        if (error) console.error("[Electronic] Session reset failed:", error.message);
      });
  }
}

function electronicStatus(userId) {
  const session = getUserSession(userId);
  return { gameName: session.gameName, mode: session.mode, waitingCustomRoom: session.waitingCustomRoom };
}

function cleanupOldCycles() {
  pruneRoomRecommendationLeases();
  const currentCycle = getCycleKey();
  for (const [key] of cycleCache.entries()) if (!key.endsWith(currentCycle)) cycleCache.delete(key);
  for (const [key, value] of recommendCursorStore.entries()) {
    if (key.endsWith(":live")) {
      if (Date.now() - value.updatedAt > SESSION_TIMEOUT) {
        recommendCursorStore.delete(key);
        recommendHistoryHydrated.delete(key.slice(0, -":live".length));
      }
    } else if (!key.endsWith(`:${currentCycle}`)) {
      recommendCursorStore.delete(key);
    }
  }
  for (const [key, stoppedAt] of stoppedWatchKeys.entries()) {
    if (Date.now() - stoppedAt > LIVE_WATCH_TIMEOUT) stoppedWatchKeys.delete(key);
  }
  for (const [key, result] of recentFeatureResults.entries()) {
    if (Date.now() - (result.lastSeenAt || result.deliveredAt) > FEATURE_RESULT_LIFECYCLE_MS) {
      recentFeatureResults.delete(key);
    }
  }
  for (const [userId, pending] of pendingRecommendations.entries()) {
    if (Date.now() - pending.requestedAt > SESSION_TIMEOUT) cancelPendingRecommendation(userId);
  }
}

setInterval(cleanupOldCycles, 10 * 60 * 1000).unref();

module.exports = {
  handleElectronicMessage,
  isElectronicCommand,
  setGameSession,
  showElectronicMain,
  selectGame,
  showGameMenu,
  recommendRoom,
  changeRecommendRoom,
  hasActiveElectronicSession,
  getCurrentGame,
  resetElectronicSession,
  electronicStatus,
  getNextRecommendRoom,
  handleElectronicSpin,
  getActiveWatchRooms,
  handleAdminRefreshCommand,
  notifyAdminRefreshComplete,
  hydratePendingRecommendations,
  hydrateRecommendHistory,
  ADMIN_REFRESH_COMMANDS,
  isStopWatchCommand,
  isCancelRecommendationCommand,
  handleElectronicDataReady,
  isElectronicGameEnabled,
  enforceGameAvailability,
};
