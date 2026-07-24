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
const mbSource = require("../modules/mb/source");
const { buildAnalysis: buildMbAnalysis } = require("../modules/mb/service");

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
  if (message.type === "flex" && message.contents?.type === "bubble") {
    const size = Buffer.byteLength(JSON.stringify(message.contents), "utf8");
    if (size > 30000) throw new Error(`Flex bubble exceeds LINE 30 KB limit: ${size} bytes`);
  }
  if (message.type === "image" && !/^https:\/\//.test(message.originalContentUrl)) throw new Error("Image URL must be HTTPS");
}

async function main() {
  mbSource.resetForTest();
  if (!mbSource.ingestRoadmap({
    items: [{
      game_name: "PK-MBRACE-1",
      roadmap: Array.from({ length: 30 }, (_, index) => {
        const champion = (index % 10) + 1;
        const second = ((index + 1) % 10) + 1;
        const third = ((index + 2) % 10) + 1;
        return {
          draw_num: String(202607240001 - index),
          champion: { rank_value: String(champion) },
          second: { rank_value: String(second) },
          third: { rank_value: String(third) },
          sum: {
            rank_value: String(champion + second),
            over_under: champion + second >= 12 ? "OVER" : "UNDER",
            odd_even: (champion + second) % 2 ? "ODD" : "EVEN",
          },
        };
      }),
    }],
  })) throw new Error("MB roadmap payload must be accepted");
  if (!mbSource.ingestSocketEvent({
    event: "RESULT_PUBLIC",
    data: {
      dcs_id: 368,
      game_name: "PK-MBRACE-1",
      draw_num: "202607240002",
      result: [3, 9, 2, 1, 6, 5, 8, 10, 7, 4],
      result_display: { sum: "12", over_under: "OVER", odd_even: "EVEN" },
      result_time: 1784893222,
    },
  })) throw new Error("MB live result payload must be accepted");
  const mbSnapshot = mbSource.getSnapshot();
  const mbTrack = mbSnapshot.tracks.find((track) => track.gameName === "PK-MBRACE-1");
  if (!mbTrack || mbTrack.historyCount !== 31 || mbTrack.latestPeriodId !== "202607240002") {
    throw new Error("MB track history was not merged correctly");
  }
  if (mbTrack.targetPeriodId !== "202607240003") {
    throw new Error("MB target period must advance after a live result");
  }
  const mbAnalysis = buildMbAnalysis(mbTrack, 5);
  if (!mbAnalysis.available || mbAnalysis.rows.length !== 3) {
    throw new Error("MB analysis must cover the top three ranks");
  }
  if (mbAnalysis.rows.some((row) => row.picks.length !== 5 || new Set(row.picks).size !== 5)) {
    throw new Error("MB analysis must return five unique picks per rank");
  }
  for (const count of [3, 4, 5, 6]) {
    const analysis = buildMbAnalysis(mbTrack, count);
    if (analysis.rows.some((row) => row.picks.length !== count)) {
      throw new Error(`MB analysis must return ${count} picks per rank`);
    }
  }

  mbSource.ingestSocketEvent({
    event: "OPEN",
    data: {
      game_name: "PK-MBRACE-2",
      current: { game_name: "PK-MBRACE-2", draw_num: "202607240103" },
    },
  });
  mbSource.ingestRoadmap({
    items: [{
      game_name: "PK-MBRACE-2",
      roadmap: [{
        draw_num: "202607240101",
        champion: { rank_value: "1" },
        second: { rank_value: "2" },
        third: { rank_value: "3" },
      }],
    }],
  });
  const skippedTrack = mbSource.getSnapshot().tracks.find((track) => track.gameName === "PK-MBRACE-2");
  if (skippedTrack.targetPeriodId !== "202607240103") {
    throw new Error("MB roadmap refresh must not move an active target period backwards");
  }

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
  if (!captured.routes.get.some((route) => route.route === "/mb-relay.user.js")) {
    throw new Error("MB relay userscript route is not registered");
  }
  if (!captured.routes.get.some((route) => route.route === "/api/mb/status")) {
    throw new Error("MB status route is not registered");
  }
  if (!captured.routes.post.some((route) => route.route === "/api/mb/ingest")) {
    throw new Error("MB ingest route is not registered");
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

  const atgGameMenuReply = await send("ATG", "user-smoke");
  const firstAtgGame = atgGameMenuReply.messages[0]?.contents?.contents?.[0];
  if (firstAtgGame?.hero?.action?.text !== "ATG賽馬") {
    throw new Error("ATG horse must be the first game in the ATG carousel");
  }
  values = atgGameMenuReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "ATG賽馬", "ATG combined game menu");
  assertIncludes(values, "戰神賽特1", "ATG combined game menu");

  const mbMenuReply = await send("MB彈珠", "user-smoke");
  values = mbMenuReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "獨立四賽道即時資料", "MB independent game menu");
  assertIncludes(values, "賭城賽車", "MB independent game menu");
  assertIncludes(values, "雪地賽車", "MB independent game menu");
  const mbHeroUrl = mbMenuReply.messages[0]?.contents?.hero?.url || "";
  if (!mbHeroUrl.includes("mb-marble-hd.webp")) {
    throw new Error("MB menu must use the enhanced MB marble image");
  }
  values = await sendAndTexts("mb彈珠", "user-smoke-lowercase");
  assertIncludes(values, "獨立四賽道即時資料", "Lowercase MB command");
  values = await sendAndTexts("MB 賭城賽車", "user-smoke");
  assertIncludes(values, "主流 5碼", "MB track pick menu");
  values = await sendAndTexts("MB 賭城賽車 5碼", "user-smoke");
  assertIncludes(values, "冠軍、亞軍、季軍定位推薦", "MB analysis");
  assertIncludes(values, "最近 3 場開獎", "MB track data");
  assertIncludes(values, "202607240002", "MB track latest result");
  const mbAnalysisMessage = captured.replies[captured.replies.length - 1].messages[0];
  const mbAnalysisJson = JSON.stringify(mbAnalysisMessage);
  const regularChipWidths = (mbAnalysisJson.match(/"width":"25px"/g) || []).length;
  if (regularChipWidths !== 15 || mbAnalysisJson.includes('"width":"20px","height":"25px"')) {
    throw new Error("MB recommendation number chips must use a consistent size");
  }

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
  assertIncludes(values, "冠軍、亞軍、三名定位推薦", "ATG top-three analysis");
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
