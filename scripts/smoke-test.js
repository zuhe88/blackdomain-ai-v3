const Module = require("module");
const path = require("path");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ATG_DISABLE_LIVE = "true";

const captured = {
  replies: [],
  pushes: [],
  multicasts: [],
  routes: { use: [], get: [], post: [], static: [] },
};

const activeVip = {
  id: "vip-1",
  line_user_id: "user-smoke",
  line_name: "測試使用者",
  three_a_account: "test3a",
  vip_status: "approved",
  ai_permission: true,
  expires_at: "2099-12-31T00:00:00.000Z",
  is_admin: false,
  updated_at: "2099-01-01T00:00:00.000Z",
};

const boundVip = {
  ...activeVip,
  id: "vip-2",
  line_user_id: "bound-user",
  three_a_account: "bound3a",
};

const pendingRequest = {
  id: "request-1",
  line_user_id: "pending-user",
  line_name: "待審核使用者",
  three_a_account: "abc123",
  status: "pending",
  request_time: "2099-01-01T00:00:00.000Z",
};

global.fetch = async function mockedFetch(url) {
  const value = String(url || "");
  if (value.includes("stats.cpbl.com.tw/api/proxy/v1/games/schedule")) {
    return {
      ok: true,
      async json() {
        return {
          Data: { Games: [{
            GameId: "2099-A-1",
            GameStatus: "SCHEDULED",
            PreExeDate: "2099-07-03T18:35:00",
            Visiting: { Team: { Code: "AJL011", Name: "樂天桃猿" }, AccumulationScore: { W: 35, L: 25, T: 1 } },
            Home: { Team: { Code: "ACN011", Name: "中信兄弟" }, AccumulationScore: { W: 40, L: 20, T: 1 } },
            Field: { No: "F19", Abbe: "洲際" },
          }] },
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
  express.json = function jsonMiddleware() {
    return function jsonHandler(req, res, next) { if (next) next(); };
  };
  return express;
}

class MockLineClient {
  async replyMessage(replyToken, messages) { captured.replies.push({ replyToken, messages }); }
  async pushMessage(userId, messages) { captured.pushes.push({ userId, messages }); }
  async multicast(userIds, messages) { captured.multicasts.push({ userIds, messages }); }
  async getProfile() { return { displayName: "測試使用者" }; }
}

function makeSupabaseTable(table) {
  const filters = [];
  let inserted = null;
  let updated = null;
  const chain = {
    select() { return chain; },
    eq(field, value) { filters.push({ field, value }); return chain; },
    update(payload) { updated = payload; return chain; },
    insert(payload) { inserted = payload; return chain; },
    async maybeSingle() {
      const rows = rowsForTable(table, filters, inserted, updated);
      return { data: rows[0] || null, error: null };
    },
    then(resolve) {
      resolve({ data: rowsForTable(table, filters, inserted, updated), error: null });
    },
  };
  return chain;
}

function rowsForTable(table, filters, inserted, updated) {
  if (inserted) return [{ ...inserted, id: "inserted-1" }];
  if (updated) return [{ ...updated, id: "updated-1" }];

  const lineFilter = filters.find((item) => item.field === "line_user_id")?.value;
  const accountFilter = filters.find((item) => item.field === "three_a_account")?.value;
  const statusFilter = filters.find((item) => item.field === "status")?.value;

  if (table === "vip_users") {
    const rows = [activeVip, boundVip];
    return rows.filter((row) => {
      if (lineFilter && row.line_user_id !== lineFilter) return false;
      if (accountFilter && row.three_a_account !== accountFilter) return false;
      return true;
    });
  }

  if (table === "vip_requests") {
    const rows = [pendingRequest];
    return rows.filter((row) => {
      if (lineFilter && row.line_user_id !== lineFilter) return false;
      if (accountFilter && row.three_a_account !== accountFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      return true;
    });
  }

  return [];
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "dotenv") return { config() {} };
  if (request === "express") return createExpress();
  if (request === "cors") return () => (req, res, next) => next && next();
  if (request === "@line/bot-sdk") return { Client: MockLineClient, middleware: () => (req, res, next) => next && next() };
  if (request === "openai") {
    return class MockOpenAI {
      constructor() {
        this.chat = { completions: { create: async () => ({ choices: [{ message: { content: "主隊近期狀況較佳\n客隊防守不穩\n主場優勢明顯\n建議參考主勝" } }] }) } };
      }
    };
  }
  if (request === "@supabase/supabase-js") {
    return { createClient() { return { from(table) { return makeSupabaseTable(table); } }; } };
  }
  return originalLoad.apply(this, arguments);
};

const { handleEvent } = require("../index");
const { image, multicast, push } = require("../services/line");
const { buildAnalysis: buildAtgAnalysis } = require("../modules/atg/service");
const atgSeed = require("../modules/atg/history-seed.json");

function event(text, userId = "user-smoke") {
  return { type: "message", replyToken: `reply-${captured.replies.length + 1}`, source: { userId }, message: { type: "text", text } };
}

function followEvent(userId = "new-follower") {
  return { type: "follow", replyToken: `reply-${captured.replies.length + 1}`, source: { userId } };
}

async function send(text, userId = "user-smoke") {
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

function collectActions(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (value.action) output.push(value.action);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectActions(item, output));
    else if (child && typeof child === "object" && child !== value.action) collectActions(child, output);
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
  const atgAnalysis = buildAtgAnalysis(atgSeed.results, 5, {
    source: "seed",
    targetPeriodId: atgSeed.targetPeriodId,
  });
  if (!atgAnalysis.available || atgAnalysis.rows.length !== 10) throw new Error("ATG analysis must cover all 10 ranks");
  if (atgAnalysis.recentResults.length !== 3) throw new Error("ATG analysis must expose the latest 3 results");
  for (const row of atgAnalysis.rows) {
    if (row.picks.length !== 5 || new Set(row.picks).size !== 5) {
      throw new Error(`ATG ${row.label} must contain 5 unique picks`);
    }
  }

  require("../app");
  const root = path.join(__dirname, "..");
  const staticPath = captured.routes.static[0];
  if (!staticPath || path.resolve(staticPath) !== path.join(root, "assets", "images")) throw new Error("Static image route points to the wrong directory");
  if (!captured.routes.static.some((staticRoot) => path.resolve(staticRoot) === path.join(root, "public", "brand"))) {
    throw new Error("Brand image route is not registered");
  }

  await handleEvent(followEvent());
  const followReply = captured.replies[captured.replies.length - 1];
  let values = followReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "歡迎進入黑域 AI", "Follow welcome");
  assertIncludes(values, "綁定 3A 帳號", "Follow welcome binding guide");
  const welcomeActions = followReply.messages.flatMap((message) => collectActions(message));
  if (!welcomeActions.some((action) => action.label === "綁定 3A 開通全部權限" && action.text === "綁定")) {
    throw new Error("Welcome binding CTA does not open the 3A binding flow");
  }

  values = await sendAndTexts("歡迎訊息", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "歡迎進入黑域 AI", "Admin welcome preview");

  values = await sendAndTexts("歡迎訊息", "regular-user");
  if (values.some((value) => String(value).includes("歡迎進入黑域 AI"))) {
    throw new Error("Welcome preview command must be admin-only");
  }

  values = await sendAndTexts("VIP", "user-smoke");
  assertIncludes(values, "VIP狀態", "VIP center");
  assertIncludes(values, "test3a", "VIP center");

  values = await sendAndTexts("綁定", "bound-user");
  assertIncludes(values, "您已綁定 3A帳號", "Already bound");
  assertIncludes(values, "bound3a", "Already bound");

  values = await sendAndTexts("綁定", "pending-user");
  assertIncludes(values, "您已有綁定申請待審核", "Pending bind");
  assertIncludes(values, "abc123", "Pending bind");

  values = await sendAndTexts("綁定", "new-user");
  assertIncludes(values, "請輸入", "Bind prompt");
  values = await sendAndTexts("new3a", "new-user");
  assertIncludes(values, "已收到您的3A帳號綁定申請", "Bind success");
  if (!captured.pushes.length) throw new Error("Admin bind notification was not pushed");

  values = await sendAndTexts("綁定", "invalid-account-user");
  assertIncludes(values, "請輸入", "Invalid account bind prompt");
  values = await sendAndTexts("中文 帳號!", "invalid-account-user");
  assertIncludes(values, "帳號格式不正確", "Invalid account validation");
  assertIncludes(values, "不可包含中文、空白或其他符號", "Invalid account explanation");
  values = await sendAndTexts("valid123", "invalid-account-user");
  assertIncludes(values, "已收到您的3A帳號綁定申請", "Valid account retry");

  values = await sendAndTexts("綁定", "global-command-user");
  assertIncludes(values, "請輸入", "Global command bind prompt");
  values = await sendAndTexts("黑域官網", "global-command-user");
  assertIncludes(values, "BLACKDOMAIN AI 官方入口", "Official website command overrides binding session");

  values = await sendAndTexts("綁定", "global-ai-entry-user");
  assertIncludes(values, "請輸入", "AI entry bind prompt");
  values = await sendAndTexts("電子", "global-ai-entry-user");
  assertIncludes(values, "尚未開通黑域AI", "AI entry overrides binding session");

  await send("電子", "user-smoke");
  values = await sendAndTexts("戰神賽特1", "user-smoke");
  assertIncludes(values, "AI推薦房", "Electronic menu");

  await send("百家樂", "user-smoke");
  values = await sendAndTexts("DG", "user-smoke");
  assertIncludes(values, "RB01", "Baccarat rooms");
  assertIncludes(values, "S07", "Baccarat rooms");

  values = await sendAndTexts("體育", "user-smoke");
  assertIncludes(values, "CPBL", "Sports menu");

  values = await sendAndTexts("CPBL", "user-smoke");
  assertIncludes(values, "AI預測勝方", "Sports analysis");

  values = await sendAndTexts("ATG賽馬", "user-smoke");
  assertIncludes(values, "主流 5碼", "ATG menu");
  values = await sendAndTexts("ATG 5碼", "user-smoke");
  assertIncludes(values, "冠軍至第十名定位推薦", "ATG analysis");
  assertIncludes(values, "離線樣本", "ATG seeded history");
  assertIncludes(values, "最近 3 場開獎", "ATG recent results");
  values = await sendAndTexts("ATG 即時刷新", "user-smoke");
  assertIncludes(values, "ATG賽馬AI · 5碼", "ATG instant refresh");

  await push("push-user", "測試推播");
  await multicast(["user-a", "user-b"], "測試群發");
  assertMessage(image("https://example.com/image.png"));

  for (const item of captured.replies) item.messages.forEach(assertMessage);
  for (const item of captured.pushes) item.messages.forEach(assertMessage);
  for (const item of captured.multicasts) item.messages.forEach(assertMessage);
  console.log(`Smoke test passed: ${captured.replies.length} replies, ${captured.pushes.length} push, ${captured.multicasts.length} multicast.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
