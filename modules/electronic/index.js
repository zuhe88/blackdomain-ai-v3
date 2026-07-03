const { reply, textMessage, quickReply } = require("../../services/line");

const {
  electronicRecommendFlex,
  electronicRankFlex,
  electronicAnalyzeFlex,
} = require("../../ui/flex/electronicResult");

const electronicSessions = new Map();
const CYCLE_CACHE = new Map();

const GAME_CONFIG = {
  戰神賽特1: { name: "戰神賽特1", min: 1, max: 1300, pad: 3 },
  戰神賽特2: { name: "戰神賽特2", min: 1, max: 4000, pad: 4 },
  古神巴風特: { name: "古神巴風特", min: 1, max: 1000, pad: 3 },
};

function getCycleKey() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() >= 30 ? "30" : "00";

  return `${y}${m}${d}${h}${mm}`;
}

function getUpdateTimeText() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );

  const h = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() >= 30 ? "30" : "00";

  return `${h}:${mm}`;
}

function formatRoom(gameName, room) {
  const config = GAME_CONFIG[gameName];
  if (!config) return String(room);
  return String(room).padStart(config.pad, "0");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(array) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function createRoomList(gameName) {
  const config = GAME_CONFIG[gameName];
  const rooms = [];

  for (let i = config.min; i <= config.max; i++) {
    rooms.push(i);
  }

  return shuffle(rooms);
}

function getGameCycle(gameName) {
  const cycleKey = getCycleKey();
  const cacheKey = `${gameName}:${cycleKey}`;

  if (!CYCLE_CACHE.has(cacheKey)) {
    const pool = createRoomList(gameName);

    CYCLE_CACHE.set(cacheKey, {
      gameName,
      cycleKey,
      pool,
      hotRooms: pool.slice(0, 5),
      createdAt: Date.now(),
    });
  }

  return CYCLE_CACHE.get(cacheKey);
}

function getUserSession(userId) {
  if (!electronicSessions.has(userId)) {
    electronicSessions.set(userId, {
      gameName: null,
      mode: null,
      waitingCustomRoom: false,
      usedRoomsByCycle: {},
    });
  }

  return electronicSessions.get(userId);
}

function setGameSession(userId, gameName) {
  const session = getUserSession(userId);

  session.gameName = gameName;
  session.mode = "menu";
  session.waitingCustomRoom = false;

  electronicSessions.set(userId, session);
  return session;
}

function getUsedRooms(session, gameName) {
  const key = `${gameName}:${getCycleKey()}`;

  if (!session.usedRoomsByCycle[key]) {
    session.usedRoomsByCycle[key] = [];
  }

  return session.usedRoomsByCycle[key];
}

function getNextRecommendRoom(userId, gameName) {
  const session = getUserSession(userId);
  const cycle = getGameCycle(gameName);
  const usedRooms = getUsedRooms(session, gameName);

  let room = cycle.pool.find((r) => !usedRooms.includes(r));

  if (!room) {
    session.usedRoomsByCycle[`${gameName}:${getCycleKey()}`] = [];
    room = cycle.pool[0];
  }

  usedRooms.push(room);
  electronicSessions.set(userId, session);

  return room;
}

function parseRoomInput(text) {
  const raw = String(text || "").trim();

  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function validateRoom(gameName, room) {
  const config = GAME_CONFIG[gameName];

  if (!config) {
    return { ok: false, message: "遊戲不存在。" };
  }

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
  return reply(
    event.replyToken,
    textMessage("請先回到電子 AI 選單選擇遊戲。")
  );
}

async function selectGame(event, gameName) {
  const userId = event.source.userId;

  if (!GAME_CONFIG[gameName]) {
    return reply(event.replyToken, textMessage("❌ 遊戲不存在，請重新選擇。"));
  }

  setGameSession(userId, gameName);

  return reply(
    event.replyToken,
    textMessage(
      `⚡ BLACKDOMAIN AI\n\n${gameName}\n\n請選擇功能。`,
      electronicModeQuickReply()
    )
  );
}

async function showGameMenu(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);

  if (!session.gameName) return showElectronicMain(event);

  session.mode = "menu";
  session.waitingCustomRoom = false;
  electronicSessions.set(userId, session);

  return reply(
    event.replyToken,
    textMessage(
      `⚡ BLACKDOMAIN AI\n\n${session.gameName}\n\n請選擇功能。`,
      electronicModeQuickReply()
    )
  );
}

async function recommendRoom(event) {
  const userId = event.source.userId;
  const session = getUserSession(userId);

  if (!session.gameName) return showElectronicMain(event);

  session.mode = "recommend";
  session.waitingCustomRoom = false;
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
  electronicSessions.set(userId, session);

  const cycle = getGameCycle(session.gameName);
  const rooms = cycle.hotRooms.map((r) => formatRoom(session.gameName, r));

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
  electronicSessions.set(userId, session);

  const config = GAME_CONFIG[session.gameName];

  return reply(
    event.replyToken,
    textMessage(
      `請輸入房號\n\n${session.gameName}\n範圍：${formatRoom(
        session.gameName,
        config.min
      )} ~ ${formatRoom(session.gameName, config.max)}`
    )
  );
}

async function analyzeCustomRoom(event, text) {
  const userId = event.source.userId;
  const session = getUserSession(userId);

  if (!session.gameName) return showElectronicMain(event);

  const room = parseRoomInput(text);
  const check = validateRoom(session.gameName, room);

  if (!check.ok) {
    return reply(event.replyToken, textMessage(check.message));
  }

  session.mode = "menu";
  session.waitingCustomRoom = false;
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

  if (GAME_CONFIG[text]) {
    return selectGame(event, text);
  }

  if (session.waitingCustomRoom) {
    return analyzeCustomRoom(event, text);
  }

  if (text === "AI推薦房" || text === "🤖 AI推薦房") {
    return recommendRoom(event);
  }

  if (text === "換一間" || text === "🔄 換一間") {
    return changeRecommendRoom(event);
  }

  if (text === "熱門房排行" || text === "🔥 熱門排行") {
    return showHotRank(event);
  }

  if (text === "自選房號分析" || text === "🔍 自選分析") {
    return askCustomRoom(event);
  }

  if (text === "返回電子功能") {
    return showGameMenu(event);
  }

  return false;
}

function isElectronicCommand(text) {
  if (!text) return false;

  return (
    text === "電子" ||
    text === "電子AI" ||
    text === "🎰 電子AI" ||
    text === "戰神賽特1" ||
    text === "戰神賽特2" ||
    text === "古神巴風特" ||
    text === "AI推薦房" ||
    text === "🤖 AI推薦房" ||
    text === "換一間" ||
    text === "🔄 換一間" ||
    text === "熱門房排行" ||
    text === "🔥 熱門排行" ||
    text === "自選房號分析" ||
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
