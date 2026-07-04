const line = require("@line/bot-sdk");
const { USER_ERROR_TEXT, logError } = require("../utils/errorCodes");

const line3AConfig = {
  channelAccessToken: process.env.LINE_3A_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_3A_CHANNEL_SECRET,
};

let cachedClient = null;

function has3ALineConfig() {
  return Boolean(line3AConfig.channelAccessToken && line3AConfig.channelSecret);
}

function getLine3AClient() {
  if (!has3ALineConfig()) {
    console.error("LINE_3A_CHANNEL_ACCESS_TOKEN or LINE_3A_CHANNEL_SECRET is not configured.");
    return null;
  }

  if (!cachedClient) {
    cachedClient = new line.Client(line3AConfig);
  }

  return cachedClient;
}

function trim(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [messages])
    .filter(Boolean)
    .slice(0, 5)
    .map((message) => {
      if (typeof message === "string") return { type: "text", text: trim(message, 5000) };
      if (!message.type) return { type: "text", text: USER_ERROR_TEXT };
      return message;
    });
}

async function reply(replyToken, messages) {
  try {
    const client = getLine3AClient();
    if (!client) return;
    await client.replyMessage(replyToken, normalizeMessages(messages));
  } catch (error) {
    logError("E001", error);
  }
}

async function push(userId, messages) {
  try {
    const client = getLine3AClient();
    if (!client) return;
    await client.pushMessage(userId, normalizeMessages(messages));
  } catch (error) {
    logError("E002", error);
  }
}

async function getProfile(userId) {
  try {
    const client = getLine3AClient();
    if (!client || !userId) return null;
    return await client.getProfile(userId);
  } catch (error) {
    logError("E002", error);
    return null;
  }
}

module.exports = {
  line,
  line3AConfig,
  getLine3AClient,
  getProfile,
  reply,
  push,
};
