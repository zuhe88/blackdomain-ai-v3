const line = require("@line/bot-sdk");
const { USER_ERROR_TEXT, logError } = require("../utils/errorCodes");
const webChannel = require("./webChannel");

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  httpConfig: {
    timeout: Math.max(1000, Number(process.env.LINE_HTTP_TIMEOUT_MS) || 10000),
  },
};

if (!lineConfig.channelAccessToken || !lineConfig.channelSecret) {
  console.error("LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET is not configured.");
}

let cachedClient = null;
let warnedMissingLineConfig = false;

function getLineClient() {
  if ((!lineConfig.channelAccessToken || !lineConfig.channelSecret) && !warnedMissingLineConfig) {
    warnedMissingLineConfig = true;
    console.error("LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET is not configured.");
  }
  if (!cachedClient) {
    const client = new line.Client(lineConfig);
    const axiosDefaults = client?.http?.instance?.defaults;
    if (!axiosDefaults) {
      throw new Error("LINE SDK HTTP timeout could not be configured.");
    }
    axiosDefaults.timeout = lineConfig.httpConfig.timeout;
    cachedClient = client;
  }
  return cachedClient;
}

const lineClient = {
  replyMessage(replyToken, messages) {
    return getLineClient().replyMessage(replyToken, messages);
  },
  pushMessage(userId, messages) {
    return getLineClient().pushMessage(userId, messages);
  },
  multicast(userIds, messages) {
    return getLineClient().multicast(userIds, messages);
  },
  getProfile(userId) {
    return getLineClient().getProfile(userId);
  },
};

function trim(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function text(text, quickReply = null) {
  const message = {
    type: "text",
    text: trim(text || USER_ERROR_TEXT, 5000),
  };

  if (quickReply) {
    message.quickReply = quickReply;
  }

  return message;
}

function flex(altText, contents) {
  return {
    type: "flex",
    altText: trim(altText || "BLACKDOMAIN AI", 400),
    contents,
  };
}

function image(originalContentUrl, previewImageUrl = originalContentUrl) {
  if (!isHttpsUrl(originalContentUrl) || !isHttpsUrl(previewImageUrl)) {
    logError("E005", new Error("Invalid image URL"));
    return text(USER_ERROR_TEXT);
  }

  return {
    type: "image",
    originalContentUrl,
    previewImageUrl,
  };
}

function qr(label, text, imageUrl = null) {
  const item = {
    type: "action",
    action: {
      type: "message",
      label: trim(label, 20),
      text: trim(text, 300),
    },
  };

  if (isHttpsUrl(imageUrl)) item.imageUrl = imageUrl;

  return item;
}

function quickReply(items = []) {
  return {
    items: items.slice(0, 13).map((item) => {
      if (item.type === "action" && item.action) {
        return {
          ...item,
          action: {
            ...item.action,
            label: trim(item.action.label, 20),
            text: trim(item.action.text, 300),
          },
        };
      }

      return qr(item.label, item.text, item.imageUrl || null);
    }),
  };
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [messages])
    .filter(Boolean)
    .slice(0, 5)
    .map((message) => {
      if (typeof message === "string") return text(message);
      if (!message.type) {
        logError("E006", new Error("Invalid LINE message object"));
        return text(USER_ERROR_TEXT);
      }
      return message;
    });
}

async function reply(replyToken, messages) {
  const normalized = normalizeMessages(messages);
  if (String(replyToken || "").startsWith("web:")) {
    webChannel.resolveReply(replyToken, normalized);
    return;
  }
  try {
    await lineClient.replyMessage(replyToken, normalized);
  } catch (err) {
    logError("E001", err);
  }
}

async function push(userId, messages) {
  try {
    await pushStrict(userId, messages);
  } catch (err) {
    logError("E002", err);
  }
}

async function pushStrict(userId, messages) {
  if (!userId) throw new Error("Missing line_user_id for pushMessage.");
  const normalized = normalizeMessages(messages);
  if (String(process.env.LINE_WEBSITE_ONLY_MODE || "true").toLowerCase() !== "false") {
    webChannel.publish(userId, normalized);
    return;
  }
  if (webChannel.connected(userId)) {
    webChannel.publish(userId, normalized);
    return;
  }
  await lineClient.pushMessage(userId, normalized);
}

async function multicast(userIds, messages) {
  try {
    const normalized = normalizeMessages(messages);
    if (String(process.env.LINE_WEBSITE_ONLY_MODE || "true").toLowerCase() !== "false") {
      userIds.forEach((userId) => webChannel.publish(userId, normalized));
      return;
    }
    await lineClient.multicast(userIds, normalized);
  } catch (err) {
    logError("E002", err);
  }
}

module.exports = {
  line,
  lineConfig,
  lineClient,
  text,
  textMessage: text,
  flex,
  image,
  qr,
  quickReply,
  reply,
  push,
  pushStrict,
  multicast,
};
