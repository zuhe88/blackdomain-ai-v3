const Module = require("module");
const path = require("path");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ATG_DISABLE_LIVE = "true";
process.env.DG_DISABLE_LIVE = "true";
process.env.MT_DISABLE_LIVE = "true";

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
    like(field, value) { filters.push({ field, value }); return chain; },
    update(payload) { updated = payload; return chain; },
    insert(payload) { inserted = payload; return chain; },
    upsert(payload) { inserted = payload; return chain; },
    delete() { updated = { deleted: true }; return chain; },
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
const dgSource = require("../modules/baccarat/dgSource");
const dgLive = require("../modules/baccarat/dgLive");
const mtSource = require("../modules/baccarat/mtSource");
const mtLive = require("../modules/baccarat/mtLive");
const { userscript: baccaratRelayUserscript } = require("../routes/dgRelay");
const { predict: predictBaccarat } = require("../modules/baccarat/ai");

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

function protobufVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function protobufVarintField(field, value) {
  return Buffer.concat([protobufVarint(field * 8), protobufVarint(value)]);
}

function protobufBytesField(field, value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return Buffer.concat([protobufVarint((field * 8) + 2), protobufVarint(content.length), content]);
}

function dgSnapshotFrame() {
  const table = Buffer.concat([
    protobufVarintField(1, 0),
    protobufVarintField(2, 12345),
    protobufVarintField(3, 67),
    protobufVarintField(4, 1),
    protobufVarintField(5, 18),
    protobufBytesField(10, "65#1#0#0"),
    protobufBytesField(10, "66#5#0#0"),
    protobufBytesField(10, "67#9#0#0"),
    protobufBytesField(13, "自營桌 RB01"),
    protobufVarintField(18, 1),
  ]);
  return Buffer.concat([
    protobufVarintField(1, 27),
    protobufBytesField(17, table),
  ]).toString("base64");
}

async function main() {
  const encryptedDgToken = dgLive.encrypt("0123456789abcdef0123456789abcdef");
  if (!encryptedDgToken || encryptedDgToken === "0123456789abcdef0123456789abcdef") {
    throw new Error("DG guest WebSocket token must be encrypted");
  }
  if (dgLive.getStatus().enabled) throw new Error("DG live connection must be disabled in smoke tests");
  if (mtLive.getStatus().enabled) throw new Error("MT live connection must be disabled in smoke tests");

  dgSource.resetForTest();
  if (!dgSource.ingestFrame(dgSnapshotFrame())) throw new Error("DG protobuf snapshot must be accepted");
  const dgTable = dgSource.getTableByRoom("RB01");
  if (!dgTable || dgTable.tableId !== 0 || dgTable.history.length !== 3) {
    throw new Error("DG table snapshot was not decoded correctly");
  }
  if (dgTable.history.map((record) => record.result).join("") !== "莊閒和") {
    throw new Error("DG baccarat road results were not normalized correctly");
  }
  const newestFirstRoad = dgSource.normalizeHistory(["#5#0#8", "#1#0#7"], "shoe");
  if (newestFirstRoad.map((record) => record.result).join("") !== "莊閒") {
    throw new Error("DG newest-first baccarat roads must be converted to chronological order");
  }
  if (predictBaccarat(["莊", "莊", "莊"]) !== "莊" || predictBaccarat(["閒", "閒", "閒"]) !== "閒") {
    throw new Error("Baccarat prediction must support both banker and player recommendations");
  }
  let firstRoundEvent = null;
  const stopFirstRoundListener = dgSource.onResult((result) => {
    if (result.room === "RB02") firstRoundEvent = result;
  });
  dgSource.ingestMessage({
    cmd: 27,
    table: [{ tableId: 2, tableName: "RB02", shoeId: 1, roads: [] }],
  });
  dgSource.ingestMessage({ cmd: 1004, tableId: 2, list: ["#5#0#8"] });
  stopFirstRoundListener();
  if (!firstRoundEvent || firstRoundEvent.result !== "閒") {
    throw new Error("DG first round must emit an automatic settlement event immediately");
  }
  dgSource.ingestMessage({
    cmd: 1002,
    table: [{ tableId: 2, tableName: "RB02", shoeId: 2, roads: [] }],
  });
  if (dgSource.getTableByRoom("RB02")?.history.length !== 0) {
    throw new Error("DG new shoe must clear the previous shoe road history");
  }
  for (const [tableId, tableName] of [
    [801, "龍虎 RD01"],
    [802, "輪盤 RR01"],
    [803, "輪盤 S08"],
    [804, "骰寶 RS01"],
  ]) {
    if (dgSource.ingestMessage({ cmd: 27, table: [{ tableId, tableName }] })) {
      throw new Error(`DG non-baccarat table ${tableName} must be rejected`);
    }
  }
  if (dgSource.getSnapshot().tables.some((table) => ["RD01", "RR01", "S08", "RS01"].includes(table.room))) {
    throw new Error("DG non-baccarat tables must not appear in snapshots");
  }

  mtSource.resetForTest();
  let mtFirstRoundEvent = null;
  const stopMtListener = mtSource.onResult((result) => {
    if (result.room === "MT01") mtFirstRoundEvent = result;
  });
  if (!mtSource.ingestTables({
    1: {
      table_id: 1,
      table_name: "百家樂 1",
      table_type: "BAC",
      shoe: 88,
      trend: {
        bead_plate2: "0102#03",
        total_round_banker: 1,
        total_round_player: 1,
        total_round_tie: 1,
      },
    },
    2: {
      table_id: 2,
      table_name: "龍虎 2",
      table_type: "DT",
      trend: { bead_plate2: "01" },
    },
    3: {
      table_id: 3,
      table_name: "骰寶 3",
      table_type: "SB",
      trend: { bead_plate2: "01" },
    },
    4: {
      table_id: 4,
      table_name: "牛牛 5",
      table_type: "NU",
      trend: { bead_plate2: "01" },
    },
  })) throw new Error("MT baccarat table snapshot must be accepted");
  stopMtListener();
  const mtTable = mtSource.getTableByRoom("MT01");
  if (!mtTable || mtTable.history.map((record) => record.result).join("") !== "閒莊和") {
    throw new Error("MT baccarat bead plate must normalize player, banker, and tie");
  }
  if (!mtFirstRoundEvent || mtFirstRoundEvent.result !== "和") {
    throw new Error("MT first received result must emit automatic settlement immediately");
  }
  const mtStats = mtSource.getRoomStats("MT01");
  if (mtStats.banker !== 1 || mtStats.player !== 1 || mtStats.tie !== 1 || mtStats.total !== 3) {
    throw new Error("MT room statistics must use the current baccarat table totals");
  }
  if (mtSource.getSnapshot().tables.some((table) => ["DT", "SB", "NU"].includes(table.tableType))) {
    throw new Error("MT dragon tiger, sic bo, and bull tables must be excluded");
  }
  mtSource.ingestTables([{
    table_id: 1,
    table_name: "百家樂 1",
    table_type: "BAC",
    shoe: 89,
    trend: {
      bead_plate2: "02",
      total_round_banker: 1,
      total_round_player: 0,
      total_round_tie: 0,
    },
  }]);
  if (mtSource.getTableByRoom("MT01")?.history.length !== 1) {
    throw new Error("MT new shoe must replace the previous shoe road history");
  }

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
  if (!captured.routes.get.some((route) => route.route === "/dg-relay.user.js")) {
    throw new Error("DG relay userscript route is not registered");
  }
  if (!captured.routes.get.some((route) => route.route === "/api/dg/status")) {
    throw new Error("DG status route is not registered");
  }
  if (!captured.routes.get.some((route) => route.route === "/api/mt/status")) {
    throw new Error("MT status route is not registered");
  }
  if (!captured.routes.post.some((route) => route.route === "/api/dg/ingest")) {
    throw new Error("DG ingest route is not registered");
  }
  if (!captured.routes.post.some((route) => route.route === "/api/mt/ingest")) {
    throw new Error("MT ingest route is not registered");
  }
  const baccaratRelayScript = baccaratRelayUserscript("https://example.com");
  for (const expected of [
    "@match        *://gsa.ofalive99.net/*",
    "/api/mt/ingest",
    'table?.table_type === "BAC"',
    "total_round_banker",
  ]) {
    if (!baccaratRelayScript.includes(expected)) {
      throw new Error(`Baccarat relay userscript is missing MT support: ${expected}`);
    }
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

  const homeReply = await send("首頁", "user-smoke");
  values = homeReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "彩票AI", "Main menu lottery entry");
  assertIncludes(values, "ATG賽馬、MB彈珠與今彩539", "Main menu lottery description");

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
  if (firstAtgGame?.hero?.action?.text !== "戰神賽特1") {
    throw new Error("ATG electronic menu must begin with Seth 1");
  }
  values = atgGameMenuReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "戰神賽特1", "ATG combined game menu");
  if (values.some((value) => String(value).includes("ATG賽馬"))) {
    throw new Error("ATG horse must only appear inside the lottery menu");
  }

  const lotteryMenuReply = await send("彩票", "user-smoke");
  values = lotteryMenuReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "ATG賽馬", "Lottery game menu");
  assertIncludes(values, "系統維護中", "ATG maintenance status");
  assertIncludes(values, "MB彈珠", "Lottery game menu");
  assertIncludes(values, "今彩539", "Lottery game menu");
  const lotteryCards = lotteryMenuReply.messages[0]?.contents?.contents || [];
  const lotteryActions = lotteryCards.map((item) => item.hero?.action?.text);
  if (lotteryActions.join(",") !== "ATG賽馬 維護中,MB彈珠,539") {
    throw new Error(`Lottery menu has incorrect game order: ${lotteryActions.join(",")}`);
  }
  if (!lotteryCards[0]?.hero?.url?.includes("atg-horse-hd.webp")) {
    throw new Error("ATG maintenance card must keep the original horse image");
  }
  if (!lotteryCards[2]?.hero?.url?.includes("lottery539-hd.webp")) {
    throw new Error("Lottery 539 card must use the enhanced image");
  }

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
  await send("RB01", "user-smoke");
  values = await sendAndTexts("自由配注", "user-smoke");
  assertIncludes(values, "本房牌路統計", "Baccarat room statistics");
  assertIncludes(values, "等待本房下一局開獎", "Baccarat automatic settlement");
  const dgAutoMessage = captured.replies[captured.replies.length - 1].messages[0];
  const dgAutoJson = JSON.stringify(dgAutoMessage);
  for (const color of ["#D71920", "#1464D2", "#278A18", "#9A6728"]) {
    if (!dgAutoJson.includes(color)) throw new Error(`Baccarat room statistics missing color ${color}`);
  }
  if (collectActions(dgAutoMessage).some((action) => ["莊", "閒", "和"].includes(action.text))) {
    throw new Error("DG automatic settlement must not show manual result buttons");
  }
  const pushesBeforeDgResult = captured.pushes.length;
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: ["#1#0#0", "#9#0#0", "#5#0#0", "#1#0#0"],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeDgResult + 1) {
    throw new Error("DG result must automatically push the next analysis");
  }
  let dgPushTexts = captured.pushes[captured.pushes.length - 1].messages.flatMap((message) => collectText(message));
  assertIncludes(dgPushTexts, "過 1", "Baccarat automatic pass result");

  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: ["#9#0#0", "#1#0#0", "#9#0#0", "#5#0#0", "#1#0#0"],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dgPushTexts = captured.pushes[captured.pushes.length - 1].messages.flatMap((message) => collectText(message));
  assertIncludes(dgPushTexts, "過 1　倒 0　和 1", "Baccarat automatic tie result");

  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: ["#1#0#0", "#9#0#0", "#1#0#0", "#9#0#0", "#5#0#0", "#1#0#0"],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dgPushTexts = captured.pushes[captured.pushes.length - 1].messages.flatMap((message) => collectText(message));
  assertIncludes(dgPushTexts, "過 1　倒 1　和 1", "Baccarat automatic failed result");
  if (dgPushTexts.some((value) => String(value).includes("上局結算"))) {
    throw new Error("Baccarat Flex must not show the previous-round settlement row");
  }

  values = await sendAndTexts("重新開始", "user-smoke");
  assertIncludes(values, "DG 房號選擇", "Baccarat restart returns to current platform rooms");
  values = await sendAndTexts("返回首頁", "user-smoke");
  assertIncludes(values, "DG 百家樂AI", "Baccarat home returns to platform selection");
  assertIncludes(values, "MT 百家樂AI", "Baccarat home returns to platform selection");

  await send("百家樂", "user-smoke");
  values = await sendAndTexts("MT", "user-smoke");
  assertIncludes(values, "MT01", "MT baccarat rooms");
  values = await sendAndTexts("MT01", "user-smoke");
  assertIncludes(values, "請選擇分析模式", "MT baccarat mode flow");
  assertIncludes(values, "自由配注", "MT baccarat mode flow");
  values = await sendAndTexts("自由配注", "user-smoke");
  assertIncludes(values, "自動結算", "MT baccarat automatic settlement");
  const pushesBeforeMtResult = captured.pushes.length;
  mtSource.ingestTables([{
    table_id: 1,
    table_name: "百家樂 1",
    table_type: "BAC",
    shoe: 89,
    trend: {
      bead_plate2: "0201",
      total_round_banker: 1,
      total_round_player: 1,
      total_round_tie: 0,
    },
  }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeMtResult + 1) {
    throw new Error("MT live result must automatically push the next analysis");
  }
  const mtPushTexts = captured.pushes[captured.pushes.length - 1].messages
    .flatMap((message) => collectText(message));
  const mtPushSummary = mtPushTexts.join(" | ");
  if (!mtPushSummary.includes("莊 | 1 | 閒 | 1 | 和 | 0 | 總 | 2")) {
    throw new Error(`MT live room statistics are incorrect: ${mtPushSummary}`);
  }
  if (mtPushTexts.some((value) => String(value).includes("上局結算"))) {
    throw new Error("MT baccarat Flex must not show the previous-round settlement row");
  }

  values = await sendAndTexts("體育", "user-smoke");
  assertIncludes(values, "CPBL", "Sports menu");

  values = await sendAndTexts("CPBL", "user-smoke");
  assertIncludes(values, "AI預測勝方", "Sports analysis");

  values = await sendAndTexts("ATG賽馬", "user-smoke");
  assertIncludes(values, "目前維護中", "ATG maintenance reply");
  values = await sendAndTexts("ATG賽馬 維護中", "user-smoke");
  assertIncludes(values, "服務暫停開放", "ATG maintenance card action");

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
