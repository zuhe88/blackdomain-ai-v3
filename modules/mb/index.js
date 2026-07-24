const { reply } = require("../../services/line");
const source = require("./source");
const { mbMenuFlex, mbTrackFlex } = require("./flex");

const ENTRY_COMMANDS = new Set(["MB", "MB彈珠", "MB彈珠AI"]);
const TRACK_COMMANDS = new Map([
  ["MB 賭城賽車", "PK-MBRACE-1"],
  ["MB 雪地賽車", "PK-MBRACE-2"],
  ["MB 運動賽車", "PK-MBRACE-3"],
  ["MB 海洋賽車", "PK-MBRACE-4"],
]);
const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

function isEntryCommand(value) {
  return ENTRY_COMMANDS.has(String(value || "").trim());
}

function isMbCommand(value) {
  const text = String(value || "").trim();
  return isEntryCommand(text) || TRACK_COMMANDS.has(text);
}

function setSession(userId, gameName = null) {
  sessions.set(String(userId || "anonymous"), {
    gameName,
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

async function handleMbMessage(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId || "";

  if (isEntryCommand(text)) {
    setSession(userId);
    return reply(event.replyToken, mbMenuFlex(source.getSnapshot()));
  }

  const gameName = TRACK_COMMANDS.get(text);
  if (!gameName) return false;
  const track = findTrack(gameName);
  if (!track) return false;
  setSession(userId, gameName);
  return reply(event.replyToken, mbTrackFlex(track));
}

module.exports = {
  handleMbMessage,
  hasActiveMbSession,
  isEntryCommand,
  isMbCommand,
  resetMbSession,
};
