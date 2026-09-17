const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../public/portal/app.js"), "utf8");
function portalFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing portal function ${name}`);
  const remaining = source.slice(start);
  if (name !== "renderResults") return remaining.split(/\r?\n/)[0];
  return remaining.slice(0, remaining.indexOf("\nasync function send("));
}

function flex(title, game = "虎小妹", extra = []) {
  return { type: "flex", altText: title, contents: { type: "bubble", body: {
    type: "box", contents: [title, game, ...extra].filter(Boolean).map(text => ({ type: "text", text })),
  } } };
}
const waiting = () => flex("房間數據整理中");
const complete = (game = "虎小妹") => flex("AI推薦房", game, ["推薦房號", "1566"]);

function fixture() {
  const state = { now: 10_000, stagePresent: true, step: 2, fetches: 0, history: [], navigations: 0 };
  const heading = { textContent: "正在分析" }, copy = { textContent: "" };
  const stage = {
    classList: { toggle() {} },
    querySelector: selector => selector === "h2" ? heading : copy,
    remove() { state.stagePresent = false; },
  };
  const target = { innerHTML: "", querySelectorAll: () => [], scrollIntoView() {} };
  const context = vm.createContext({
    console, Date: { now: () => state.now }, authenticated: true,
    electronicRecoveryInFlight: false, ELECTRONIC_CLIENT_TIMEOUT_MS: 95_000,
    routeRevision: 1, currentPath: "/portal/atg/tiger/recommend",
    activeOperation: { categoryKey: "atg", mode: "recommend", startedAt: 1_000, item: { fullName: "虎小妹" } },
    document: {
      querySelector: selector => selector === "#result" ? target : selector === "#analysisStage" && state.stagePresent ? stage : null,
    },
    escapeHtml: value => String(value ?? ""),
    genericResultBody: texts => texts.join(" | "),
    resultCard: message => `<article>${message.altText}: ${context.walk(message.contents).texts.join(" | ")}</article>`,
    setAnalysisFlowStep: step => { state.step = step; },
    toast() {}, renderLogin() {},
    navigate() { state.navigations++; },
    fetch: async () => {
      state.fetches++;
      return { ok: true, status: 200, json: async () => ({ messages: state.history }) };
    },
  });
  for (const name of ["walk", "routeForCommand", "actionMarkup", "quickReplyActions", "messageBelongsToActiveOperation",
    "showAnalysisState", "localizeResultLabels", "electronicRecommendationState", "renderResults",
    "recoverElectronicRecommendation", "expireElectronicRecommendation", "restartElectronicRecommendation"]) {
    vm.runInContext(portalFunction(name), context);
  }
  return { context, state, target, heading };
}

test("waiting acknowledgement keeps recovery active and never claims completion", () => {
  const { context, state, target, heading } = fixture();
  for (const title of ["房間數據整理中", "房間數據仍在整理中", "即時房間數據同步中"]) {
    context.renderResults(flex(title));
    assert.equal(state.stagePresent, true);
    assert.equal(state.step, 2);
    assert.equal(heading.textContent, "房間數據整理中");
    assert.match(target.innerHTML, /取消推薦/);
    assert.match(target.innerHTML, /data-go="\/portal\/"/);
    assert.doesNotMatch(target.innerHTML, /分析完成|已同步|AI ANALYSIS COMPLETE/);
  }
});

test("missed SSE result is recovered from history after waiting, excluding older and other-game results", async () => {
  const { context, state, target } = fixture();
  context.renderResults(waiting());
  state.history = [
    { at: 500, messages: [complete()] },
    { at: 2_000, messages: [complete()] },
    { at: 3_000, messages: [complete("赤三國")] },
  ];
  await context.recoverElectronicRecommendation();
  assert.equal(state.fetches, 1);
  assert.equal(state.stagePresent, false);
  assert.equal(state.step, 3);
  assert.match(target.innerHTML, /1566/);
  assert.doesNotMatch(target.innerHTML, /赤三國/);
  await context.recoverElectronicRecommendation();
  assert.equal(state.fetches, 1);
});

test("a late HTTP waiting acknowledgement cannot replace a completed SSE result", () => {
  const { context, target, state } = fixture();
  context.renderResults(complete(), { automatic: true, enforceScope: true });
  const result = target.innerHTML;
  assert.equal(context.renderResults(waiting()), false);
  assert.equal(target.innerHTML, result);
  assert.equal(state.step, 3);
});

test("a missed server stop or cancellation is recovered without a green completed label", async () => {
  for (const title of ["本次推薦已停止", "已取消推薦", "目前沒有可推薦的空房"]) {
    const { context, state, target } = fixture();
    context.renderResults(waiting());
    state.history = [{ at: 2_000, messages: [flex(title, title === "已取消推薦" ? "" : "虎小妹")] }];
    await context.recoverElectronicRecommendation();
    assert.equal(state.stagePresent, false);
    assert.equal(context.activeOperation.mode, "recommend-timeout");
    assert.match(target.innerHTML, /已停止/);
    assert.doesNotMatch(target.innerHTML, /分析完成|已同步/);
    const stopped = target.innerHTML;
    context.renderResults(waiting());
    assert.equal(target.innerHTML, stopped);
  }
});

test("95 second deadline remains effective after waiting and offers a fresh retry", () => {
  const { context, state, target } = fixture();
  context.renderResults(waiting());
  state.now = 95_999;
  context.expireElectronicRecommendation();
  assert.equal(state.stagePresent, true);
  state.now = 96_000;
  context.expireElectronicRecommendation();
  assert.equal(state.stagePresent, false);
  assert.match(target.innerHTML, /本次推薦已停止/);
  assert.match(target.innerHTML, /重新推薦/);
  assert.doesNotMatch(target.innerHTML, /已同步/);
  assert.equal(context.restartElectronicRecommendation(), true);
  assert.equal(state.navigations, 1);
});

test("recovery response cannot overwrite a new operation or a result that arrived while fetching", async () => {
  for (const transition of ["navigate", "result", "timeout"]) {
    const { context, state, target } = fixture();
    context.renderResults(waiting());
    let finish;
    context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = context.recoverElectronicRecommendation();
    if (transition === "navigate") {
      context.routeRevision++;
      context.activeOperation = { ...context.activeOperation, startedAt: state.now };
      target.innerHTML = "new operation";
    } else if (transition === "result") context.renderResults(complete());
    else { state.now = 96_000; context.expireElectronicRecommendation(); }
    const current = target.innerHTML;
    finish({ ok: true, json: async () => ({ messages: [{ at: 2_000, messages: [flex("本次推薦已停止")] }] }) });
    await pending;
    assert.equal(target.innerHTML, current);
    assert.equal(context.electronicRecoveryInFlight, false);
  }
});

test("waiting and final in the same response display the final room", () => {
  const { context, target, state } = fixture();
  context.renderResults([complete(), waiting()]);
  assert.equal(state.stagePresent, false);
  assert.match(target.innerHTML, /1566/);
  assert.doesNotMatch(target.innerHTML, /房間數據整理中/);
});

test("non-electronic result rendering remains unchanged", () => {
  const { context, target, state } = fixture();
  context.activeOperation = { categoryKey: "baccarat", mode: "analyze", item: {} };
  context.renderResults(flex("百家樂AI 分析結果", "", ["本房牌路統計"]), { automatic: true });
  assert.equal(state.stagePresent, false);
  assert.equal(state.step, 3);
  assert.match(target.innerHTML, /下一局分析已自動更新/);
});
