const fs = require("fs");
const Module = require("module");
const path = require("path");

const root = path.join(__dirname, "..");
const captured = {
  replies: [],
  pushes: [],
  multicasts: [],
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

  async multicast(userIds, messages) {
    captured.multicasts.push({ userIds, messages });
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

  if (request === "@supabase/supabase-js") {
    return {
      createClient() {
        return {
          from() {
            return {
              select() {
                return this;
              },
              eq() {
                return this;
              },
              async maybeSingle() {
                return { data: null, error: null };
              },
            };
          },
        };
      },
    };
  }

  return originalLoad.apply(this, arguments);
};

const { handleEvent } = require("../index");
const baccaratAi = require("../modules/baccarat/ai");
const { image, multicast, push } = require("../services/line");
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

function collectMessageText(message) {
  const values = [];

  if (message.type === "text") {
    values.push(message.text);
  }

  if (message.type === "flex") {
    walkFlex(message.contents, (node) => {
      if (node.type === "text") values.push(node.text);
      if (node.action?.type === "message") values.push(node.action.text);
    });
  }

  if (message.quickReply) {
    message.quickReply.items.forEach((item) => {
      values.push(item.action.label);
      values.push(item.action.text);
    });
  }

  return values;
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

  collectMessageText(message).forEach((value) => {
    if (value.includes("建置中")) {
      throw new Error("Active module returned 建置中");
    }

    if (value.includes("??") || value.includes("�")) {
      throw new Error("Detected corrupted text marker");
    }

    if (/\b(Error|undefined|null|Exception|Stack)\b/.test(value)) {
      throw new Error("Detected user-facing technical error text");
    }
  });
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
  return captured.replies[captured.replies.length - 1];
}

async function sendAndTexts(text, userId) {
  const response = await send(text, userId);
  return response.messages.flatMap(collectMessageText);
}

function assertIncludes(values, expected, label) {
  if (!values.some((value) => String(value).includes(expected))) {
    throw new Error(`${label} missing expected text: ${expected}`);
  }
}

function assert539Numbers(values) {
  const joined = values.join(" ");
  const numberGroups = joined.match(/\b(?:0[1-9]|[12][0-9]|3[0-9])(?:　(?:0[1-9]|[12][0-9]|3[0-9])){4}\b/g);
  if (!numberGroups || numberGroups.length < 4) {
    throw new Error("539 analysis must include prediction, hot, cold, and stable number groups");
  }

  numberGroups.forEach((group) => {
    const numbers = group.split("　");
    if (new Set(numbers).size !== 5) {
      throw new Error("539 number group contains duplicates");
    }
  });
}

function assertBaccaratLogic() {
  const aiBetSession = {
    mode: "AI配注",
    bankroll: 3000,
    capital: 3000,
    maxBet: 50,
    history: [],
    results: { win: 0, lose: 0, tie: 0 },
    tianmenLevel: 1,
  };
  let result = baccaratAi.firstAnalysis(aiBetSession);
  if (result.bet !== 50) throw new Error("Baccarat bet limit must cap AI bet");
  const beforeWinBankroll = result.session.bankroll;
  result = baccaratAi.nextAnalysis(result.session, "過");
  if (result.session.bankroll <= beforeWinBankroll) throw new Error("Baccarat 過 must increase bankroll");

  const tieSession = {
    mode: "AI配注",
    bankroll: 3000,
    capital: 3000,
    maxBet: 500,
    history: [],
    results: { win: 0, lose: 0, tie: 0 },
    tianmenLevel: 1,
  };
  result = baccaratAi.firstAnalysis(tieSession);
  const beforeTieBankroll = result.session.bankroll;
  result = baccaratAi.nextAnalysis(result.session, "和");
  if (result.session.bankroll !== beforeTieBankroll) throw new Error("Baccarat 和 must not change bankroll");

  const heavenSession = {
    mode: "天門",
    bankroll: 3000,
    capital: 3000,
    maxBet: 80,
    history: [],
    results: { win: 0, lose: 0, tie: 0 },
    tianmenLevel: 1,
  };
  result = baccaratAi.firstAnalysis(heavenSession);
  if (result.bet !== 80) throw new Error("Heaven Mode must cap first level by max bet");

  const freeSession = {
    mode: "自由配注",
    bankroll: 3000,
    capital: 3000,
    maxBet: 500,
    history: [],
    results: { win: 0, lose: 0, tie: 0 },
    tianmenLevel: 1,
  };
  result = baccaratAi.firstAnalysis(freeSession);
  if (result.bet !== 0) throw new Error("Free Bet must not recommend stake");
}

async function main() {
  assertBaccaratLogic();

  ["config", "modules", "services", "database", "middleware", "routes", "flex", "assets", "public", "utils", "logs", "scripts", "types"].forEach((dir) => {
    if (!fs.existsSync(path.join(root, dir))) {
      throw new Error(`Missing architecture directory: ${dir}`);
    }
  });

  ["app.js", "server.js", "package.json"].forEach((file) => {
    if (!fs.existsSync(path.join(root, file))) {
      throw new Error(`Missing root file: ${file}`);
    }
  });

  const standardModules = ["baccarat", "electronic", "sports", "lottery539", "vip"];
  const standardFiles = ["index.js", "handler.js", "service.js", "flex.js", "validator.js", "constants.js", "session.js", "repository.js"];
  standardModules.forEach((moduleName) => {
    standardFiles.forEach((file) => {
      if (!fs.existsSync(path.join(root, "modules", moduleName, file))) {
        throw new Error(`Missing module standard file: ${moduleName}/${file}`);
      }
    });
  });

  const imageRoute = captured.routes.use.find((route) => route.route === "/images");
  if (!imageRoute) throw new Error("Missing /images static route");

  const publicImageRoute = captured.routes.use.find((route) => route.route === "/public/images");
  if (!publicImageRoute) throw new Error("Missing /public/images static route");

  ["/images/home", "/images/baccarat", "/images/electronic", "/images/sport", "/images/539", "/images/vip", "/images/admin"].forEach((route) => {
    if (!captured.routes.use.find((item) => item.route === route)) {
      throw new Error(`Missing image route: ${route}`);
    }
  });

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

  for (const text of ["黑域AI", "首頁", "開始", "menu", "選單"]) {
    const values = await sendAndTexts(text, `main-${text}`);
    ["🎲 百家樂AI", "⚡ 電子AI", "⚽ 體育AI", "🎯 539AI", "👑 VIP中心", "🌐 黑域官網", "📞 聯繫管理員"].forEach((label) => {
      assertIncludes(values, label, "Home menu");
    });
  }

  for (const text of ["電子", "電子AI", "Electronic", "⚡ 電子AI"]) {
    await send(text, `electronic-menu-${text}`);
  }

  for (const game of ["戰神賽特1", "戰神賽特2", "古神巴風特"]) {
    const electronicUser = `electronic-flow-${game}`;
    let values = await sendAndTexts(game, electronicUser);
    assertIncludes(values, "AI推薦房", `${game} menu`);
    assertIncludes(values, "熱門房排行", `${game} menu`);
    assertIncludes(values, "自選房號分析", `${game} menu`);

    values = await sendAndTexts("AI推薦房", electronicUser);
    assertIncludes(values, "推薦房號", `${game} recommend`);
    assertIncludes(values, "推薦原因", `${game} recommend`);

    values = await sendAndTexts("熱門房排行", electronicUser);
    assertIncludes(values, "TOP10", `${game} ranking`);
    assertIncludes(values, "更新時間", `${game} ranking`);

    values = await sendAndTexts("自選房號分析", electronicUser);
    assertIncludes(values, "請輸入房號", `${game} custom prompt`);

    values = await sendAndTexts(game === "戰神賽特2" ? "4000" : "123", electronicUser);
    assertIncludes(values, "活躍度", `${game} analysis`);
    assertIncludes(values, "波動", `${game} analysis`);
    assertIncludes(values, "AI監控", `${game} analysis`);
    assertIncludes(values, "建議", `${game} analysis`);
  }

  const baccaratUser = "baccarat-flow";
  for (const text of ["百家樂", "DG", "DG01", "3000", "500"]) {
    const reply = await send(text, baccaratUser);
    reply.messages.forEach((message) => {
      if (message.type !== "flex") throw new Error("Baccarat must reply with Flex UI");
    });
  }
  let baccaratValues = await sendAndTexts("AI配注", baccaratUser);
  ["預測", "建議下注", "信心值", "建議原因", "單注上限", "目前本金", "目前獲利"].forEach((field) => {
    assertIncludes(baccaratValues, field, "Baccarat AI Bet");
  });
  baccaratValues = await sendAndTexts("過", baccaratUser);
  assertIncludes(baccaratValues, "過", "Baccarat over");
  assertIncludes(baccaratValues, "目前獲利", "Baccarat profit");
  baccaratValues = await sendAndTexts("倒", baccaratUser);
  assertIncludes(baccaratValues, "倒", "Baccarat loss");
  baccaratValues = await sendAndTexts("和", baccaratUser);
  assertIncludes(baccaratValues, "和", "Baccarat tie");
  await send("返回房號", baccaratUser);
  await send("DG02", baccaratUser);
  await send("3000", baccaratUser);
  await send("500", baccaratUser);
  await send("AI配注", baccaratUser);
  await send("結束分析", baccaratUser);

  const baccaratUserMt = "baccarat-mt-flow";
  for (const text of ["百家樂AI", "MT", "3A", "3000", "500"]) {
    const reply = await send(text, baccaratUserMt);
    reply.messages.forEach((message) => {
      if (message.type !== "flex") throw new Error("Baccarat must reply with Flex UI");
    });
  }
  baccaratValues = await sendAndTexts("天門", baccaratUserMt);
  assertIncludes(baccaratValues, "天門", "Baccarat Heaven Mode");
  assertIncludes(baccaratValues, "建議下注", "Baccarat Heaven Mode bet");
  await send("過", baccaratUserMt);
  await send("取消", baccaratUserMt);

  const baccaratUserFree = "baccarat-free-flow";
  for (const text of ["baccarat", "MT", "MT13", "3,000", "500"]) {
    const reply = await send(text, baccaratUserFree);
    reply.messages.forEach((message) => {
      if (message.type !== "flex") throw new Error("Baccarat must reply with Flex UI");
    });
  }
  baccaratValues = await sendAndTexts("自由配注", baccaratUserFree);
  assertIncludes(baccaratValues, "自行控注", "Baccarat Free Bet");
  await send("和", baccaratUserFree);

  for (const text of ["539", "539AI", "今彩539", "🎯 539AI", "🔥 AI今日預測", "📈 熱號分析", "📉 冷號分析", "⭐ 穩定號分析", "📊 歷史開獎"]) {
    const values = await sendAndTexts(text, `539-${text}`);
    if (!["539", "539AI", "今彩539", "🎯 539AI", "📊 歷史開獎"].includes(text)) {
      assert539Numbers(values);
    }
  }

  for (const text of ["體育", "體育AI", "SPORT", "SPORT AI", "世足", "世足AI", "MLB", "MLB AI", "NBA"]) {
    const values = await sendAndTexts(text, `sports-${text}`);
    if (["世足", "世足AI", "MLB", "MLB AI", "NBA"].includes(text)) {
      assertIncludes(values, "目前尚無可分析賽事", `SPORT ${text}`);
    }
  }

  for (const text of ["VIP", "vip", "VIP查詢", "我的VIP", "會員", "VIP中心", "👑 VIP中心"]) {
    const values = await sendAndTexts(text, `vip-${text}`);
    ["VIP狀態", "到期日期", "剩餘天數", "AI權限"].forEach((field) => {
      assertIncludes(values, field, `VIP ${text}`);
    });
  }

  for (const text of [
    "黑域官網",
    "官網",
    "🌐 黑域官網",
    "聯繫管理員",
    "客服",
    "管理員",
    "admin",
    "開通VIP",
    "延長VIP",
    "取消VIP",
    "查詢VIP",
    "使用者",
    "Session",
    "Log",
    "發送公告",
    "維護公告",
    "更新公告",
    "刷新AI",
    "查看AI狀態",
    "查看Railway",
    "查看Supabase",
    "查看Version",
  ]) {
    const values = await sendAndTexts(text, `official-${text}`);
    if (["黑域官網", "官網", "🌐 黑域官網"].includes(text)) {
      assertIncludes(values, "黑域官網", "Official website");
    } else if (["聯繫管理員", "客服"].includes(text)) {
      assertIncludes(values, "聯繫管理員", "Contact admin");
    } else {
      assertIncludes(values, "無權限使用此功能", `Admin ${text}`);
    }
  }

  for (const text of ["未知指令"]) {
    await send(text, `misc-${text}`);
  }

  await push("push-user", "推播測試");
  if (captured.pushes.length !== 1) throw new Error("Expected pushMessage to be called");
  captured.pushes[0].messages.forEach(assertMessage);

  await multicast(["user-a", "user-b"], "群發測試");
  if (captured.multicasts.length !== 1) throw new Error("Expected multicast to be called");
  captured.multicasts[0].messages.forEach(assertMessage);

  const imageMessage = image("https://example.com/image.png");
  assertMessage(imageMessage);

  process.env.IMG_SET1 = "http://example.com/not-secure.png";
  const gameQuickReply = uiQuickReply.electronicGames();
  if (gameQuickReply.items.some((item) => item.imageUrl)) {
    throw new Error("Invalid quickReply imageUrl should be omitted");
  }

  console.log(`Smoke test passed: ${captured.replies.length} replies, ${captured.pushes.length} push, ${captured.multicasts.length} multicast.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
