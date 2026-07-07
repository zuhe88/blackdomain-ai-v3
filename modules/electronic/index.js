const { reply, quickReply } = require("../../services/line");
const { bubble, infoLine } = require("../../ui/flex/premium");
const {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
} = require("../../ui/flex/electronicResult");

const electronicSessions = new Map();
const cycleCache = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

const GAME_CONFIG = {
  戰神賽特1: { name: "戰神賽特1", min: 1, max: 1300, pad: 3 },
  戰神賽特2: { name: "戰神賽特2", min: 1, max: 4000, pad: 4 },
  古神巴風特: { name: "古神巴風特", min: 1, max: 1000, pad: 3 },
  虎小妹: { name: "虎小妹", min: 1, max: 3000, pad: 4 },
  赤三國: { name: "赤三國", min: 1, max: 200, pad: 3 },
};

const MAIN_COMMANDS = new Set(["電子", "電子AI", "Electronic", "electronic", "⚡ 電子AI"]);
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
  let score = 0;
  for (const char of String(input)) score = (score * 31 + char.charCodeAt(0)) % max;
  return score || 1;
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

function buildCyclePools(gameName, cycleKey) {
  const config = GAME_CONFIG[gameName];
  const allRooms = [];
  for (let room = config.min; room <= config.max; room += 1) allRooms.push(room);

  const scored = allRooms
    .map((room) => ({
      room,
      score: hashScore(`AI:${gameName}:${cycleKey}:${room}`, 1000000),
    }))
    .sort((a, b) => b.score - a.score);

  const goodCount = Math.max(20, Math.ceil(allRooms.length * 0.15));
  const goodRooms = scored.slice(0, goodCount).map((item) => item.room);
  const recommendRooms = shuffleBySeed(goodRooms, `RECOMMEND:${gameName}:${cycleKey}`);
  const rankRooms = scored.slice(0, 5).map((item) => item.room);

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
  const session = { gameName: null, mode: null, waitingCustomRoom: false, recommendCursorByCycle: {}, updatedAt: Date.now() };
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
  const session = getUserSession(userId);
  const cycle = getGameCycle(gameName);
  const key = `${gameName}:${cycle.cycleKey}`;
  const cursor = Number(session.recommendCursorByCycle[key] || 0);
  const room = cycle.recommendRooms[cursor % cycle.recommendRooms.length];

  session.recommendCursorByCycle[key] = cursor + 1;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);

  return room;
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
  return reply(event.replyToken, electronicAnalyzeFlex(session.gameName, formatRoom(session.gameName, room), getUpdateTimeText(), afterAnalyzeQuickReply()));
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
