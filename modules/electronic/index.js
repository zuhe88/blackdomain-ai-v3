const crypto = require("crypto");
const { reply, push, quickReply } = require("../../services/line");
const { COLORS, bubble, button, note, section, text } = require("../../ui/flex/premium");
const {
  electronicRecommendFlex,
  electronicFeatureResultFlex,
} = require("../../ui/flex/electronicResult");
const supabase = require("../../services/supabase");
const electronicSource = require("./source");
const { isAdminLineUserId } = require("../../config/admin");

const electronicSessions = new Map();
const cycleCache = new Map();
const recommendCursorStore = new Map();
const recommendInFlight = new Map();
const pendingRecommendations = new Map();
const liveWatches = new Map();
const stoppedWatchKeys = new Map();
const notifiedSpins = new Set();
const SESSION_TIMEOUT = 30 * 60 * 1000;
const WATCH_KEY_PREFIX = "electronic_watch:";
const SESSION_KEY_PREFIX = "electronic_session:";
const DETAIL_WAIT_MS = Math.max(1000, Number(process.env.ELECTRONIC_DETAIL_WAIT_MS) || 8000);
const PENDING_RECOMMEND_TIMEOUT_MS = Math.min(
  120000,
  Math.max(15000, Number(process.env.ELECTRONIC_PENDING_RECOMMEND_TIMEOUT_MS) || 60000),
);
const FIRST_SCAN_ESTIMATE = "首次建立完整房表，通常約 30～45 秒";

const GAME_CONFIG = {
  戰神賽特1: { name: "戰神賽特1", min: 1, max: 1300, pad: 3 },
  戰神賽特2: { name: "戰神賽特2", min: 1, max: 4000, pad: 4 },
  古神巴風特: { name: "古神巴風特", min: 1, max: 1000, pad: 3 },
  虎小妹: { name: "虎小妹", min: 1, max: 3000, pad: 4 },
  赤三國: { name: "赤三國", min: 1, max: 200, pad: 3 },
};

const MAIN_COMMANDS = new Set(["ATG", "ATGAI", "ATG AI", "電子", "電子AI", "Electronic", "electronic", "⚡ 電子AI"]);
const RECOMMEND_COMMANDS = new Set(["AI推薦房", "推薦房", "重新推薦"]);
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

function cancelPendingRecommendation(userId) {
  const pending = pendingRecommendations.get(userId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingRecommendations.delete(userId);
  return true;
}

async function cancelRecommendation(userId) {
  const pendingCancelled = cancelPendingRecommendation(userId);
  const inFlight = recommendInFlight.get(userId);
  if (inFlight) inFlight.cancelled = true;
  if (inFlight) await stopLiveWatch(userId);
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

function queuePendingRecommendation(userId, gameName) {
  cancelPendingRecommendation(userId);
  electronicSource.requestFullRefresh();
  const requestedAt = Date.now();
  const pending = {
    userId,
    gameName,
    requestedAt,
    deadlineAt: requestedAt + PENDING_RECOMMEND_TIMEOUT_MS,
    timer: null,
  };
  pending.timer = setTimeout(async () => {
    if (pendingRecommendations.get(userId) !== pending) return;
    pendingRecommendations.delete(userId);
    await push(userId, electronicPromptFlex("目前無法取得即時房況", [
      gameName,
      "為避免房況不一致，本次未使用舊資料推薦",
      "等待已自動結束，稍後可再使用 AI推薦房",
    ], afterRecommendQuickReply()));
  }, PENDING_RECOMMEND_TIMEOUT_MS);
  pending.timer.unref?.();
  pendingRecommendations.set(userId, pending);
  return pending;
}

function rememberLiveWatch(watch) {
  if (!watch?.userId) return;
  stoppedWatchKeys.delete(watchKey(watch));
  liveWatches.set(watch.userId, watch);
  if (!supabase) return;
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
  if (!watch) return { stopped: false, reason: "none" };
  if (
    (expectedGameName && watch.gameName !== expectedGameName)
    || (
      expectedRoomNumber != null
      && Number(watch.roomNumber) !== Number(expectedRoomNumber)
    )
  ) {
    return { stopped: false, reason: "changed", watch };
  }

  liveWatches.delete(userId);
  stoppedWatchKeys.set(watchKey(watch), Date.now());
  if (supabase) {
    const { error } = await supabase
      .from("lottery_settings")
      .delete()
      .eq("key", `${WATCH_KEY_PREFIX}${userId}`);
    if (error) console.error("[Electronic] Watch removal failed:", error.message);
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
      && now - Number(watch.updatedAt || 0) <= SESSION_TIMEOUT
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
      && now - Number(watch.updatedAt || 0) <= SESSION_TIMEOUT
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
  for (const watch of liveWatches.values()) {
    if (watch?.userId && now - Number(watch.updatedAt || 0) <= SESSION_TIMEOUT) {
      watches.set(watch.userId, watch);
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
        if (watch?.userId && now - Number(watch.updatedAt || 0) <= SESSION_TIMEOUT) {
          watches.set(watch.userId, watch);
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
    rooms.set(`${watch.gameName}:${roomNumber}`, { gameName: watch.gameName, roomNumber });
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

function getNextRecommendRoom(userId, gameName) {
  if (electronicSource.SUPPORTED_GAMES.has(gameName)) {
    const emptyRooms = electronicSource.getEmptyRooms(gameName);
    if (!emptyRooms.length) return null;
    const detailedRooms = emptyRooms.filter((room) => room.detail);
    const candidates = detailedRooms.length ? detailedRooms.slice(0, 10) : emptyRooms;
    const key = `${userId || "guest"}:${gameName}:live`;
    const existing = recommendCursorStore.get(key);
    const recentRooms = Array.isArray(existing?.recentRooms) ? existing.recentRooms : [];
    const freshCandidates = candidates.filter((room) => !recentRooms.includes(room.number));
    const pool = freshCandidates.length ? freshCandidates : candidates;
    const selected = pool[crypto.randomInt(pool.length)];
    const recentLimit = Math.min(5, Math.max(1, candidates.length - 1));
    recommendCursorStore.set(key, {
      recentRooms: [selected.number, ...recentRooms.filter((room) => room !== selected.number)].slice(0, recentLimit),
      updatedAt: Date.now(),
    });
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
  const room = cycle.recommendRooms[cursor % cycle.recommendRooms.length];

  recommendCursorStore.set(key, { cursor: cursor + 1, updatedAt: Date.now() });

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
  return reply(event.replyToken, electronicMenuFlex());
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
    return reply(event.replyToken, electronicPromptFlex("已結束房間監控", [
      `${result.watch.gameName} ${formatRoom(result.watch.gameName, result.watch.roomNumber)}`,
      "已停止接收該房特色遊戲通知",
    ], afterRecommendQuickReply()));
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
    await push(userId, recommendationWaitingFlex(
      "即時房間數據同步中",
      gameName,
      "正在確認空房與房間統計",
      "預計 0～8 秒",
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
    await push(refresh.requestedBy, electronicPromptFlex("房間數據更新完成", [
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
  session.mode = "menu";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  const electronicGameMenu = require("../../ui/flex/electronicGameMenu");
  const message = electronicGameMenu(session.gameName);
  message.quickReply = electronicModeQuickReply();
  return reply(event.replyToken, message);
}

function deliverRecommendation(event, message) {
  if (event.recommendationRequest?.cancelled) return false;
  return event.autoPush
    ? push(event.source.userId, message)
    : reply(event.replyToken, message);
}

async function stopIfRecommendationCancelled(event, userId) {
  if (!event.recommendationRequest?.cancelled) return false;
  await stopLiveWatch(userId);
  return true;
}

async function performRecommendRoom(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  session.mode = "recommend";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  let selected = getNextRecommendRoom(userId, session.gameName);
  if (!selected) {
    if (
      electronicSource.SUPPORTED_GAMES.has(session.gameName)
      && (!electronicSource.hasFreshData(session.gameName) || !electronicSource.hasReadyData(session.gameName))
    ) {
      queuePendingRecommendation(userId, session.gameName);
      return deliverRecommendation(event, recommendationWaitingFlex(
        "房間數據整理中",
        session.gameName,
        FIRST_SCAN_ESTIMATE,
        `最長等待 ${Math.ceil(PENDING_RECOMMEND_TIMEOUT_MS / 1000)} 秒，完成後自動回傳`,
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
    if (!event.waitingAlreadySent) {
      await pushRoomSyncWaiting(userId, session.gameName);
    }
    rememberLiveWatch({
      userId,
      gameName: session.gameName,
      roomNumber,
      updatedAt: Date.now(),
    });
    const firstWaitMs = detailDeadline - Date.now();
    const refreshed = firstWaitMs > 0
      ? await electronicSource.waitForRoomDetail(
        session.gameName,
        roomNumber,
        firstWaitMs,
      )
      : null;
    if (await stopIfRecommendationCancelled(event, userId)) return false;
    if (!refreshed || refreshed.status !== "Empty" || refreshed.occupied === true) {
      selected = getNextRecommendRoom(userId, session.gameName);
      roomNumber = selectedRoomNumber(selected);
      if (typeof selected === "object") {
        rememberLiveWatch({
          userId,
          gameName: session.gameName,
          roomNumber,
          updatedAt: Date.now(),
        });
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
    if (!selected || (typeof selected === "object" && (
      !selected.detail || selected.status !== "Empty" || selected.occupied === true
    ))) {
      await stopLiveWatch(userId, session.gameName, roomNumber);
      return deliverRecommendation(event, electronicPromptFlex("即時房間數據同步逾時", [
        session.gameName,
        "為避免房況不一致，本次未使用舊統計推薦",
        "等待已自動結束，需要時可重新推薦",
      ], afterRecommendQuickReply()));
    }
    roomNumber = selectedRoomNumber(selected);
  }
  if (await stopIfRecommendationCancelled(event, userId)) return false;
  const room = formatRoom(session.gameName, roomNumber);
  rememberLiveWatch({
    userId,
    gameName: session.gameName,
    roomNumber,
    updatedAt: Date.now(),
  });
  return deliverRecommendation(event, electronicRecommendFlex(
    session.gameName,
    room,
    getUpdateTimeText(),
    afterRecommendQuickReply(),
    typeof selected === "object" ? selected : null,
  ));
}

async function recommendRoom(event) {
  const userId = event.source.userId;
  const pending = pendingRecommendations.get(userId);
  if (pending && !event.autoPush) {
    const remainingSeconds = Math.max(1, Math.ceil((pending.deadlineAt - Date.now()) / 1000));
    return reply(event.replyToken, recommendationWaitingFlex(
      "房間數據仍在整理中",
      pending.gameName,
      FIRST_SCAN_ESTIMATE,
      `剩餘最長約 ${remainingSeconds} 秒，完成後自動回傳`,
    ));
  }
  if (recommendInFlight.has(userId)) {
    const currentGame = getUserSession(userId).gameName || "電子AI";
    return reply(event.replyToken, recommendationWaitingFlex(
      "即時房間數據同步中",
      currentGame,
      "正在確認空房與房間統計",
      "預計 0～8 秒",
    ));
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
  if (!electronicSource.hasReadyData(gameName)) return 0;
  const pending = [...pendingRecommendations.values()]
    .filter((item) => item.gameName === gameName);
  if (!pending.length) return 0;
  pending.forEach((item) => cancelPendingRecommendation(item.userId));
  const results = await Promise.allSettled(pending.map((item) => recommendRoom({
    source: { userId: item.userId },
    message: { type: "text", text: "自動推薦" },
    autoPush: true,
    waitingAlreadySent: true,
    recommendationDeadline: item.deadlineAt,
  })));
  return results.filter((result) => result.status === "fulfilled").length;
}

async function handleElectronicSpin(payload = {}) {
  const featureTrigger = String(payload.featureTrigger || "");
  const featureAction = String(payload.action || "");
  const isConfirmedFeature = featureTrigger === "purchased"
    || featureTrigger === "room-monitor"
    || (featureTrigger === "natural" && /free|super|feature/i.test(featureAction));
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
  if (notifiedSpins.has(spinKey)) return false;
  notifiedSpins.add(spinKey);
  if (notifiedSpins.size > 500) notifiedSpins.delete(notifiedSpins.values().next().value);
  const message = electronicFeatureResultFlex(
    payload.gameName,
    formatRoom(payload.gameName, roomNumber),
    winnings,
    afterRecommendQuickReply(),
  );
  const results = await Promise.allSettled(
    watchers.map((watch) => require("../../services/line").push(watch.userId, message)),
  );
  return results.some((result) => result.status === "fulfilled");
}

async function changeRecommendRoom(event) {
  return recommendRoom(event);
}

async function handleElectronicMessage(event) {
  const value = event.message.text.trim();
  if (isCancelRecommendationCommand(value)) return handleCancelRecommendation(event);
  if (isStopWatchCommand(value)) return stopRoomMonitoring(event);
  if (MAIN_COMMANDS.has(value)) return showElectronicMain(event);
  if (GAME_CONFIG[value]) return selectGame(event, value);
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
  const currentCycle = getCycleKey();
  for (const [key] of cycleCache.entries()) if (!key.endsWith(currentCycle)) cycleCache.delete(key);
  for (const [key, value] of recommendCursorStore.entries()) {
    if (key.endsWith(":live")) {
      if (Date.now() - value.updatedAt > SESSION_TIMEOUT) recommendCursorStore.delete(key);
    } else if (!key.endsWith(`:${currentCycle}`)) {
      recommendCursorStore.delete(key);
    }
  }
  for (const [key, stoppedAt] of stoppedWatchKeys.entries()) {
    if (Date.now() - stoppedAt > SESSION_TIMEOUT) stoppedWatchKeys.delete(key);
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
  ADMIN_REFRESH_COMMANDS,
  isStopWatchCommand,
  isCancelRecommendationCommand,
  handleElectronicDataReady,
};
