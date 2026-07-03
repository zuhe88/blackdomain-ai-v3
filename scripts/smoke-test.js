const fs = require("fs");
const Module = require("module");
const path = require("path");

const root = path.join(__dirname, "..");
const captured = {
  replies: [],
  pushes: [],
  routes: {
    use: [],
    get: [],
    post: [],
    static: [],
  },
};

const originalLoad = Module._load;

function createExpress() {
  function express() {
    return {
      disable() {},
      use(route, handler) {
        captured.routes.use.push({ route, handler });
      },
      get(route, handler) {
        captured.routes.get.push({ route, handler });
      },
      post(route, handler) {
        captured.routes.post.push({ route, handler });
      },
      listen(port, callback) {
        if (callback) callback();
        return { close() {} };
      },
    };
  }

  express.static = function staticMiddleware(staticPath) {
    captured.routes.static.push(staticPath);
    return function staticHandler(req, res, next) {
      if (next) next();
    };
  };

  return express;
}

class MockLineClient {
  async replyMessage(replyToken, messages) {
    captured.replies.push({ replyToken, messages });
  }

  async pushMessage(userId, messages) {
    captured.pushes.push({ userId, messages });
  }
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "dotenv") {
    return { config() {} };
  }

  if (request === "express") {
    return createExpress();
  }

  if (request === "cors") {
    return function cors() {
      return function corsMiddleware(req, res, next) {
        if (next) next();
      };
    };
  }

  if (request === "@line/bot-sdk") {
    return {
      Client: MockLineClient,
      middleware() {
        return function lineMiddleware(req, res, next) {
          if (next) next();
        };
      },
    };
  }

  return originalLoad.apply(this, arguments);
};

const { handleEvent } = require("../index");
const { image, push } = require("../services/line");
const uiQuickReply = require("../ui/quickReply");

function event(text, userId = "user-smoke") {
  return {
    type: "message",
    replyToken: `reply-${captured.replies.length + 1}`,
    source: { userId },
    message: { type: "text", text },
  };
}

function walkFlex(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);

  if (Array.isArray(node)) {
    node.forEach((child) => walkFlex(child, visitor));
    return;
  }

  Object.keys(node).forEach((key) => walkFlex(node[key], visitor));
}

function assertMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("LINE message must be an object");
  }

  if (message.type === "text") {
    if (!message.text || message.text.length > 5000) {
      throw new Error("Invalid text message");
    }
  } else if (message.type === "flex") {
    if (!message.altText || message.altText.length > 400) {
      throw new Error("Invalid flex altText");
    }

    if (!message.contents || !["bubble", "carousel"].includes(message.contents.type)) {
      throw new Error("Invalid flex contents");
    }

    walkFlex(message.contents, (node) => {
      if (node.type === "text") {
        if (typeof node.text !== "string" || node.text.length === 0) {
          throw new Error("Invalid flex text node");
        }
      }

      if (node.action?.type === "message") {
        if (!node.action.text || node.action.text.length > 300) {
          throw new Error("Invalid message action");
        }
      }
    });
  } else if (message.type === "image") {
    if (!/^https:\/\//.test(message.originalContentUrl || "")) {
      throw new Error("Image message requires HTTPS originalContentUrl");
    }

    if (!/^https:\/\//.test(message.previewImageUrl || "")) {
      throw new Error("Image message requires HTTPS previewImageUrl");
    }
  } else {
    throw new Error(`Unsupported LINE message type: ${message.type}`);
  }

  if (message.quickReply) {
    if (!Array.isArray(message.quickReply.items) || message.quickReply.items.length > 13) {
      throw new Error("Invalid quickReply items");
    }

    message.quickReply.items.forEach((item) => {
      if (item.type !== "action" || item.action?.type !== "message") {
        throw new Error("Invalid quickReply action");
      }

      if (!item.action.label || item.action.label.length > 20) {
        throw new Error("Invalid quickReply label");
      }

      if (!item.action.text || item.action.text.length > 300) {
        throw new Error("Invalid quickReply text");
      }
    });
  }
}

function assertLatestReply() {
  const latest = captured.replies[captured.replies.length - 1];
  if (!latest) throw new Error("Expected replyMessage to be called");

  if (!Array.isArray(latest.messages) || latest.messages.length === 0 || latest.messages.length > 5) {
    throw new Error("Invalid replyMessage payload");
  }

  latest.messages.forEach(assertMessage);
}

async function send(text, userId) {
  await handleEvent(event(text, userId));
  assertLatestReply();
}

async function main() {
  const imageRoute = captured.routes.use.find((route) => route.route === "/images");
  if (!imageRoute) throw new Error("Missing /images static route");

  const staticPath = captured.routes.static[0];
  if (!staticPath || path.resolve(staticPath) !== path.join(root, "assets", "images")) {
    throw new Error("Static image route points to the wrong directory");
  }

  ["seth1.png", "seth2.png", "baphomet.png"].forEach((file) => {
    const target = path.join(root, "assets", "images", file);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      throw new Error(`Missing image asset: ${file}`);
    }
  });

  for (const text of ["黑域AI", "首頁", "開始", "選單"]) {
    await send(text, `main-${text}`);
  }

  for (const text of ["電子", "電子AI", "🎰 電子AI"]) {
    await send(text, `electronic-menu-${text}`);
  }

  const electronicUser = "electronic-flow";
  for (const text of [
    "戰神賽特1",
    "AI推薦房",
    "換一間",
    "熱門房排行",
    "自選房號分析",
    "123",
    "返回電子功能",
    "戰神賽特2",
    "古神巴風特",
  ]) {
    await send(text, electronicUser);
  }

  const baccaratUser = "baccarat-flow";
  for (const text of ["百家樂", "DG", "01", "3000", "500", "AI配注", "莊", "閒", "和", "結束分析"]) {
    await send(text, baccaratUser);
  }

  const baccaratUserMt = "baccarat-mt-flow";
  for (const text of ["百家樂AI", "MT", "3A", "3000.5", "500.5", "天門", "莊", "取消"]) {
    await send(text, baccaratUserMt);
  }

  const baccaratUserFree = "baccarat-free-flow";
  for (const text of ["🤖 百家樂AI", "MT", "13A", "3,000", "500", "自由配注", "和"]) {
    await send(text, baccaratUserFree);
  }

  for (const text of ["539", "539AI", "📊 539AI", "體育", "體育AI", "⚽ 體育AI", "MLB", "VIP", "VIP查詢", "👑 VIP查詢", "未知指令"]) {
    await send(text, `misc-${text}`);
  }

  await push("push-user", "推播測試");
  if (captured.pushes.length !== 1) throw new Error("Expected pushMessage to be called");
  captured.pushes[0].messages.forEach(assertMessage);

  const imageFallback = image("http://example.com/not-secure.png");
  assertMessage(imageFallback);

  process.env.IMG_SET1 = "http://example.com/not-secure.png";
  const gameQuickReply = uiQuickReply.electronicGames();
  if (gameQuickReply.items.some((item) => item.imageUrl)) {
    throw new Error("Invalid quickReply imageUrl should be omitted");
  }

  console.log(`Smoke test passed: ${captured.replies.length} replies, ${captured.pushes.length} push.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
