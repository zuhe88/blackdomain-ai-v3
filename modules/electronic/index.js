const crypto = require("crypto");
const { reply, quickReply } = require("../../services/line");
const { bubble, infoLine } = require("../../ui/flex/premium");
const { electronicRecommendFlex } = require("../../ui/flex/electronicResult");
const electronicSource = require("./source");

const electronicSessions = new Map();
const cycleCache = new Map();
const recommendCursorStore = new Map();
const liveWatches = new Map();
const notifiedSpins = new Set();
const SESSION_TIMEOUT = 30 * 60 * 1000;

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
  return session;
}

function electronicPromptFlex(title, lines = [], quickReplyData = null) {
  return bubble({
    altText: title,
    title,
    subtitle: "BLACKDOMAIN ELECTRONIC AI",
    quickReply: quickReplyData,
    footer: "BLACKDOMAIN ELECTRONIC AI",
    contents: lines.map((line) => infoLine("資訊", line)),
  });
}

function getNextRecommendRoom(userId, gameName) {
  if (electronicSource.SUPPORTED_GAMES.has(gameName)) {
    const emptyRooms = electronicSource.getEmptyRooms(gameName);
    if (!emptyRooms.length) return null;
    const candidates = emptyRooms.filter((room) => room.detail).slice(0, 10);
    if (!candidates.length) return null;
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
    { label: "返回遊戲選單", text: "返回遊戲選單" },
  ]);
}

async function showElectronicMain(event) {
  const electronicMenuFlex = require("../../ui/flex/electronicMenu");
  return reply(event.replyToken, electronicMenuFlex());
}

async function selectGame(event, gameName) {
  const userId = event.source.userId;
  if (!GAME_CONFIG[gameName]) return reply(event.replyToken, electronicPromptFlex("遊戲不存在", ["請重新選擇電子AI遊戲。"]));
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

async function recommendRoom(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  session.mode = "recommend";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  const selected = getNextRecommendRoom(userId, session.gameName);
  if (!selected) {
    if (electronicSource.SUPPORTED_GAMES.has(session.gameName) && !electronicSource.hasFreshData(session.gameName)) {
      return reply(event.replyToken, electronicPromptFlex("房間資料連線中", [
        session.gameName,
        "目前尚未收到最新空桌資料。",
        "系統正在重新同步顯示空桌的 8 頁房間，請稍後再試。",
      ], afterRecommendQuickReply()));
    }
    const liveEmptyRooms = electronicSource.SUPPORTED_GAMES.has(session.gameName)
      ? electronicSource.getEmptyRooms(session.gameName)
      : [];
    if (liveEmptyRooms.length > 0 && !liveEmptyRooms.some((room) => room.detail)) {
      return reply(event.replyToken, electronicPromptFlex("房間數據整理中", [
        session.gameName,
        "空桌名單已更新，正在讀取房間統計。",
        "完成後才會提供包含完整數據的推薦，請稍後再試。",
      ], afterRecommendQuickReply()));
    }
    return reply(event.replyToken, electronicPromptFlex("目前沒有可推薦的空房", [
      session.gameName,
      "系統只推薦狀態為空房的房間。",
      "客滿、鎖定與關閉房間均已排除，請稍後再試。",
    ], afterRecommendQuickReply()));
  }
  const roomNumber = typeof selected === "object" ? selected.number : selected;
  const room = formatRoom(session.gameName, roomNumber);
  liveWatches.set(`${session.gameName}:${roomNumber}`, { userId, updatedAt: Date.now() });
  return reply(event.replyToken, electronicRecommendFlex(
    session.gameName,
    room,
    getUpdateTimeText(),
    afterRecommendQuickReply(),
    typeof selected === "object" ? selected : null,
  ));
}

async function handleElectronicSpin(payload = {}) {
  const roomNumber = Number(payload.roomNumber);
  const watch = liveWatches.get(`${payload.gameName}:${roomNumber}`);
  if (!watch || !Number.isInteger(roomNumber)) return false;
  const spinKey = `${payload.gameName}:${payload.spinId || roomNumber}:${Number(payload.totalWinnings) || 0}`;
  if (notifiedSpins.has(spinKey)) return false;
  notifiedSpins.add(spinKey);
  if (notifiedSpins.size > 500) notifiedSpins.delete(notifiedSpins.values().next().value);
  const winnings = Number(payload.totalWinnings) || 0;
  const stake = Number(payload.totalStake) || 0;
  const multiplier = stake > 0 ? `（${(winnings / stake).toFixed(2)} 倍）` : "";
  const triggerLabel = payload.featureTrigger === "purchased" ? "購買特色" : "自然觸發特色";
  await require("../../services/line").push(watch.userId, {
    type: "text",
    text: `${payload.gameName} 房號 ${formatRoom(payload.gameName, roomNumber)}\n觸發方式：${triggerLabel}\n本次開獎金額：${winnings.toLocaleString("en-US")} ${multiplier}\n後台結果已先回傳，動畫可能仍在播放`,
  });
  return true;
}

async function changeRecommendRoom(event) {
  return recommendRoom(event);
}

async function handleElectronicMessage(event) {
  const value = event.message.text.trim();
  if (MAIN_COMMANDS.has(value)) return showElectronicMain(event);
  if (GAME_CONFIG[value]) return selectGame(event, value);
  if (RECOMMEND_COMMANDS.has(value)) return recommendRoom(event);
  if (BACK_TO_GAME_COMMANDS.has(value)) return showGameMenu(event);
  return false;
}

function isElectronicCommand(value) {
  if (!value) return false;
  return MAIN_COMMANDS.has(value) || Boolean(GAME_CONFIG[value]) || RECOMMEND_COMMANDS.has(value) || BACK_TO_GAME_COMMANDS.has(value);
}

function hasActiveElectronicSession(userId) {
  return electronicSessions.has(userId);
}

function getCurrentGame(userId) {
  return getUserSession(userId).gameName;
}

function resetElectronicSession(userId) {
  electronicSessions.delete(userId);
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
};
