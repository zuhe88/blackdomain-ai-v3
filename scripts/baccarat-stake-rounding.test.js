const { test } = require("node:test");
const assert = require("node:assert/strict");
const { roundRecommendedStake } = require("../modules/baccarat/currency");
const { calculateBet, firstAnalysis, applyResult } = require("../modules/baccarat/ai");

test("native denomination boundaries never round a recommendation up", () => {
  for (const currency of ["TWD", "MYR"]) {
    for (const [amount, expected] of [[1000, 1000], [1050, 1000], [1750, 1700], [1999, 1900], [9950, 9900], [10000, 10000], [10950, 10000]]) {
      assert.equal(roundRecommendedStake(amount, currency), expected);
    }
  }
  assert.equal(roundRecommendedStake(999, "TWD"), 950);
  assert.equal(roundRecommendedStake(999, "MYR"), 990);
  assert.equal(roundRecommendedStake(49, "TWD"), 0);
  assert.equal(roundRecommendedStake(9, "MYR"), 0);
  assert.equal(roundRecommendedStake(NaN, "TWD"), 0);
});

test("dynamic recommendation, stored stake and settlement all use 1700 rather than 1750", t => {
  t.mock.method(Math, "random", () => 0.5);
  const session = { currency: "TWD", mode: "動態配注", capital: 10000, startBankroll: 10000, bankroll: 10000, maxBet: 1750, history: Array(8).fill("閒") };
  const result = firstAnalysis(session);
  assert.equal(result.bet, 1700);
  assert.equal(session.lastBet, 1700);
  assert.equal(session.lastBetMeta.baseBet, 1700);
  applyResult(session, "閒");
  assert.equal(session.bankroll, 11700);
});

test("both modes and currencies respect native denominations and caps", t => {
  t.mock.method(Math, "random", () => 0.99);
  for (const currency of ["TWD", "MYR"]) {
    for (const mode of ["動態配注", "天門"]) {
      for (const capital of [1000, 2850, 5700, 10000, 12500, 20000, 60000, 100000]) {
        for (const maxBet of [49, 950, 1050, 1750, 9950, 10950, capital]) {
          for (const tianmenLevel of [1, 3, 5]) {
            const session = { currency, mode, capital, bankroll: capital, startBankroll: capital, maxBet, tianmenLevel };
            const bet = calculateBet(session, "莊");
            assert.ok(bet <= maxBet && bet <= capital);
            if (bet >= 10000) assert.equal(bet % 1000, 0);
            else if (bet >= 1000) assert.equal(bet % 100, 0);
            else assert.equal(bet % (currency === "MYR" ? 10 : 50), 0);
          }
        }
      }
    }
  }
});
