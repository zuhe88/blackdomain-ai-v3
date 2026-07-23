const { reply } = require("../../services/line");
const { ENTRY_COMMANDS, PICK_COUNTS } = require("./constants");
const { buildAnalysis } = require("./service");
const source = require("./source");
const { atgMenuFlex, atgAnalysisFlex } = require("./flex");

const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;
const REFRESH_COMMAND = "ATG 即時刷新";

function isEntryCommand(value) {
  return ENTRY_COMMANDS.has(String(value || "").trim());
}

function parsePickCount(value) {
  const match = String(value || "").trim().match(/^(?:ATG\s*)?([3-6])\s*碼$/i);
  if (!match) return null;
  const count = Number(match[1]);
  return PICK_COUNTS.includes(count) ? count : null;
}

function isAtgCommand(value) {
  return isEntryCommand(value) || parsePickCount(value) !== null || String(value || "").trim() === REFRESH_COMMAND;
}

function setActive(userId, pickCount = null) {
  const key = String(userId || "anonymous");
  const existing = sessions.get(key);
  sessions.set(key, {
    updatedAt: Date.now(),
    pickCount: pickCount || existing?.pickCount || 5,
  });
}

function hasActiveAtgSession(userId) {
  const key = String(userId || "anonymous");
  const session = sessions.get(key);
  if (!session) return false;
  if (Date.now() - session.updatedAt > SESSION_TIMEOUT) {
    sessions.delete(key);
    return false;
  }
  return true;
}

function resetAtgSession(userId) {
  sessions.delete(String(userId || "anonymous"));
}

async function handleAtgMessage(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId || "";

  if (isEntryCommand(text)) {
    setActive(userId);
    source.start();
    return reply(event.replyToken, atgMenuFlex());
  }

  const session = sessions.get(String(userId || "anonymous"));
  const count = text === REFRESH_COMMAND ? (session?.pickCount || 5) : parsePickCount(text);
  if (!count) return false;

  setActive(userId, count);
  source.start();
  const snapshot = source.getSnapshot();
  const analysis = buildAnalysis(snapshot.history, count, snapshot);
  return reply(event.replyToken, atgAnalysisFlex(analysis));
}

module.exports = {
  isEntryCommand,
  isAtgCommand,
  parsePickCount,
  handleAtgMessage,
  hasActiveAtgSession,
  resetAtgSession,
};
