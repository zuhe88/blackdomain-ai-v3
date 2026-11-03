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

test("one random group uses distinct game-specific symbols and valid images", () => {
  for (const game of ["戰神賽特1", "戰神賽特2"]) {
    for (const value of [0, 0.49, 0.5, 0.99]) {
    const lesson = lessons.forGame(game, () => value);
    assert.equal(lesson.symbols.length, 1 + Math.floor(value * 3));
    assert.equal(new Set(lesson.symbols.map(s => s.id)).size, lesson.symbols.length);
    assert.ok(lesson.symbols.filter(s => ["scatter", "awakening"].includes(s.id)).reduce((sum, s) => sum + s.count, 0) <= 3);
    assert.deepEqual(lesson, lessons.forGame(game, () => value));
    for (const symbol of lesson.symbols) {
      assert.ok(fs.existsSync(path.join(root, "public", symbol.image)));
      assert.ok(Number.isInteger(symbol.count) && symbol.count >= 1 && symbol.count <= 6);
      if (game === "戰神賽特1") assert.notEqual(symbol.id, "awakening");
      if (symbol.id === "awakening") assert.equal(symbol.count, 1);
    }
    const texts = [lesson.title, ...lesson.symbols.map(s => `${s.label} ×${s.count}`)];
    const recovered = lessons.fromTexts(game, texts);
    assert.deepEqual(recovered.symbols.map(s => `${s.id}:${s.count}`).sort(), lesson.symbols.map(s => `${s.id}:${s.count}`).sort());
    }
    for (const symbol of lessons.catalog(game)) assert.ok(fs.existsSync(path.join(root, "public", symbol.image)));
  }
  for (const game of ["虎小妹", "古神巴風特", "赤三國", "toString", "__proto__"]) assert.equal(lessons.forGame(game), null);
});

test("standard and purple SCATTER share a maximum of three, including restored results", () => {
  const draws = [0.5, 0, 0.5, 0, 0.99];
  const group = lessons.forGame("戰神賽特2", () => draws.shift());
  assert.deepEqual(group.symbols.map(s => [s.id, s.count]), [["scatter", 2], ["awakening", 1]]);
  assert.match(group.symbols[1].image, /scatter-awakening.png$/);
  for (const texts of [["SCATTER ×4"], ["覺醒 SCATTER ×6"], ["SCATTER ×2", "覺醒 SCATTER ×2"]]) {
    assert.equal(lessons.fromTexts("戰神賽特2", ["推薦訊號", ...texts]), null);
  }
  assert.equal(lessons.fromTexts("戰神賽特2", ["推薦訊號", "覺醒 SCATTER ×1"]).symbols[0].count, 1);
  for (const count of [2, 3, 4, 5, 6]) {
    assert.equal(lessons.fromTexts("戰神賽特2", ["推薦訊號", `覺醒 SCATTER ×${count}`]), null);
  }
  assert.equal(lessons.fromTexts("戰神賽特2", ["推薦訊號", "SCATTER ×3"]).symbols[0].count, 3);
  const awakeningOnly = lessons.forGame("戰神賽特2", (() => {
    const draws = [0, 0.1, 0.99];
    return () => draws.shift();
  })());
  assert.deepEqual(awakeningOnly.symbols.map(s => [s.id, s.count]), [["awakening", 1]]);
});

test("random group stays behind valid room and RTP gates", () => {
  for (const data of [null, { ...room(), occupied: true }, { ...room(), detailUpdatedAt: "2000-01-01" }, { ...room(), detail: {} }]) {
    const message = electronicRecommendFlex("戰神賽特2", "1165", "12:00", null, data);
    assert.equal(message.altText, "本次推薦已停止");
    assert.ok(!JSON.stringify(message).includes("推薦訊號"));
  }
  for (const game of ["戰神賽特1", "戰神賽特2", "虎小妹"]) {
    const message = electronicRecommendFlex(game, "1165", "12:00", null, room());
    assert.equal(message.altText, "AI推薦房");
    assert.equal(JSON.stringify(message).includes("推薦訊號"), game !== "虎小妹");
    assert.ok(!JSON.stringify(message).includes("圖案組合僅供參考，非即時盤面偵測"));
    assert.ok(!/教學|查看 6|固定圖案/.test(JSON.stringify(message)));
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
        assert.equal(await page.locator(".symbol-lesson").count(), 1);
        assert.equal(await page.locator(".symbol-lesson-combo").count(), 1);
        assert.equal(await page.locator(".symbol-lesson details").count(), 0);
        const count = await page.locator(".symbol-lesson-symbol").count();
        assert.ok(count >= 1 && count <= 3);
        await page.locator(".symbol-lesson").scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll(".symbol-lesson img")].every(i => i.complete && i.naturalWidth > 0));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.SYMBOL_LESSON_CAPTURE_DIR) {
          fs.mkdirSync(process.env.SYMBOL_LESSON_CAPTURE_DIR, { recursive: true });
          await page.locator(".symbol-lesson").screenshot({ path: path.join(process.env.SYMBOL_LESSON_CAPTURE_DIR, `seth${game.endsWith("1") ? 1 : 2}-${width}.png`) });
        }
        const again = await page.evaluate(message => recommendationCard(walk(message.contents), []), message);
        assert.match(again, /推薦訊號/);
        assert.ok(!again.includes("圖案組合僅供參考，非即時盤面偵測"));
        assert.ok(!again.includes("隨機搭配"));
        assert.ok(!/教學|summary|details/.test(again));
        assert.equal(await page.evaluate(message => recommendationCard(walk(message.contents), []), message), again);
      }
    }
    assert.deepEqual(errors, []);
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const texts = ["戰神賽特2", "推薦房號", "1165", "推薦訊號", "SCATTER ×2", "覺醒 SCATTER ×1", "綠寶石 ×3"];
      await page.evaluate(texts => { document.querySelector("#view").innerHTML = recommendationCard({ texts }, []); }, texts);
      assert.equal(await page.locator(".symbol-lesson-symbol").count(), 3);
      assert.equal(await page.locator(".symbol-lesson-combo>i").count(), 2);
      await page.locator(".symbol-lesson").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll(".symbol-lesson img")].every(i => i.complete && i.naturalWidth > 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.SYMBOL_LESSON_CAPTURE_DIR) await page.locator(".symbol-lesson").screenshot({ path: path.join(process.env.SYMBOL_LESSON_CAPTURE_DIR, `three-symbols-${width}.png`) });
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
