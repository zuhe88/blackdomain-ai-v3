const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright-core");

const extension = path.resolve(__dirname, "../extensions/electronic-turbo");
const gamePaths = {
  seth2: "/egames/22020103b31b7390f07b1551e8538589b5e51967/game/",
  seth1: "/egames/88d5a6c6b3ebe4c6410b52b1c1aba71f2fad6de0/game/",
  baphomet: "/egames/2b4c37c532b5e60f542a29c23e602748c06fd426/game/",
  tigerPrincess: "/egames/9c0ec83253193a1c672c2906b83e88e29a61a826/game/",
  scarletThreeKingdoms: "/egames/e19fdb8f5121a0abeecca7638e92d010dbe496c1/game/",
};
const gameOrigin = "https://play.godeebxp.com";

test("installed extension drives demo controls and the five supported games", { timeout: 60000 }, async () => {
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

    const simulationCDP = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#controls > div" });
    const { node } = await session.send("DOM.describeNode", { nodeId: simulationCDP.nodeId, pierce: true, depth: 1 });
    const { object } = await session.send("DOM.resolveNode", { backendNodeId: node.shadowRoots[0].backendNodeId });
    async function inspectSimulation(expression) {
      const { result } = await session.send("Runtime.callFunctionOn", {
        objectId: object.objectId, functionDeclaration: "function() { return " + expression + "; }", returnByValue: true,
      });
      return result.value;
    }
    const switchSelector = 'this.querySelector("[role=switch]")';
    assert.equal(await inspectSimulation(switchSelector + '.getAttribute("aria-label")'), "提高勝率（模擬）");
    const clickSimulation = () => inspectSimulation(switchSelector + ".click()");
    const successHidden = () => inspectSimulation('this.getElementById("success").hidden');
    await clickSimulation();
    await clickSimulation();
    await delay(1750);
    assert.equal(await successHidden(), true);
    await clickSimulation();
    const deadline = Date.now() + 4000;
    while (await successHidden() && Date.now() < deadline) await delay(30);
    assert.equal(await successHidden(), false);
    await delay(1200);
    assert.equal(await successHidden(), true);

    await worker.evaluate(() => {
      globalThis.fetch = async () => new Response(JSON.stringify({ authenticated: true, accessAllowed: true }));
    });
    await page.goto(`${extensionOrigin}/popup.html`);
    await page.getByText("會員資格已確認").waitFor();
    await context.route(/^https:\/\/play\.godeebxp\.com\/egames\/[^/]+\/game\/$/, route => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><canvas id="GameCanvas"></canvas>
        <script>
          const isSeth2 = location.pathname === ${JSON.stringify(gamePaths.seth2)};
          class Skeleton {
            isValid = true;
            enabledInHierarchy = true;
            timeScale = 1;
            node = {name: "spine", parent: {name: "winboard"}};
            constructor(loop = false) { this.loop = loop; }
            getCurrent(index) {
              if (index !== 0) return null;
              return {loop: this.loop, animation: {name: "mg_idle", duration: 1}};
            }
          }
          const spine = new Skeleton();
          const loopingSpine = new Skeleton(true);
          const oneShot = {isPlaying: true, isPaused: false, repeatCount: 1, speed: 1};
          const loopingClip = {isPlaying: true, isPaused: false, repeatCount: Infinity, speed: 1};
          class Animation {
            isValid = true;
            enabledInHierarchy = true;
            clips = [{name: "wipe"}, {name: "idle"}];
            getState(name) { return name === "wipe" ? oneShot : loopingClip; }
          }
          const animation = new Animation();
          const scoreManager = {
            elapsed: 0,
            update(dt) { this.elapsed += dt; }
          };
          window.advanceScore = dt => {
            scoreManager.update(dt);
            return scoreManager.elapsed;
          };
          class Tween {
            to(seconds) { return seconds; }
            by(seconds) { return seconds; }
            delay(seconds) { return seconds; }
          }
          class ReelView {
            playBounceTween() { return new Tween().to(1); }
          }
          window.readTestTween = () => new ReelView().playBounceTween();
          class FreeGameAlertView {
            constructor(summary) { this.data = { getData: () => summary }; }
            showSummaryAlert() { return "shown"; }
          }
          const parser = { parseNewSpin: () => "parsed", parseNewEarlySpin: () => "parsed early" };
          window.parseGameFixture = (gameState, early = false, spinId) =>
            parser[early ? "parseNewEarlySpin" : "parseNewSpin"]({ engine: { gameState, spinId } });
          window.showFreeGameSummary = (spinId = "free-round", totalWinnings = 0) =>
            new FreeGameAlertView({ gameState: { freeGameCount: 0, totalWinnings }, spinId }).showSummaryAlert();
          window.freeGameEvents = { progress: 0, previews: 0, summaries: 0 };
          window.addEventListener("BLACKDOMAIN_TURBO_FREE_GAME_PREVIEW", event => {
            const kind = event.detail?.complete === false ? "progress" : "previews";
            window.freeGameEvents[kind]++;
          });
          window.addEventListener("BLACKDOMAIN_TURBO_FREE_GAME_SUMMARY", () => window.freeGameEvents.summaries++);
          window.readTestRate = () => spine.timeScale;
          window.readTestClip = () => oneShot.speed;
          window.readLoopRates = () => [loopingSpine.timeScale, loopingClip.speed];
          window.System = {
            resolve: name => name,
            get: name => name.endsWith("/ParseResponse.ts") ? { default: parser } : ({
              js: {getClassByName: name => ({ FreeGameAlertView, ReelView: isSeth2 ? ReelView : undefined })[name]},
              Tween,
              TweenSystem: { instance: { ActionManager: scoreManager } },
              Animation,
              sp: {Skeleton},
              director: {getScene: () => ({getComponentsInChildren(type) {
                if (type === Skeleton) return [spine, loopingSpine];
                if (type === Animation) return [animation];
                if (type === ReelView) return [{spine}];
                return [];
              }})},
            }),
          };
        </script></body></html>`,
    }));
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const gameSession = await context.newCDPSession(page);
    async function gameDocument() {
      const { root: gameRoot } = await gameSession.send("DOM.getDocument", { depth: -1, pierce: true });
      return gameRoot;
    }
    function findRateButton(node, rate) {
      const attributes = node.attributes || [];
      if (node.nodeName === "BUTTON" && attributes[attributes.indexOf("value") + 1] === String(rate)
        && !attributes.includes("disabled")) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const match = findRateButton(child, rate);
        if (match) return match;
      }
      return undefined;
    }
    async function chooseGameRate(rate) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const button = findRateButton(await gameDocument(), rate);
        if (button) {
          await gameSession.send("DOM.focus", { backendNodeId: button.backendNodeId });
          await page.keyboard.press("Enter");
          return;
        }
        await delay(50);
      }
      assert.fail(`Game rate ${rate} was not enabled at ${page.url()}`);
    }
    async function testAcceleration(gamePath) {
      const usesSeth2Hooks = gamePath === gamePaths.seth2;
      await page.goto(gameOrigin + gamePath);
      await page.waitForFunction(() => document.documentElement.getAttribute("data-blackdomain-seth2-rate") === "1"
        && document.documentElement.hasAttribute("data-blackdomain-seth2-ready"));
      await chooseGameRate(50);
      if (gamePath === gamePaths.baphomet) {
        await page.waitForFunction(() => document.documentElement.getAttribute("data-blackdomain-seth2-rate") === "50");
        assert.deepEqual(await page.evaluate(() => [window.readTestRate(), window.readTestClip(), window.advanceScore(0.02)]), [1, 1, 1]);
      } else {
        await page.waitForFunction(specific => window.readTestRate() === 50
          && (specific || window.readTestClip() === 50), usesSeth2Hooks);
      }
      assert.equal(await page.evaluate(() => window.readTestTween()), usesSeth2Hooks ? 0.02 : 1);
      assert.deepEqual(await page.evaluate(() => window.readLoopRates()), [1, 1]);
      await chooseGameRate(1);
      await page.waitForFunction(() => window.readTestRate() === 1 && window.readTestClip() === 1);
      if (gamePath === gamePaths.baphomet) {
        await page.waitForFunction(() => document.documentElement.getAttribute("data-blackdomain-seth2-rate") === "1");
        assert.equal(await page.evaluate(() => window.advanceScore(0.02)), 1.02);
      }
      assert.equal(await page.evaluate(() => window.readTestTween()), 1);
    }
    async function gameText() {
      text.length = 0;
      collect(await gameDocument());
      return text;
    }
    for (const [game, gamePath] of Object.entries(gamePaths)) {
      await testAcceleration(gamePath);
      const rejectedBatches = [
        [{ freeGameCount: 3 }, { freeGameCount: 2, totalWinnings: 47 }],
        [{ freeGameCount: 0, totalWinnings: 71 }],
        [{ freeGameCount: 3 }, { freeGameCount: 0, superMainGameCount: 1, totalWinnings: 91 }],
        [{ freeGameCount: 3 }, { totalWinnings: 92 }],
        [{ freeGameCount: 0 }, { freeGameCount: 0, totalWinnings: 93 }],
        [{ numFreeSpins: 3, freeGameCount: 3 }, { freeGameCount: 0, totalWinnings: 94 }],
      ];
      for (const batch of rejectedBatches) {
        assert.equal(await page.evaluate(states => window.parseGameFixture(states), batch), "parsed");
      }
      assert.equal(await page.evaluate(() => window.freeGameEvents.previews), 0, `${game} previewed a partial or unrelated batch`);
      assert.ok(!(await gameText()).includes("待結算"), `${game} displayed an incomplete result`);

      assert.equal(await page.evaluate(() => window.parseGameFixture([
        { freeGameCount: 3 }, { freeGameCount: 0, freespinWinnings: 125, totalWinnings: 135 },
      ], true)), "parsed early");
      await gameText();
      assert.ok(text.includes("125") && text.includes("待結算"), `${game} did not show the completed preview`);
      assert.equal(await page.evaluate(() => window.showFreeGameSummary()), "shown");
      assert.equal(await page.evaluate(() => window.showFreeGameSummary()), "shown");
      await gameText();
      assert.ok(text.includes("0") && text.includes("已結算"), `${game} did not settle a zero result`);
      assert.equal(text.filter(value => value === "0 分").length, 1, `${game} duplicated the same settlement`);
      assert.ok(!text.includes("待結算"), `${game} did not clear the completed preview`);

      assert.equal(await page.evaluate(() => window.parseGameFixture([
        { freeGameCount: 2, freespinWinnings: 53, totalWinnings: 64 },
      ], false, "split-round")), "parsed");
      await gameText();
      assert.ok(text.includes("53") && text.includes("累計中"), `${game} did not show the split round's running total`);
      assert.equal(await page.evaluate(() => window.freeGameEvents.progress), 1);
      assert.ok(!text.includes("待結算"), `${game} marked an in-progress round as complete`);
      await page.evaluate(() => window.parseGameFixture([
        { freeGameCount: 0, freespinWinnings: 83 },
      ], false, "unrelated-round"));
      assert.equal(await page.evaluate(() => window.freeGameEvents.previews), 1, `${game} used a different round's positive counter`);
      assert.equal(await page.evaluate(() => window.parseGameFixture([
        { freeGameCount: 0, totalWinnings: 165 },
      ], false, "split-round")), "parsed");
      await gameText();
      assert.ok(text.includes("165") && text.includes("待結算"), `${game} did not complete the matching split round`);
      assert.equal(await page.evaluate(() => window.showFreeGameSummary("split-round", 165)), "shown");
      await gameText();
      assert.ok(text.includes("165 分") && text.includes("已結算"), `${game} did not record the matching split round`);
    }

    await page.goto(gameOrigin + "/egames/another-game/game/");
    // Trigger the same observer input without granting the page a supported game identity.
    await page.evaluate(() => document.documentElement.setAttribute("data-blackdomain-seth2-rate", "50"));
    assert.deepEqual(await page.evaluate(() => ({
      supported: document.documentElement.hasAttribute("data-blackdomain-supported-atg"),
      ready: document.documentElement.hasAttribute("data-blackdomain-seth2-ready"),
      panel: Boolean(document.querySelector("[data-overlay]")),
      rate: window.readTestRate(),
    })), { supported: false, ready: false, panel: false, rate: 1 });
    assert.deepEqual(await page.evaluate(() => {
      window.parseGameFixture([{ freeGameCount: 1 }, { freeGameCount: 0, totalWinnings: 125 }]);
      window.showFreeGameSummary();
      return window.freeGameEvents;
    }), { progress: 0, previews: 0, summaries: 0 });
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
  const attrs = new Map([[rateAttribute, "10"], ["data-blackdomain-supported-atg", ""], ["data-blackdomain-seth2-game", ""]]);
  class Skeleton {
    timeScale = 0.5;
    isValid = true;
    enabledInHierarchy = true;
    animation = "mg_win";
    node = { name: "spine", parent: { name: "winboard" } };
    getCurrent() { return { animation: { name: this.animation } }; }
    setCompleteListener(callback) { this.complete = callback; }
  }
  const selected = new Skeleton();
  class AnimView {}
  const awakening = new Skeleton();
  const fireBall = new Skeleton();
  fireBall.animation = "fireball_blue_upgrade_loop";
  class EffectsView {
    scheduleOnce(callback, delay) { return { callback, delay }; }
    showTimesMoving() { return this.scheduleOnce(() => new Tween().call(() => new Tween().to(2)), 1); }
  }
  const excluded = new Skeleton();
  excluded.node.parent.name = "reel";
  const root = {
    hasAttribute: name => attrs.has(name),
    getAttribute: name => attrs.get(name),
    removeAttribute: name => attrs.delete(name),
    setAttribute: (name, value) => attrs.set(name, value),
  };
  let tick;
  let hide;
  const queuedScans = [];
  class Tween {
    to(seconds, props, options) {
      const duration = this.by(seconds);
      return options ? { duration, options } : duration;
    }
    by(seconds) { return seconds; }
    delay(seconds) { return seconds; }
    call(callback) { return callback; }
  }
  class WinningSymbol {
    schedule(callback, interval, repeat, delay) { return { callback, interval, repeat, delay }; }
    scheduleOnce(callback, delay) {
      const registration = this.schedule(callback, 0, 0, delay);
      return { callback: registration.callback, delay: registration.delay };
    }
    unschedule(callback) { return callback; }
    playWinAnim(callback) { return this.scheduleOnce(callback, 1); }
    playOutAnim() { return this.scheduleOnce(() => new Tween().call(() => new Tween().to(2)), 1); }
  }
  class InfoBarController { playTotalWinTween() { return new Tween().to(1.9); } }
  class RunScore { runScore(seconds) { return new Tween().to(seconds); } }
  class WinView {
    playWinCashTween() { return [new Tween().by(1.5), new Tween().delay(1), new Tween().to(0.5)]; }
  }
  class TransitionView {
    scheduleOnce(callback, delay) { return { callback, delay }; }
    showTransitionIn() { return this.scheduleOnce(() => new Tween().to(3), 2); }
    showTransitionOut() { selected.setCompleteListener(() => new Tween().delay(1)); }
  }
  class FreeGameAlertView extends WinningSymbol {
    showIntroAlert() { return this.schedule(() => new Tween().to(2), 0.5, 3, 1); }
  }
  class ReelView {}
  const config = { reelConfig: { speed: 0.2, animStagger: 0.05 } };
  class SymbolView {
    get configModel() { return config; }
    showSymbolsOut(callback) {
      const { speed, animStagger } = this.configModel.reelConfig;
      callback(speed);
      return [new Tween().by(speed), new Tween().delay(animStagger)];
    }
    showNormalSymbolsIn() {
      return [new Tween().to(this.configModel.reelConfig.speed), new Tween().to(0.1)];
    }
    showTurboSymbolsIn() {
      return new Tween().to(this.configModel.reelConfig.speed, {}, {
        onStart: () => new Tween().to(0.1),
        onComplete: () => new Tween().to(0.04),
      });
    }
    moveTo() {
      const { speed } = this.configModel.reelConfig;
      return new Tween().to(speed, {}, { onComplete: () => new Tween().to(speed) });
    }
  }
  const symbolView = new SymbolView();
  const engine = {
    sp: { Skeleton },
    Tween,
    js: { getClassByName: name => ({ Symbol: WinningSymbol, SymbolView, ReelView, WinView, RunScore, EffectsView, TransitionView, FreeGameAlertView })[name] },
    director: {
      getScene: () => ({
        getComponentsInChildren(type) {
          if (type === AnimView) return [{ menLevel2Animation: awakening }];
          if (type === WinningSymbol || type === TransitionView || type === FreeGameAlertView) return [];
          if (type === EffectsView) return [{ node: { getComponentsInChildren: () => [fireBall, excluded] } }];
          assert.equal(type, ReelView);
          return [{ spine: selected }, { spine: excluded }];
        },
      }),
    },
  };
  const context = vm.createContext({
    document: { documentElement: root, getElementById: () => ({}) },
    location: { pathname: gamePaths.seth2, search: "" },
    window: { System: { resolve: () => "cc", get: name => ({ cc: engine, "chunks:///_virtual/InfoBarController.ts": { default: InfoBarController }, "chunks:///_virtual/AnimaView.ts": { AnimView } })[name] } },
    MutationObserver: class { observe() {} },
    setInterval: callback => { tick = callback; },
    queueMicrotask: callback => { queuedScans.push(callback); },
    addEventListener: (_event, callback) => { hide = callback; },
  });
  vm.runInContext(fs.readFileSync(path.join(extension, "seth2-canvas.js"), "utf8"), context);
  assert.equal(selected.timeScale, 5);
  assert.equal(fireBall.timeScale, 5);
  const multiplier = new EffectsView().showTimesMoving();
  assert.equal(multiplier.delay, 0.1);
  assert.equal(multiplier.callback()(), 0.2);
  assert.equal(new Tween().call(() => new Tween().to(2))(), 2);
  assert.equal(awakening.timeScale, 5);
  assert.deepEqual(new WinView().playWinCashTween(), [0.15, 0.1, 0.05]);
  assert.equal(new Tween().by(1.5), 1.5);
  assert.equal(new RunScore().runScore(2), 0.2);
  assert.equal(new InfoBarController().playTotalWinTween(), 0.19);
  const winner = new WinningSymbol();
  const removal = winner.playOutAnim();
  assert.equal(removal.delay, 0.1);
  assert.equal(removal.callback()(), 0.2);
  const transitionView = new TransitionView();
  const transition = transitionView.showTransitionIn();
  assert.equal(transition.delay, 0.2);
  assert.equal(transition.callback(), 0.3);
  transitionView.showTransitionOut();
  assert.equal(selected.complete(), 0.1);
  const intro = new FreeGameAlertView().showIntroAlert();
  assert.equal(intro.interval, 0.05);
  assert.equal(intro.delay, 0.1);
  assert.equal(intro.repeat, 3);
  assert.equal(intro.callback(), 0.2);
  const onWin = () => new Tween().to(2);
  const hold = winner.playWinAnim(onWin);
  assert.equal(hold.delay, 0.1);
  assert.equal(hold.callback(), 0.2);
  assert.equal(winner.unschedule(onWin), hold.callback);
  assert.equal(winner.scheduleOnce(onWin, 1).delay, 1);
  assert.equal(excluded.timeScale, 0.5);
  assert.equal(attrs.get(readyAttribute), "reels");
  assert.deepEqual(symbolView.showSymbolsOut(speed => assert.equal(speed, 0.2)), [0.02, 0.005]);
  assert.deepEqual(symbolView.showNormalSymbolsIn(), [0.02, 0.01]);
  const turboIn = symbolView.showTurboSymbolsIn();
  assert.equal(turboIn.duration, 0.02);
  assert.equal(turboIn.options.onStart(), 0.01);
  assert.equal(turboIn.options.onComplete(), 0.004);
  assert.equal(symbolView.moveTo().options.onComplete(), 0.02);
  assert.equal(queuedScans.length, 1);
  queuedScans.shift()();
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
  assert.equal(multiplier.callback()(), 2);
  assert.equal(fireBall.timeScale, 0.5);
  assert.equal(awakening.timeScale, 0.5);
  assert.equal(symbolView.moveTo().duration, config.reelConfig.speed);
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
