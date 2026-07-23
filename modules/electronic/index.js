const { reply, quickReply } = require("../../services/line");
const { bubble, infoLine } = require("../../ui/flex/premium");
const {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
} = require("../../ui/flex/electronicResult");

const electronicSessions = new Map();
const cycleCache = new Map();
const recommendCursorStore = new Map();
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
const RANK_COMMANDS = new Set(["熱門排行", "熱門房排行"]);
const CUSTOM_COMMANDS = new Set(["自選分析", "自選房號分析"]);
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

function isAiSelectedRoom(gameName, room) {
  const cycle = getGameCycle(gameName);
  return cycle.goodRooms.includes(room) || cycle.rankRooms.includes(room);
}

function electronicModeQuickReply() {
  return quickReply([
    { label: "AI推薦房", text: "AI推薦房" },
    { label: "熱門排行", text: "熱門排行" },
    { label: "自選分析", text: "自選分析" },
    { label: "返回首頁", text: "首頁" },
  ]);
}

function afterRecommendQuickReply() {
  return quickReply([
    { label: "重新推薦", text: "重新推薦" },
    { label: "熱門排行", text: "熱門排行" },
    { label: "自選分析", text: "自選分析" },
  ]);
}

function afterRankQuickReply() {
  return quickReply([
    { label: "AI推薦房", text: "AI推薦房" },
    { label: "自選分析", text: "自選分析" },
    { label: "返回遊戲選單", text: "返回遊戲選單" },
  ]);
}

function afterAnalyzeQuickReply() {
  return quickReply([
    { label: "AI推薦房", text: "AI推薦房" },
    { label: "熱門排行", text: "熱門排行" },
    { label: "重新輸入", text: "自選分析" },
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
  const room = formatRoom(session.gameName, getNextRecommendRoom(userId, session.gameName));
  return reply(event.replyToken, electronicRecommendFlex(session.gameName, room, getUpdateTimeText(), afterRecommendQuickReply()));
}

async function changeRecommendRoom(event) {
  return recommendRoom(event);
}

async function showHotRank(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  session.mode = "rank";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  const cycle = getGameCycle(session.gameName);
  const rooms = cycle.rankRooms.map((room) => formatRoom(session.gameName, room));
  return reply(event.replyToken, electronicRankFlex(session.gameName, rooms, getUpdateTimeText(), afterRankQuickReply()));
}

async function askCustomRoom(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  session.mode = "custom";
  session.waitingCustomRoom = true;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  const config = GAME_CONFIG[session.gameName];
  return reply(event.replyToken, electronicPromptFlex("請輸入房號", [
    session.gameName,
    `房號範圍：${formatRoom(session.gameName, config.min)} ~ ${formatRoom(session.gameName, config.max)}`,
  ]));
}

async function analyzeCustomRoom(event, value) {
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (!session.gameName) return showElectronicMain(event);
  const room = parseRoomInput(value);
  const check = validateRoom(session.gameName, room);
  if (!check.ok) return reply(event.replyToken, electronicPromptFlex("房號錯誤", [check.message]));
  session.mode = "menu";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);
  return reply(
    event.replyToken,
    electronicAnalyzeFlex(session.gameName, formatRoom(session.gameName, room), getUpdateTimeText(), afterAnalyzeQuickReply(), {
      forceGreen: isAiSelectedRoom(session.gameName, room),
    })
  );
}

async function handleElectronicMessage(event) {
  const value = event.message.text.trim();
  const userId = event.source.userId;
  const session = getUserSession(userId);
  if (MAIN_COMMANDS.has(value)) return showElectronicMain(event);
  if (GAME_CONFIG[value]) return selectGame(event, value);
  if (session.waitingCustomRoom) return analyzeCustomRoom(event, value);
  if (RECOMMEND_COMMANDS.has(value)) return recommendRoom(event);
  if (RANK_COMMANDS.has(value)) return showHotRank(event);
  if (CUSTOM_COMMANDS.has(value)) return askCustomRoom(event);
  if (BACK_TO_GAME_COMMANDS.has(value)) return showGameMenu(event);
  return false;
}

function isElectronicCommand(value) {
  if (!value) return false;
  return MAIN_COMMANDS.has(value) || Boolean(GAME_CONFIG[value]) || RECOMMEND_COMMANDS.has(value) || RANK_COMMANDS.has(value) || CUSTOM_COMMANDS.has(value) || BACK_TO_GAME_COMMANDS.has(value);
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
  for (const [key] of recommendCursorStore.entries()) if (!key.endsWith(`:${currentCycle}`)) recommendCursorStore.delete(key);
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
  showHotRank,
  askCustomRoom,
  analyzeCustomRoom,
  hasActiveElectronicSession,
  getCurrentGame,
  resetElectronicSession,
  electronicStatus,
};
