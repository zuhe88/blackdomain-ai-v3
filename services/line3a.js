const line = require("@line/bot-sdk");
const { USER_ERROR_TEXT, logError } = require("../utils/errorCodes");

const line3AConfig = {
  channelAccessToken: process.env.LINE_3A_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_3A_CHANNEL_SECRET,
};

const line3AClient = new line.Client(line3AConfig);

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
    await line3AClient.replyMessage(replyToken, normalizeMessages(messages));
  } catch (error) {
    logError("E001", error);
  }
}

async function push(userId, messages) {
  try {
    await line3AClient.pushMessage(userId, normalizeMessages(messages));
  } catch (error) {
    logError("E002", error);
  }
}

module.exports = {
  line,
  line3AConfig,
  line3AClient,
  reply,
  push,
};
