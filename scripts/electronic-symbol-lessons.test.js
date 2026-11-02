const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { chromium } = require("playwright-core");
const lessons = require("../public/portal/symbol-lessons");
const { electronicRecommendFlex } = require("../ui/flex/electronicResult");
const root = path.join(__dirname, "..");
const room = () => ({ status: "Empty", occupied: false, detailUpdatedAt: new Date().toISOString(), detail: { todayBet: 100000, todayWin: 90000, todayRtp: 90, dayBet: 3000000, dayWin: 2800000 } });

test("fixed lessons preserve game-specific combinations and real local image files", () => {
  for (const game of ["戰神賽特1", "戰神賽特2"]) {
    const lesson = lessons.forGame(game);
    assert.equal(lesson.examples.length, 6);
    assert.deepEqual(lesson, lessons.forGame(game));
    assert.match(lesson.description, /不代表目前房間已出現/);
    assert.match(lesson.note, /不同圖案不能相加/);
    for (const example of lesson.examples) for (const symbol of example.symbols) {
      assert.ok(fs.existsSync(path.join(root, "public", symbol.image)));
      assert.ok(Number.isInteger(symbol.count) && symbol.count > 0);
      if (game === "戰神賽特1") assert.notEqual(symbol.id, "awakening");
    }
    lesson.examples[0].symbols[0].count = 100;
    assert.equal(lessons.forGame(game).examples[0].symbols[0].count, 3);
  }
  for (const game of ["虎小妹", "古神巴風特", "赤三國", "toString", "__proto__"]) assert.equal(lessons.forGame(game), null);
});

test("teaching stays behind valid room and RTP gates and does not create a signal", () => {
  for (const data of [null, { ...room(), occupied: true }, { ...room(), detailUpdatedAt: "2000-01-01" }, { ...room(), detail: {} }]) {
    const message = electronicRecommendFlex("戰神賽特2", "1165", "12:00", null, data);
    assert.equal(message.altText, "本次推薦已停止");
    assert.ok(!JSON.stringify(message).includes("圖案觀察教學"));
  }
  for (const game of ["戰神賽特1", "戰神賽特2", "虎小妹"]) {
    const message = electronicRecommendFlex(game, "1165", "12:00", null, room());
    assert.equal(message.altText, "AI推薦房");
    assert.equal(JSON.stringify(message).includes("圖案觀察教學"), game !== "虎小妹");
    assert.ok(!JSON.stringify(message).includes("訊號出現後推薦購買"));
  }
});

test("portal renders lessons and all images at mobile and desktop widths", { timeout: 90000 }, async () => {
  const app = express();
  app.get("/api/web/me", (_req, res) => res.json({ authenticated: false }));
  app.use(express.static(path.join(root, "public")));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  try {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://127.0.0.1:${server.address().port}/portal/`);
      await page.waitForFunction(() => typeof recommendationCard === "function");
      for (const game of ["戰神賽特1", "戰神賽特2", "虎小妹"]) {
        const message = electronicRecommendFlex(game, "1165", "12:00", null, room());
        await page.evaluate(message => { const data = walk(message.contents); document.querySelector("#view").innerHTML = recommendationCard(data, []); }, message);
        if (game === "虎小妹") { assert.equal(await page.locator(".symbol-lesson").count(), 0); continue; }
        await page.locator(".symbol-lesson summary").click();
        assert.equal(await page.locator(".symbol-lesson-example").count(), 6);
        await page.locator(".symbol-lesson").scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll(".symbol-lesson img")].every(i => i.complete && i.naturalWidth > 0));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.SYMBOL_LESSON_CAPTURE_DIR) {
          fs.mkdirSync(process.env.SYMBOL_LESSON_CAPTURE_DIR, { recursive: true });
          await page.locator(".symbol-lesson").screenshot({ path: path.join(process.env.SYMBOL_LESSON_CAPTURE_DIR, `seth${game.endsWith("1") ? 1 : 2}-${width}.png`) });
        }
        const again = await page.evaluate(message => recommendationCard(walk(message.contents), []), message);
        assert.match(again, /固定教學範例/);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
