const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright-core");

const extension = path.resolve(__dirname, "../extensions/electronic-turbo");

test("installed extension drives demo controls and the game fixture", { timeout: 30000 }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "blackdomain-turbo-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.BLACKDOMAIN_TURBO_TEST_BROWSER
        ? { executablePath: process.env.BLACKDOMAIN_TURBO_TEST_BROWSER }
        : { channel: "chromium" }),
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const isMembershipWorker = worker => /^chrome-extension:\/\/[^/]+\/membership\.js$/.test(worker.url());
    const worker = context.serviceWorkers().find(isMembershipWorker)
      || await context.waitForEvent("serviceworker", { predicate: isMembershipWorker, timeout: 5000 });
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${extensionOrigin}/demo.html`);
    const animationRate = rate => page.waitForFunction(
      value => document.querySelector(".marker").getAnimations()[0]?.playbackRate === value, rate,
    );
    await animationRate(1);
    await page.keyboard.press("Tab"); // collapse button
    for (const rate of [1, 10, 20, 50]) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await animationRate(rate);
    }
    for (let index = 0; index < 3; index += 1) await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await animationRate(1);
    for (let index = 0; index < 6; index += 1) await page.locator("#record").click();
    const session = await context.newCDPSession(page);
    const { root } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
    const text = [];
    function collect(node) {
      if (node.nodeType === 3) text.push(node.nodeValue);
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) collect(child);
    }
    collect(root);
    assert.ok(text.includes("750") && text.includes("已結算"));
    assert.deepEqual(text.filter(line => /^\d+ 分$/.test(line)), ["750 分", "625 分", "500 分", "375 分", "250 分"]);

    await worker.evaluate(() => {
      globalThis.fetch = async () => new Response(JSON.stringify({ authenticated: true, accessAllowed: true }));
    });
    await page.goto(`${extensionOrigin}/popup.html`);
    await page.getByText("會員資格已確認").waitFor();
    const gameUrl = "https://play.godeebxp.com/egames/22020103b31b7390f07b1551e8538589b5e51967/game/";
    await context.route(gameUrl, route => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><canvas id="GameCanvas"></canvas>
        <script>
          class Skeleton {
            isValid = true;
            enabledInHierarchy = true;
            timeScale = 1;
            node = {name: "spine", parent: {name: "winboard"}};
            getCurrent() { return {animation: {name: "mg_idle"}}; }
          }
          const spine = new Skeleton();
          const summary = { gameState: { totalWinnings: 0 }, spinId: "free-round" };
          class FreeGameAlertView {
            data = { getData: () => summary };
            showSummaryAlert() { return "shown"; }
          }
          const parser = { parseNewSpin: () => "parsed" };
          window.parseGameFixture = gameState => parser.parseNewSpin({ engine: { gameState } });
          window.showFreeGameSummary = () => new FreeGameAlertView().showSummaryAlert();
          window.readTestRate = () => spine.timeScale;
          window.System = {
            resolve: name => name,
            get: name => name.endsWith("/ParseResponse.ts") ? { default: parser } : ({
              js: {getClassByName: name => ({ ReelView: class ReelView {}, FreeGameAlertView })[name]},
              sp: {Skeleton},
              director: {getScene: () => ({getComponentsInChildren: () => [{spine}]})},
            }),
          };
        </script></body></html>`,
    }));
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(gameUrl);
    await page.waitForFunction(() => document.documentElement.getAttribute("data-blackdomain-seth2-rate") === "1"
      && document.documentElement.hasAttribute("data-blackdomain-seth2-ready"));
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.readTestRate() === 50);
    for (let index = 0; index < 3; index += 1) await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.readTestRate() === 1);
    const gameSession = await context.newCDPSession(page);
    async function gameText() {
      const { root: gameRoot } = await gameSession.send("DOM.getDocument", { depth: -1, pierce: true });
      text.length = 0;
      collect(gameRoot);
      return text;
    }
    assert.equal(await page.evaluate(() => window.parseGameFixture([
      { freeGameCount: 3 }, { freeGameCount: 2, totalWinnings: 50 },
    ])), "parsed");
    assert.ok(!(await gameText()).includes("50"));
    assert.equal(await page.evaluate(() => window.parseGameFixture([
      { freeGameCount: 3 }, { freeGameCount: 0, totalWinnings: 125 },
    ])), "parsed");
    await gameText();
    assert.ok(text.includes("125") && text.includes("待結算"));
    assert.equal(await page.evaluate(() => window.showFreeGameSummary()), "shown");
    await gameText();
    assert.ok(text.includes("0") && text.includes("已結算"));
    assert.deepEqual(pageErrors, []);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("Seth 2 adapter changes only approved win board animation and restores replaced fields", () => {
  const vm = require("node:vm");
  const rateAttribute = "data-blackdomain-seth2-rate";
  const readyAttribute = "data-blackdomain-seth2-ready";
  const attrs = new Map([[rateAttribute, "10"]]);
  class Skeleton {
    timeScale = 0.5;
    isValid = true;
    enabledInHierarchy = true;
    animation = "mg_win";
    node = { name: "spine", parent: { name: "winboard" } };
    getCurrent() { return { animation: { name: this.animation } }; }
  }
  const selected = new Skeleton();
  class AnimView {}
  const awakening = new Skeleton();
  const fireBall = new Skeleton();
  fireBall.animation = "fireball_purple_turbo_stop";
  class EffectsView {}
  const excluded = new Skeleton();
  excluded.node.parent.name = "reel";
  const root = {
    getAttribute: name => attrs.get(name),
    removeAttribute: name => attrs.delete(name),
    setAttribute: (name, value) => attrs.set(name, value),
  };
  let tick;
  let hide;
  class Tween {
    to(seconds) { return seconds; }
    by(seconds) { return seconds; }
    delay(seconds) { return seconds; }
  }
  class WinningSymbol {
    scheduleOnce(callback, delay) { return { callback, delay }; }
    playWinAnim(callback) { return this.scheduleOnce(callback, 1); }
  }
  class InfoBarController { playTotalWinTween() { return new Tween().to(1.9); } }
  class RunScore { runScore(seconds) { return new Tween().to(seconds); } }
  class WinView {
    playWinCashTween() { return [new Tween().by(1.5), new Tween().delay(1), new Tween().to(0.5)]; }
  }
  class ReelView {}
  const config = { reelConfig: { speed: 0.2, animStagger: 0.05 } };
  class SymbolView {
    get configModel() { return config; }
    showSymbolsOut(callback) {
      callback(this.configModel.reelConfig);
    }
    showNormalSymbolsIn() { return this.configModel.reelConfig; }
    showTurboSymbolsIn() { return this.configModel.reelConfig; }
    moveTo() { return this.configModel.reelConfig; }
  }
  const symbolView = new SymbolView();
  const engine = {
    sp: { Skeleton },
    Tween,
    js: { getClassByName: name => ({ Symbol: WinningSymbol, SymbolView, ReelView, WinView, RunScore, EffectsView })[name] },
    director: {
      getScene: () => ({
        getComponentsInChildren(type) {
          if (type === AnimView) return [{ menLevel2Animation: awakening }];
          if (type === WinningSymbol) return [];
          if (type === EffectsView) return [{ node: { getComponentsInChildren: () => [fireBall, excluded] } }];
          assert.equal(type, ReelView);
          return [{ spine: selected }, { spine: excluded }];
        },
      }),
    },
  };
  const context = vm.createContext({
    document: { documentElement: root, getElementById: () => ({}) },
    window: { System: { resolve: () => "cc", get: name => ({ cc: engine, "chunks:///_virtual/InfoBarController.ts": { default: InfoBarController }, "chunks:///_virtual/AnimaView.ts": { AnimView } })[name] } },
    MutationObserver: class { observe() {} },
    setInterval: callback => { tick = callback; },
    addEventListener: (_event, callback) => { hide = callback; },
  });
  vm.runInContext(fs.readFileSync(path.join(extension, "seth2-canvas.js"), "utf8"), context);
  assert.equal(selected.timeScale, 5);
  assert.equal(fireBall.timeScale, 5);
  assert.equal(awakening.timeScale, 5);
  assert.deepEqual(new WinView().playWinCashTween(), [0.15, 0.1, 0.05]);
  assert.equal(new Tween().by(1.5), 1.5);
  assert.equal(new RunScore().runScore(2), 0.2);
  assert.equal(new InfoBarController().playTotalWinTween(), 0.19);
  const winner = new WinningSymbol();
  const onWin = () => {};
  assert.deepEqual(winner.playWinAnim(onWin), { callback: onWin, delay: 0.1 });
  assert.deepEqual(winner.scheduleOnce(onWin, 1), { callback: onWin, delay: 1 });
  assert.equal(excluded.timeScale, 0.5);
  assert.equal(attrs.get(readyAttribute), "reels");
  symbolView.showSymbolsOut(config => assert.equal(config.speed, 0.02));
  assert.equal(symbolView.showNormalSymbolsIn().animStagger, 0.005);
  assert.equal(symbolView.showTurboSymbolsIn().speed, 0.02);
  assert.equal(symbolView.moveTo().speed, 0.02);
  assert.equal(symbolView.configModel, config);
  assert.throws(() => symbolView.showSymbolsOut(() => { throw new Error("cancelled"); }), /cancelled/);
  assert.equal(symbolView.configModel, config);
  attrs.set(rateAttribute, "3");
  tick();
  assert.equal(selected.timeScale, 1.5);
  selected.animation = "unknown";
  tick();
  assert.equal(selected.timeScale, 0.5);
  assert.equal(attrs.get(readyAttribute), "reels");
  selected.animation = "mg_idle";
  tick();
  assert.equal(selected.timeScale, 1.5);
  hide();
  assert.equal(fireBall.timeScale, 0.5);
  assert.equal(awakening.timeScale, 0.5);
  assert.equal(symbolView.moveTo(), config.reelConfig);
  assert.equal(selected.timeScale, 0.5);
});

test("bankroll stops before starting a spin below the floor and above the ceiling", () => {
  const vm = require("node:vm");
  const attrs = new Map([["data-blackdomain-bankroll-settings", JSON.stringify({ floor: 100, ceiling: null })]]);
  const data = { currentGameType: "main", isOpenEarlyFlag: true };
  const auto = { active: true, spinsRemaining: 10 };
  const platform = { amount: 125 };
  let bets = 0;
  let earlyBets = 0;
  const spin = { data, execute() { bets++; }, getAfterBettingBalance: () => platform.amount - 25 };
  const early = { data, execute() { earlyBets++; } };
  const closed = { data, createFlow: () => auto.active };
  const modules = {
    CreateNewSpinFlowCmd: { default: spin },
    CreateNewEarlySpinFlowCmd: { default: early },
    NewSpinClosedCmd: { default: closed },
    AutoPlayModel: { default: auto },
    PlatformModel: { default: platform },
    SlotFrameworkEvent: { SlotFrameworkEvent: { STOP_AUTO_SPIN: "stop" } },
    types: { EGameType: { MAIN_GAME: "main" } },
  };
  let tick;
  vm.runInNewContext(fs.readFileSync(path.join(extension, "bankroll.js"), "utf8"), {
    document: { documentElement: { hasAttribute: () => true, getAttribute: name => attrs.get(name), setAttribute: (name, value) => attrs.set(name, value) } },
    window: {
      System: { get: key => modules[key.split("/").pop().replace(".ts", "")] },
      dispatch: () => { auto.active = false; auto.spinsRemaining = 0; },
    },
    setInterval: callback => { tick = callback; return 1; },
    clearInterval() {},
  });
  tick();
  spin.execute();
  assert.equal(bets, 1);
  assert.equal(auto.spinsRemaining, 10);
  early.execute();
  assert.equal(earlyBets, 0);
  platform.amount = 124.99;
  assert.equal(closed.createFlow(), false);
  auto.active = true;
  spin.execute();
  assert.equal(bets, 1);
  attrs.set("data-blackdomain-bankroll-settings", JSON.stringify({ floor: null, ceiling: 125 }));
  platform.amount = 125;
  auto.active = true;
  spin.execute();

  assert.equal(bets, 2);
  platform.amount = 125.01;
  assert.equal(closed.createFlow(), false);
});
