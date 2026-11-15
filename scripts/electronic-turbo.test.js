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
    await page.keyboard.press("Tab"); // multiplier
    await page.keyboard.press("End");
    await animationRate(10);
    await page.keyboard.press("ArrowUp");
    await animationRate(9);
    await page.keyboard.press("Tab"); // reset
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
    assert.ok(text.includes("本次免遊總得分 750"));
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
          window.readTestRate = () => spine.timeScale;
          window.System = {
            resolve: name => name,
            get: () => ({
              js: {getClassByName: () => class ReelView {}},
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
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("End");
    await page.waitForFunction(() => window.readTestRate() === 10);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.readTestRate() === 1);
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
  const excluded = new Skeleton();
  excluded.node.parent.name = "reel";
  const root = {
    getAttribute: name => attrs.get(name),
    removeAttribute: name => attrs.delete(name),
    toggleAttribute: (name, force) => force ? attrs.set(name, "") : attrs.delete(name),
  };
  let tick;
  let hide;
  class ReelView {}
  const engine = {
    sp: { Skeleton },
    js: { getClassByName: () => ReelView },
    director: {
      getScene: () => ({
        getComponentsInChildren(type) {
          assert.equal(type, ReelView);
          return [{ spine: selected }, { spine: excluded }];
        },
      }),
    },
  };
  const context = vm.createContext({
    document: { documentElement: root, getElementById: () => ({}) },
    window: { System: { resolve: () => "cc", get: () => engine } },
    MutationObserver: class { observe() {} },
    setInterval: callback => { tick = callback; },
    addEventListener: (_event, callback) => { hide = callback; },
  });
  vm.runInContext(fs.readFileSync(path.join(extension, "seth2-canvas.js"), "utf8"), context);
  assert.equal(selected.timeScale, 5);
  assert.equal(excluded.timeScale, 0.5);
  assert.equal(attrs.has(readyAttribute), true);
  attrs.set(rateAttribute, "3");
  tick();
  assert.equal(selected.timeScale, 1.5);
  selected.animation = "unknown";
  tick();
  assert.equal(selected.timeScale, 0.5);
  assert.equal(attrs.has(readyAttribute), false);
  selected.animation = "mg_idle";
  tick();
  assert.equal(selected.timeScale, 1.5);
  hide();
  assert.equal(selected.timeScale, 0.5);
});
