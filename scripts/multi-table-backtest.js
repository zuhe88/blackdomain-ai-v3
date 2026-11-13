const fs = require("node:fs");
const { analyzePrediction } = require("../modules/baccarat/ai");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/multi-table-backtest.js shoes.json");
  process.exit(1);
}
const shoes = JSON.parse(fs.readFileSync(file, "utf8"));
const totals = new Map();
for (const { platform, results } of shoes) {
  if (!["DG", "MT", "歐博"].includes(platform)
    || !Array.isArray(results) || results.some(result => !["莊", "閒", "和"].includes(result))) {
    throw new Error("Expected chronological shoes with platform and results.");
  }
  if (!totals.has(platform)) totals.set(platform, {});
  const groups = totals.get(platform);
  for (const [index, result] of results.entries()) {
    if (result === "和") continue;
    const analysis = analyzePrediction(results.slice(Math.max(0, index - 50), index), { doubleJump: true });
    for (const name of ["overall", analysis.reasonCode]) {
      const score = groups[name] ??= { eligible: 0, issued: 0, hits: 0, banker: 0, player: 0 };
      score.eligible += 1;
      if (analysis.prediction === "觀望") continue;
      score.issued += 1;
      score.hits += Number(result === analysis.prediction);
      score.banker += Number(result === "莊");
      score.player += Number(result === "閒");
    }
  }
}
console.log(JSON.stringify(Object.fromEntries(totals), null, 2));
