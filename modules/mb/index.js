const { reply } = require("../../services/line");
const source = require("./source");
const { buildAnalysis, PICK_COUNTS } = require("./service");
const { mbAnalysisFlex, mbMenuFlex, mbTrackFlex } = require("./flex");

const ENTRY_COMMANDS = new Set(["MB", "MB彈珠", "MB彈珠AI"]);
const TRACK_COMMANDS = new Map([
  ["MB 賭城賽車", "PK-MBRACE-1"],
  ["MB 雪地賽車", "PK-MBRACE-2"],
  ["MB 運動賽車", "PK-MBRACE-3"],
  ["MB 海洋賽車", "PK-MBRACE-4"],
]);
const GAME_BY_TRACK_NAME = new Map([...TRACK_COMMANDS].map(([command, gameName]) => [
  command.replace(/^MB\s+/, ""),
  gameName,
]));
const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

function isEntryCommand(value) {
  return ENTRY_COMMANDS.has(String(value || "").trim());
}

function isMbCommand(value) {
  const text = String(value || "").trim();
  return isEntryCommand(text)
    || TRACK_COMMANDS.has(text)
    || /^MB\s+\S+\s+[3-6]\s*碼$/i.test(text)
    || /^MB\s*[3-6]\s*碼$/i.test(text);
}

function setSession(userId, gameName = null, pickCount = null) {
  const existing = activeSession(userId);
  sessions.set(String(userId || "anonymous"), {
    gameName: gameName || existing?.gameName || null,
    pickCount: pickCount || existing?.pickCount || 5,
    updatedAt: Date.now(),
  });
}

function activeSession(userId) {
  const key = String(userId || "anonymous");
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TIMEOUT) {
    sessions.delete(key);
    return null;
  }
  return session;
}

function hasActiveMbSession(userId) {
  return Boolean(activeSession(userId));
}

function resetMbSession(userId) {
  sessions.delete(String(userId || "anonymous"));
}

function findTrack(gameName) {
  return source.getSnapshot().tracks.find((track) => track.gameName === gameName) || null;
}

function parseAnalysisCommand(text, session) {
  const full = text.match(/^MB\s+(\S+)\s+([3-6])\s*碼$/i);
  if (full && GAME_BY_TRACK_NAME.has(full[1])) {
    return { gameName: GAME_BY_TRACK_NAME.get(full[1]), count: Number(full[2]) };
  }
  const short = text.match(/^MB\s*([3-6])\s*碼$/i);
  if (short && session?.gameName) {
    return { gameName: session.gameName, count: Number(short[1]) };
  }
  return null;
}

async function handleMbMessage(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId || "";

  if (isEntryCommand(text)) {
    setSession(userId);
    return reply(event.replyToken, mbMenuFlex(source.getSnapshot()));
  }

  const selectedGame = TRACK_COMMANDS.get(text);
  if (selectedGame) {
    const track = findTrack(selectedGame);
    if (!track) return false;
    setSession(userId, selectedGame);
    return reply(event.replyToken, mbTrackFlex(track));
  }

  const selection = parseAnalysisCommand(text, activeSession(userId));
  if (!selection || !PICK_COUNTS.includes(selection.count)) return false;
  const track = findTrack(selection.gameName);
  if (!track) return false;
  setSession(userId, selection.gameName, selection.count);
  return reply(event.replyToken, mbAnalysisFlex(buildAnalysis(track, selection.count), track));
}

module.exports = {
  handleMbMessage,
  hasActiveMbSession,
  isEntryCommand,
  isMbCommand,
  resetMbSession,
};
