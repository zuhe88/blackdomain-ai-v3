const Module = require("module");
const path = require("path");

const captured = {
  replies: [],
  pushes: [],
  multicasts: [],
  routes: { use: [], get: [], post: [], static: [] },
};

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

global.fetch = async function mockedFetch(url) {
  const value = String(url || "");
  if (value.includes("fifa.world")) {
    return {
      ok: true,
      async json() {
        return {
          events: [
            {
              date: "2099-07-03T18:00Z",
              competitions: [
                {
                  competitors: [
                    { homeAway: "home", form: "WWDDL", team: { abbreviation: "AUS", displayName: "Australia" } },
                    { homeAway: "away", form: "DLWDL", team: { abbreviation: "EGY", displayName: "Egypt" } },
                  ],
                },
              ],
            },
            {
              date: "2099-07-03T22:00Z",
              competitions: [
                {
                  competitors: [
                    { homeAway: "home", form: "WWWWW", team: { abbreviation: "ARG", displayName: "Argentina" } },
                    { homeAway: "away", form: "WDLDD", team: { abbreviation: "CPV", displayName: "Cape Verde" } },
                  ],
                },
              ],
            },
          ],
        };
      },
    };
  }
  if (value.includes("statsapi.mlb.com")) return { ok: true, async json() { return { dates: [] }; } };
  if (value.includes("cdn.nba.com")) return { ok: true, async json() { return { scoreboard: { games: [] } }; } };
  return { ok: false, status: 404, async json() { return {}; } };
};

const originalLoad = Module._load;

function createExpress() {
  function express() {
    return {
      disable() {},
      use(route, handler) { captured.routes.use.push({ route, handler }); },
      get(route, handler) { captured.routes.get.push({ route, handler }); },
      post(route, handler) { captured.routes.post.push({ route, handler }); },
      listen(port, callback) { if (callback) callback(); return { close() {} }; },
    };
  }
  express.static = function staticMiddleware(staticPath) {
    captured.routes.static.push(staticPath);
    return function staticHandler(req, res, next) { if (next) next(); };
  };
  return express;
}

class MockLineClient {
  async replyMessage(replyToken, messages) { captured.replies.push({ replyToken, messages }); }
  async pushMessage(userId, messages) { captured.pushes.push({ userId, messages }); }
  async multicast(userIds, messages) { captured.multicasts.push({ userIds, messages }); }
  async getProfile() { return { displayName: "測試使用者" }; }
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "dotenv") return { config() {} };
  if (request === "express") return createExpress();
  if (request === "cors") return () => (req, res, next) => next && next();
  if (request === "@line/bot-sdk") return { Client: MockLineClient, middleware: () => (req, res, next) => next && next() };
  if (request === "openai") {
    return class MockOpenAI {
      constructor() {
        this.chat = { completions: { create: async () => ({ choices: [{ message: { content: "• 主隊近期狀況較佳\n• 客隊防守不穩\n• AI預估主勝機率較高\n• 建議可參考主勝及大分" } }] }) } };
      }
    };
  }
  if (request === "@supabase/supabase-js") {
    const activeVip = {
      id: "vip-1",
      line_user_id: "user-smoke",
      line_name: "測試使用者",
      three_a_account: "test3a",
      vip_status: "已開通",
      ai_permission: true,
      expires_at: "2099-12-31T00:00:00.000Z",
      is_admin: false,
      updated_at: "2099-01-01T00:00:00.000Z",
    };
    return {
      createClient() {
        return {
          from() {
            let lookupValue = null;
            const chain = {
              select() { return chain; },
              eq(field, value) {
                lookupValue = value;
                return chain;
              },
              update() { return chain; },
              insert() { return chain; },
              async maybeSingle() {
                if (lookupValue === "blocked-user") return { data: null, error: null };
                return { data: activeVip, error: null };
              },
              then(resolve) {
                resolve({ data: lookupValue === "pending" ? [{ ...activeVip, vip_status: "待審核" }] : [activeVip], error: null });
              },
            };
            return chain;
          },
        };
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const { handleEvent } = require("../index");
const { image, multicast, push } = require("../services/line");

function event(text, userId = "user-smoke") {
  return {
    type: "message",
    replyToken: `reply-${captured.replies.length + 1}`,
    source: { userId },
    message: { type: "text", text },
  };
}

async function send(text, userId) {
  await handleEvent(event(text, userId));
  return captured.replies[captured.replies.length - 1];
}

function collectText(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (value.type === "text" && value.text) output.push(value.text);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectText(item, output));
    else if (child && typeof child === "object") collectText(child, output);
  }
  return output;
}

async function sendAndTexts(text, userId) {
  const result = await send(text, userId);
  return result.messages.flatMap((message) => collectText(message));
}

function assertIncludes(values, expected, label) {
  if (!values.some((value) => String(value).includes(expected))) {
    throw new Error(`${label} missing expected text: ${expected}; got: ${values.join(" | ")}`);
  }
}

function assertMessage(message) {
  if (!message || !message.type) throw new Error("Invalid LINE message");
  if (message.type === "flex" && !message.contents) throw new Error("Invalid Flex message");
  if (message.type === "image" && !/^https:\/\//.test(message.originalContentUrl)) throw new Error("Image URL must be HTTPS");
}

async function main() {
  require("../app");
  const root = path.join(__dirname, "..");
  const staticPath = captured.routes.static[0];
  if (!staticPath || path.resolve(staticPath) !== path.join(root, "assets", "images")) {
    throw new Error("Static image route points to the wrong directory");
  }
  ["/images/home", "/images/baccarat", "/images/electronic", "/images/sport", "/images/539", "/images/vip", "/images/admin"].forEach((route) => {
    if (!captured.routes.use.find((item) => item.route === route)) throw new Error(`Missing image route: ${route}`);
  });

  for (const text of ["黑域AI", "首頁", "開始", "menu", "選單"]) {
    const values = await sendAndTexts(text, `home-${text}`);
    ["🎲 百家樂AI", "⚡ 電子AI", "⚽ 體育AI", "🎯 539AI", "👑 VIP中心", "🌐 黑域官網", "📞 聯繫管理員"].forEach((label) => assertIncludes(values, label, "Home"));
  }

  let values = await sendAndTexts("VIP", "user-smoke");
  assertIncludes(values, "3A帳號", "VIP center");
  assertIncludes(values, "AI權限", "VIP center");

  values = await sendAndTexts("綁定", "bind-user");
  assertIncludes(values, "請輸入", "Bind prompt");
  values = await sendAndTexts("abc123", "bind-user");
  assertIncludes(values, "綁定申請已送出", "Bind success");
  if (!captured.pushes.length) throw new Error("Admin bind notification was not pushed");

  values = await sendAndTexts("VIP", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "管理員", "Admin VIP");
  assertIncludes(values, "無限制", "Admin VIP permission");
  values = await sendAndTexts("管理指令", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "管理員功能", "Admin commands");

  await send("電子", "user-smoke");
  values = await sendAndTexts("戰神賽特1", "user-smoke");
  assertIncludes(values, "AI推薦房", "Electronic menu");
  values = await sendAndTexts("AI推薦房", "user-smoke");
  assertIncludes(values, "推薦房號", "Electronic recommend");
  values = await sendAndTexts("熱門排行", "user-smoke");
  assertIncludes(values, "TOP10", "Electronic ranking");
  values = await sendAndTexts("自選分析", "user-smoke");
  assertIncludes(values, "請輸入房號", "Electronic custom prompt");
  values = await sendAndTexts("123", "user-smoke");
  assertIncludes(values, "AI監控", "Electronic custom analysis");

  values = await sendAndTexts("539", "user-smoke");
  assertIncludes(values, "AI今日預測", "539 menu");
  assertIncludes(values, "歷史開獎", "539 menu");
  values = await sendAndTexts("AI今日預測", "user-smoke");
  ["預測日期", "AI預測", "熱號", "冷號", "穩定號", "更新時間"].forEach((field) => assertIncludes(values, field, "539 analysis"));

  values = await sendAndTexts("體育", "user-smoke");
  assertIncludes(values, "世足AI", "Sports menu");
  values = await sendAndTexts("世足", "user-smoke");
  assertIncludes(values, "AI預測勝方", "Sports analysis");
  assertIncludes(values, "分析重點", "Sports points");

  values = await sendAndTexts("百家樂", "blocked-user");
  assertIncludes(values, "尚未開通黑域AI", "VIP gate");

  await push("push-user", "測試推播");
  await multicast(["user-a", "user-b"], "測試群發");
  assertMessage(image("https://example.com/image.png"));

  for (const replyRecord of captured.replies) replyRecord.messages.forEach(assertMessage);
  for (const pushRecord of captured.pushes) pushRecord.messages.forEach(assertMessage);
  for (const multicastRecord of captured.multicasts) multicastRecord.messages.forEach(assertMessage);

  console.log(`Smoke test passed: ${captured.replies.length} replies, ${captured.pushes.length} push, ${captured.multicasts.length} multicast.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
