const Module = require("module");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

process.env.WEB_SESSION_SECRET = "test-web-session-secret";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.NODE_ENV = "test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.DG_DISABLE_LIVE = "true";
process.env.MT_DISABLE_LIVE = "true";
process.env.LINE_HTTP_TIMEOUT_MS = "4321";
process.env.ELECTRONIC_PENDING_TIMEOUT_MS = "5000";

const captured = {
  replies: [],
  pushes: [],
  multicasts: [],
  routes: { use: [], get: [], post: [], static: [] },
};
const mockBaccaratRows = new Map();
const mockElectronicRows = new Map();
const mockSupabaseControl = {
  cancellationAttempts: 0,
  cancellationFailuresRemaining: 0,
};
let mockGlobalAiAccessRow = null;
const mockLineControl = {
  pushGate: null,
  pushFailuresRemaining: 0,
};

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
  constructor(config) {
    this.config = config;
    this.http = { instance: { defaults: { timeout: 0 } } };
    captured.lineClient = this;
  }

  async replyMessage(replyToken, messages) { captured.replies.push({ replyToken, messages }); }
  async pushMessage(userId, messages) {
    if (mockLineControl.pushFailuresRemaining > 0) {
      mockLineControl.pushFailuresRemaining -= 1;
      throw new Error("mock LINE push failure");
    }
    const gate = mockLineControl.pushGate;
    if (gate) {
      gate.events.push("push-start");
      gate.startedAt = Date.now();
      gate.started.resolve();
      await gate.release.promise;
      gate.events.push("push-delivered");
      if (mockLineControl.pushGate === gate) mockLineControl.pushGate = null;
    }
    captured.pushes.push({ userId, messages });
  }
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
      if (table === "lottery_settings") {
        const insertedKey = String(inserted?.key || "");
        const keyFilter = String(filters.find((item) => item.field === "key")?.value || "");
        if (updated?.deleted && keyFilter.startsWith("electronic_")) {
          mockElectronicRows.delete(keyFilter);
          resolve({ data: [], error: null });
          return;
        }
        if (insertedKey.startsWith("electronic_")) {
          const row = { ...inserted, id: insertedKey };
          mockElectronicRows.set(insertedKey, row);
          resolve({ data: [row], error: null });
          return;
        }
        if (keyFilter.startsWith("electronic_pending:") && keyFilter.endsWith("%")) {
          const prefix = keyFilter.slice(0, -1);
          resolve({
            data: [...mockElectronicRows.entries()]
              .filter(([key]) => key.startsWith(prefix))
              .map(([, row]) => row),
            error: null,
          });
          return;
        }
        if (insertedKey.startsWith("baccarat_session:")) {
          if (inserted?.value?.cancelled) {
            mockSupabaseControl.cancellationAttempts += 1;
            if (mockSupabaseControl.cancellationFailuresRemaining > 0) {
              mockSupabaseControl.cancellationFailuresRemaining -= 1;
              resolve({ data: null, error: new Error("mock cancellation write failure") });
              return;
            }
          }
          const row = { ...inserted, id: insertedKey };
          mockBaccaratRows.set(insertedKey, row);
          resolve({ data: [row], error: null });
          return;
        }
        const likeKey = filters.find((item) => item.field === "key")?.value;
        if (String(likeKey || "").startsWith("baccarat_session:")) {
          resolve({ data: [...mockBaccaratRows.values()], error: null });
          return;
        }
      }
      resolve({ data: rowsForTable(table, filters, inserted, updated), error: null });
    },
  };
  return chain;
}

function rowsForTable(table, filters, inserted, updated) {
  if (table === "lottery_settings") {
    const keyFilter = filters.find((item) => item.field === "key")?.value;
    if (keyFilter && mockElectronicRows.has(keyFilter)) {
      return [mockElectronicRows.get(keyFilter)];
    }
    if (inserted?.key === "global_ai_access_override") {
      mockGlobalAiAccessRow = { ...inserted, id: "global-ai-access" };
      return [mockGlobalAiAccessRow];
    }
    if (keyFilter === "global_ai_access_override") {
      return mockGlobalAiAccessRow ? [mockGlobalAiAccessRow] : [];
    }
  }
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
const webChannel = require("../services/webChannel");
const {
  image,
  lineClient,
  lineConfig,
  multicast,
  push,
} = require("../services/line");
const mbSource = require("../modules/mb/source");
const { buildAnalysis: buildMbAnalysis } = require("../modules/mb/service");
const { mbAnalysisFlex } = require("../modules/mb/flex");
const dgSource = require("../modules/baccarat/dgSource");
const dgLive = require("../modules/baccarat/dgLive");
const mtSource = require("../modules/baccarat/mtSource");
const mtLive = require("../modules/baccarat/mtLive");
const baccaratModule = require("../modules/baccarat");
const {
  getSession: getBaccaratSession,
  hasActiveSession: hasActiveBaccaratSession,
  resetSession: resetBaccaratSession,
  setSession: setBaccaratSession,
} = require("../modules/baccarat/session");
const electronic = require("../modules/electronic");
const electronicSource = require("../modules/electronic/source");
const featureAudit = require("../modules/electronic/featureAudit");
const expectedElectronicGames = ["戰神賽特1", "戰神賽特2", "古神巴風特", "虎小妹", "赤三國"];
if (JSON.stringify(electronicSource.GAME_NAMES) !== JSON.stringify(expectedElectronicGames)) {
  throw new Error("Electronic live source must expose all five ATG games");
}
electronicSource.GAME_NAMES.forEach((gameName) => {
  electronicSource.setMinimumReadyTablesForTest(gameName, 1);
});
const electronicSourceCode = fs.readFileSync(
  path.join(__dirname, "..", "modules", "electronic", "source.js"),
  "utf8",
);
if (!electronicSourceCode.includes("fullScanIsFresh && state.tables.size >= minimumTables")) {
  throw new Error("Electronic partial room segments must never become recommendation-ready data");
}
const { userscript: baccaratRelayUserscript } = require("../routes/dgRelay");
const {
  analyzePrediction: analyzeBaccarat,
  calculateBet: calculateBaccaratBet,
  firstAnalysis: firstBaccaratAnalysis,
  getTianmenRequirements,
  nextAnalysis: nextBaccaratAnalysis,
  predict: predictBaccarat,
} = require("../modules/baccarat/ai");
const { baccaratAnalysisFlex } = require("../ui/flex/baccarat");

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

function findNode(value, predicate) {
  if (!value || typeof value !== "object") return null;
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findNode(item, predicate);
        if (found) return found;
      }
    } else if (child && typeof child === "object") {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function assertBaccaratRecord(message, expected, label) {
  const panel = findNode(
    message,
    (node) => node.layout === "vertical"
      && Array.isArray(node.contents)
      && node.contents.some(
        (item) => item?.layout === "horizontal"
          && item.contents?.some((child) => child?.text === "推薦紀錄"),
      ),
  );
  const recordRow = panel?.contents?.find(
    (node) => node.layout === "horizontal"
      && node.contents?.length === 4
      && node.contents.every((item) => item?.layout === "vertical"),
  );
  const actual = Object.fromEntries(
    (recordRow?.contents || []).map((item) => [
      item.contents?.[1]?.text,
      Number(item.contents?.[0]?.text),
    ]),
  );
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${label} expected ${key} ${value}; got ${JSON.stringify(actual)}`);
    }
  }
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
  process.env.NODE_ENV = "test";
  process.env.LINE_WEBSITE_ONLY_MODE = "false";
  await lineClient.getProfile("line-timeout-smoke");
  if (
    lineConfig.httpConfig.timeout !== 4321
    || captured.lineClient?.http?.instance?.defaults?.timeout !== 4321
  ) {
    throw new Error("LINE SDK Axios timeout must be applied to the live HTTP instance");
  }
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
  if (
    !dgSource.isRoomFresh("RB01", Date.now(), 15_000)
    || dgSource.isRoomFresh("RB01", Date.now() + 16_000, 15_000)
  ) {
    throw new Error("DG freshness guard must reject expired table snapshots");
  }
  const newestFirstRoad = dgSource.normalizeHistory(["#5#0#8", "#1#0#7"], "shoe");
  if (newestFirstRoad.map((record) => record.result).join("") !== "莊閒") {
    throw new Error("DG newest-first baccarat roads must be converted to chronological order");
  }
  if (
    predictBaccarat([]) !== "觀望"
    || predictBaccarat(["莊"]) !== "觀望"
    || predictBaccarat(["莊", "莊"]) !== "莊"
    || predictBaccarat(["閒", "閒"]) !== "閒"
  ) {
    throw new Error("Baccarat must derive its direction from at least two settled non-tie rounds");
  }
  const bankerSignal = analyzeBaccarat(Array(12).fill("莊"));
  const playerSignal = analyzeBaccarat(Array(12).fill("閒"));
  const alternatingSignal = analyzeBaccarat(["莊", "閒", "莊", "閒"]);
  const tiedSignal = analyzeBaccarat(["莊", "莊", "閒"]);
  const weakSignalHistory = ["閒", "莊", "閒", "莊", "莊", "閒", "閒", "莊"];
  const weakSignal = analyzeBaccarat(weakSignalHistory);
  const normalizedObjectSignal = analyzeBaccarat([
    { result: "莊" },
    { result: "和" },
    { result: "閒" },
  ]);
  if (
    bankerSignal.prediction !== "莊"
    || playerSignal.prediction !== "閒"
    || alternatingSignal.prediction !== "莊"
    || tiedSignal.prediction !== "觀望"
    || weakSignal.prediction !== "觀望"
    || weakSignal.reasonCode !== "RECENT_SIGNAL_WEAK"
    || normalizedObjectSignal.prediction !== predictBaccarat(["莊", "閒"])
    || normalizedObjectSignal.sampleSize !== 2
    || bankerSignal.modelVersion !== "baccarat-recent-road-v4"
    || bankerSignal.sampleSize !== 8
    || bankerSignal.historySize !== 12
    || bankerSignal.reasonCode !== "RECENT_STREAK"
    || playerSignal.reasonCode !== "RECENT_STREAK"
    || alternatingSignal.reasonCode !== "RECENT_ALTERNATION"
    || tiedSignal.reasonCode !== "RECENT_SIGNAL_TIED"
  ) {
    throw new Error("Baccarat predictor must follow deterministic recent-road signals without a banker bias");
  }
  for (let length = 2; length <= 8; length += 1) {
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      const sequence = Array.from(
        { length },
        (_, index) => ((mask >> index) & 1 ? "莊" : "閒"),
      );
      const mirrored = sequence.map((result) => (result === "莊" ? "閒" : "莊"));
      const originalSignal = analyzeBaccarat(sequence);
      const mirroredSignal = analyzeBaccarat(mirrored);
      const expectedMirror = originalSignal.prediction === "觀望"
        ? "觀望"
        : (originalSignal.prediction === "莊" ? "閒" : "莊");
      if (
        mirroredSignal.prediction !== expectedMirror
        || mirroredSignal.confidence !== originalSignal.confidence
        || mirroredSignal.reasonCode !== originalSignal.reasonCode
        || JSON.stringify(analyzeBaccarat(sequence)) !== JSON.stringify(originalSignal)
      ) {
        throw new Error(`Baccarat predictor lost mirror symmetry or determinism: ${sequence.join("")}`);
      }
    }
  }
  const weakBetAnalysis = firstBaccaratAnalysis({
    mode: "動態配注",
    history: weakSignalHistory,
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    bankroll: 10000,
    capital: 10000,
    maxBet: 2000,
    startBankroll: 10000,
    tianmenLevel: 1,
    lastPrediction: null,
    lastBet: 0,
  });
  if (weakBetAnalysis.prediction !== "觀望" || weakBetAnalysis.bet !== 0) {
    throw new Error("Baccarat weak recent-road signals must observe without placing a bet");
  }
  const observeSession = {
    mode: "天門",
    history: [],
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    bankroll: 5000,
    capital: 5000,
    maxBet: 1000,
    startBankroll: 5000,
    tianmenLevel: 1,
    lastPrediction: "觀望",
    lastBet: 0,
  };
  const observedRound = nextBaccaratAnalysis(observeSession, "莊");
  if (
    observedRound.session.results.observe !== 1
    || observedRound.session.results.pass !== 0
    || observedRound.session.results.fail !== 0
    || observedRound.session.bankroll !== 5000
    || observedRound.session.tianmenLevel !== 1
  ) {
    throw new Error("Baccarat observed rounds must not change pass/fail, bankroll, or Tianmen level");
  }
  const resolvedSession = {
    mode: "自由配注",
    history: Array(12).fill("莊"),
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    bankroll: null,
    capital: null,
    maxBet: null,
    startBankroll: null,
    tianmenLevel: 1,
    lastPrediction: null,
    lastBet: 0,
  };
  const issuedBanker = firstBaccaratAnalysis(resolvedSession);
  const resolvedBanker = nextBaccaratAnalysis(issuedBanker.session, "莊");
  if (issuedBanker.prediction !== "莊" || resolvedBanker.session.results.pass !== 1) {
    throw new Error("Baccarat qualified predictions must still settle normally");
  }
  if (calculateBaccaratBet({
    mode: "動態配注",
    bankroll: 50,
    capital: 50,
    maxBet: 50,
  }, "莊") !== 0) {
    throw new Error("Baccarat bet must not exceed a bankroll or limit below the minimum unit");
  }
  const insufficientBetAnalysis = firstBaccaratAnalysis({
    mode: "動態配注",
    history: Array(12).fill("莊"),
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    bankroll: 50,
    capital: 50,
    maxBet: 50,
    startBankroll: 50,
    tianmenLevel: 1,
    lastPrediction: null,
    lastBet: 0,
  });
  if (
    insufficientBetAnalysis.prediction !== "觀望"
    || insufficientBetAnalysis.bet !== 0
    || insufficientBetAnalysis.analysis.reasonCode !== "INSUFFICIENT_BET_LIMIT"
  ) {
    throw new Error("Baccarat analysis must observe when no safe wager fits the configured limits");
  }
  const minimumTianmen = getTianmenRequirements(5700);
  const belowMinimumTianmen = getTianmenRequirements(5699);
  if (
    !minimumTianmen.sufficientBankroll
    || minimumTianmen.baseBet !== 100
    || minimumTianmen.requiredMaxBet !== 3100
    || belowMinimumTianmen.sufficientBankroll
  ) {
    throw new Error("Tianmen must clearly require enough capital for all five 1-3-7-15-31 stages");
  }
  if (
    calculateBaccaratBet({
      mode: "天門",
      bankroll: 5600,
      capital: 5700,
      startBankroll: 5700,
      maxBet: 3100,
      tianmenLevel: 2,
    }, "莊") !== 300
    || calculateBaccaratBet({
      mode: "天門",
      bankroll: 3100,
      capital: 5700,
      startBankroll: 5700,
      maxBet: 3100,
      tianmenLevel: 5,
    }, "閒") !== 3100
  ) {
    throw new Error("Tianmen stages must keep the base wager derived from the starting bankroll");
  }
  const underfundedTianmen = firstBaccaratAnalysis({
    mode: "天門",
    history: Array(12).fill("莊"),
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    bankroll: 5000,
    capital: 5000,
    maxBet: 5000,
    startBankroll: 5000,
    tianmenLevel: 1,
    lastPrediction: null,
    lastBet: 0,
  });
  const cappedTianmen = firstBaccaratAnalysis({
    mode: "天門",
    history: Array(12).fill("莊"),
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    bankroll: 5700,
    capital: 5700,
    maxBet: 1000,
    startBankroll: 5700,
    tianmenLevel: 1,
    lastPrediction: null,
    lastBet: 0,
  });
  if (
    underfundedTianmen.prediction !== "觀望"
    || underfundedTianmen.analysis.reasonCode !== "INSUFFICIENT_TIANMEN_BANKROLL"
    || cappedTianmen.prediction !== "觀望"
    || cappedTianmen.analysis.reasonCode !== "INSUFFICIENT_TIANMEN_MAX_BET"
  ) {
    throw new Error("Tianmen must report insufficient funding instead of silently observing");
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
  if (
    !firstRoundEvent
    || firstRoundEvent.result !== "閒"
    || firstRoundEvent.isContinuous !== true
    || !firstRoundEvent.eventKey
    || firstRoundEvent.roundIndex !== 1
  ) {
    throw new Error("DG first round must emit an automatic settlement event immediately");
  }
  const dgOrderingEvents = [];
  const stopDgOrderingListener = dgSource.onResult((result) => {
    if (result.room === "RB03") dgOrderingEvents.push(result);
  });
  dgSource.ingestMessage({
    cmd: 27,
    table: [{ tableId: 3, tableName: "RB03", shoeId: 44, roads: [] }],
  });
  dgSource.ingestMessage({ cmd: 1004, tableId: 3, list: ["#1#0#0"] });
  dgSource.ingestMessage({ cmd: 1004, tableId: 3, list: ["#1#0#0"] });
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 3,
    list: ["#1#0#0", "#5#0#0", "#1#0#0"],
  });
  const rejectedDgRollback = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 3,
    list: ["#5#0#0", "#1#0#0"],
  });
  stopDgOrderingListener();
  if (
    rejectedDgRollback !== false
    || dgOrderingEvents.length !== 2
    || dgOrderingEvents[1].isContinuous !== false
    || dgOrderingEvents[1].resyncReason !== "round_gap"
    || dgOrderingEvents[1].history.length !== 3
    || dgSource.getTableByRoom("RB03")?.history.length !== 3
  ) {
    throw new Error("DG source must suppress duplicates/rollbacks and mark multi-round gaps for resync");
  }
  const dgRoad = (results) => results.map((result, index) => (
    `${index + 1}#${result === "莊" ? 1 : result === "閒" ? 5 : 9}#0`
  ));
  const oldDgShoe = ["莊", "閒", "莊", "莊", "閒", "閒", "莊", "閒", "莊", "閒", "莊", "閒"];
  const dgImplicitResetEvents = [];
  const stopDgImplicitResetListener = dgSource.onResult((result) => {
    if (result.room === "RB04") dgImplicitResetEvents.push(result);
  });
  dgSource.ingestMessage({
    cmd: 27,
    table: [{
      tableId: 41,
      tableName: "RB04",
      playId: 12,
      roads: dgRoad(oldDgShoe),
    }],
  });
  dgSource.ingestMessage({ cmd: 1004, tableId: 41, playId: 0, list: [] });
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 41,
    playId: 2,
    list: dgRoad(oldDgShoe.slice(0, 2)),
  });
  const rejectedDelayedDgShoe = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 41,
    playId: 13,
    list: dgRoad([...oldDgShoe, "莊"]),
  });
  stopDgImplicitResetListener();
  const dgImplicitResetEvent = dgImplicitResetEvents[dgImplicitResetEvents.length - 1];
  if (
    rejectedDelayedDgShoe !== false
    || dgImplicitResetEvent?.resyncReason !== "shoe_changed"
    || dgImplicitResetEvent?.isContinuous !== false
    || dgSource.getTableByRoom("RB04")?.history.length !== 2
  ) {
    throw new Error("DG implicit matching-prefix shoe resets must reject delayed old-shoe snapshots");
  }
  const dgCorrectionEvents = [];
  const stopDgCorrectionListener = dgSource.onResult((result) => {
    if (result.room === "RB05" || result.room === "RB06") dgCorrectionEvents.push(result);
  });
  dgSource.ingestMessage({
    cmd: 27,
    table: [{ tableId: 42, tableName: "RB05", roads: dgRoad(["莊", "閒"]) }],
  });
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 42,
    list: dgRoad(["莊", "莊"]),
  });
  dgSource.ingestMessage({
    cmd: 27,
    table: [{ tableId: 43, tableName: "RB06", roads: dgRoad(["莊", "莊"]) }],
  });
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 43,
    list: dgRoad(["閒", "莊", "閒"]),
  });
  stopDgCorrectionListener();
  const dgReplacementEvents = dgCorrectionEvents.filter((event) => (
    event.resyncReason === "snapshot_replaced"
  ));
  if (
    dgReplacementEvents.length !== 2
    || dgReplacementEvents.some((event) => event.isContinuous)
    || new Set(dgCorrectionEvents.map((event) => event.eventKey)).size !== dgCorrectionEvents.length
  ) {
    throw new Error("DG corrections and divergent appends must resync with unique event keys");
  }
  dgSource.ingestMessage({
    cmd: 27,
    table: [{
      tableId: 44,
      tableName: "RB07",
      shoeId: 100,
      roads: dgRoad(["莊", "閒"]),
    }],
  });
  dgSource.ingestMessage({
    cmd: 1002,
    table: [{
      tableId: 44,
      tableName: "RB07",
      shoeId: 101,
      roads: dgRoad(["閒"]),
    }],
  });
  const rejectedRetiredDgId = dgSource.ingestMessage({
    cmd: 1002,
    table: [{
      tableId: 44,
      tableName: "RB07",
      shoeId: 100,
      roads: dgRoad(["莊", "閒", "莊"]),
    }],
  });
  if (
    rejectedRetiredDgId !== false
    || String(dgSource.getTableByRoom("RB07")?.explicitShoeId) !== "101"
  ) {
    throw new Error("DG delayed retired explicit shoe IDs must be rejected");
  }
  const rollingPattern = Array.from(
    { length: 201 },
    (_, index) => ["莊", "閒", "和"][index % 3],
  );
  const dgRollingEvents = [];
  const stopDgRollingListener = dgSource.onResult((result) => {
    if (result.room === "S01") dgRollingEvents.push(result);
  });
  dgSource.ingestMessage({
    cmd: 27,
    table: [{
      tableId: 71,
      tableName: "S01",
      shoeId: 300,
      playId: 200,
      roads: dgRoad(rollingPattern.slice(0, 200)),
    }],
  });
  dgRollingEvents.length = 0;
  const acceptedDgRollingWindow = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 71,
    playId: 201,
    list: dgRoad(rollingPattern.slice(1)),
  });
  const rejectedDgRollingPredecessor = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 71,
    playId: 200,
    list: dgRoad(rollingPattern.slice(0, 200)),
  });
  stopDgRollingListener();
  const dgRollingTable = dgSource.getTableByRoom("S01");
  if (
    !acceptedDgRollingWindow
    || rejectedDgRollingPredecessor !== false
    || dgRollingEvents.length !== 1
    || dgRollingEvents[0].isContinuous !== true
    || dgRollingEvents[0].roundIndex !== 201
    || dgRollingEvents[0].previousEventKey !== "DG:71:300:g0:200"
    || dgRollingTable?.sourceRoundMarker !== 201
    || dgRollingTable?.history?.[0]?.roundIndex !== 2
    || dgRollingTable?.history?.[0]?.gameNo !== "2"
    || dgRollingTable?.history?.[199]?.gameNo !== "201"
  ) {
    throw new Error("DG rolling-200 windows must advance stable round and game identities");
  }
  const dgIdenticalRollingEvents = [];
  const stopDgIdenticalRollingListener = dgSource.onResult((result) => {
    if (result.room === "S02") dgIdenticalRollingEvents.push(result);
  });
  const identicalRollingRoad = Array(200).fill("莊");
  dgSource.ingestMessage({
    cmd: 27,
    table: [{
      tableId: 72,
      tableName: "S02",
      shoeId: 301,
      playId: 200,
      roads: dgRoad(identicalRollingRoad),
    }],
  });
  dgIdenticalRollingEvents.length = 0;
  const acceptedIdenticalDgWindow = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 72,
    playId: 201,
    list: dgRoad(identicalRollingRoad),
  });
  stopDgIdenticalRollingListener();
  if (
    !acceptedIdenticalDgWindow
    || dgIdenticalRollingEvents.length !== 1
    || dgIdenticalRollingEvents[0].roundIndex !== 201
    || dgIdenticalRollingEvents[0].isContinuous !== true
  ) {
    throw new Error("DG marker advances must disambiguate identical rolling-200 windows");
  }
  const dgMarkerFirstEvents = [];
  const stopDgMarkerFirstListener = dgSource.onResult((result) => {
    if (result.room === "S03") dgMarkerFirstEvents.push(result);
  });
  const dgMarkerFirstRoad = ["莊", "閒"];
  dgSource.ingestMessage({
    cmd: 27,
    table: [{
      tableId: 73,
      tableName: "S03",
      shoeId: 302,
      playId: 2,
      roads: dgRoad(dgMarkerFirstRoad),
    }],
  });
  dgMarkerFirstEvents.length = 0;
  const acceptedDgMarkerOnly = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 73,
    playId: 3,
    list: dgRoad(dgMarkerFirstRoad),
  });
  const acceptedDgMarkerResult = dgSource.ingestMessage({
    cmd: 1004,
    tableId: 73,
    playId: 3,
    list: dgRoad([...dgMarkerFirstRoad, "和"]),
  });
  stopDgMarkerFirstListener();
  const dgMarkerFirstTable = dgSource.getTableByRoom("S03");
  if (
    !acceptedDgMarkerOnly
    || !acceptedDgMarkerResult
    || dgMarkerFirstEvents.length !== 1
    || dgMarkerFirstEvents[0].roundIndex !== 3
    || dgMarkerFirstEvents[0].isContinuous !== true
    || dgMarkerFirstTable?.shoeGeneration !== 0
  ) {
    throw new Error("DG marker-first updates must wait for the actual road result");
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
  if (
    !mtSource.isTimestampFresh(mtTable.updatedAt, Date.now(), 15_000)
    || mtSource.isTimestampFresh(mtTable.updatedAt, Date.now() + 16_000, 15_000)
  ) {
    throw new Error("MT freshness guard must reject expired table snapshots");
  }
  if (
    !mtFirstRoundEvent
    || mtFirstRoundEvent.result !== "和"
    || mtFirstRoundEvent.isContinuous !== false
    || mtFirstRoundEvent.resyncReason !== "initial_snapshot"
    || mtFirstRoundEvent.previousEventKey !== null
  ) {
    throw new Error("MT initial snapshot must emit a metadata-rich resync event");
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
  const mtOrderingEvents = [];
  const stopMtOrderingListener = mtSource.onResult((result) => {
    if (result.room === "MT02") mtOrderingEvents.push(result);
  });
  mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "stable-shoe",
    trend: { bead_plate2: "" },
  }]);
  mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "stable-shoe",
    trend: { bead_plate2: "01" },
  }]);
  mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "stable-shoe",
    trend: { bead_plate2: "01" },
  }]);
  mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "stable-shoe",
    trend: { bead_plate2: "0102#03" },
  }]);
  const rejectedMtRollback = mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "stable-shoe",
    trend: { bead_plate2: "0102" },
  }]);
  mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "next-shoe",
    trend: { bead_plate2: "02" },
  }]);
  const rejectedRetiredMtId = mtSource.ingestTables([{
    table_id: 22,
    table_name: "百家樂 2",
    table_type: "BAC",
    shoe: "stable-shoe",
    trend: { bead_plate2: "0102#0301" },
  }]);
  stopMtOrderingListener();
  if (
    rejectedMtRollback !== false
    || rejectedRetiredMtId !== false
    || mtOrderingEvents.length !== 3
    || mtOrderingEvents[0].isContinuous !== true
    || mtOrderingEvents[1].resyncReason !== "round_gap"
    || mtOrderingEvents[2].resyncReason !== "shoe_changed"
    || new Set(mtOrderingEvents.map((event) => event.eventKey)).size !== 3
  ) {
    throw new Error("MT source must suppress duplicates/rollbacks and mark gaps/new shoes for resync");
  }
  const mtBead = (results) => results.map((result) => (
    result === "莊" ? "02" : result === "閒" ? "01" : "03"
  )).join("");
  const oldMtShoe = ["莊", "閒", "莊", "莊", "閒", "閒", "莊", "閒", "莊", "閒", "莊", "閒"];
  const mtImplicitEvents = [];
  const stopMtImplicitListener = mtSource.onResult((result) => {
    if (result.room === "MT03") mtImplicitEvents.push(result);
  });
  mtSource.ingestTables([{
    table_id: 33,
    table_name: "百家樂 3",
    table_type: "BAC",
    round: 12,
    trend: { bead_plate2: mtBead(oldMtShoe) },
  }]);
  mtSource.ingestTables([{
    table_id: 33,
    table_name: "百家樂 3",
    table_type: "BAC",
    round: 0,
    trend: { bead_plate2: "" },
  }]);
  mtSource.ingestTables([{
    table_id: 33,
    table_name: "百家樂 3",
    table_type: "BAC",
    round: 2,
    trend: { bead_plate2: mtBead(oldMtShoe.slice(0, 2)) },
  }]);
  const rejectedDelayedMtShoe = mtSource.ingestTables([{
    table_id: 33,
    table_name: "百家樂 3",
    table_type: "BAC",
    round: 13,
    trend: { bead_plate2: mtBead([...oldMtShoe, "莊"]) },
  }]);
  stopMtImplicitListener();
  const mtImplicitResetEvent = mtImplicitEvents[mtImplicitEvents.length - 1];
  if (
    rejectedDelayedMtShoe !== false
    || mtImplicitResetEvent?.resyncReason !== "shoe_changed"
    || mtImplicitResetEvent?.isContinuous !== false
    || mtSource.getTableByRoom("MT03")?.history.length !== 2
  ) {
    throw new Error("MT implicit matching-prefix shoe resets must reject delayed old-shoe snapshots");
  }
  const mtCorrectionEvents = [];
  const stopMtCorrectionListener = mtSource.onResult((result) => {
    if (result.room === "MT05" || result.room === "MT06") mtCorrectionEvents.push(result);
  });
  mtSource.ingestTables([{
    table_id: 55,
    table_name: "百家樂 5",
    table_type: "BAC",
    trend: { bead_plate2: mtBead(["莊", "閒"]) },
  }]);
  mtSource.ingestTables([{
    table_id: 55,
    table_name: "百家樂 5",
    table_type: "BAC",
    trend: { bead_plate2: mtBead(["莊", "莊"]) },
  }]);
  mtSource.ingestTables([{
    table_id: 66,
    table_name: "百家樂 6",
    table_type: "BAC",
    trend: { bead_plate2: mtBead(["莊", "莊"]) },
  }]);
  mtSource.ingestTables([{
    table_id: 66,
    table_name: "百家樂 6",
    table_type: "BAC",
    trend: { bead_plate2: mtBead(["閒", "莊", "閒"]) },
  }]);
  stopMtCorrectionListener();
  const mtReplacementEvents = mtCorrectionEvents.filter((event) => (
    event.resyncReason === "snapshot_replaced"
  ));
  if (
    mtReplacementEvents.length !== 2
    || mtReplacementEvents.some((event) => event.isContinuous)
    || new Set(mtCorrectionEvents.map((event) => event.eventKey)).size !== mtCorrectionEvents.length
  ) {
    throw new Error("MT corrections and divergent appends must resync with unique event keys");
  }
  const mtRollingEvents = [];
  const stopMtRollingListener = mtSource.onResult((result) => {
    if (result.room === "MT08") mtRollingEvents.push(result);
  });
  mtSource.ingestTables([{
    table_id: 88,
    table_name: "MT08",
    table_type: "BAC",
    shoe: "mt-rolling-300",
    round: 200,
    trend: { bead_plate2: mtBead(rollingPattern.slice(0, 200)) },
  }]);
  mtRollingEvents.length = 0;
  const acceptedMtRollingWindow = mtSource.ingestTables([{
    table_id: 88,
    table_name: "MT08",
    table_type: "BAC",
    shoe: "mt-rolling-300",
    round: 201,
    trend: { bead_plate2: mtBead(rollingPattern.slice(1)) },
  }]);
  const rejectedMtRollingPredecessor = mtSource.ingestTables([{
    table_id: 88,
    table_name: "MT08",
    table_type: "BAC",
    shoe: "mt-rolling-300",
    round: 200,
    trend: { bead_plate2: mtBead(rollingPattern.slice(0, 200)) },
  }]);
  stopMtRollingListener();
  const mtRollingTable = mtSource.getTableByRoom("MT08");
  if (
    !acceptedMtRollingWindow
    || rejectedMtRollingPredecessor !== false
    || mtRollingEvents.length !== 1
    || mtRollingEvents[0].isContinuous !== true
    || mtRollingEvents[0].roundIndex !== 201
    || mtRollingEvents[0].previousEventKey !== "MT:88:mt-rolling-300:g0:200"
    || mtRollingTable?.sourceRoundMarker !== 201
    || mtRollingTable?.history?.[0]?.roundIndex !== 2
    || mtRollingTable?.history?.[0]?.gameNo !== "mt-rolling-300:2"
    || mtRollingTable?.history?.[199]?.gameNo !== "mt-rolling-300:201"
  ) {
    throw new Error("MT rolling-200 windows must advance stable round and game identities");
  }
  const mtIdenticalRollingEvents = [];
  const stopMtIdenticalRollingListener = mtSource.onResult((result) => {
    if (result.room === "MT09") mtIdenticalRollingEvents.push(result);
  });
  const identicalMtRoad = Array(200).fill("莊");
  mtSource.ingestTables([{
    table_id: 89,
    table_name: "MT09",
    table_type: "BAC",
    shoe: "mt-rolling-301",
    round: 200,
    trend: { bead_plate2: mtBead(identicalMtRoad) },
  }]);
  mtIdenticalRollingEvents.length = 0;
  const acceptedIdenticalMtWindow = mtSource.ingestTables([{
    table_id: 89,
    table_name: "MT09",
    table_type: "BAC",
    shoe: "mt-rolling-301",
    round: 201,
    trend: { bead_plate2: mtBead(identicalMtRoad) },
  }]);
  stopMtIdenticalRollingListener();
  if (
    !acceptedIdenticalMtWindow
    || mtIdenticalRollingEvents.length !== 1
    || mtIdenticalRollingEvents[0].roundIndex !== 201
    || mtIdenticalRollingEvents[0].isContinuous !== true
  ) {
    throw new Error("MT marker advances must disambiguate identical rolling-200 windows");
  }
  const mtMarkerFirstEvents = [];
  const stopMtMarkerFirstListener = mtSource.onResult((result) => {
    if (result.room === "MT10") mtMarkerFirstEvents.push(result);
  });
  const mtMarkerFirstRoad = ["莊", "閒"];
  mtSource.ingestTables([{
    table_id: 90,
    table_name: "MT10",
    table_type: "BAC",
    shoe: "mt-marker-first",
    round: 2,
    trend: { bead_plate2: mtBead(mtMarkerFirstRoad) },
  }]);
  mtMarkerFirstEvents.length = 0;
  const acceptedMtMarkerOnly = mtSource.ingestTables([{
    table_id: 90,
    table_name: "MT10",
    table_type: "BAC",
    shoe: "mt-marker-first",
    round: 3,
    trend: { bead_plate2: mtBead(mtMarkerFirstRoad) },
  }]);
  const acceptedMtMarkerResult = mtSource.ingestTables([{
    table_id: 90,
    table_name: "MT10",
    table_type: "BAC",
    shoe: "mt-marker-first",
    round: 3,
    trend: { bead_plate2: mtBead([...mtMarkerFirstRoad, "和"]) },
  }]);
  stopMtMarkerFirstListener();
  const mtMarkerFirstTable = mtSource.getTableByRoom("MT10");
  if (
    !acceptedMtMarkerOnly
    || !acceptedMtMarkerResult
    || mtMarkerFirstEvents.length !== 1
    || mtMarkerFirstEvents[0].roundIndex !== 3
    || mtMarkerFirstEvents[0].isContinuous !== true
    || mtMarkerFirstTable?.shoeGeneration !== 0
  ) {
    throw new Error("MT marker-first updates must wait for the actual road result");
  }

  await send("百家樂", "user-smoke");
  const mtRoomMenuValues = await sendAndTexts("MT", "user-smoke");
  if (mtRoomMenuValues.includes("MT16") || mtRoomMenuValues.includes("MT17")) {
    throw new Error("MT room menu must hide rooms absent from the live source");
  }
  await send("首頁", "user-smoke");

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
    if (analysis.rows.some((row) => row.picks.length !== count || new Set(row.picks).size !== count)) {
      throw new Error(`MB analysis must return exactly ${count} unique picks per rank`);
    }
  }
  const staleMbAnalysis = buildMbAnalysis({
    ...mbTrack,
    updatedAt: new Date(Date.now() - 181000).toISOString(),
    liveUpdatedAt: new Date(Date.now() - 181000).toISOString(),
  }, 5);
  if (staleMbAnalysis.available || staleMbAnalysis.rows.length) {
    throw new Error("MB stale live data must never expose old recommendations");
  }
  if (!mbSource.invalidateSession()) {
    throw new Error("MB session expiry must be accepted");
  }
  const expiredMbTrack = mbSource.getSnapshot().tracks
    .find((track) => track.gameName === "PK-MBRACE-1");
  if (
    expiredMbTrack?.state !== "SessionExpired"
    || expiredMbTrack.updatedAt !== null
    || buildMbAnalysis(expiredMbTrack, 5).available
  ) {
    throw new Error("MB session expiry must immediately block cached recommendations");
  }
  if (!mbSource.ingestSocketEvent({
    event: "RESULT_PUBLIC",
    data: {
      dcs_id: 368,
      game_name: "PK-MBRACE-1",
      draw_num: "202607240003",
      result: [4, 10, 3, 2, 7, 6, 9, 1, 8, 5],
      result_display: { sum: "14", over_under: "OVER", odd_even: "EVEN" },
      result_time: 1784893282,
    },
  })) {
    throw new Error("MB relay must recover after fresh data resumes");
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

  require("../app");
  const root = path.join(__dirname, "..");
  for (const route of ["/portal/login", "/api/web/me", "/api/web/events", "/api/web/command"]) {
    const registered = [...captured.routes.get, ...captured.routes.post].some((entry) => entry.route === route);
    if (!registered) throw new Error(`Web portal route is missing: ${route}`);
  }
  if (!captured.routes.get.some((entry) => entry.route === "/portal/login")) {
    throw new Error("Web login must provide a preview-safe GET confirmation page");
  }
  if (!captured.routes.get.some((entry) => entry.route === "/portal/*")) {
    throw new Error("Web portal must serve its app shell for nested view routes");
  }
  if (!captured.routes.post.some((entry) => entry.route === "/portal/login")) {
    throw new Error("Web login must redeem its one-time code through POST");
  }
  const webPortalRouteSource = fs.readFileSync(path.join(root, "routes", "webPortal.js"), "utf8");
  const getLoginSection = webPortalRouteSource.split('app.get("/portal/login"')[1]?.split('app.post("/portal/login"')[0] || "";
  if (getLoginSection.includes("web.redeem")) {
    throw new Error("Web login GET must not consume a code because LINE previews open links");
  }
  if (!captured.routes.use.some((entry) => entry.route === "/portal")) {
    throw new Error("Web portal static assets are not registered");
  }
  if (!captured.routes.use.some((entry) => entry.route === "/videos")) {
    throw new Error("Public practice video assets are not registered");
  }
  const webPortalSource = fs.readFileSync(path.join(root, "public", "portal", "index.html"), "utf8");
  const publicSiteSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const webPortalAppSource = fs.readFileSync(path.join(root, "public", "portal", "app.js"), "utf8");
  const webPortalStylesSource = fs.readFileSync(path.join(root, "public", "portal", "styles.css"), "utf8");
  for (const expected of ["黑域AI｜AI 遊戲數據分析與即時分析平台", 'rel="canonical"', 'application/ld+json', 'name="application-name" content="黑域AI"', 'rel="icon" type="image/png" sizes="384x384" href="/favicon.png"', "進入AI預測系統", "https://line.me/ti/p/@893jrweh", "聯絡管理員 LINE", "加入免費討論群", "2LjVINFUKeXijuZMnbxXBBhP779jdIHuwvsCDQ", "button community", "#ffdc78", "service-icon", '<svg viewBox="0 0 24 24">', "logoGlow", "haloPulse", ".hero-art img{position:relative;width:min(390px,100%);height:auto", "AI 實戰影片", "/videos/baccarat-practice.mp4", "/videos/seth2-practice.mp4", "/videos/mb-practice.mp4", 'preload="none"']) {
    if (!publicSiteSource.includes(expected)) throw new Error(`Public SEO website is missing: ${expected}`);
  }
  for (const route of ["/robots.txt", "/sitemap.xml", "/google9ea0721a8c1ecc83.html"]) {
    if (!captured.routes.get.some((entry) => entry.route === route)) throw new Error(`Public SEO route is missing: ${route}`);
  }
  if (!webPortalSource.includes('name="robots" content="noindex,nofollow,noarchive"')) {
    throw new Error("Private member portal must be excluded from search indexing");
  }
  for (const expected of ["app.js?v=20260830.02", "styles.css?v=20260830.02", "admin.css?v=20260830.02"]) {
    if (!webPortalSource.includes(expected)) throw new Error(`Website cache-busted asset is missing: ${expected}`);
  }
  for (const expected of ["etag: false", '"cache-control", "no-store, no-cache, must-revalidate"', "web.waitReply(replyToken, 20_000)", 'portalBuild: "20260830.02"', 'isAdminLineUserId(userId)', '"/api/web/admin/monitor"']) {
    if (!webPortalRouteSource.includes(expected)) throw new Error(`Website command/cache hardening is missing: ${expected}`);
  }
  const webManifestSource = fs.readFileSync(path.join(root, "public", "portal", "manifest.webmanifest"), "utf8");
  const webServiceWorkerSource = fs.readFileSync(path.join(root, "public", "portal", "sw.js"), "utf8");
  const webManifest = JSON.parse(webManifestSource);
  if (webManifest.scope !== "/portal/" || webManifest.display !== "standalone") {
    throw new Error("Web portal PWA manifest must stay scoped to the member portal");
  }
  for (const expected of ['rel="manifest"', 'apple-mobile-web-app-capable', 'id="installApp"', 'id="installDialog"']) {
    if (!webPortalSource.includes(expected)) throw new Error(`Web portal PWA UI is missing: ${expected}`);
  }
  for (const expected of ['navigator.serviceWorker.register("/portal/sw.js"', 'beforeinstallprompt', "isStandaloneApp", "renderOffline"]) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web portal PWA behavior is missing: ${expected}`);
  }
  for (const expected of ['url.pathname.startsWith("/api/")', 'url.pathname.startsWith("/portal/login")', 'networkFirst(request, "/portal/index.html")']) {
    if (!webServiceWorkerSource.includes(expected)) throw new Error(`Web portal PWA cache safety is missing: ${expected}`);
  }
  for (const expected of ["智能分析中心", "id=\"view\"", "/portal/vip/status"]) {
    if (!webPortalSource.includes(expected)) throw new Error(`Web portal is missing feature: ${expected}`);
  }
  for (const expected of ["EventSource(\"/api/web/events\")", "fetch(\"/api/web/command\"", "baccarat:{", "atg:{", "lottery:{", "sports:{", "history.pushState"]){
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web portal integration is missing: ${expected}`);
  }
  for (const expected of ["特色遊戲紀錄", "featureRecords", "通知成功", "仍在追蹤", "實際開獎金額（精確）", "admin-direct-watch-form", "/api/web/admin/electronic-watch", "/api/web/admin/electronic-room", "搜尋紀錄"]) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Admin feature audit UI is missing: ${expected}`);
  }
  for (const expected of ["listFeatureNotifications", "isStillTracking", "featureRecords: recordsWithTracking"]) {
    if (!webPortalRouteSource.includes(expected)) throw new Error(`Admin feature audit API is missing: ${expected}`);
  }
  if (webPortalAppSource.includes('id:"horse"')) {
    throw new Error("Retired ATG horse must not remain in the website categories");
  }
  for (const expected of ["selectedHasUsableRtp", "scoreRoomForRecommendation(session.gameName, selected) != null", "recoverElectronicRecommendation", "setInterval(recoverElectronicRecommendation,5_000)", "restartElectronicRecommendation", 'command.dataset.command==="重新推薦"', "ELECTRONIC_CLIENT_TIMEOUT_MS=95_000", "recommend-timeout", "entry.at", "activeOperation.startedAt"]) {
    if (!webPortalAppSource.includes(expected) && !fs.readFileSync(path.join(root, "modules", "electronic", "index.js"), "utf8").includes(expected)) {
      throw new Error(`Electronic recommendation anti-stall recovery is missing: ${expected}`);
    }
  }
  for (const expected of ["recommendationDeliveryChannel", 'event.deliveryChannel === "web"', "webChannel.publish(userId, [message])", "deliveryChannel: pending.deliveryChannel"]) {
    if (!fs.readFileSync(path.join(root, "modules", "electronic", "index.js"), "utf8").includes(expected)) {
      throw new Error(`Electronic web delivery recovery is missing: ${expected}`);
    }
  }
  for (const expected of ["accessAllowed", "renderAccessDenied", "LINE：@893jrweh", "https://line.me/ti/p/@893jrweh", "if(!accessAllowed)return renderAccessDenied(categoryKey)", "setAccessIndicator", 'action.text==="綁定"']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web portal card-level access guard is missing: ${expected}`);
  }
  for (const expected of ["前往官方帳號登入", "開通權限・聯絡管理員", "https://line.me/ti/p/@391wiftp", "https://line.me/ti/p/@893jrweh", "login-panel", "login-official", "login-manager"]) {
    if (!webPortalAppSource.includes(expected) && !webPortalStylesSource.includes(expected)) throw new Error(`Web login guidance is missing: ${expected}`);
  }
  for (const expected of ["automaticBaccarat", "本局已結算", "下一局分析已自動更新", "automatic-round-update"]) {
    if (!webPortalAppSource.includes(expected) && !webPortalStylesSource.includes(expected)) throw new Error(`Web baccarat round transition is missing: ${expected}`);
  }
  for (const expected of ["baccaratRoomSelectionCard", "room-button-grid", "uniqueActions.slice(0,8)", "rooms.length"]) {
    if (!webPortalAppSource.includes(expected) && !webPortalStylesSource.includes(expected)) throw new Error(`Web baccarat room card is missing: ${expected}`);
  }
  for (const expected of ["data-state=access-granted", "data-state=access-denied"]) {
    if (!webPortalStylesSource.includes(expected)) throw new Error(`Web portal permission indicator styling is missing: ${expected}`);
  }
  if (!webPortalRouteSource.includes("vip.checkVipAccess(userId)") || !webPortalRouteSource.includes("accessAllowed:")) {
    throw new Error("Web member endpoint must expose the current AI access state");
  }
  for (const expected of ["allElectronicGamesEnabled:", "electronicAvailability.areAllElectronicGamesEnabled()", "applyElectronicAvailability", "applyRuntimeAccess", "refreshRuntimeAccess", "setInterval(refreshRuntimeAccess,5_000)"]) {
    if (!webPortalRouteSource.includes(expected) && !webPortalAppSource.includes(expected)) throw new Error(`Website live admin access synchronization is missing: ${expected}`);
  }
  for (const expected of ['item.id!=="set2"&&!allElectronicGamesEnabled', 'item.disabledLabel=item.disabled?"暫停開放"', 'disabled aria-disabled="true"']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Website disabled electronic card guard is missing: ${expected}`);
  }
  for (const expected of ["sportsResultCarousel", "showSportsGame", "data-sports-game", "data-sports-move", "上一場", "下一場", 'message.contents.contents']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Website sports match navigation is missing: ${expected}`);
  }
  for (const expected of [".sports-game-tabs", ".sports-pager", ".sports-slide.active"]) {
    if (!webPortalStylesSource.includes(expected)) throw new Error(`Website sports match navigation styling is missing: ${expected}`);
  }
  for (const expected of ["blackdomain-ai-logo.png", "recommendationCard", "genericResultBody", "initializeGame", 'send("百家樂"', "quickReplyActions", "baccaratForm"]) {
    if (!webPortalAppSource.includes(expected) && !webPortalSource.includes(expected)) {
      throw new Error(`Web portal UI flow is missing: ${expected}`);
    }
  }
  if (webPortalAppSource.includes('actionButton("自選房分析"')) {
    throw new Error("Web electronic game pages must not expose custom-room analysis");
  }
  if (!webPortalAppSource.includes('categoryKey==="atg"&&mode==="custom"')) {
    throw new Error("Legacy web electronic custom-room URLs must redirect to the game page");
  }
  if (!fs.existsSync(path.join(root, "public", "brand", "blackdomain-ai-logo.png"))) {
    throw new Error("Web portal brand logo asset is missing");
  }
  for (const asset of ["casino-track.webp", "snow-track.webp", "sports-track.webp", "ocean-track.webp"]) {
    if (!fs.existsSync(path.join(root, "public", "images", "mb", asset))) {
      throw new Error(`Web MB track image is missing: ${asset}`);
    }
  }
  const imageRouteSource = fs.readFileSync(path.join(root, "routes", "images.js"), "utf8");
  if (!imageRouteSource.includes('app.use("/images/mb", express.static(path.join(publicImagesPath, "mb")))')) {
    throw new Error("Web MB track image route is missing");
  }
  for (const expected of ["renderMbTrackPicker", "renderMbCountPicker", "renderMbConfirmation", "startMbAnalysis", "mbResultCard", "mbRecentRecords", "mbHistoryMarkup", "最近 3 場開獎", "請核對預測期號", "下一場自動分析", "data-mb-track", "data-mb-count", "data-mb-start", "MB ${track.name} ${count}碼", "new Set(texts.slice", "mbRankPicks(texts,rank.label,count)"]) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web MB analysis flow is missing: ${expected}`);
  }
  for (const expected of [".mb-track-grid", ".mb-count-grid", ".mb-ranking", ".mb-stepper"]) {
    if (!webPortalStylesSource.includes(expected)) throw new Error(`Web MB analysis styling is missing: ${expected}`);
  }
  for (const expected of ["analysisFlowSteps", "analysisStepHeader", "setAnalysisFlowStep", "選擇房號", "同步房況", "同步開獎", "同步賽事"]) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web shared analysis stepper is missing: ${expected}`);
  }
  for (const expected of ["baccaratInputCard", "baccarat-input-form", "輸入正整數本金", "輸入單注上限（不可超過本金）", 'event.target.matches(".baccarat-input-form")']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web baccarat funding input is missing: ${expected}`);
  }
  for (const expected of [".baccarat-input-card", ".baccarat-input-form"]) {
    if (!webPortalStylesSource.includes(expected)) throw new Error(`Web baccarat funding input styling is missing: ${expected}`);
  }
  const mbTrackOrder = ["賭城賽車", "雪地賽車", "運動賽車", "海洋賽車"].map(name => webPortalAppSource.indexOf(`name:\"${name}\"`));
  if (mbTrackOrder.some(index => index < 0) || mbTrackOrder.some((index, position) => position > 0 && index <= mbTrackOrder[position - 1])) {
    throw new Error("Web MB tracks must follow the platform order");
  }
  if (webPortalAppSource.includes('item.id==="mb"?"MB 賭城賽車 5碼"')) {
    throw new Error("Web MB entry must not skip track and count selection");
  }
  const webChannelSource = fs.readFileSync(path.join(root, "services", "webChannel.js"), "utf8");
  const webhookSource = fs.readFileSync(path.join(root, "routes", "webhook.js"), "utf8");
  const lineServiceSource = fs.readFileSync(path.join(root, "services", "line.js"), "utf8");
  const baccaratSessionSource = fs.readFileSync(path.join(root, "modules", "baccarat", "session.js"), "utf8");
  const baccaratModuleSource = fs.readFileSync(path.join(root, "modules", "baccarat", "index.js"), "utf8");
  if (!webChannelSource.includes("timeoutMs = 90000")) {
    throw new Error("Web commands must allow slow external analysis to return before timing out");
  }
  for (const expected of ["eventPayload(entry)", "lastEventId", "history.slice(cursor + 1)", "entry.replayable === true", "remember(userId, messages, true)", "id: ${entry.id}"]) {
    if (!webChannelSource.includes(expected)) throw new Error(`Web realtime replay is missing: ${expected}`);
  }
  for (const expected of ["remember(userId, messages)", "activeBaccaratSession", "resumeBaccaratSession", "[...restoredMessages].reverse().find"]) {
    if (!webChannelSource.includes(expected) && !webPortalRouteSource.includes(expected) && !webPortalAppSource.includes(expected)) throw new Error(`Web session recovery is missing: ${expected}`);
  }
  for (const expected of ['app.post("/api/web/stop"', "clearAllUserSessions(userId)"]) {
    if (!webPortalRouteSource.includes(expected)) throw new Error(`Website monitoring stop endpoint is missing: ${expected}`);
  }
  for (const expected of ['app.post("/api/web/sync"', "reconcileActiveBaccaratSession(userId)", "setImmediate"]) {
    if (!webPortalRouteSource.includes(expected)) throw new Error(`Website baccarat reconciliation is missing: ${expected}`);
  }
  for (const expected of ["stopMonitoringAndGoHome", 'fetch("/api/web/stop"', 'normalizePath(route.dataset.go)==="/portal"']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Website home monitoring stop flow is missing: ${expected}`);
  }
  for (const expected of ["renderResults(data.messages)", "showAnalysisState", "25_000", 'error.name==="AbortError"']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Website analysis anti-stall behavior is missing: ${expected}`);
  }
  if (webPortalAppSource.includes("renderResults(data.messages,{enforceScope:Boolean(activeOperation)})")) {
    throw new Error("Direct website command replies must not be discarded by background-event filtering");
  }
  for (const expected of ['fetch("/api/web/sync"', "setInterval(syncActiveBaccarat,15_000)", 'document.addEventListener("visibilitychange"']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Website baccarat catch-up trigger is missing: ${expected}`);
  }
  for (const expected of ["deliveryChannel", "setDeliveryChannel", 'startsWith("web:")', 'originalSession.deliveryChannel === "web"', "webChannel.publish"]) {
    if (!baccaratSessionSource.includes(expected) && !baccaratModuleSource.includes(expected)) throw new Error(`Baccarat delivery-channel isolation is missing: ${expected}`);
  }
  for (const expected of ["isLineWebsiteOnlyMode", "websiteAccessReply", "LINE 分析功能暫時改由網站版提供", "成功登入後不受此限制", "adminLineCommand", "memberUtilityCommand", "vip.hasActiveVipSession?.(userId)"]) {
    if (!webhookSource.includes(expected)) throw new Error(`LINE website-only mode is missing: ${expected}`);
  }
  for (const expected of ["isLineWebsiteOnlyMode", "webChannel.publish(userId, normalized)", "userIds.forEach((userId) => webChannel.publish"]) {
    if (!lineServiceSource.includes(expected)) throw new Error(`LINE outbound website-only guard is missing: ${expected}`);
  }
  for (const expected of ['req.get("last-event-id")', 'res.write(": keep-alive', "clearInterval(heartbeat)"]) {
    if (!webPortalRouteSource.includes(expected)) throw new Error(`Web realtime recovery route is missing: ${expected}`);
  }
  if (!captured.routes.use.some((entry) => entry.route === require("../middleware/errorHandler").errorHandler)) {
    throw new Error("Express error middleware must be registered after all routes");
  }
  const electronicStatusRoute = captured.routes.get.find((route) => route.route === "/api/electronic/status");
  let electronicStatusPayload = null;
  electronicStatusRoute.handler({}, { json(value) { electronicStatusPayload = value; } });
  if (
    !electronicStatusPayload?.games?.every((game) => Number.isInteger(game.tableCount))
    || electronicStatusPayload.games.some((game) => Object.prototype.hasOwnProperty.call(game, "tables"))
  ) {
    throw new Error("Public electronic status must expose summaries without raw room financial data");
  }
  for (const statusPath of ["/api/dg/status", "/api/mt/status"]) {
    const statusRoute = captured.routes.get.find((route) => route.route === statusPath);
    let payload = null;
    statusRoute.handler({}, { json(value) { payload = value; } });
    if (!Number.isInteger(payload?.tableCount) || payload.rooms?.some((room) => room.latest || room.gameNo)) {
      throw new Error(`${statusPath} must expose a compact redacted status`);
    }
  }
  const staticPath = captured.routes.static[0];
  if (!staticPath || path.resolve(staticPath) !== path.join(root, "assets", "images")) throw new Error("Static image route points to the wrong directory");
  if (!captured.routes.static.some((staticRoot) => path.resolve(staticRoot) === path.join(root, "public", "brand"))) {
    throw new Error("Brand image route is not registered");
  }
  const timestampedRoom = electronicSource.normalizeTable({
    roomId: "freshness-room",
    number: 99,
    status: "Empty",
    capturedAt: Date.now(),
    todayWin: 99,
    todayBet: 100,
  });
  if (
    !electronicSource.hasFreshRoomDetail(timestampedRoom, Date.now(), 120000)
    || electronicSource.hasFreshRoomDetail(timestampedRoom, Date.now() + 120001, 120000)
  ) {
    throw new Error("Electronic RTP freshness must be enforced per room");
  }
  if (!captured.routes.get.some((route) => route.route === "/mb-relay.user.js")) {
    throw new Error("MB relay userscript route is not registered");
  }
  const mbRelayScript = require("../routes/mbRelay").userscript("https://example.com");
  for (const expected of [
    "@match        https://mbracing.cc/*",
    "@match        https://mbracing.dev/*",
  ]) {
    if (!mbRelayScript.includes(expected)) {
      throw new Error(`MB relay userscript is missing supported host: ${expected}`);
    }
  }
  for (const expected of ["baccaratResultCard", "本房牌路統計", "baccaratPerformance", "有效命中率", "valueBefore(section,\"命中\")", "valueBefore(section,\"觀望\")", "vipResultCard", "VIP會員權限", "會員權限總覽", "剩餘時間", "lottery539ResultCard", "近期開獎紀錄", "AI抓牌", "lottery539-ai-lock", "重新分析|重新推薦", "actionMarkup(fixedActions)", "roomStatsFromTexts", "texts.slice(sectionIndex+1)", "texts:rawTexts", "routeForCommand", "首頁:\"/portal/\"", "返回首頁:\"/portal/\"", "mbResultCard", "messageBelongsToActiveOperation", "enforceScope:true", "renderAnalysis", "routeRevision", "/recommend", "/analyze"]) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Web portal state isolation is missing: ${expected}`);
  }
  const lottery539ServiceSource = fs.readFileSync(path.join(__dirname, "..", "modules", "lottery539", "service.js"), "utf8");
  for (const expected of ["analysisCache", "analysisInFlight", "computeAnalysis(cacheKey, offset)", "cloneAnalysis(await pending)", "recentHistory: history.slice(0, 3)"]) {
    if (!lottery539ServiceSource.includes(expected)) throw new Error(`539 same-draw result lock is missing: ${expected}`);
  }
  const lottery539RepositorySource = fs.readFileSync(path.join(__dirname, "..", "modules", "lottery539", "repository.js"), "utf8");
  for (const expected of ["ANALYSIS_KEY_PREFIX", "loadPersistedAnalysis", "persistAnalysis", "statisticalAnalysis(history, cacheKey)"]) {
    if (!lottery539ServiceSource.includes(expected)) throw new Error(`539 cross-restart daily lock is missing: ${expected}`);
  }
  if (!lottery539RepositorySource.includes("10 * 60 * 1000")) throw new Error("539 draw history cache must refresh after the nightly draw");
  for (const expected of [".road-grid", ".baccarat-decision", ".finance-grid"]) {
    if (!webPortalStylesSource.includes(expected)) throw new Error(`Web baccarat result styling is missing: ${expected}`);
  }
  for (const expected of ["--cursor-x", "repeating-linear-gradient", "tech-field-scan", "tech-trace-drift", "prefers-reduced-motion"]) {
    if (!webPortalStylesSource.includes(expected)) throw new Error(`Interactive portal atmosphere is missing: ${expected}`);
  }
  for (const expected of ['addEventListener("pointermove"', 'requestAnimationFrame', '"--cursor-x"', '"--cursor-y"']) {
    if (!webPortalAppSource.includes(expected)) throw new Error(`Pointer-reactive portal background is missing: ${expected}`);
  }
  if (!captured.routes.get.some((route) => route.route === "/api/mb/status")) {
    throw new Error("MB status route is not registered");
  }
  if (!captured.routes.get.some((route) => route.route === "/api/electronic/watch-rooms")) {
    throw new Error("Electronic watched-room route is not registered");
  }
  const electronicRelayManifest = require("../extensions/mb-relay/manifest.json");
  if (electronicRelayManifest.version !== "2.11.4") {
    throw new Error("Electronic relay extension version must be 2.11.4");
  }
  if (!electronicRelayManifest.permissions.includes("alarms")) {
    throw new Error("Relay extension must enable the independent background watchdog alarm");
  }
  if (!electronicRelayManifest.permissions.includes("debugger")) {
    throw new Error("Relay extension must support a trusted ATG canvas entry click");
  }
  for (const requiredHost of ["https://mbracing.cc/*", "https://play.godeebxp.com/*"]) {
    if (!electronicRelayManifest.host_permissions.includes(requiredHost)) {
      throw new Error(`Relay watchdog is missing host access: ${requiredHost}`);
    }
  }
  const relayBackgroundSource = fs.readFileSync(
    path.join(root, "extensions", "mb-relay", "background.js"),
    "utf8",
  );
  for (const expected of [
    "BLACKDOMAIN_RELAY_HEARTBEAT",
    "BLACKDOMAIN_RELAY_PING",
    "chrome.alarms.onAlarm",
    "chrome.tabs.reload",
    "GAME_DATA_TIMEOUT_MS",
    "buildFreshTokenLobbyUrl",
    "blackdomainAtgRecoveryLobbyUrl",
    "refreshRecoveryLobbyUrl",
    "blackdomain_reopen",
    "TOKEN_ERROR_RECOVERY_COOLDOWN_MS",
  ]) {
    if (!relayBackgroundSource.includes(expected)) {
      throw new Error(`Relay background watchdog is missing: ${expected}`);
    }
  }
  for (const expected of [
    "clickAtgCanvas",
    'chrome.debugger.attach(target, "1.3")',
    '"Input.dispatchMouseEvent"',
    'message?.type === "BLACKDOMAIN_ATG_ENTRY_CLICK"',
    'url.hostname !== "play.godeebxp.com"',
  ]) {
    if (!relayBackgroundSource.includes(expected)) {
      throw new Error(`ATG trusted entry click is missing: ${expected}`);
    }
  }
  const atgBridgeSource = fs.readFileSync(
    path.join(root, "extensions", "mb-relay", "atg-bridge.js"),
    "utf8",
  );
  const packetWorkerSource = fs.readFileSync(
    path.join(root, "extensions", "mb-relay", "atg-packet-worker.js"),
    "utf8",
  );
  const atgMainScripts = electronicRelayManifest.content_scripts.find((entry) => (
    entry.world === "MAIN" && entry.matches.includes("https://play.godeebxp.com/egames/*")
  ))?.js || [];
  for (const requiredScript of ["vendor/socket.io.js", "atg-packet-worker.js", "atg-bridge.js"]) {
    if (!atgMainScripts.includes(requiredScript)) {
      throw new Error(`ATG main-world packet stack is missing: ${requiredScript}`);
    }
  }
  for (const expected of [
    "lobbyInitial",
    "lobbyPlay",
    "getSlotTables",
    "getSlotTableDetail",
    'crypto.subtle.decrypt(',
    "decodeGameResponse",
    "if (binary) return decryptResponse",
    "tablePage(state.initialResponse)",
    "candidate.tableMeta?.totalPages",
    "manualGameCaptureRequested",
    'searchParams.get("blackdomain_manual") === "1"',
    'new DecompressionStream("deflate")',
    'relayMode: "packet-worker"',
    "five-game ATG packet relay active",
    "await scanTarget(target, context)",
    "installExclusiveRelayHost",
    "ATG 即時數據作戰中心",
    "ATG 5-GAME LIVE COMMAND",
    "window.stop()",
    'platform: { type: "DESKTOP_BROWSER" }',
    "blackdomain-packet-status",
    "setHostStatus",
    "FULL_SCAN_INTERVAL_MS = 15 * 60 * 1000",
    "GAME_SWITCH_GAP_MS = 5000",
    "tableCatalogs",
    'fullScanDue ? "full scan" : "RTP refresh"',
    "戰神賽特1",
    "戰神賽特2",
    "古神巴風特",
    "虎小妹",
    "赤三國",
  ]) {
    if (!packetWorkerSource.includes(expected)) {
      throw new Error(`ATG five-game packet worker is missing: ${expected}`);
    }
  }
  for (const unstableRetry of [
    "TARGET_SCAN_MAX_ATTEMPTS",
    "rememberLaunchLobby",
    "lobby-ticket-rejected",
  ]) {
    if (packetWorkerSource.includes(unstableRetry)) {
      throw new Error(`ATG stable packet core must not retain: ${unstableRetry}`);
    }
  }
  for (const removedRotation of [
    "BLACKDOMAIN_ATG_SCAN_COMPLETE",
    "blackdomain_rotation",
    "rotateAtgGame",
  ]) {
    if (relayBackgroundSource.includes(removedRotation)) {
      throw new Error(`ATG background must not retain UI rotation: ${removedRotation}`);
    }
  }
  if (atgBridgeSource.includes("detailQueueTimer")) {
    throw new Error("ATG bridge must not reference the removed detail queue timer");
  }
  for (const expected of [
    "ATG_INIT_TIMEOUT_MS = 45 * 1000",
    "BLACKDOMAIN_ELECTRONIC_SESSION_STALE",
    'reason: "init-timeout"',
    'reportSessionStale("connection-timeout-dialog")',
    "連線\\s*逾時",
    'reportSessionStale("token-error-dialog")',
    "installGameSocketObserver",
    'reportSessionStale("game-socket-closed")',
    "socket\\.godeebxp\\.com",
    "MutationObserver",
    '古神巴風特: "g1007"',
    '赤三國: "g1008"',
    '虎小妹: "g1009"',
    "senderCodeForCurrentGame",
  ]) {
    if (!atgBridgeSource.includes(expected)) {
      throw new Error(`ATG startup token recovery is missing: ${expected}`);
    }
  }
  if (electronicRelayManifest.content_scripts.some((entry) => (
    entry.js?.some((file) => file.startsWith("mt-"))
    || entry.matches?.some((match) => match.includes("ofalive99") || match.includes("mtx"))
  ))) {
    throw new Error("MT must use the local relay and must not be captured by the browser extension");
  }
  const electronicBridgeSource = fs.readFileSync(
    path.join(root, "extensions", "mb-relay", "atg-bridge.js"),
    "utf8",
  );
  const electronicResultSource = fs.readFileSync(
    path.join(root, "ui", "flex", "electronicResult.js"),
    "utf8",
  );
  for (const expected of [
    "RTP 評估",
    "今日得分率",
    "近30天得分率",
    "可信度",
    "今日總下注額",
    "近30天總下注額",
    "下注占比",
    "今日下注量 ÷ 近30天下注量",
  ]) {
    if (!electronicResultSource.includes(expected)) {
      throw new Error(`Electronic recommendation card is missing RTP display: ${expected}`);
    }
  }
  const electronicRecommendationModuleSource = fs.readFileSync(
    path.join(root, "modules", "electronic", "index.js"),
    "utf8",
  );
  for (const expected of [
    "BACKGROUND_PROBE_OWNER",
    "BACKGROUND_PROBE_ROTATE_MS",
    "refreshBackgroundRecommendationProbes(now)",
    "bucketCount = Math.min(batchSize, RECOMMEND_PROBE_BATCH_SIZE)",
    "spreadRtpQualityPool(pool, gameName)",
    "monthRtp < SETH2_MONTH_RTP_MIN",
    "isSeth2BetRatioRecommendable(betRatio)",
  ]) {
    if (!electronicRecommendationModuleSource.includes(expected)) {
      throw new Error(`Electronic recommendation must keep expanding its RTP pool: ${expected}`);
    }
  }
  for (const expected of [
    "SCAN_PAGE_TIMEOUT_MS",
    "SCAN_STARTUP_GRACE_MS",
    "SCAN_RESTART_BACKOFF_STEPS_MS",
    "handleScanPageFailure",
    "SCAN_PAGE_INTERVAL_MS",
    "WRAPPER_HEALTH_CHECK_MS",
    "watchedRoomsChanged",
    "watchedRoomQueue",
    "room.priority === \"feature\"",
    "setInterval(requestNextWatchedRoom, 1500)",
    "clearInterval(watchedRoomTimer)",
    "eventName === \"SlotFrameworkEvent:BUY_FEATURE_RESPONSE\"",
    "const ROTATING_PAGE_REFRESH_MS = 60000",
    "const SCAN_BATCH_SIZE = 3",
    "createScanBatch",
    "shuffledSourcePages",
    "startScanBatch()",
    "data.sourcePage = effectiveSourcePage",
    "data.totalPages = scanBatchPages.length",
    "scanPageQueue.splice(0, SCAN_BATCH_SIZE)",
    "cachedEmptyPages.set(effectiveSourcePage, data.tables)",
    "if (data.scanComplete) data.tables = cachedEmptyTables()",
    "cachedEmptyPages.size < activeSourcePageCount",
    "rawTables.length > 0 && !tables.length",
  ]) {
    if (!electronicBridgeSource.includes(expected)) {
      throw new Error(`Electronic relay bridge is missing scan recovery: ${expected}`);
    }
  }
  if (electronicBridgeSource.includes("setInterval(() => {\n    installDispatchWrapper()")) {
    throw new Error("Electronic relay bridge must not poll wrappers with a permanent fast interval");
  }
  if (electronicBridgeSource.includes("PASSIVE_FULL_SCAN_INTERVAL_MS")) {
    throw new Error("Electronic relay must not run passive full scans");
  }
  if (electronicBridgeSource.includes("data.page && data.page !== requestedScanPage")) {
    throw new Error("Electronic empty-room scans must tolerate ATG page-number reordering");
  }
  if (!electronicBridgeSource.includes("scheduleFullScan(SCAN_STARTUP_GRACE_MS);")) {
    throw new Error("Electronic relay must start its first empty-room scan after ATG initialization");
  }
  if (
    !electronicBridgeSource.includes("isSpinLikeRequest(request, requestPayload)")
    || !electronicBridgeSource.includes("|| activePurchasedFeature")
    || !electronicBridgeSource.includes("|| activeNaturalFeature")
    || !electronicBridgeSource.includes("isTablePageRequest")
    || !electronicBridgeSource.includes("handleDispatch(TABLE_PAGE_RESPONSE, response)")
    || !electronicBridgeSource.includes("observedPageResponses")
  ) {
    throw new Error("Electronic relay must observe table callbacks and deduplicate dispatch responses");
  }
  for (const expected of [
    "const SCAN_PAGE_TIMEOUT_MS = 30000",
    "const SCAN_STARTUP_GRACE_MS = 2000",
    "const SCAN_RESTART_BACKOFF_STEPS_MS = [3000, 8000, 15000]",
    "let activeSourcePageCount = SOURCE_PAGE_COUNT",
    "reportedSourcePageCount",
    "cachedEmptyPages.size < activeSourcePageCount",
  ]) {
    if (!electronicBridgeSource.includes(expected)) {
      throw new Error(`Electronic first scan is missing fast recovery setting: ${expected}`);
    }
  }
  const atgRelayEvents = [];
  const atgFeatureOrder = [];
  const atgWindowListeners = new Map();
  const atgSender = {
    send(request, requestPayload, callback) {
      return callback(requestPayload?.testResponse);
    },
  };
  const atgWindow = {
    App: {
      senderManager: {
        _datas: new Map([["g1005", atgSender]]),
      },
    },
    dispatch() {},
    dispatchEvent(eventValue) {
      atgRelayEvents.push(eventValue.detail);
      if (eventValue.detail?.type === "spin") atgFeatureOrder.push("relay");
    },
    addEventListener(name, listener) {
      const listeners = atgWindowListeners.get(name) || [];
      listeners.push(listener);
      atgWindowListeners.set(name, listeners);
    },
  };
  vm.runInNewContext(electronicBridgeSource, {
    window: atgWindow,
    document: { readyState: "complete", scripts: [] },
    location: {
      pathname: "/egames/361d567d94ac569664c82068a30b762e8d8438b8",
      href: "https://play.godeebxp.com/egames/361d567d94ac569664c82068a30b762e8d8438b8",
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    console: { info() {}, warn() {}, error() {} },
    setTimeout(callback, delay) {
      if (Number(delay) === 0) callback();
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    Date,
    Math,
    Number,
    String,
    Set,
    Map,
    Array,
    Object,
  });
  atgWindow.dispatch("SlotFrameworkEvent:INIT_RESPONSE", {
    platform: {
      table: { roomId: "seth-room-138", number: 138, status: "Full" },
    },
  });
  atgFeatureOrder.length = 0;
  atgSender.send("spin", {
    action: "spin",
    testResponse: {
      engine: {
        spinId: "seth-natural-precomputed-678",
        gameState: [
          { action: "startFreeGame", numFreeSpins: 10, totalWinnings: 0 },
          { action: "freeSpin", numFreeSpins: 0, totalWinnings: 678 },
        ],
      },
    },
  }, () => {
    atgFeatureOrder.push("game-callback");
  });
  const preRenderedNaturalFeature = atgRelayEvents.find((item) => (
    item?.type === "spin" && item?.spinId === "seth-natural-precomputed-678"
  ));
  if (
    preRenderedNaturalFeature?.totalWinnings !== 678
    || atgFeatureOrder.join(",") !== "relay,game-callback"
  ) {
    throw new Error("Electronic relay must capture a natural feature before ATG renders it");
  }
  atgWindow.dispatch("SlotFrameworkEvent:BUY_FEATURE_RESPONSE", {
    engine: {
      spinId: "seth-feature-234",
      gameState: {
        action: "buyFeature",
        numFreeSpins: 10,
        totalWinnings: 0,
      },
    },
  });
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-feature-234",
      gameState: {
        action: "freeSpin",
        numFreeSpins: 5,
        totalWinnings: 120,
      },
    },
  });
  const firstAvailableFeatureEvent = atgRelayEvents
    .find((item) => item?.type === "spin" && item?.spinId === "seth-feature-234");
  if (firstAvailableFeatureEvent?.totalWinnings !== 120) {
    throw new Error("Electronic relay must return the first available positive feature total immediately");
  }
  const featureEventCount = atgRelayEvents.filter((item) => (
    item?.type === "spin" && item?.spinId === "seth-feature-234"
  )).length;
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-feature-234",
      gameState: {
        action: "freeSpin",
        numFreeSpins: 0,
        totalWinnings: 234,
      },
    },
  });
  if (
    firstAvailableFeatureEvent?.featureTrigger !== "purchased"
    || firstAvailableFeatureEvent?.roomNumber !== 138
    || atgRelayEvents.filter((item) => (
      item?.type === "spin" && item?.spinId === "seth-feature-234"
    )).length !== featureEventCount
  ) {
    throw new Error("Electronic relay must not duplicate a purchased feature after immediate delivery");
  }
  const precomputedFeatureResponse = {
    engine: {
      spinId: "seth-precomputed-345",
      gameState: {
        action: "buyFeature",
        numFreeSpins: 10,
        totalWinnings: 345,
      },
    },
  };
  atgWindow.dispatch("SlotFrameworkEvent:BUY_FEATURE_RESPONSE", precomputedFeatureResponse);
  atgWindow.dispatch("SlotFrameworkEvent:BUY_FEATURE_RESPONSE", precomputedFeatureResponse);
  const precomputedFeatureEvent = atgRelayEvents
    .find((item) => item?.type === "spin" && item?.spinId === "seth-precomputed-345");
  if (
    precomputedFeatureEvent?.totalWinnings !== 345
    || atgRelayEvents.filter((item) => (
      item?.type === "spin" && item?.spinId === "seth-precomputed-345"
    )).length !== 1
  ) {
    throw new Error("Electronic relay must return a precomputed feature total immediately and once");
  }
  atgWindow.dispatch("SlotFrameworkEvent:BUY_FEATURE_RESPONSE", {
    engine: {
      spinId: "seth-late-total-456",
      gameState: {
        action: "buyFeature",
        numFreeSpins: 1,
        totalWinnings: 0,
      },
    },
  });
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-late-total-456",
      gameState: {
        action: "freeSpin",
        numFreeSpins: 0,
        totalWinnings: 0,
      },
    },
  });
  if (atgRelayEvents.some((item) => item?.spinId === "seth-late-total-456")) {
    throw new Error("Electronic relay must never emit a temporary zero payout");
  }
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-late-total-456",
      gameState: {
        action: "freeSpin",
        numFreeSpins: 0,
        totalWinnings: 456,
      },
    },
  });
  const lateFeatureTotal = atgRelayEvents
    .find((item) => item?.type === "spin" && item?.spinId === "seth-late-total-456");
  if (lateFeatureTotal?.totalWinnings !== 456) {
    throw new Error("Electronic relay must preserve a positive total arriving after a temporary zero");
  }
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-natural-root-321",
      gameState: {
        action: "startFreeGame",
        numFreeSpins: 10,
        totalWinnings: 0,
      },
    },
  });
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-natural-child-1",
      gameState: {
        action: "freeSpin",
        numFreeSpins: 5,
        totalWinnings: 321,
      },
    },
  });
  const naturalFeatureEvent = atgRelayEvents.find((item) => (
    item?.type === "spin" && item?.spinId === "seth-natural-root-321"
  ));
  if (
    naturalFeatureEvent?.totalWinnings !== 321
    || naturalFeatureEvent?.featureTrigger !== "natural"
  ) {
    throw new Error("Natural Seth features must survive changing spin IDs and return the first total");
  }
  const naturalFeatureEventCount = atgRelayEvents.filter((item) => (
    item?.type === "spin" && item?.spinId === "seth-natural-root-321"
  )).length;
  atgWindow.dispatch("SlotFrameworkEvent:SPIN_RESPONSE", {
    engine: {
      spinId: "seth-natural-child-2",
      gameState: {
        action: "freeSpin",
        numFreeSpins: 0,
        totalWinnings: 500,
      },
    },
  });
  if (atgRelayEvents.filter((item) => (
    item?.type === "spin" && item?.spinId === "seth-natural-root-321"
  )).length !== naturalFeatureEventCount) {
    throw new Error("Natural Seth features must only be delivered once");
  }
  const electronicRelaySource = fs.readFileSync(
    path.join(root, "extensions", "mb-relay", "atg-relay.js"),
    "utf8",
  );
  if (!electronicRelaySource.includes("setInterval(syncWatchRooms, 2000)")) {
    throw new Error("Electronic relay watch sync must use the reduced two-second interval");
  }
  for (const expected of [
    "autoReopenSeth2",
    "autoEnterAtgGame",
    'document.querySelectorAll("canvas")',
    'type: "BLACKDOMAIN_ATG_ENTRY_CLICK"',
    "isRecoveredSethLaunch",
    "elapsed > 120000",
    "elapsed < 5000",
    "rect.height * 0.92",
    "now - lastClickAt < 8000",
    "chrome.runtime.getManifest().version",
    'img[alt*="戰神賽特2"]',
    "blackdomainAtgRecoveryLobbyUrl",
    "button.click()",
    "BLACKDOMAIN_ATG_SESSION_STALE",
  ]) {
    if (!electronicRelaySource.includes(expected)) {
      throw new Error(`Electronic relay token recovery is missing: ${expected}`);
    }
  }
  if (
    !electronicRelaySource.includes("BLACKDOMAIN_RELAY_HEARTBEAT")
    || !electronicRelaySource.includes("BLACKDOMAIN_RELAY_PING")
  ) {
    throw new Error("Electronic relay must answer independent background health checks");
  }
  const mbExtensionRelaySource = fs.readFileSync(
    path.join(root, "extensions", "mb-relay", "relay.js"),
    "utf8",
  );
  if (
    !mbExtensionRelaySource.includes("BLACKDOMAIN_RELAY_HEARTBEAT")
    || !mbExtensionRelaySource.includes("BLACKDOMAIN_RELAY_PING")
  ) {
    throw new Error("MB relay must answer independent background health checks");
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
  const mtRelayClientSource = fs.readFileSync(
    path.join(root, "scripts", "mt-relay-client.js"),
    "utf8",
  );
  for (const expected of [
    'tokenRejected ? "token_rejected" : "disconnected"',
    "MT 票證已失效，請在下方貼上新票證",
    'res.setHeader("location", "/")',
  ]) {
    if (!mtRelayClientSource.includes(expected)) {
      throw new Error(`MT relay status page is missing recovery behavior: ${expected}`);
    }
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

  await send("百家樂", "web-login-alias-user");
  await send("DG", "web-login-alias-user");
  await send("RB01", "web-login-alias-user");
  const webLoginAliasValues = await sendAndTexts("網頁登入", "web-login-alias-user");
  assertIncludes(webLoginAliasValues, "網站登入連結", "Web login alias must bypass an active baccarat session");
  if (webLoginAliasValues.includes("本房自動結算中")) {
    throw new Error("網頁登入 must not be consumed by an active baccarat session");
  }
  const websiteLoginValues = await sendAndTexts("網站登入", "website-login-user");
  assertIncludes(websiteLoginValues, "網站登入連結", "Website login command");
  process.env.LINE_WEBSITE_ONLY_MODE = "true";
  const websiteOnlyValues = await sendAndTexts("百家樂", "website-only-user");
  assertIncludes(websiteOnlyValues, "暫時改由網站版提供", "LINE website-only redirect");
  if (websiteOnlyValues.some((value) => String(value).includes("DG 百家樂AI"))) {
    throw new Error("Website-only mode must not enter the LINE baccarat flow");
  }
  const websiteOnlyBindingUser = "website-only-binding-user";
  const websiteOnlyBindPrompt = await sendAndTexts("綁定", websiteOnlyBindingUser);
  assertIncludes(websiteOnlyBindPrompt, "請輸入", "LINE website-only mode must preserve the 3A binding prompt");
  const websiteOnlyBindResult = await sendAndTexts("webbind123", websiteOnlyBindingUser);
  assertIncludes(websiteOnlyBindResult, "已收到", "LINE website-only mode must preserve the 3A binding submission");
  if (websiteOnlyBindResult.some((value) => String(value).includes("暫時改由網站版提供"))) {
    throw new Error("3A binding input must not be redirected to website analysis");
  }
  const websiteReplyToken = "web:website-command-user:website-only-bypass";
  const websiteReplyPending = webChannel.waitReply(websiteReplyToken, 1000);
  await handleEvent({
    type: "message",
    replyToken: websiteReplyToken,
    source: { userId: "website-command-user" },
    message: { type: "text", text: "百家樂" },
  });
  const websiteCommandValues = (await websiteReplyPending)
    .flatMap((message) => collectText(message));
  assertIncludes(websiteCommandValues, "DG", "Website commands must bypass the LINE redirect");
  if (websiteCommandValues.some((value) => String(value).includes("暫時改由網站版提供"))) {
    throw new Error("Website commands must never be redirected back to the website login link");
  }
  process.env.LINE_WEBSITE_ONLY_MODE = "false";
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

  values = await sendAndTexts("首頁", "web-entry-home-user");
  assertIncludes(values, "開啟網頁分析", "Home web analysis entry");
  assertIncludes(values, "進入完整網頁版分析中心", "Home web analysis entry subtitle");
  const homeWebActions = captured.replies[captured.replies.length - 1].messages.flatMap((message) => collectActions(message));
  if (!homeWebActions.some((action) => action.label === "網站登入" || action.text === "網站登入")) {
    throw new Error("Home web analysis entry must request a website login link");
  }

  electronicSource.resetForTest();
  values = await sendAndTexts("更新房間數據", "regular-user");
  assertIncludes(values, "權限不足", "Electronic room refresh must be admin-only");
  if (electronicSource.getRefreshRequest()) {
    throw new Error("Non-admin electronic room refresh must not create a refresh request");
  }
  values = await sendAndTexts("更新房間數據", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "已發送強制刷新指令", "Admin electronic room refresh");
  if (!electronicSource.getRefreshRequest()?.id) {
    throw new Error("Admin electronic room refresh must create a refresh request");
  }
  const firstRefreshId = electronicSource.getRefreshRequest().id;
  const duplicateElectronicRefresh = electronicSource.requestFullRefresh("another-admin");
  if (duplicateElectronicRefresh.accepted || duplicateElectronicRefresh.id !== firstRefreshId) {
    throw new Error("Electronic room refresh must throttle duplicate requests");
  }
  if (electronicSource.markRefreshGameComplete("戰神賽特1", "stale-refresh")) {
    throw new Error("Electronic room refresh must reject stale scan completion");
  }
  if (electronicSource.markRefreshGameComplete("戰神賽特1", firstRefreshId)) {
    throw new Error("Electronic room refresh must wait for every supported game");
  }
  let completedElectronicRefresh = null;
  electronicSource.GAME_NAMES.slice(1).forEach((gameName, index, games) => {
    const result = electronicSource.markRefreshGameComplete(gameName, firstRefreshId);
    if (index < games.length - 1 && result) {
      throw new Error("Electronic room refresh completed before every supported game");
    }
    if (result) completedElectronicRefresh = result;
  });
  if (
    completedElectronicRefresh?.requestedBy !== "Uaf293ee976e5170d4e8672d2c12b3f76"
    || !completedElectronicRefresh.completedAt
  ) {
    throw new Error("Electronic room refresh completion is incorrect");
  }
  electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特2",
    scanId: "session-expiry-scan",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    tables: [{ roomId: "seth-session-room", number: 777, status: "Empty" }],
  });
  if (!electronicSource.hasFreshData("戰神賽特2")) {
    throw new Error("Electronic session expiry test requires fresh data first");
  }
  electronicSource.invalidateSession();
  if (
    electronicSource.hasFreshData("戰神賽特2")
    || electronicSource.hasReadyData("戰神賽特2")
  ) {
    throw new Error("3A session expiry must immediately block electronic recommendations");
  }
  electronicSource.resetForTest();

  const homeReply = await send("首頁", "user-smoke");
  values = homeReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "彩票 AI", "Main menu lottery entry");
  assertIncludes(values, "MB彈珠・今彩539", "Main menu lottery description");
  assertIncludes(values, "系統在線", "Main menu compact status");
  assertIncludes(values, "分析服務", "Main menu service grid");
  if (values.some((value) => String(value).includes("AI分析摘要"))) {
    throw new Error("Main menu must not repeat the old analysis summary panel");
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

  values = await sendAndTexts("開通 abc123 15 分鐘", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "15分鐘", "Minute VIP approval duration");
  assertIncludes(values, "到期時間", "Minute VIP approval expiry");
  assertIncludes(values, "已開通並通知會員", "Minute VIP approval result");
  const minuteVipPush = captured.pushes[captured.pushes.length - 1];
  const minuteVipPushText = minuteVipPush.messages.flatMap((message) => collectText(message));
  assertIncludes(minuteVipPushText, "+15分鐘", "Minute VIP member notification");
  assertIncludes(minuteVipPushText, "剩餘時間", "Minute VIP remaining-time display");

  values = await sendAndTexts("開通 abc123 0分鐘", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "開通分鐘必須大於 0", "Minute VIP invalid duration guard");

  values = await sendAndTexts("延長VIP test3a 5分鐘", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "5分鐘", "Minute VIP extension duration");
  assertIncludes(values, "已延長並通知會員", "Minute VIP extension result");

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
  assertIncludes(values, "BLACKDOMAIN AI 全新官方入口", "Official website command overrides binding session");
  const officialModuleSource = fs.readFileSync(path.join(root, "modules", "official", "index.js"), "utf8");
  if (!officialModuleSource.includes("https://blackdomain-ai-v3-production.up.railway.app/")) {
    throw new Error("Official website must use the new public homepage");
  }
  if (officialModuleSource.includes("zuhe88.github.io/blackdomain-ai")) {
    throw new Error("Legacy GitHub Pages official website entry must be removed");
  }

  values = await sendAndTexts("綁定", "global-ai-entry-user");
  assertIncludes(values, "請輸入", "AI entry bind prompt");
  values = await sendAndTexts("電子", "global-ai-entry-user");
  assertIncludes(values, "戰神賽特2", "Non-VIP can browse electronic game cards");
  for (const gameName of ["戰神賽特1", "戰神賽特2", "古神巴風特", "虎小妹", "赤三國"]) {
    values = await sendAndTexts(gameName, "global-ai-entry-user");
    assertIncludes(values, "需要開通權限", `Non-VIP is blocked on the ${gameName} card`);
  }
  assertIncludes(values, "LINE：@893jrweh", "Non-VIP access guidance");

  values = await sendAndTexts("百家樂", "non-vip-baccarat-user");
  assertIncludes(values, "DG 百家樂AI", "Non-VIP can browse baccarat platform cards");
  for (const platform of ["DG", "MT"]) {
    values = await sendAndTexts(platform, "non-vip-baccarat-user");
    assertIncludes(values, "需要開通權限", `Non-VIP is blocked on the ${platform} baccarat card`);
  }

  values = await sendAndTexts("彩票", "non-vip-lottery-user");
  assertIncludes(values, "MB彈珠", "Non-VIP can see the MB lottery card");
  assertIncludes(values, "今彩539", "Non-VIP can see the 539 lottery card");
  values = await sendAndTexts("539", "non-vip-lottery-user");
  assertIncludes(values, "需要開通權限", "Non-VIP is blocked on the 539 lottery card");
  values = await sendAndTexts("MB彈珠", "non-vip-lottery-user");
  assertIncludes(values, "需要開通權限", "Non-VIP is blocked on the MB lottery card");
  values = await sendAndTexts("體育", "non-vip-sports-user");
  assertIncludes(values, "MLB AI", "Non-VIP can browse sports league cards");
  for (const league of ["CPBL", "MLB", "NBA"]) {
    values = await sendAndTexts(league, "non-vip-sports-user");
    assertIncludes(values, "需要開通權限", `Non-VIP is blocked on the ${league} sports card`);
  }

  values = await sendAndTexts("全部開放權限", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "臨時開放中", "Admin global access enable");
  assertIncludes(values, "個別 VIP、到期日與權限均未修改", "Global access preserves member permissions");
  values = await sendAndTexts("VIP", "free-access-user");
  assertIncludes(values, "免費權限", "Global free access VIP center");
  assertIncludes(values, "原會員權限", "Global free access restore notice");
  values = await sendAndTexts("電子", "free-access-user");
  assertIncludes(values, "戰神賽特2", "Global free access AI entry");
  values = await sendAndTexts("恢復原權限", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "已恢復原設定", "Admin global access restore");
  assertIncludes(values, "個別 VIP、到期日與權限均未修改", "Global access restore preserves member permissions");
  values = await sendAndTexts("電子", "restored-access-user");
  assertIncludes(values, "戰神賽特2", "Restored non-VIP can still browse game cards");
  values = await sendAndTexts("戰神賽特2", "restored-access-user");
  assertIncludes(values, "需要開通權限", "Restored non-VIP is blocked on the electronic game card");

  values = await sendAndTexts("僅開放賽特2", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "僅開放戰神賽特2", "Admin electronic access restriction");
  assertIncludes(values, "已更新並永久保存", "Electronic access persistence");
  await send("電子", "user-smoke");
  values = await sendAndTexts("戰神賽特1", "user-smoke");
  assertIncludes(values, "暫未開放", "Disabled electronic game guard");
  assertIncludes(values, "目前僅開放戰神賽特2", "Disabled electronic game guidance");
  values = await sendAndTexts("開放全部電子遊戲", "Uaf293ee976e5170d4e8672d2c12b3f76");
  assertIncludes(values, "全部開放", "Admin electronic access enable");
  assertIncludes(values, "已更新並永久保存", "Electronic access enable persistence");
  await send("電子", "user-smoke");
  values = await sendAndTexts("戰神賽特1", "user-smoke");
  assertIncludes(values, "AI推薦房", "Electronic menu");
  electronicSource.resetForTest();
  const prematureCompletedScan = electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特1",
    scanId: "out-of-order-scan",
    page: 2,
    totalPages: 2,
    scanComplete: true,
    tables: [{ roomId: "seth-page-2", number: 2, status: "Empty" }],
  });
  if (prematureCompletedScan.scanCompleted || electronicSource.hasReadyData("戰神賽特1")) {
    throw new Error("Electronic room data must not publish before every scan page arrives");
  }
  const completedOutOfOrderScan = electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特1",
    scanId: "out-of-order-scan",
    page: 1,
    totalPages: 2,
    scanComplete: false,
    tables: [{ roomId: "seth-page-1", number: 1, status: "Empty" }],
  });
  if (!completedOutOfOrderScan.scanCompleted || !electronicSource.hasReadyData("戰神賽特1")) {
    throw new Error("Electronic room data must publish after all out-of-order scan pages arrive");
  }
  electronicSource.resetForTest();
  for (let page = 1; page <= 8; page += 1) {
    const emptyOnlyResult = electronicSource.ingestTables({
      type: "tables",
      gameName: electronicSource.GAME_NAMES[1],
      scanId: "eight-page-empty-only-scan",
      page,
      totalPages: 8,
      scanComplete: page === 8,
      emptyOnly: true,
      sourcePagesCovered: page,
      sourcePageCount: 8,
      tables: [
        {
          roomId: `seth-empty-page-${page}`,
          number: page * 500,
          status: "Empty",
        },
        {
          roomId: `seth-full-page-${page}`,
          number: page * 500 - 1,
          status: "Full",
        },
      ],
    });
    if (page < 8 && (emptyOnlyResult.scanCompleted
      || electronicSource.hasReadyData(electronicSource.GAME_NAMES[1]))) {
      throw new Error("Electronic empty-only room data must wait for all eight pages");
    }
  }
  const emptyOnlySnapshot = electronicSource.getGame(electronicSource.GAME_NAMES[1]);
  if (!electronicSource.hasReadyData(electronicSource.GAME_NAMES[1])
    || emptyOnlySnapshot.dataMode !== "empty-only"
    || emptyOnlySnapshot.sourcePagesCovered !== 8
    || emptyOnlySnapshot.sourcePageCount !== 8
    || emptyOnlySnapshot.tables.length !== 8
    || emptyOnlySnapshot.tables.some((table) => table.status !== "Empty")) {
    throw new Error("Electronic eight-page empty-only scan was not published correctly");
  }
  const rotationStarted = electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    scanId: "background-rotation-scan",
    page: 1,
    totalPages: 3,
    scanComplete: false,
    emptyOnly: true,
    sourcePagesCovered: 8,
    sourcePageCount: 8,
    tables: [emptyOnlySnapshot.tables[0]],
  });
  const snapshotDuringRotation = electronicSource.getGame(electronicSource.GAME_NAMES[1]);
  if (
    rotationStarted.scanCompleted
    || !electronicSource.hasReadyData(electronicSource.GAME_NAMES[1])
    || snapshotDuringRotation.tables.length !== emptyOnlySnapshot.tables.length
  ) {
    throw new Error("Background page rotation must keep the previous recommendation pool available");
  }
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    scanId: "background-rotation-scan",
    page: 2,
    totalPages: 3,
    scanComplete: false,
    emptyOnly: true,
    sourcePagesCovered: 8,
    sourcePageCount: 8,
    tables: [emptyOnlySnapshot.tables[1]],
  });
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    scanId: "background-rotation-scan",
    page: 3,
    totalPages: 3,
    scanComplete: true,
    emptyOnly: true,
    sourcePagesCovered: 8,
    sourcePageCount: 8,
    tables: emptyOnlySnapshot.tables,
  });
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    tables: [
      { roomId: "seth-empty-page-1", number: 500, status: "Full" },
      { roomId: "seth-new-empty", number: 4001, status: "Empty" },
    ],
  });
  const emptyOnlyLiveSnapshot = electronicSource.getGame(electronicSource.GAME_NAMES[1]);
  if (emptyOnlyLiveSnapshot.tables.some((table) => table.status !== "Empty")
    || emptyOnlyLiveSnapshot.tables.some((table) => table.roomId === "seth-empty-page-1")
    || !emptyOnlyLiveSnapshot.tables.some((table) => table.roomId === "seth-new-empty")) {
    throw new Error("Electronic live updates polluted the empty-only recommendation pool");
  }
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    tables: [
      {
        roomId: "seth-rtp-low",
        number: 3998,
        status: "Empty",
        todayBet: 100000,
        todayWin: 95000,
        dayBet: 10000000,
        dayWin: 9000000,
      },
      {
        roomId: "seth-rtp-high",
        number: 3999,
        status: "Empty",
        todayBet: 200000,
        todayWin: 220000,
        dayBet: 10000000,
        dayWin: 9500000,
      },
      {
        roomId: "seth-bad-volume",
        number: 3994,
        status: "Empty",
        todayBet: 40000,
        todayWin: 40000,
        dayBet: 10000000,
        dayWin: 9000000,
      },
    ],
  });
  const rtpRankedRoom = electronic.getNextRecommendRoom("rtp-ranking-user", electronicSource.GAME_NAMES[1]);
  if (![3998, 3999].includes(rtpRankedRoom?.number)) {
    throw new Error("Seth 2 recommendations must stay inside the valid RTP and bet-volume pool");
  }
  const secondUserRtpRoom = electronic.getNextRecommendRoom(
    "rtp-ranking-user-2",
    electronicSource.GAME_NAMES[1],
  );
  if (
    ![3998, 3999].includes(secondUserRtpRoom?.number)
    || secondUserRtpRoom?.number === rtpRankedRoom?.number
  ) {
    throw new Error("Concurrent Seth 2 users must receive different available rooms");
  }
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    tables: [3995, 3996, 3997].map((number, index) => ({
      roomId: `seth-rotation-${number}`,
      number,
      status: "Empty",
      todayBet: 100000 + (index * 50000),
      todayWin: 95000 + (index * 45000),
      dayBet: 10000000,
      dayWin: 9000000 - (index * 50000),
    })),
  });
  const rotationRooms = Array.from({ length: 3 }, () => (
    electronic.getNextRecommendRoom("rtp-rotation-user", electronicSource.GAME_NAMES[1])?.number
  ));
  if (new Set(rotationRooms).size !== rotationRooms.length) {
    throw new Error(`Seth 2 recent recommendations must not repeat: ${rotationRooms.join(",")}`);
  }
  electronicSource.resetForTest();
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    scanId: "invalid-seth2-conditions",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    emptyOnly: true,
    tables: [
      {
        roomId: "seth-too-little-volume",
        number: 3003,
        status: "Empty",
        todayBet: 40,
        dayBet: 10000,
        dayRtp: 90,
      },
      {
        roomId: "seth-outside-month-rtp",
        number: 3004,
        status: "Empty",
        todayBet: 100,
        dayBet: 10000,
        dayRtp: 96,
      },
      {
        roomId: "seth-regression-2737",
        number: 2737,
        status: "Empty",
        todayBet: 9676.8,
        dayBet: 11506938.6,
        todayRtp: 116.81,
        dayRtp: 98.32,
      },
    ],
  });
  if (electronic.getNextRecommendRoom("invalid-seth2-user", "戰神賽特2") !== null) {
    throw new Error("Seth 2 must reject room 2737 and other rooms outside the volume or monthly RTP limits");
  }
  electronicSource.resetForTest();
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    scanId: "seth2-mid-volume-band",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    emptyOnly: true,
    tables: [{
      roomId: "seth-mid-volume",
      number: 3005,
      status: "Empty",
      todayBet: 275,
      dayBet: 10000,
      dayRtp: 90,
    }],
  });
  if (electronic.getNextRecommendRoom("seth2-mid-volume-user", "戰神賽特2")?.number !== 3005) {
    throw new Error("Seth 2 must recommend rooms in the 2.5-3.0% bet-volume band");
  }
  electronicSource.resetForTest();
  electronicSource.ingestTables({
    type: "tables",
    gameName: electronicSource.GAME_NAMES[1],
    scanId: "persistent-history-scan",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    emptyOnly: true,
    tables: [
      {
        roomId: "persistent-history-3001",
        number: 3001,
        status: "Empty",
        todayBet: 100,
        dayBet: 10000,
        todayRtp: 120,
        dayRtp: 90,
      },
      {
        roomId: "persistent-history-3002",
        number: 3002,
        status: "Empty",
        todayBet: 150,
        dayBet: 10000,
        todayRtp: 105,
        dayRtp: 92,
      },
    ],
  });
  const persistentHistoryKey = "electronic_recommend_history:persistent-history-user:戰神賽特2";
  mockElectronicRows.set(persistentHistoryKey, {
    id: persistentHistoryKey,
    key: persistentHistoryKey,
    value: {
      userId: "persistent-history-user",
      gameName: "戰神賽特2",
      recentRooms: [3001],
      updatedAt: Date.now(),
    },
  });
  await electronic.hydrateRecommendHistory("persistent-history-user", "戰神賽特2");
  const persistedRotationRoom = electronic.getNextRecommendRoom(
    "persistent-history-user",
    "戰神賽特2",
  );
  if (persistedRotationRoom?.number !== 3002) {
    throw new Error("Seth 2 must preserve per-user non-repeat history across service restarts");
  }
  await new Promise((resolve) => setImmediate(resolve));
  const updatedHistory = mockElectronicRows.get(persistentHistoryKey)?.value?.recentRooms || [];
  if (updatedHistory[0] !== 3002 || !updatedHistory.includes(3001)) {
    throw new Error("Seth 2 must persist the updated recommendation rotation history");
  }
  electronicSource.resetForTest();
  values = await sendAndTexts("AI推薦房", "user-smoke");
  assertIncludes(values, "房間數據整理中", "Seth 1 must wait for live RTP data");
  assertIncludes(values, "正在掃描房間中並計算 RTP", "Seth 1 RTP requirement");
  await new Promise((resolve) => setImmediate(resolve));
  await send("戰神賽特2", "user-smoke");
  values = await sendAndTexts("AI推薦房", "user-smoke");
  await new Promise((resolve) => setImmediate(resolve));
  assertIncludes(values, "房間數據整理中", "Electronic pending recommendation");
  assertIncludes(values, "完成後會自動回傳推薦房間", "Electronic pending automatic response notice");
  assertIncludes(values, "正在掃描房間中並計算 RTP", "Electronic first-scan estimate");
  assertIncludes(values, "通常約 15～45 秒，最長等待 90 秒｜請勿重複點擊", "Electronic pending duplicate-click warning");
  assertIncludes(values, "取消推薦", "Electronic pending cancel action");
  if (!electronicSource.getRefreshRequest()?.id) {
    throw new Error("Electronic pending recommendation must request a fresh room scan");
  }
  const electronicModuleSource = fs.readFileSync(
    path.join(root, "modules", "electronic", "index.js"),
    "utf8",
  );
  for (const expected of [
    "const PENDING_RECOMMEND_RETRY_MS = 5000",
    "const RECOMMEND_PROBE_BATCH_SIZE = 12",
    "const RECOMMEND_HISTORY_LIMIT = 500",
    "const FALLBACK_ROOM_HISTORY_LIMIT = 100",
    "probe-cursor",
    "await pushRecommendation(",
    "handleElectronicDataReady(gameName)",
    "clearInterval(pending.retryTimer)",
    "if (requiresLiveRtp(gameName) && !rtpRankedRooms.length) return null",
    "seedRecommendationProbes(userId, gameName)",
    "refreshPendingRecommendationProbes(gameName)",
  ]) {
    if (!electronicModuleSource.includes(expected)) {
      throw new Error(`Electronic first recommendation is missing automatic recovery: ${expected}`);
    }
  }
  if (values.some((value) => value === "資訊" || value === "狀態")) {
    throw new Error("Electronic pending recommendation must not repeat generic row labels");
  }
  if (values.some((value) => String(value).includes("請等60秒後再按重新推薦"))) {
    throw new Error("Electronic pending recommendation must not require another manual click");
  }
  values = await sendAndTexts("取消推薦", "user-smoke");
  assertIncludes(values, "已取消推薦", "Electronic pending recommendation cancellation");
  values = await sendAndTexts("AI推薦房", "user-smoke");
  assertIncludes(values, "房間數據整理中", "Electronic pending recommendation restart after cancellation");
  values = await sendAndTexts("重新推薦", "user-smoke");
  assertIncludes(values, "房間數據仍在整理中", "Electronic pending duplicate guard");
  await new Promise((resolve) => setImmediate(resolve));
  if (!electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特2",
    scanId: "automatic-ready-recommendation",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    tables: [{ roomId: "seth-auto-7", number: 7, status: "Empty" }],
  })) {
    throw new Error("Electronic automatic recommendation fixture was rejected");
  }
  if (electronic.getNextRecommendRoom("seth-no-rtp-user", electronicSource.GAME_NAMES[1]) !== null) {
    throw new Error("Seth 2 must not recommend an empty room before RTP is available");
  }
  if (await electronic.handleElectronicDataReady("戰神賽特2") !== 0) {
    throw new Error("Seth 2 must keep waiting while RTP is unavailable");
  }
  const pendingProbeRooms = await electronic.getActiveWatchRooms();
  if (!pendingProbeRooms.some((room) => room.gameName === "戰神賽特2" && room.roomNumber === 7)) {
    throw new Error("Seth 2 waiting flow must actively request candidate-room RTP details");
  }
  electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-auto-7",
      number: 7,
      status: "Empty",
      todayWin: 98,
      todayBet: 100,
      dayWin: 900,
      dayBet: 1000,
    },
  });
  setTimeout(() => electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-auto-7",
      number: 7,
      status: "Empty",
      todayWin: 198,
      todayBet: 200,
      dayWin: 1800,
      dayBet: 2000,
    },
  }), 10);
  const automaticRecommendationPushCount = captured.pushes.length;
  const automaticRecommendationCount = await electronic.handleElectronicDataReady("戰神賽特2");
  if (automaticRecommendationCount !== 1) {
    throw new Error(`Electronic data-ready flow returned ${automaticRecommendationCount} automatic recommendations`);
  }
  const automaticRecommendationPushes = captured.pushes
    .slice(automaticRecommendationPushCount);
  if (automaticRecommendationPushes.length !== 1) {
    throw new Error(
      `Electronic data-ready flow must send only the final recommendation, received ${automaticRecommendationPushes.length} pushes`,
    );
  }
  const automaticRecommendationTexts = automaticRecommendationPushes
    .flatMap((entry) => entry.messages.flatMap((message) => collectText(message)));
  assertIncludes(automaticRecommendationTexts, "推薦房號", "Electronic data-ready automatic recommendation");
  assertIncludes(automaticRecommendationTexts, "98.00%", "Electronic automatic recommendation immediately uses existing fresh RTP details");
  assertIncludes(automaticRecommendationTexts, "10.00%", "Seth 2 recommendation displays its bet-volume ratio");
  if (automaticRecommendationTexts.some((value) => value === "即時房間數據同步中")) {
    throw new Error("Electronic data-ready flow must not send a second waiting card");
  }
  electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特2",
    tables: [{ roomId: "seth-background-8", number: 8, status: "Empty" }],
  });
  electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-background-8",
      number: 8,
      status: "Empty",
      todayWin: 97,
      todayBet: 100,
      dayWin: 900,
      dayBet: 1000,
    },
  });
  electronic.setGameSession("user-smoke", "戰神賽特2");
  setTimeout(() => electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-background-8",
      number: 8,
      status: "Empty",
      todayWin: 194,
      todayBet: 200,
      dayWin: 1800,
      dayBet: 2000,
    },
  }), 20);
  const backgroundDeliveryPushCount = captured.pushes.length;
  const backgroundDeliveryReply = await send("AI推薦房", "user-smoke");
  const backgroundDeliveryReplyTexts = backgroundDeliveryReply.messages
    .flatMap((message) => collectText(message));
  assertIncludes(
    backgroundDeliveryReplyTexts,
    "房間數據整理中",
    "Seth 2 must immediately acknowledge a recommendation request",
  );
  if (backgroundDeliveryReplyTexts.some((value) => String(value).includes("推薦房號"))) {
    throw new Error("Seth 2 final recommendation must not depend on the original LINE reply token");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const backgroundDeliveryPushTexts = captured.pushes
    .slice(backgroundDeliveryPushCount)
    .flatMap((entry) => entry.messages.flatMap((message) => collectText(message)));
  assertIncludes(
    backgroundDeliveryPushTexts,
    "推薦房號",
    "Seth 2 must deliver the final room through a background LINE push",
  );
  assertIncludes(
    backgroundDeliveryPushTexts,
    "97.00%",
    "Seth 2 background delivery must use freshly confirmed RTP",
  );
  electronicSource.resetForTest();
  await send("戰神賽特1", "user-smoke");
  if (!electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特1",
    scanId: "smoke-complete-empty-rooms",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    tables: [
      { roomId: "seth-1", number: 1, status: "Empty" },
      { roomId: "seth-2", number: 2, status: "Empty" },
    ],
  })) {
    throw new Error("Electronic empty-room fixture was rejected");
  }
  setTimeout(async () => {
    [1, 2].forEach((number) => electronicSource.ingestDetail({
      gameName: "戰神賽特1",
      detail: {
        roomId: `seth-${number}`,
        number,
        status: "Empty",
        todayWin: 99,
        todayBet: 100,
        dayWin: 990,
        dayBet: 1000,
      },
    }));
    await electronic.handleElectronicDataReady("戰神賽特1");
  }, 10);
  values = await sendAndTexts("AI推薦房", "user-smoke");
  assertIncludes(values, "房間數據整理中", "Seth 1 waits while fresh RTP is collected");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const sethOneRtpTexts = captured.pushes.at(-1).messages
    .flatMap((message) => collectText(message));
  assertIncludes(sethOneRtpTexts, "推薦房號", "Seth 1 RTP-backed recommendation");
  assertIncludes(sethOneRtpTexts, "99.00%", "Seth 1 recommendation includes live RTP");
  electronicSource.resetForTest();
  electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特1",
    scanId: "fresh-detail-recommendation",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    tables: [{ roomId: "seth-88", number: 88, status: "Empty" }],
  });
  electronicSource.ingestDetail({
    gameName: "戰神賽特1",
    detail: {
      roomId: "seth-88",
      number: 88,
      status: "Empty",
      todayWin: 90,
      todayBet: 100,
      dayWin: 900,
      dayBet: 1000,
    },
  });
  const waitingPushCount = captured.pushes.length;
  values = await sendAndTexts("重新推薦", "user-smoke");
  assertIncludes(values, "完成後會自動回傳推薦房間", "Electronic RTP waiting reply");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const waitingPushTexts = captured.pushes
    .slice(waitingPushCount)
    .flatMap((entry) => entry.messages.flatMap((message) => collectText(message)));
  assertIncludes(waitingPushTexts, "推薦房號", "Electronic live RTP recommendation push");
  assertIncludes(waitingPushTexts, "90.00%", "Electronic recommendation must use fresh RTP details");
  assertIncludes(waitingPushTexts, "結束該房間", "Electronic recommendation stop-room button");
  values = waitingPushTexts;
  assertIncludes(values, "結束該房間", "Electronic recommendation stop-room button");
  if (values.some((value) => String(value).includes("只推薦即時狀態為 Empty 的房間"))) {
    throw new Error("Electronic recommendation must not display internal Empty-room rules");
  }
  const zeroPayoutPushCount = captured.pushes.length;
  const zeroPayoutNotified = await electronic.handleElectronicSpin({
    gameName: "戰神賽特1",
    roomNumber: 88,
    spinId: "premature-zero-feature",
    totalWinnings: 0,
    featureTrigger: "purchased",
  });
  if (zeroPayoutNotified || captured.pushes.length !== zeroPayoutPushCount) {
    throw new Error("Electronic feature monitoring must never send a premature zero payout");
  }
  const retryableFeaturePushCount = captured.pushes.length;
  mockLineControl.pushFailuresRemaining = 1;
  const failedFeatureNotification = await electronic.handleElectronicSpin({
    gameName: "戰神賽特1",
    roomNumber: 88,
    spinId: "retryable-feature",
    totalWinnings: 500,
    featureTrigger: "purchased",
  });
  if (failedFeatureNotification || captured.pushes.length !== retryableFeaturePushCount) {
    throw new Error("Electronic failed LINE pushes must not be marked as delivered");
  }
  const retriedFeatureNotification = await electronic.handleElectronicSpin({
    gameName: "戰神賽特1",
    roomNumber: 88,
    spinId: "retryable-feature",
    totalWinnings: 500,
    featureTrigger: "purchased",
  });
  if (!retriedFeatureNotification || captured.pushes.length !== retryableFeaturePushCount + 1) {
    throw new Error("Electronic feature notifications must remain retryable after a LINE failure");
  }
  const naturalFeaturePushCount = captured.pushes.length;
  const naturalFeatureNotification = await electronic.handleElectronicSpin({
    gameName: "戰神賽特1",
    roomNumber: 88,
    spinId: "natural-feature-without-action",
    totalWinnings: 321,
    featureTrigger: "natural",
  });
  if (!naturalFeatureNotification || captured.pushes.length !== naturalFeaturePushCount + 1) {
    throw new Error("Confirmed natural features must not require an optional action label");
  }
  const featureRecords = await featureAudit.listFeatureNotifications(10);
  if (!featureRecords.some((record) => (
    record.spinId === "retryable-feature"
    && record.notificationSucceeded === false
    && record.winnings === 500
  ))) {
    throw new Error("Failed feature notifications must remain visible in the admin audit");
  }
  if (!featureRecords.some((record) => (
    record.spinId === "retryable-feature"
    && record.notificationSucceeded === true
    && record.member.lineUserId === "user-smoke"
  ))) {
    throw new Error("Successful feature notifications must identify the notified member in the admin audit");
  }
  if (!await electronic.isStillTracking("user-smoke", "戰神賽特1", 88)) {
    throw new Error("Admin feature audit must report an active room watch before the member stops it");
  }
  const crossPathDuplicatePushCount = captured.pushes.length;
  const originalDateNow = Date.now;
  const featureCompletionAt = originalDateNow() + 90 * 1000;
  Date.now = () => featureCompletionAt;
  let crossPathDuplicateNotification;
  try {
    crossPathDuplicateNotification = await electronic.handleElectronicSpin({
      gameName: "戰神賽特1",
      roomNumber: 88,
      spinId: "room-monitor-different-id-same-feature",
      totalWinnings: 321,
      featureTrigger: "room-monitor",
    });
  } finally {
    Date.now = originalDateNow;
  }
  if (crossPathDuplicateNotification || captured.pushes.length !== crossPathDuplicatePushCount) {
    throw new Error("Electronic feature delivery must suppress the delayed completion event after early delivery");
  }
  values = await sendAndTexts("結束房間監控 戰神賽特1 089", "user-smoke");
  assertIncludes(values, "目前監控房間已變更", "Old electronic recommendation card guard");
  values = await sendAndTexts("結束房間監控 戰神賽特1 088", "user-smoke");
  assertIncludes(values, "監控已結束", "Electronic room monitoring stop");
  assertIncludes(values, "已停止接收通知", "Electronic room monitoring stop confirmation");
  assertIncludes(values, "後續特色遊戲結果不會再傳送給您", "Electronic room monitoring stop explanation");
  const stoppedWatchRow = mockElectronicRows.get("electronic_watch:user-smoke");
  if (
    stoppedWatchRow?.value?.gameName !== "戰神賽特1"
    || stoppedWatchRow?.value?.roomNumber !== 88
    || !Number.isFinite(Number(stoppedWatchRow?.value?.stoppedAt))
  ) {
    throw new Error("Stopped electronic watches must persist a restart-safe tombstone");
  }
  const activeRoomsAfterStop = await electronic.getActiveWatchRooms();
  if (activeRoomsAfterStop.some((room) => (
    room.gameName === "戰神賽特1" && room.roomNumber === 88
  ))) {
    throw new Error("Stopped electronic rooms must be removed from the relay watch queue");
  }
  if (await electronic.isStillTracking("user-smoke", "戰神賽特1", 88)) {
    throw new Error("Admin feature audit must report that the member stopped tracking the room");
  }
  values = await sendAndTexts("結束房間監控 格式錯誤", "user-smoke");
  assertIncludes(values, "無法辨識房間", "Malformed electronic stop-room command guard");
  const stoppedWatchPushCount = captured.pushes.length;
  const stoppedWatchNotified = await electronic.handleElectronicSpin({
    gameName: "戰神賽特1",
    roomNumber: 88,
    spinId: "stopped-watch-feature",
    totalWinnings: 500,
    featureTrigger: "purchased",
  });
  if (stoppedWatchNotified || captured.pushes.length !== stoppedWatchPushCount) {
    throw new Error("Stopped electronic room monitoring must not send feature notifications");
  }
  electronicSource.resetForTest();
  electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特1",
    scanId: "cancel-inflight-seth-one",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    tables: [{ roomId: "seth-88", number: 88, status: "Empty" }],
  });
  electronic.setGameSession("cancel-inflight-user", "戰神賽特1");
  setTimeout(() => electronicSource.ingestDetail({
    gameName: "戰神賽特1",
    detail: {
      roomId: "seth-88",
      number: 88,
      status: "Empty",
      todayWin: 300,
      todayBet: 300,
      dayWin: 3000,
      dayBet: 3000,
    },
  }), 50);
  const cancelInFlightReplyCount = captured.replies.length;
  const cancelInFlightPushCount = captured.pushes.length;
  const cancelledRecommendationPromise = electronic.recommendRoom(
    event("AI推薦房", "cancel-inflight-user"),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  values = await sendAndTexts("取消推薦", "cancel-inflight-user");
  assertIncludes(values, "已取消推薦", "Electronic in-flight recommendation cancellation");
  await cancelledRecommendationPromise;
  if (captured.replies.length !== cancelInFlightReplyCount + 2) {
    throw new Error("Cancelled in-flight recommendation must not send a final reply");
  }
  const cancelledRecommendationPushTexts = captured.pushes
    .slice(cancelInFlightPushCount)
    .flatMap((entry) => entry.messages.flatMap((message) => collectText(message)));
  if (cancelledRecommendationPushTexts.some((value) => String(value).includes("推薦房號"))) {
    throw new Error("Cancelled in-flight recommendation must not push a room");
  }
  electronic.setGameSession("home-cancel-user", "戰神賽特1");
  setTimeout(() => electronicSource.ingestDetail({
    gameName: "戰神賽特1",
    detail: {
      roomId: "seth-88",
      number: 88,
      status: "Empty",
      todayWin: 500,
      todayBet: 500,
      dayWin: 5000,
      dayBet: 5000,
    },
  }), 50);
  const homeCancelReplyCount = captured.replies.length;
  const homeCancelledRecommendation = electronic.recommendRoom(
    event("AI推薦房", "home-cancel-user"),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  electronic.resetElectronicSession("home-cancel-user");
  await homeCancelledRecommendation;
  if (captured.replies.length !== homeCancelReplyCount + 1) {
    throw new Error("Returning home must cancel an in-flight electronic recommendation");
  }
  const restoredPendingKey = "electronic_pending:restored-pending-user";
  mockElectronicRows.set(restoredPendingKey, {
    id: restoredPendingKey,
    key: restoredPendingKey,
    value: {
      userId: "restored-pending-user",
      gameName: "戰神賽特2",
      requestedAt: Date.now(),
      deadlineAt: Date.now() + 60000,
    },
  });
  const restoredPendingCount = await electronic.hydratePendingRecommendations();
  if (restoredPendingCount < 1) {
    throw new Error("Electronic pending recommendations must restore after a restart");
  }
  values = await sendAndTexts("取消推薦", "restored-pending-user");
  assertIncludes(values, "已取消推薦", "Restored electronic recommendation cancellation");
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (mockElectronicRows.has(restoredPendingKey)) {
    throw new Error("Cancelling a restored recommendation must remove persistence");
  }
  electronicSource.resetForTest();
  electronic.setGameSession("recommend-timeout-user", "戰神賽特2");
  const timeoutPushCount = captured.pushes.length;
  await electronic.recommendRoom(event("AI推薦房", "recommend-timeout-user"));
  await new Promise((resolve) => setTimeout(resolve, 5200));
  const timeoutPushTexts = captured.pushes
    .slice(timeoutPushCount)
    .flatMap((entry) => entry.messages.flatMap((message) => collectText(message)));
  assertIncludes(timeoutPushTexts, "本次推薦已停止", "Electronic recommendation hard timeout notice");
  if (timeoutPushTexts.some((value) => String(value).includes("推薦房號"))) {
    throw new Error("Timed-out electronic recommendations must not send a room card");
  }
  electronicSource.resetForTest();
  electronicSource.ingestTables({
    type: "tables",
    gameName: "戰神賽特2",
    scanId: "monitored-room-scan",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    tables: [{ roomId: "seth-199", number: 199, status: "Empty" }],
  });
  electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Empty",
      todayWin: 111905.47,
      todayBet: 112025,
      mgCounts: [17, 3, 13],
      capturedAt: 1000,
    },
  });
  const featureStart = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Full",
      todayWin: 112038.27,
      todayBet: 112225,
      mgCounts: [0, 17, 3],
      capturedAt: 3500,
    },
  });
  if (
    featureStart.feature?.featureTrigger !== "room-monitor"
    || Math.abs(featureStart.feature.totalWinnings - 132.8) > 1e-6
  ) {
    throw new Error("Room feature monitor must catch a payout immediately after an empty room becomes occupied");
  }
  const featureStillRunning = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Full",
      todayWin: 112038.27,
      todayBet: 112225,
      mgCounts: [0, 17, 3],
      capturedAt: 6000,
    },
  });
  if (featureStillRunning.feature) {
    throw new Error("Room feature monitor must not finalize after one unchanged sample");
  }
  const featureSettled = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Full",
      todayWin: 112038.27,
      todayBet: 112225,
      mgCounts: [0, 17, 3],
      capturedAt: 9000,
    },
  });
  if (featureSettled.feature) {
    throw new Error("Room feature monitor must not send a duplicate payout after immediate delivery");
  }
  electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Full",
      todayWin: 112038.27,
      todayBet: 112225,
      mgCounts: [8, 0, 17],
      capturedAt: 12000,
    },
  });
  const pendingFeatureStart = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Full",
      todayWin: 112038.27,
      todayBet: 112225,
      mgCounts: [0, 8, 0],
      capturedAt: 14500,
    },
  });
  if (pendingFeatureStart.feature) {
    throw new Error("Room feature monitor must not emit a temporary zero payout");
  }
  const delayedZeroRoomTotal = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Empty",
      todayWin: 112038.27,
      todayBet: 112225,
      mgCounts: [0, 8, 0],
      capturedAt: 110000,
    },
  });
  if (delayedZeroRoomTotal.feature) {
    throw new Error("Room feature monitor must keep waiting without emitting a delayed zero");
  }
  const firstPositiveRoomTotal = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "seth-199",
      number: 199,
      status: "Empty",
      todayWin: 112093.27,
      todayBet: 112425,
      mgCounts: [0, 8, 0],
      capturedAt: 110500,
    },
  });
  if (Math.abs(firstPositiveRoomTotal.feature?.totalWinnings - 55) > 1e-6) {
    throw new Error("Room feature monitor must return the first later positive payout immediately");
  }

  electronicSource.resetForTest();
  electronicSource.ingestTables({
    gameName: "戰神賽特2",
    tables: [{
      roomId: "occupied-watched-room",
      number: 2468,
      status: "Empty",
      todayWin: 100,
      todayBet: 200,
      mgCounts: [12, 5, 1],
    }],
  });
  electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "occupied-watched-room",
      number: 2468,
      status: "Empty",
      todayWin: 100,
      todayBet: 200,
      mgCounts: [12, 5, 1],
      capturedAt: Date.now(),
    },
  });
  electronicSource.ingestTables({
    gameName: "戰神賽特2",
    scanId: "empty-pool-after-player-entered",
    page: 1,
    totalPages: 1,
    scanComplete: true,
    emptyOnly: true,
    tables: [],
  });
  const removedRoomFeature = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "occupied-watched-room",
      number: 2468,
      status: "Full",
      todayWin: 188,
      todayBet: 210,
      mgCounts: [0, 12, 5],
      capturedAt: Date.now() + 1000,
    },
  });
  if (
    removedRoomFeature?.feature?.featureTrigger !== "room-monitor"
    || Math.abs(removedRoomFeature.feature.totalWinnings - 88) > 1e-6
  ) {
    throw new Error("Occupied recommended rooms must remain feature-monitored after leaving the empty-room pool");
  }

  electronicSource.resetForTest();
  electronicSource.ingestTables({
    gameName: "戰神賽特2",
    tables: [{
      roomId: "delayed-feature-sample",
      number: 1165,
      status: "Empty",
      todayWin: 100,
      todayBet: 1000,
      mgCounts: [17, 3, 13],
    }],
  });
  electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "delayed-feature-sample",
      number: 1165,
      status: "Empty",
      todayWin: 100,
      todayBet: 1000,
      mgCounts: [17, 3, 13],
      capturedAt: Date.now(),
    },
  });
  const delayedFeatureSample = electronicSource.ingestDetail({
    gameName: "戰神賽特2",
    detail: {
      roomId: "delayed-feature-sample",
      number: 1165,
      status: "Full",
      todayWin: 155,
      todayBet: 1100,
      mgCounts: [2, 17, 3],
      capturedAt: Date.now() + 2000,
    },
  });
  if (
    delayedFeatureSample?.feature?.featureTrigger !== "room-monitor"
    || Math.abs(delayedFeatureSample.feature.totalWinnings - 55) > 1e-6
  ) {
    throw new Error("Seth 2 room monitoring must detect a feature after polling misses the exact zero count");
  }
  const deniedAdminWatch = electronic.startAdminRoomWatch(
    "non-admin-direct-watch",
    "戰神賽特2",
    1165,
  );
  if (deniedAdminWatch.ok) {
    throw new Error("Direct electronic room monitoring must be restricted to administrators");
  }
  const invalidAdminWatch = electronic.startAdminRoomWatch(
    "Uaf293ee976e5170d4e8672d2c12b3f76",
    "戰神賽特2",
    4001,
  );
  if (invalidAdminWatch.ok) {
    throw new Error("Direct electronic room monitoring must validate each game's room range");
  }
  const adminWatch = electronic.startAdminRoomWatch(
    "Uaf293ee976e5170d4e8672d2c12b3f76",
    "戰神賽特2",
    1165,
  );
  const activeAdminWatch = await electronic.getActiveWatchForUser(
    "Uaf293ee976e5170d4e8672d2c12b3f76",
  );
  if (
    !adminWatch.ok
    || activeAdminWatch?.gameName !== "戰神賽特2"
    || activeAdminWatch?.roomNumber !== 1165
    || activeAdminWatch?.adminDirect !== true
  ) {
    throw new Error("Administrators must be able to directly monitor Seth 2 room 1165");
  }
  const exactOnlyPushCount = captured.pushes.length;
  const estimatedAdminNotification = await electronic.handleElectronicSpin({
    gameName: "戰神賽特2",
    roomNumber: 1165,
    spinId: "admin-room-statistics-only",
    totalWinnings: 55,
    featureTrigger: "room-monitor",
  });
  if (estimatedAdminNotification || captured.pushes.length !== exactOnlyPushCount) {
    throw new Error("Room-level payout deltas must never trigger exact feature notifications");
  }
  const exactAdminNotification = await electronic.handleElectronicSpin({
    gameName: "戰神賽特2",
    roomNumber: 1165,
    spinId: "admin-exact-feature-packet",
    totalWinnings: 888,
    featureTrigger: "purchased",
  });
  const exactAdminTexts = captured.pushes.at(-1)?.messages
    ?.flatMap((message) => collectText(message)) || [];
  if (
    !exactAdminNotification
    || captured.pushes.length !== exactOnlyPushCount + 1
    || !exactAdminTexts.includes("本次開獎金額（精確）")
    || !exactAdminTexts.includes("888.00")
  ) {
    throw new Error("Exact precomputed feature packets must notify the selected room before animation");
  }

  const atgGameMenuReply = await send("ATG", "user-smoke");
  const electronicCards = atgGameMenuReply.messages[0]?.contents?.contents || [];
  const electronicActions = electronicCards.map((item) => item.hero?.action?.text);
  if (electronicActions.join(",") !== "戰神賽特1,戰神賽特2,古神巴風特,虎小妹,赤三國") {
    throw new Error(`ATG electronic menu has incorrect game availability: ${electronicActions.join(",")}`);
  }
  values = atgGameMenuReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "戰神賽特1", "ATG combined game menu");
  if (values.some((value) => String(value).includes("暫未開放"))) {
    throw new Error("Enabled electronic game menu must not show unavailable status");
  }
  if (values.some((value) => String(value).includes("ATG賽馬"))) {
    throw new Error("Retired ATG horse must not appear inside the ATG electronic menu");
  }

  const lotteryMenuReply = await send("彩票", "user-smoke");
  values = lotteryMenuReply.messages.flatMap((message) => collectText(message));
  assertIncludes(values, "MB彈珠", "Lottery game menu");
  assertIncludes(values, "今彩539", "Lottery game menu");
  const lotteryCards = lotteryMenuReply.messages[0]?.contents?.contents || [];
  const lotteryActions = lotteryCards.map((item) => item.hero?.action?.text);
  if (lotteryActions.join(",") !== "MB彈珠,539") {
    throw new Error(`Lottery menu has incorrect game order: ${lotteryActions.join(",")}`);
  }
  if (!lotteryCards[1]?.hero?.url?.includes("lottery539-hd.webp")) {
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
  values = await sendAndTexts("mb彈珠", "user-smoke");
  assertIncludes(values, "獨立四賽道即時資料", "Lowercase MB command");
  values = await sendAndTexts("MB 賭城賽車", "user-smoke");
  assertIncludes(values, "主流 5碼", "MB track pick menu");
  values = await sendAndTexts("MB 賭城賽車 5碼", "user-smoke");
  assertIncludes(values, "冠軍、亞軍、季軍定位推薦", "MB analysis");
  assertIncludes(values, "最近 3 場開獎", "MB track data");
  assertIncludes(values, "202607240002", "MB track latest result");
  assertIncludes(values, "請核對預測期號是否與平台相同，下一場會自動分析。", "MB automatic next-draw notice");
  const mbAnalysisMessage = captured.replies[captured.replies.length - 1].messages[0];
  const mbAnalysisJson = JSON.stringify(mbAnalysisMessage);
  if (mbAnalysisJson.indexOf("期 AI推薦") > mbAnalysisJson.indexOf("最近 3 場開獎")) {
    throw new Error("MB recommendation must appear before draw history");
  }
  const regularChipWidths = (mbAnalysisJson.match(/"width":"25px"/g) || []).length;
  if (regularChipWidths !== 15 || mbAnalysisJson.includes('"width":"20px","height":"25px"')) {
    throw new Error("MB recommendation number chips must use a consistent size");
  }
  const mbSixMessage = mbAnalysisFlex(buildMbAnalysis(mbTrack, 6), mbTrack);
  const mbSixPickRows = [];
  (function collectMbSixPickRows(node) {
    if (!node || typeof node !== "object") return;
    if (
      node.layout === "horizontal"
      && node.contents?.length === 6
      && node.contents.every((item) => item?.width === "20px" && item?.height === "20px")
    ) mbSixPickRows.push(node);
    Object.values(node).forEach((child) => {
      if (Array.isArray(child)) child.forEach(collectMbSixPickRows);
      else if (child && typeof child === "object") collectMbSixPickRows(child);
    });
  }(mbSixMessage));
  if (mbSixPickRows.length !== 3) {
    throw new Error("MB six-number recommendation must render all six chips for all three ranks");
  }
  const pushesBeforeMbSettlement = captured.pushes.length;
  mbSource.ingestSocketEvent({
    event: "RESULT_PUBLIC",
    data: {
      dcs_id: 368,
      game_name: "PK-MBRACE-1",
      draw_num: "202607240004",
      next_draw_num: "202607240005",
      result: [6, 2, 9, 4, 1, 10, 3, 7, 5, 8],
      result_display: { sum: "8", over_under: "UNDER", odd_even: "EVEN" },
      result_time: 1784893342,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  if (captured.pushes.length !== pushesBeforeMbSettlement + 1) {
    throw new Error("MB live result must automatically deliver the next-period analysis once");
  }
  const mbAutomaticTexts = captured.pushes.at(-1).messages.flatMap((message) => collectText(message));
  assertIncludes(mbAutomaticTexts, "202607240004 期已開獎，下一期推薦已更新", "MB automatic settlement");
  assertIncludes(mbAutomaticTexts, "202607240005", "MB next-period target");
  mbSource.ingestSocketEvent({
    event: "RESULT_PUBLIC",
    data: {
      dcs_id: 368,
      game_name: "PK-MBRACE-1",
      draw_num: "202607240004",
      next_draw_num: "202607240005",
      result: [6, 2, 9, 4, 1, 10, 3, 7, 5, 8],
      result_display: { sum: "8", over_under: "UNDER", odd_even: "EVEN" },
      result_time: 1784893342,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  if (captured.pushes.length !== pushesBeforeMbSettlement + 1) {
    throw new Error("MB duplicate live results must not redeliver the same settlement");
  }

  mtSource.resetForTest();
  await send("百家樂", "user-smoke");
  values = await sendAndTexts("DG", "user-smoke");
  assertIncludes(values, "RB01", "Baccarat rooms");
  assertIncludes(values, "請選擇下方房號", "Baccarat room selection instruction");
  assertIncludes(values, "可選房號：", "Baccarat room selection must repeat the actual buttons");
  if (values.some((value) => value.includes("也可以直接輸入正確房號") || value.includes("支援手動輸入"))) {
    throw new Error("Baccarat room selection must not advertise unrelated manual room examples");
  }
  if (values.includes("S07")) {
    throw new Error("DG room menu must hide stale live rooms");
  }
  await send("RB01", "user-smoke");
  values = await sendAndTexts("自由配注", "user-smoke");
  assertIncludes(values, "本房牌路統計", "Baccarat room statistics");
  assertIncludes(values, "請核對本局莊、閒、和是否與平台一致，下一局會自動分析。", "Baccarat platform verification notice");
  assertIncludes(values, "等待本房下一局開獎", "Baccarat immediate automatic recommendation");
  assertIncludes(values, "玩家自行決定", "Baccarat free-bet direction");
  assertIncludes(values, "有效命中", "Baccarat resolved hit-rate label");
  assertIncludes(values, "結束並返回遊戲選單", "Baccarat persistent exit button");
  const dgAutoMessage = captured.replies[captured.replies.length - 1].messages[0];
  const dgAutoJson = JSON.stringify(dgAutoMessage);
  if (dgAutoJson.includes("莊家數學基準")) {
    throw new Error("Baccarat result card must not expose internal model wording");
  }
  if (!collectActions(dgAutoMessage).some((action) => action.text === "首頁")) {
    throw new Error("Baccarat exit button must return to the main game menu");
  }
  for (const color of ["#D71920", "#1464D2", "#278A18", "#9A6728"]) {
    if (!dgAutoJson.includes(color)) throw new Error(`Baccarat room statistics missing color ${color}`);
  }
  const longRoomStatsMessage = baccaratAnalysisFlex({
    session: {
      mode: "天門",
      bankroll: 50000,
      startBankroll: 50000,
      maxBet: 5000,
      results: { pass: 0, fail: 0, tie: 0 },
      platform: "DG",
      room: "RB02",
    },
    prediction: "閒",
    bet: 3100,
    roomStats: { banker: 12345, player: 67890, tie: 1234, total: 81469 },
    autoResult: true,
  });
  const longStatsPanel = findNode(
    longRoomStatsMessage,
    (node) => node.layout === "vertical"
      && Array.isArray(node.contents)
      && node.contents.some((item) => item?.text === "本房牌路統計"),
  );
  const longStatsRows = longStatsPanel?.contents?.slice(1) || [];
  if (
    longStatsRows.length !== 1
    || longStatsRows[0]?.layout !== "horizontal"
    || longStatsRows[0]?.contents?.length !== 4
  ) {
    throw new Error("Baccarat room statistics must use one platform-style badge row");
  }
  for (const label of ["莊", "閒", "和", "總"]) {
    if (!findNode(longStatsPanel, (node) => node.type === "text" && node.text === label)) {
      throw new Error(`Baccarat room statistics missing Traditional Chinese badge: ${label}`);
    }
  }
  for (const value of ["12345", "67890", "1234", "81469"]) {
    const valueNode = findNode(longStatsPanel, (node) => node.type === "text" && node.text === value);
    if (!valueNode || valueNode.wrap !== false || valueNode.adjustMode !== "shrink-to-fit") {
      throw new Error(`Baccarat room statistic ${value} must remain fully visible`);
    }
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
  assertBaccaratRecord(
    captured.pushes[captured.pushes.length - 1].messages[0],
    { 命中: 0, 未中: 1, 和局: 0, 觀望: 0 },
    "Baccarat automatic immediate recommendation result",
  );

  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: ["#9#0#0", "#1#0#0", "#9#0#0", "#5#0#0", "#1#0#0"],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dgPushTexts = captured.pushes[captured.pushes.length - 1].messages.flatMap((message) => collectText(message));
  assertBaccaratRecord(
    captured.pushes[captured.pushes.length - 1].messages[0],
    { 命中: 0, 未中: 1, 和局: 1, 觀望: 0 },
    "Baccarat automatic tie result",
  );

  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: ["#1#0#0", "#9#0#0", "#1#0#0", "#9#0#0", "#5#0#0", "#1#0#0"],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dgPushTexts = captured.pushes[captured.pushes.length - 1].messages.flatMap((message) => collectText(message));
  assertBaccaratRecord(
    captured.pushes[captured.pushes.length - 1].messages[0],
    { 命中: 0, 未中: 2, 和局: 1, 觀望: 0 },
    "Baccarat automatic result",
  );
  if (dgPushTexts.some((value) => String(value).includes("上局結算"))) {
    throw new Error("Baccarat Flex must not show the previous-round settlement row");
  }
  const pushesBeforeDgGap = captured.pushes.length;
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: [
      "#1#0#0",
      "#5#0#0",
      "#1#0#0",
      "#9#0#0",
      "#1#0#0",
      "#9#0#0",
      "#5#0#0",
      "#1#0#0",
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeDgGap + 1) {
    throw new Error("DG multi-round gaps must push one resynchronized analysis");
  }
  dgPushTexts = captured.pushes[captured.pushes.length - 1].messages
    .flatMap((message) => collectText(message));
  assertIncludes(dgPushTexts, "缺漏局已略過，本次未計算過倒", "Baccarat gap resync notice");
  assertBaccaratRecord(
    captured.pushes[captured.pushes.length - 1].messages[0],
    { 命中: 0, 未中: 2, 和局: 1, 觀望: 0 },
    "Baccarat gap must not change the settlement record",
  );
  const baccaratAudit = getBaccaratSession("user-smoke").predictionAudit || [];
  if (
    baccaratAudit.length !== 3
    || baccaratAudit.some((record) => record.modelVersion !== "baccarat-recent-road-v4")
    || baccaratAudit[baccaratAudit.length - 1].verdict !== "倒"
  ) {
    throw new Error("Baccarat must retain an exact model-versioned audit for settled live events only");
  }
  const pushesBeforeDgRollback = captured.pushes.length;
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: [
      "#5#0#0",
      "#1#0#0",
      "#9#0#0",
      "#1#0#0",
      "#9#0#0",
      "#5#0#0",
      "#1#0#0",
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeDgRollback) {
    throw new Error("DG stale rollback snapshots must not push or settle another analysis");
  }
  const pushesBeforeDgCorrection = captured.pushes.length;
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 0,
    list: [
      "#1#0#0",
      "#5#0#0",
      "#5#0#0",
      "#9#0#0",
      "#1#0#0",
      "#9#0#0",
      "#5#0#0",
      "#1#0#0",
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeDgCorrection + 1) {
    throw new Error("DG corrected snapshots must push one reconciled analysis");
  }
  const dgCorrectionTexts = captured.pushes[captured.pushes.length - 1].messages
    .flatMap((message) => collectText(message));
  assertIncludes(
    dgCorrectionTexts,
    "路單修正已同步，既有統計已重新計算",
    "Baccarat correction reconciliation notice",
  );
  assertBaccaratRecord(
    captured.pushes[captured.pushes.length - 1].messages[0],
    { 命中: 1, 未中: 1, 和局: 1, 觀望: 0 },
    "Baccarat corrected accounting",
  );
  const correctedAudit = (getBaccaratSession("user-smoke").predictionAudit || [])
    .find((record) => Number(record.roundIndex) === 6);
  if (correctedAudit?.actual !== "閒" || correctedAudit?.verdict !== "過") {
    throw new Error("Baccarat correction must reconcile the original audit and verdict");
  }

  const catchUpUser = "baccarat-catch-up-user";
  const catchUpTable = dgSource.getTableByRoom("RB01");
  const catchUpPrevious = catchUpTable.history.at(-2);
  setBaccaratSession(catchUpUser, {
    platform: "DG",
    room: "RB01",
    mode: "自由配注",
    step: "playing",
    history: catchUpTable.history.slice(0, -1).map((record) => record.result),
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    lastPrediction: "莊",
    lastBet: null,
    lastPredictionMeta: { modelVersion: "baccarat-recent-road-v4" },
    lastLiveEventKey: catchUpPrevious.eventKey,
    lastLiveGameNo: catchUpPrevious.gameNo,
    lastLiveShoeKey: catchUpPrevious.shoeKey,
    lastLiveRoundIndex: catchUpPrevious.roundIndex,
  });
  const pushesBeforeCatchUp = captured.pushes.length;
  const firstCatchUp = await baccaratModule.reconcileActiveBaccaratSession(catchUpUser);
  if (!firstCatchUp.advanced || captured.pushes.length !== pushesBeforeCatchUp + 1) {
    throw new Error("Baccarat missed-round reconciliation must advance exactly once");
  }
  const secondCatchUp = await baccaratModule.reconcileActiveBaccaratSession(catchUpUser);
  if (secondCatchUp.advanced || captured.pushes.length !== pushesBeforeCatchUp + 1) {
    throw new Error("Baccarat missed-round reconciliation must not duplicate a settled round");
  }
  await resetBaccaratSession(catchUpUser);

  const fundingStopUser = "funding-stop-user";
  const fundingStopRoad = ["莊", "閒"];
  dgSource.ingestMessage({
    cmd: 1002,
    table: [{
      tableId: 303,
      tableName: "RB03",
      shoeId: 3030,
      roads: dgRoad(fundingStopRoad),
    }],
  });
  const fundingStopTable = dgSource.getTableByRoom("RB03");
  const fundingStopCursor = fundingStopTable.history.at(-1);
  setBaccaratSession(fundingStopUser, {
    platform: "DG",
    room: "RB03",
    mode: "AI配注",
    capital: 1000,
    startBankroll: 1000,
    bankroll: 65,
    maxBet: 1000,
    step: "playing",
    history: [...fundingStopRoad],
    results: { pass: 0, fail: 0, tie: 0, observe: 0 },
    lastPrediction: "莊",
    lastBet: 0,
    lastPredictionMeta: { modelVersion: "baccarat-recent-road-v4" },
    lastLiveEventKey: fundingStopCursor.eventKey,
    lastLiveGameNo: fundingStopCursor.gameNo,
    lastLiveShoeKey: fundingStopCursor.shoeKey,
    lastLiveRoundIndex: fundingStopCursor.roundIndex,
  });
  const pushesBeforeFundingStop = captured.pushes.length;
  fundingStopRoad.push("和");
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 303,
    shoeId: 3030,
    list: dgRoad(fundingStopRoad),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeFundingStop + 1) {
    throw new Error("Baccarat insufficient bankroll must push one automatic stop notice");
  }
  const fundingStopTexts = captured.pushes.at(-1).messages
    .flatMap((message) => collectText(message));
  assertIncludes(fundingStopTexts, "資金條件不足，已停止分析", "Baccarat funding stop title");
  assertIncludes(fundingStopTexts, "不會繼續回傳觀望", "Baccarat funding stop explanation");
  if (hasActiveBaccaratSession(fundingStopUser)) {
    throw new Error("Baccarat insufficient bankroll must remove the active room session");
  }
  fundingStopRoad.push("莊");
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 303,
    shoeId: 3030,
    list: dgRoad(fundingStopRoad),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeFundingStop + 1) {
    throw new Error("A stopped baccarat room must not keep pushing observe results");
  }

  const repeatedCorrectionUser = "bound-user";
  const repeatedRoad = ["莊", "莊", "莊"];
  dgSource.ingestMessage({
    cmd: 1002,
    table: [{
      tableId: 2,
      tableName: "RB02",
      shoeId: 200,
      roads: dgRoad(repeatedRoad),
    }],
  });
  await send("百家樂", repeatedCorrectionUser);
  await send("DG", repeatedCorrectionUser);
  await send("RB02", repeatedCorrectionUser);
  await send("自由配注", repeatedCorrectionUser);
  for (let round = 4; round <= 6; round += 1) {
    repeatedRoad.push("莊");
    dgSource.ingestMessage({
      cmd: 1004,
      tableId: 2,
      shoeId: 200,
      list: dgRoad(repeatedRoad),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  let repeatedSession = getBaccaratSession(repeatedCorrectionUser);
  if (
    repeatedSession.results.pass !== 3
    || repeatedSession.results.fail !== 0
    || repeatedSession.predictionAudit?.length !== 3
  ) {
    throw new Error(`Baccarat repeated-correction fixture must begin with three settled wins: ${JSON.stringify({
      platform: repeatedSession.platform,
      room: repeatedSession.room,
      step: repeatedSession.step,
      lastPrediction: repeatedSession.lastPrediction,
      lastLiveEventKey: repeatedSession.lastLiveEventKey,
      results: repeatedSession.results,
      audits: repeatedSession.predictionAudit,
      table: dgSource.getTableByRoom("RB02"),
    })}`);
  }
  const pushesBeforeFirstRepeatedCorrection = captured.pushes.length;
  const firstCorrectedRoad = ["莊", "莊", "莊", "莊", "莊", "閒"];
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 2,
    shoeId: 200,
    list: dgRoad(firstCorrectedRoad),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  repeatedSession = getBaccaratSession(repeatedCorrectionUser);
  const firstGenerationAudits = repeatedSession.predictionAudit || [];
  if (
    captured.pushes.length !== pushesBeforeFirstRepeatedCorrection + 1
    || repeatedSession.results.pass !== 2
    || repeatedSession.results.fail !== 1
    || firstGenerationAudits.length !== 3
    || new Set(firstGenerationAudits.map((record) => record.shoeKey)).size !== 1
  ) {
    throw new Error("The first Baccarat correction must migrate the full audit generation");
  }
  const firstCorrectedShoeKey = firstGenerationAudits[0].shoeKey;
  const pushesBeforeSecondRepeatedCorrection = captured.pushes.length;
  const secondCorrectedRoad = ["莊", "莊", "莊", "莊", "閒", "閒"];
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 2,
    shoeId: 200,
    list: dgRoad(secondCorrectedRoad),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  repeatedSession = getBaccaratSession(repeatedCorrectionUser);
  const twiceCorrectedAudits = repeatedSession.predictionAudit || [];
  const latestRepeatedHistory = new Map(
    (dgSource.getTableByRoom("RB02")?.history || [])
      .map((record) => [Number(record.roundIndex), record]),
  );
  const sixthAudit = twiceCorrectedAudits
    .find((record) => Number(record.roundIndex) === 6);
  if (
    captured.pushes.length !== pushesBeforeSecondRepeatedCorrection + 1
    || repeatedSession.results.pass !== 1
    || repeatedSession.results.fail !== 2
    || repeatedSession.results.tie !== 0
    || twiceCorrectedAudits.length !== 3
    || twiceCorrectedAudits.map((record) => record.actual).join("") !== "莊閒閒"
    || twiceCorrectedAudits.map((record) => record.verdict).join("") !== "過倒倒"
    || new Set(twiceCorrectedAudits.map((record) => record.shoeKey)).size !== 1
    || twiceCorrectedAudits[0].shoeKey === firstCorrectedShoeKey
    || new Set(twiceCorrectedAudits.map((record) => record.eventKey)).size !== 3
    || twiceCorrectedAudits.some((record) => (
      latestRepeatedHistory.get(Number(record.roundIndex))?.eventKey !== record.eventKey
    ))
    || sixthAudit?.stateBefore?.results?.pass !== 1
    || sixthAudit?.stateBefore?.results?.fail !== 1
  ) {
    throw new Error("Repeated Baccarat corrections must fully reconcile accounting and audit identity");
  }
  const noAuditGapRoad = [...secondCorrectedRoad, "莊", "莊"];
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 2,
    shoeId: 200,
    list: dgRoad(noAuditGapRoad),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const beforeUnaffectedCorrection = getBaccaratSession(repeatedCorrectionUser);
  if (
    beforeUnaffectedCorrection.results.pass !== 1
    || beforeUnaffectedCorrection.results.fail !== 2
    || beforeUnaffectedCorrection.predictionAudit?.length !== 3
  ) {
    throw new Error("Baccarat round gaps must preserve settled audits before an unrelated correction");
  }
  const pushesBeforeUnaffectedCorrection = captured.pushes.length;
  const noAuditCorrectedRoad = [...secondCorrectedRoad, "莊", "閒"];
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 2,
    shoeId: 200,
    list: dgRoad(noAuditCorrectedRoad),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const afterUnaffectedCorrection = getBaccaratSession(repeatedCorrectionUser);
  const unaffectedAudits = afterUnaffectedCorrection.predictionAudit || [];
  const unaffectedHistory = new Map(
    (dgSource.getTableByRoom("RB02")?.history || [])
      .map((record) => [Number(record.roundIndex), record]),
  );
  if (
    captured.pushes.length !== pushesBeforeUnaffectedCorrection + 1
    || afterUnaffectedCorrection.results.pass !== 1
    || afterUnaffectedCorrection.results.fail !== 2
    || afterUnaffectedCorrection.results.tie !== 0
    || unaffectedAudits.length !== 3
    || new Set(unaffectedAudits.map((record) => record.shoeKey)).size !== 1
    || unaffectedAudits[0].shoeKey === twiceCorrectedAudits[0].shoeKey
    || unaffectedAudits.some((record) => (
      unaffectedHistory.get(Number(record.roundIndex))?.eventKey !== record.eventKey
    ))
  ) {
    throw new Error("Corrections after the last audited round must only migrate audit identity");
  }
  const cancellationGate = {
    events: [],
    started: createDeferred(),
    release: createDeferred(),
    startedAt: null,
  };
  mockLineControl.pushGate = cancellationGate;
  const pushesBeforeCancellationBarrier = captured.pushes.length;
  dgSource.ingestMessage({
    cmd: 1004,
    tableId: 2,
    shoeId: 200,
    list: dgRoad([...noAuditCorrectedRoad, "莊"]),
  });
  for (let attempt = 0; attempt < 10 && !cancellationGate.startedAt; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!cancellationGate.startedAt) {
    throw new Error("Baccarat cancellation barrier fixture did not start an automatic push");
  }
  const cancellationReplyPromise = send("返回首頁", repeatedCorrectionUser)
    .then((response) => {
      cancellationGate.events.push("cancel-complete");
      return response;
    });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (cancellationGate.events.includes("cancel-complete")) {
    throw new Error("Baccarat cancellation must wait for an in-flight automatic push");
  }
  cancellationGate.release.resolve();
  const cancellationReply = await cancellationReplyPromise;
  const deliveredIndex = cancellationGate.events.indexOf("push-delivered");
  const cancelledIndex = cancellationGate.events.indexOf("cancel-complete");
  const cancellationReplyTexts = cancellationReply.messages
    .flatMap((message) => collectText(message));
  if (
    deliveredIndex < 0
    || cancelledIndex <= deliveredIndex
    || captured.pushes.length !== pushesBeforeCancellationBarrier + 1
    || !cancellationReplyTexts.some((value) => String(value).includes("彩票 AI"))
    || hasActiveBaccaratSession(repeatedCorrectionUser)
  ) {
    throw new Error(`Baccarat cancellation barrier has incorrect ordering: ${cancellationGate.events.join(" -> ")}`);
  }

  const invalidBaccaratReply = await send("不是有效開獎結果", "user-smoke");
  const invalidBaccaratActions = collectActions(invalidBaccaratReply.messages[0])
    .map((action) => action.text);
  const invalidBaccaratTexts = invalidBaccaratReply.messages
    .flatMap((message) => collectText(message));
  if (
    !invalidBaccaratActions.includes("重新開始")
    || !invalidBaccaratActions.includes("返回房號")
    || !invalidBaccaratActions.includes("返回首頁")
    || !invalidBaccaratTexts.some((value) => String(value).includes("自動同步開獎"))
  ) {
    throw new Error(`Baccarat invalid input must return a usable recovery quick reply: ${JSON.stringify(invalidBaccaratActions)}`);
  }
  const baccaratEpochBeforeRoomExit = getBaccaratSession("user-smoke").sessionEpoch;
  values = await sendAndTexts("返回房號", "user-smoke");
  assertIncludes(values, "DG 房號選擇", "Baccarat room exit returns to the room list");
  const roomExitSession = getBaccaratSession("user-smoke");
  if (
    roomExitSession.sessionEpoch === baccaratEpochBeforeRoomExit
    || roomExitSession.step !== "room"
    || roomExitSession.results.pass !== 0
    || roomExitSession.results.fail !== 0
  ) {
    throw new Error("Baccarat room exit must end the old room settlement session");
  }
  await send("RB01", "user-smoke");
  await send("自由配注", "user-smoke");

  values = await sendAndTexts("重新開始", "user-smoke");
  assertIncludes(values, "DG 房號選擇", "Baccarat restart returns to current platform rooms");
  values = await sendAndTexts("返回首頁", "user-smoke");
  assertIncludes(values, "彩票 AI", "Baccarat home returns to the main menu");
  if (hasActiveBaccaratSession("user-smoke")) {
    throw new Error("Baccarat home must end the active Baccarat session");
  }

  await send("百家樂", "user-smoke");
  values = await sendAndTexts("MT", "user-smoke");
  assertIncludes(values, "MT01", "MT baccarat rooms");
  values = await sendAndTexts("MT01", "user-smoke");
  assertIncludes(values, "請選擇分析模式", "MT baccarat mode flow");
  assertIncludes(values, "自由配注", "MT baccarat mode flow");
  values = await sendAndTexts("自由配注", "user-smoke");
  assertIncludes(values, "MT 即時資料同步中", "MT stale-data recommendation guard");
  assertIncludes(values, "不會使用上一局或逾時資料產生推薦", "MT stale-data warning");
  if (values.includes("AI分析結果")) {
    throw new Error("MT must not recommend from an unavailable or stale snapshot");
  }
  const pushesBeforeMtRecovery = captured.pushes.length;
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (captured.pushes.length !== pushesBeforeMtRecovery + 1) {
    throw new Error("MT must automatically resume only after a fresh table event arrives");
  }
  const mtRecoveryTexts = captured.pushes[captured.pushes.length - 1].messages
    .flatMap((message) => collectText(message));
  assertIncludes(mtRecoveryTexts, "自動結算", "MT fresh-data automatic recovery");
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

  await push("push-user", "測試推播");
  await multicast(["user-a", "user-b"], "測試群發");
  assertMessage(image("https://example.com/image.png"));

  const tombstoneUser = "baccarat-tombstone-smoke";
  getBaccaratSession(tombstoneUser);
  await new Promise((resolve) => setTimeout(resolve, 0));
  setBaccaratSession(tombstoneUser, { platform: "DG", room: "RB01" });
  mockSupabaseControl.cancellationFailuresRemaining = 3;
  const cancellationAttemptsBefore = mockSupabaseControl.cancellationAttempts;
  const firstCancellation = resetBaccaratSession(tombstoneUser);
  const duplicateCancellation = resetBaccaratSession(tombstoneUser);
  if (firstCancellation !== duplicateCancellation) {
    throw new Error("Concurrent Baccarat cancellations must share one persistence operation");
  }
  const failedCancellations = await Promise.allSettled([
    firstCancellation,
    duplicateCancellation,
  ]);
  if (
    failedCancellations.some((result) => result.status !== "rejected")
    || mockSupabaseControl.cancellationAttempts - cancellationAttemptsBefore !== 3
    || hasActiveBaccaratSession(tombstoneUser)
  ) {
    throw new Error("Failed Baccarat tombstones must reject once without restoring the active session");
  }
  const staleRow = mockBaccaratRows.get(`baccarat_session:${tombstoneUser}`);
  if (!staleRow || staleRow.value?.cancelled) {
    throw new Error("Failed Baccarat tombstones must leave the stale row visible for a real retry");
  }
  const retryResult = await resetBaccaratSession(tombstoneUser);
  const tombstoneRow = mockBaccaratRows.get(`baccarat_session:${tombstoneUser}`);
  if (
    retryResult !== true
    || mockSupabaseControl.cancellationAttempts - cancellationAttemptsBefore !== 4
    || tombstoneRow?.value?.cancelled !== true
  ) {
    throw new Error("A repeated Baccarat cancellation must persist the retained tombstone");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  mockBaccaratRows.clear();
  mockBaccaratRows.set(`baccarat_session:${tombstoneUser}`, tombstoneRow);
  const baccaratSessionPath = require.resolve("../modules/baccarat/session");
  const cachedBaccaratSessionModule = require.cache[baccaratSessionPath];
  delete require.cache[baccaratSessionPath];
  const restartedBaccaratSession = require("../modules/baccarat/session");
  const restoredAfterCancellation = await restartedBaccaratSession.hydrateSessions();
  if (
    restoredAfterCancellation !== 0
    || restartedBaccaratSession.hasActiveSession(tombstoneUser)
  ) {
    throw new Error("Persisted Baccarat tombstones must not revive after restart");
  }
  require.cache[baccaratSessionPath] = cachedBaccaratSessionModule;

  for (const item of captured.replies) item.messages.forEach(assertMessage);
  for (const item of captured.pushes) item.messages.forEach(assertMessage);
  for (const item of captured.multicasts) item.messages.forEach(assertMessage);
  console.log(`Smoke test passed: ${captured.replies.length} replies, ${captured.pushes.length} push, ${captured.multicasts.length} multicast.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
