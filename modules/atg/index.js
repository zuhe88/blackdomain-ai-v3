const { reply } = require("../../services/line");
const { ENTRY_COMMANDS, PICK_COUNTS } = require("./constants");
const { buildAnalysis } = require("./service");
const source = require("./source");
const { atgMenuFlex, atgAnalysisFlex } = require("./flex");

const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

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
  return isEntryCommand(value) || parsePickCount(value) !== null;
}

function setActive(userId) {
  sessions.set(String(userId || "anonymous"), Date.now());
}

function hasActiveAtgSession(userId) {
  const key = String(userId || "anonymous");
  const updatedAt = sessions.get(key);
  if (!updatedAt) return false;
  if (Date.now() - updatedAt > SESSION_TIMEOUT) {
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

  const count = parsePickCount(text);
  if (!count) return false;

  setActive(userId);
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
