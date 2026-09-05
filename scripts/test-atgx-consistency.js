const assert = require("node:assert/strict");
const { createOnboarding, STATES } = require("../modules/atgX/onboarding");
const cards = require("../modules/atgX/onboardingCards");

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
    assert.equal(analyzer.analyze("戰神賽特2", 10000, { roomNumber: "102", next: true }).roomNumber, "101");
    rooms = [];
    assert.throws(() => analyzer.analyze("戰神賽特2", 10000));
  } finally {
    [source.hasReadyData, source.getEmptyRooms, source.hasFreshRoomDetail] = original;
  }
  console.log("ATG X: account validation, Flex cards, stable analysis and room navigation passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
