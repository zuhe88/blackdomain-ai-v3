const line = require("@line/bot-sdk");

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.Client(lineConfig);

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
    text: trim(text || "系統忙碌中，請稍後再試。", 5000),
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
    return text("圖片暫時無法顯示，請稍後再試。");
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
      if (!message.type) return text("系統回覆格式異常，請重新操作。");
      return message;
    });
}

async function reply(replyToken, messages) {
  try {
    await lineClient.replyMessage(replyToken, normalizeMessages(messages));
  } catch (err) {
    console.error("LINE_REPLY_ERROR:", err.message);
    if (err.originalError?.response?.data) {
      console.error(JSON.stringify(err.originalError.response.data, null, 2));
    }
  }
}

async function push(userId, messages) {
  try {
    await lineClient.pushMessage(userId, normalizeMessages(messages));
  } catch (err) {
    console.error("LINE_PUSH_ERROR:", err.message);
    if (err.originalError?.response?.data) {
      console.error(JSON.stringify(err.originalError.response.data, null, 2));
    }
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
};
