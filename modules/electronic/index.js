const { reply, quickReply } = require("../../services/line");
const { bubble, infoLine } = require("../../ui/flex/premium");

const {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
} = require("../../ui/flex/electronicResult");

const electronicSessions = new Map();
const CYCLE_CACHE = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

const GAME_CONFIG = {
  戰神賽特1: { name: "戰神賽特1", min: 1, max: 1300, pad: 3 },
  戰神賽特2: { name: "戰神賽特2", min: 1, max: 4000, pad: 4 },
  古神巴風特: { name: "古神巴風特", min: 1, max: 1000, pad: 3 },
};

function taipeiNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function getCycleKey() {
  const now = taipeiNow();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() >= 30 ? "30" : "00";
  return `${y}${m}${d}${h}${mm}`;
}

function getUpdateTimeText() {
  const now = taipeiNow();
  const h = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() >= 30 ? "30" : "00";
  return `${h}:${mm}`;
}

function formatRoom(gameName, room) {
  const config = GAME_CONFIG[gameName];
  return String(room).padStart(config?.pad || 3, "0");
}

function hashScore(input, max = 2147483647) {
  let score = 0;

  for (const char of String(input)) {
    score = (score * 31 + char.charCodeAt(0)) % max;
  }

  return score || 1;
}

function seededRandom(seedText) {
  let seed = hashScore(seedText, 2147483647);

  if (seed <= 0) {
    seed += 2147483646;
  }

  return function random() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function shuffleBySeed(list, seedText) {
  const arr = [...list];
  const random = seededRandom(seedText);

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function randomPick(list, count, seedText = "BLACKDOMAIN") {
  return shuffleBySeed(list, seedText).slice(0, count);
}

function buildCyclePools(gameName, cycleKey) {
  const config = GAME_CONFIG[gameName];
  const allRooms = [];

  for (let room = config.min; room <= config.max; room++) {
    allRooms.push(room);
  }

  const goodCount = Math.max(10, Math.ceil(allRooms.length * 0.15));

  const goodRooms = shuffleBySeed(
    allRooms,
    `GOOD:${gameName}:${cycleKey}`
  ).slice(0, goodCount);

  return {
    goodRooms,
    goodSet: new Set(goodRooms),
  };
}

function getGameCycle(gameName) {
  const cycleKey = getCycleKey();
  const cacheKey = `${gameName}:${cycleKey}`;

  if (!CYCLE_CACHE.has(cacheKey)) {
    CYCLE_CACHE.set(cacheKey, {
      gameName,
      cycleKey,
      ...buildCyclePools(gameName, cycleKey),
      createdAt: Date.now(),
    });
  }

  return CYCLE_CACHE.get(cacheKey);
}

function getUserSession(userId) {
  const existing = electronicSessions.get(userId);

  if (existing && Date.now() - existing.updatedAt <= SESSION_TIMEOUT) {
    existing.updatedAt = Date.now();
    electronicSessions.set(userId, existing);
    return existing;
  }

  if (existing) electronicSessions.delete(userId);

  const session = {
    gameName: null,
    mode: null,
    waitingCustomRoom: false,
    usedRoomsByCycle: {},
    updatedAt: Date.now(),
  };

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
    contents: lines.map((line) => infoLine("提示", line)),
  });
}

function getUsedRooms(session, gameName) {
  const key = `${gameName}:${getCycleKey()}`;
  if (!session.usedRoomsByCycle[key]) session.usedRoomsByCycle[key] = [];
  return session.usedRoomsByCycle[key];
}

function getNextRecommendRoom(userId, gameName) {
  const session = getUserSession(userId);
  const cycle = getGameCycle(gameName);
  const usedRooms = getUsedRooms(session, gameName);

  let availableRooms = cycle.goodRooms.filter((room) => !usedRooms.includes(room));

  if (availableRooms.length === 0) {
    session.usedRoomsByCycle[`${gameName}:${getCycleKey()}`] = [];
    availableRooms = [...cycle.goodRooms];
  }

  const roomIndex = hashScore(`${userId}:${gameName}:${getCycleKey()}:${usedRooms.length}`, availableRooms.length);
  const room = availableRooms[roomIndex % availableRooms.length];

  getUsedRooms(session, gameName).push(room);
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);

  return room;
}

function parseRoomInput(text) {
  const raw = String(text || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function validateRoom(gameName, room) {
  const config = GAME_CONFIG[gameName];

  if (!config) return { ok: false, message: "遊戲不存在。" };

  if (!Number.isInteger(room)) {
    return { ok: false, message: "房號格式錯誤，請輸入數字。" };
  }

  if (room < config.min || room > config.max) {
    return {
      ok: false,
      message: `房號範圍錯誤，${gameName} 房號為 ${formatRoom(
        gameName,
        config.min
      )} ~ ${formatRoom(gameName, config.max)}。`,
    };
  }

  return { ok: true };
}

function electronicModeQuickReply() {
  return quickReply([
    { label: "🤖 AI推薦房", text: "AI推薦房" },
    { label: "🔥 熱門排行", text: "熱門房排行" },
    { label: "🔍 自選分析", text: "自選房號分析" },
    { label: "⬅ 返回電子AI", text: "電子" },
  ]);
}

function afterRecommendQuickReply() {
  return quickReply([
    { label: "🔄 換一間", text: "換一間" },
    { label: "🔥 熱門排行", text: "熱門房排行" },
    { label: "🔍 自選分析", text: "自選房號分析" },
  ]);
}

function afterRankQuickReply() {
  return quickReply([
    { label: "🤖 AI推薦房", text: "AI推薦房" },
    { label: "🔍 自選分析", text: "自選房號分析" },
    { label: "⬅ 返回功能", text: "返回電子功能" },
  ]);
}
function afterAnalyzeQuickReply() {
  return quickReply([
    { label: "🤖 AI推薦房", text: "AI推薦房" },
    { label: "🔥 熱門排行", text: "熱門房排行" },
    { label: "🔍 再分析", text: "自選房號分析" },
  ]);
}

async function showElectronicMain(event) {
  const electronicMenuFlex = require("../../ui/flex/electronicMenu");
  return reply(event.replyToken, electronicMenuFlex());
}

async function selectGame(event, gameName) {
  const userId = event.source.userId;

  if (!GAME_CONFIG[gameName]) {
    return reply(event.replyToken, electronicPromptFlex("遊戲不存在", ["請重新選擇。"]));
  }

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

  const room = formatRoom(
    session.gameName,
    getNextRecommendRoom(userId, session.gameName)
  );

  return reply(
    event.replyToken,
    electronicRecommendFlex(
      session.gameName,
      room,
      getUpdateTimeText(),
      afterRecommendQuickReply()
    )
  );
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
  const rooms = randomPick(cycle.goodRooms, 10, `RANK:${session.gameName}:${getCycleKey()}`).map((room) =>
    formatRoom(session.gameName, room)
  );

  return reply(
    event.replyToken,
    electronicRankFlex(
      session.gameName,
      rooms,
      getUpdateTimeText(),
      afterRankQuickReply()
    )
  );
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

  return reply(
    event.replyToken,
    electronicPromptFlex("請輸入房號", [
      session.gameName,
      `範圍：${formatRoom(session.gameName, config.min)} ~ ${formatRoom(
        session.gameName,
        config.max
      )}`,
    ])
  );
}

async function analyzeCustomRoom(event, text) {
  const userId = event.source.userId;
  const session = getUserSession(userId);

  if (!session.gameName) return showElectronicMain(event);

  const room = parseRoomInput(text);
  const check = validateRoom(session.gameName, room);

  if (!check.ok) {
    return reply(event.replyToken, electronicPromptFlex("房號錯誤", [check.message]));
  }

  session.mode = "menu";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);

  const cycle = getGameCycle(session.gameName);
  const roomText = `${session.gameName}｜${formatRoom(session.gameName, room)}`;

  let title = "🔴 AI判定：不建議進場";
  let lines = [
    roomText,
    "目前活躍度不足",
    "波動訊號偏弱",
    "建議等待下一輪更新",
  ];

  if (cycle.goodSet.has(room)) {
    title = "🟢 AI判定：可進場";
    lines = [
      roomText,
      "目前活躍度穩定",
      "波動狀態正常",
      "可視情況進場",
    ];
  }

  return reply(
    event.replyToken,
    electronicPromptFlex(title, lines, afterAnalyzeQuickReply())
  );
}

async function analyzeCustomRoomFlex(event, inputText) {
  const userId = event.source.userId;
  const session = getUserSession(userId);

  if (!session.gameName) return showElectronicMain(event);

  const room = parseRoomInput(inputText);
  const check = validateRoom(session.gameName, room);

  if (!check.ok) {
    return reply(event.replyToken, electronicPromptFlex("房號不正確", [check.message]));
  }

  session.mode = "menu";
  session.waitingCustomRoom = false;
  session.updatedAt = Date.now();
  electronicSessions.set(userId, session);

  return reply(
    event.replyToken,
    electronicAnalyzeFlex(
      session.gameName,
      formatRoom(session.gameName, room),
      getUpdateTimeText(),
      afterAnalyzeQuickReply()
    )
  );
}

async function handleElectronicMessage(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId;
  const session = getUserSession(userId);

  if (GAME_CONFIG[text]) return selectGame(event, text);

  if (session.waitingCustomRoom) return analyzeCustomRoomFlex(event, text);

  if (text === "AI推薦房" || text === "🤖 AI推薦房") return recommendRoom(event);

  if (text === "換一間" || text === "🔄 換一間") return changeRecommendRoom(event);

  if (text === "熱門排行" || text === "熱門房排行" || text === "🔥 熱門排行") return showHotRank(event);

  if (text === "自選分析" || text === "自選房號分析" || text === "🔍 自選分析") return askCustomRoom(event);

  if (text === "返回電子功能") return showGameMenu(event);

  return false;
}

function isElectronicCommand(text) {
  if (!text) return false;

  return (
    text === "電子" ||
    text === "電子AI" ||
    text === "Electronic" ||
    text === "⚡ 電子AI" ||
    text === "🎰 電子AI" ||
    text === "戰神賽特1" ||
    text === "戰神賽特2" ||
    text === "古神巴風特" ||
    text === "AI推薦房" ||
    text === "🤖 AI推薦房" ||
    text === "換一間" ||
    text === "🔄 換一間" ||
    text === "熱門房排行" ||
    text === "熱門排行" ||
    text === "🔥 熱門排行" ||
    text === "自選房號分析" ||
    text === "自選分析" ||
    text === "🔍 自選分析" ||
    text === "返回電子功能"
  );
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

  return {
    gameName: session.gameName,
    mode: session.mode,
    waitingCustomRoom: session.waitingCustomRoom,
  };
}

function cleanupOldCycles() {
  const currentCycle = getCycleKey();

  for (const [key] of CYCLE_CACHE.entries()) {
    if (!key.endsWith(currentCycle)) {
      CYCLE_CACHE.delete(key);
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
  showHotRank,
  askCustomRoom,
  analyzeCustomRoom,
  hasActiveElectronicSession,
  getCurrentGame,
  resetElectronicSession,
  electronicStatus,
};
