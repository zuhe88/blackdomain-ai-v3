const assert = require("node:assert/strict");
const { createOnboarding, STATES } = require("../modules/atgX/onboarding");
const cards = require("../modules/atgX/onboardingCards");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  let saved = {};
  const bot = createOnboarding({ storage: { get: async () => saved, save: async (_, value) => { saved = value; } } });
  let id = 0;
  const send = (text) => bot.handle({ type: "message", source: { type: "user", userId: "test" }, message: { type: "text", text }, webhookEventId: String(++id) });
  assert.equal(await send("隨便聊聊"), null);
  assert.equal((await send("ai")).type, "flex");
  await send("沒有");
  await send("我有");
  assert.equal(saved.state, STATES.ACCOUNT);
  assert.equal(saved.choice, "existing");
  assert.equal(saved.request, undefined);
  for (const invalid of ["中文", "abc_123", "abc 123", "１２３", "a@b", "a".repeat(129)]) {
    assert.match(JSON.stringify(await send(invalid)), /請確認帳號格式/);
    assert.equal(saved.state, STATES.ACCOUNT);
    assert.equal(saved.request, undefined);
  }
  for (const account of ["abc", "123456", "abc123", "1", "2"]) {
    await send("AI"); await send("有"); await send(account);
    assert.equal(saved.state, STATES.RECEIVED);
    assert.equal(saved.request.account, account);
  }
  for (const name of ["welcome", "choice", "existing", "registration", "invalid", "received"]) {
    const card = cards[name]("Abc123");
    assert.equal(card.type, "flex");
    assert.ok(card.altText.length < 1500);
    assert.ok(!JSON.stringify(card).includes("黑域AI"));
    assert.ok(Buffer.byteLength(JSON.stringify(card.contents)) < 30000);
  }
  const source = require("../modules/electronic/source");
  const original = [source.hasReadyData, source.getEmptyRooms, source.hasFreshRoomDetail];
  try {
    source.hasReadyData = () => true;
    let rooms = ["102", "101"].map(number => ({ number, detailUpdatedAt: new Date().toISOString(), detail: { todayBet: 10000, todayWin: 9500, dayBet: 100000, dayWin: 95000 } }));
    source.getEmptyRooms = () => rooms;
    source.hasFreshRoomDetail = () => true;
    const analyzer = require("../modules/atgX/analyzer");
    const first = analyzer.analyze("戰神賽特2", 10000);
    assert.equal(first.roomNumber, "101");
    for (let i = 0; i < 10; i++) assert.deepEqual(analyzer.analyze("戰神賽特2", 10000), first);
    assert.equal(first.predictionSignal, null);
    assert.equal(first.playbook.staking.freeGameCost, first.playbook.staking.freeGameBet * 200);
    const next = analyzer.analyze("戰神賽特2", 10000, { roomNumber: "101", next: true });
    assert.equal(next.roomNumber, "102");
    assert.deepEqual(next.playbook, first.playbook);
    assert.equal(analyzer.analyze("戰神賽特2", 10000, { roomNumber: "102" }).roomNumber, "102");
    rooms = [rooms[1]];
    assert.throws(() => analyzer.analyze("戰神賽特2", 10000, { roomNumber: "102", recheck: true }), /原房間/);
    assert.equal(analyzer.analyze("戰神賽特2", 10000, { roomNumber: "101", recheck: true }).roomNumber, "101");
    assert.equal(analyzer.analyze("戰神賽特2", 10000, { roomNumber: "102", next: true }).roomNumber, "101");
    rooms = [];
    assert.throws(() => analyzer.analyze("戰神賽特2", 10000));
  } finally {
    [source.hasReadyData, source.getEmptyRooms, source.hasFreshRoomDetail] = original;
  }
  const app = { innerHTML: "" };
  let randomValue = 0;
  const browser = { document: { querySelector: () => app, addEventListener: () => {} }, crypto: { getRandomValues(values) { values[0] = randomValue++; } }, console };
  vm.createContext(browser);
  vm.runInContext(fs.readFileSync("public/atg-x/app-v2.js", "utf8").replace(/boot\(\);\s*$/, ""), browser);
  assert.ok(!vm.runInContext("gameCard({ gameName: '戰神賽特2', ready: true, availableRooms: 1, image: '/game.webp' })", browser).includes("SET-"));
  vm.runInContext("dashboard({ expiresAt: new Date().toISOString() })", browser);
  assert.match(app.innerHTML, /empty-result standby/);
  assert.match(app.innerHTML, /等待啟動戰術掃描/);
  assert.ok(!app.innerHTML.includes("檢視可用空房與房間統計"));
  const result = { gameName: "戰神賽特2", roomNumber: "101", confidence: "高", availableRooms: 2, updatedAt: new Date().toISOString(), metrics: {}, playbook: { staking: { regularBet: 48, freeGameEligible: true, freeGameBet: 6, freeGameCost: 1200 } }, note: "" };
  browser.result = result;
  const firstMarkup = vm.runInContext("resultCard(result)", browser);
  const sameMarkup = vm.runInContext("resultCard(result)", browser);
  assert.equal(firstMarkup, sameMarkup);
  assert.match(firstMarkup, /推薦訊號/);
  assert.ok(!/隨機|生成|即時偵測/.test(firstMarkup));
  assert.ok(!firstMarkup.includes("更換示意"));
  assert.ok(!firstMarkup.includes("僅為成本試算"));
  assert.match(firstMarkup, /建議平轉金額/);
  assert.match(firstMarkup, /建議操作本金/);
  assert.match(firstMarkup, /訊號出現後推薦購買/);
  assert.match(firstMarkup, /免費遊戲/);
  assert.match(firstMarkup, /建議購買金額 <b>1,200<\/b>・投注金額 6/);
  assert.match(firstMarkup, /推薦程度/);
  assert.ok(!firstMarkup.includes("資料可信度"));
  assert.ok(!firstMarkup.includes("覺醒之力"));
  browser.result = { ...result, playbook: { staking: { ...result.playbook.staking, awakeningEligible: true, awakeningBet: 1, awakeningCost: 500 } } };
  vm.runInContext("symbolExamples.set(exampleKey(result), { index: 1, symbols: [{ ...SYMBOLS.awakening, id: 'awakening', count: 1 }] })", browser);
  const awakeningMarkup = vm.runInContext("resultCard(result)", browser);
  assert.match(awakeningMarkup, /覺醒之力/);
  assert.match(awakeningMarkup, /建議購買金額 <b>500<\/b>・投注金額 1/);
  browser.result = { ...result, gameName: "戰神賽特1" };
  assert.ok(!vm.runInContext("resultCard(result)", browser).includes("覺醒之力"));
  assert.ok(!fs.readFileSync("public/atg-x/app-v2.js", "utf8").includes("雙遊戲房況工作站"));
  const atgPage = fs.readFileSync("public/atg-x/index.html", "utf8");
  assert.ok(!atgPage.includes("遊戲選擇"));
  assert.ok(!atgPage.includes("房況分析"));
  assert.match(atgPage, /line-logo/);
  assert.match(atgPage, /https:\/\/line\.me\/ti\/p\/@605ohfyh/);
  vm.runInContext("symbolExamples.set(exampleKey(result), createSymbolExample(result, symbolExamples.get(exampleKey(result))))", browser);
  assert.notEqual(vm.runInContext("resultCard(result)", browser), firstMarkup);
  console.log("ATG X: account validation, Flex cards, stable analysis and room navigation passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
