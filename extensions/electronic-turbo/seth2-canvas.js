"use strict";

(() => {
  const seth2RateAttribute = "data-blackdomain-seth2-rate";
  const seth2ReadyAttribute = "data-blackdomain-seth2-ready";

  const root = document.documentElement;
  const animationNames = new Set(["mg_idle", "fg_idle", "golden_idle", "mg_win", "fg_win", "golden_win"]);
  const controlled = new Map();

  const checkedSymbolViews = new WeakSet();
  const reelMethods = ["showSymbolsOut", "showNormalSymbolsIn", "showTurboSymbolsIn", "moveTo"];

  function requestedRate() {
    const requested = Number(root.getAttribute(seth2RateAttribute));
    return Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : 1;
  }

  function installReelControls(SymbolView) {
    if (!SymbolView) return false;
    const prototype = SymbolView.prototype;
    if (checkedSymbolViews.has(prototype)) return true;
    if (!reelMethods.every(name => {
      const method = Object.getOwnPropertyDescriptor(prototype, name);
      return method?.writable && typeof method.value === "function"
        && /\.configModel\.reelConfig/.test(Function.prototype.toString.call(method.value));
    })) return false;

    for (const name of reelMethods) {
      const original = prototype[name];
      prototype[name] = function (...args) {
        const rate = requestedRate();
        if (rate === 1 || Object.hasOwn(this, "configModel") || !Object.isExtensible(this)) {
          return original.apply(this, args);
        }
        const config = this.configModel;
        const reelConfig = config?.reelConfig;
        if (!Number.isFinite(reelConfig?.speed) || !Number.isFinite(reelConfig.animStagger)) {
          return original.apply(this, args);
        }

        // These methods read the durations synchronously when building the tweens.
        // Keep the scaled copy local to that call and preserve game-owned settings.
        const animationConfig = Object.create(config, {
          reelConfig: { value: {
            ...reelConfig,
            speed: reelConfig.speed / rate,
            animStagger: reelConfig.animStagger / rate,
          } },
        });
        Object.defineProperty(this, "configModel", { value: animationConfig, configurable: true });
        try {
          const result = original.apply(this, args);
          root.setAttribute("data-blackdomain-seth2-applied", String(rate));
          return result;
        } finally {
          delete this.configModel;
        }
      };
    }
    checkedSymbolViews.add(prototype);
    return true;
  }

  const checkedEffects = new WeakSet();
  const effectMethods = {
    Symbol: ["playWinAnim", "playOutAnim", "showSplitA_Anim", "showSplitB_Anim", "playTimesSymbolsUpgrade"],
    SymbolView: ["playOutAnimAndRemoveSymbols", "showSplitA_Anim", "showSplitSymbolAnime"],
    ReelView: ["updateWinAmount", "fontNodeOpacityTween", "expandWinnings", "mergeWinnings", "playBounceTween", "playFadeOut"],
    WinView: ["playWinCashTween"],
    RunScore: ["runScore"],
    InfoBarController: ["playTotalWinTween"],
    InfoBarPController: ["playTotalWinTween"],
    EffectsView: ["showFireBall", "showSplitFireBall", "showTimesMoving", "showCloneTimesMoving"],
    BigwinView: ["playBounceTween", "showWinResult", "playBigFontLoop", "playAnimation", "playWin", "playBigwin", "showCoinSpray", "showBigwin", "addClickAlertCompleteCb"],
    FullComboView: ["openAlert", "closeAlert", "showFullCombo"],
    FreeGameAlertView: ["playBounceTween"],
    JackpotView: ["playBounceTween", "showJpResult"],
    TreasuresView: ["playBounceTween", "showWinResult"],
    CurrentTimesView: ["playBreatheTween"],
  };
  const visualHoldMethods = new Set(["playWinAnim", "playAnimation", "playWin", "playBigwin", "showCoinSpray", "showFullCombo", "showBigwin", "showWinResult", "addClickAlertCompleteCb"]);
  const skeletonFields = {
    AnimaView: ["womenAnimation", "menAnimation", "menLevel2Animation", "frameAnime"],
    Symbol: ["symbolAnimation", "symbolOutSpine", "frameSpine"],
    BigwinView: ["effectFont", "effectBg", "fireworks"],
    BackgroundView: ["bgSpine", "bgTopSpine"],
    CharacterView: ["man", "woman", "manFireEffect", "womanFireEffect"],
    FullComboView: ["effect"],
    FreeGameAlertView: ["effectBg"],
    JackpotView: ["effectFont", "effectBg"],
    TransitionView: ["transitionSpine"],
    TreasuresView: ["effectBg"],
    CurrentTimesView: ["timesAnimation", "upgradeAnimation"],
  };

  function findComponent(loader, engine, name) {
    const module = loader.get(`chunks:///_virtual/${name}.ts`);
    // AnimaView.ts exports and registers the Cocos class as AnimView.
    const className = name === "AnimaView" ? "AnimView" : name;
    return module?.[className] || module?.default || engine.js.getClassByName(className);
  }

  const multiplierMethods = new Set([
    "showFireBall", "showSplitFireBall", "showTimesMoving", "showCloneTimesMoving",
    "playTimesSymbolsUpgrade", "playBreatheTween",
  ]);
  const tweenDurations = ["to", "by", "delay"];

  function withTweenRate(tween, rate, followCallbacks, run) {
    if (rate === 1 || scalingEffect) return run();
    const originals = tweenDurations.map(name => tween[name]);
    const originalCall = Object.getOwnPropertyDescriptor(tween, "call");
    const wrapCall = followCallbacks && originalCall?.writable && typeof originalCall.value === "function";
    scalingEffect = true;
    try {
      tweenDurations.forEach((name, index) => {
        tween[name] = function (seconds, ...args) {
          return originals[index].call(this, Number.isFinite(seconds) ? seconds / rate : seconds, ...args);
        };
      });
      if (wrapCall) {
        tween.call = function (callback, ...args) {
          return originalCall.value.call(this, wrapCallback(tween, callback, true), ...args);
        };
      }
      return run();
    } finally {
      tweenDurations.forEach((name, index) => { tween[name] = originals[index]; });
      if (wrapCall) tween.call = originalCall.value;
      scalingEffect = false;
    }
  }

  function wrapCallback(tween, callback, followCallbacks) {
    if (typeof callback !== "function") return callback;
    return function (...args) {
      const result = withTweenRate(tween, requestedRate(), followCallbacks, () => callback.apply(this, args));
      if (followCallbacks) sync();
      return result;
    };
  }

  function installEffectControls(Component, Tween, names) {
    const prototype = Component?.prototype;
    const tween = Tween?.prototype;
    if (!prototype || !tween || checkedEffects.has(prototype)
      || !tweenDurations.every(name => typeof tween[name] === "function"
        && Object.getOwnPropertyDescriptor(tween, name)?.writable)) return;

    for (const name of names) {
      const method = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof method?.value !== "function" || !method.writable) continue;
      const original = method.value;
      const followsMultiplier = multiplierMethods.has(name);
      prototype[name] = function (...args) {
        const rate = requestedRate();
        if (rate === 1) return original.apply(this, args);
        const scheduler = (followsMultiplier || visualHoldMethods.has(name)) && this.scheduleOnce;
        const ownScheduler = scheduler && Object.getOwnPropertyDescriptor(this, "scheduleOnce");
        const scaleHold = !ownScheduler?.value?.blackdomainScaledHold && typeof scheduler === "function"
          && (ownScheduler ? ownScheduler.configurable : Object.isExtensible(this));
        try {
          if (scaleHold) {
            const scaleDelay = function (callback, seconds) {
              const next = followsMultiplier || name === "showBigwin"
                ? wrapCallback(tween, callback, followsMultiplier) : callback;
              return scheduler.call(this, next, Number.isFinite(seconds) ? seconds / rate : seconds);
            };
            scaleDelay.blackdomainScaledHold = true;
            Object.defineProperty(this, "scheduleOnce", { configurable: true, value: scaleDelay });
          }
          const result = withTweenRate(tween, rate, followsMultiplier, () => original.apply(this, args));
          if (followsMultiplier) sync();
          return result;
        } finally {
          if (scaleHold) {
            if (ownScheduler) Object.defineProperty(this, "scheduleOnce", ownScheduler);
            else delete this.scheduleOnce;
          }
        }
      };
    }
    checkedEffects.add(prototype);
  }

  let scalingEffect = false;

  const connectedSummaries = new WeakSet();
  const summaryIds = new WeakMap();
  let nextSummaryId = 0;

  function connectFreeGameSummary(Component) {
    const prototype = Component?.prototype;
    const method = prototype && Object.getOwnPropertyDescriptor(prototype, "showSummaryAlert");
    if (!method?.writable || typeof method.value !== "function" || connectedSummaries.has(prototype)) return;
    const showSummary = method.value;
    prototype.showSummaryAlert = function (...args) {
      const result = showSummary.apply(this, args);
      const data = this.data?.getData();
      const gameState = data?.gameState;
      const total = gameState?.totalWinnings;
      if (!Number.isFinite(total) || total < 0) return result;
      let id = data.spinId ? String(data.spinId) : summaryIds.get(gameState);
      if (!id) {
        id = `summary-${++nextSummaryId}`;
        summaryIds.set(gameState, id);
      }
      window.dispatchEvent(new CustomEvent("BLACKDOMAIN_TURBO_FREE_GAME_SUMMARY", { detail: { id, total } }));
      return result;
    };
    connectedSummaries.add(prototype);
  }

  const previewParsers = new WeakSet();

  function connectFreeGamePreview(parser) {
    if (!parser || previewParsers.has(parser) || typeof parser.parseNewSpin !== "function") return;
    function showPreview(payload) {
      const states = payload?.engine?.gameState;
      if (!Array.isArray(states) || states.length < 2) return;
      const counters = ["numFreeSpins", "freeGameCount", "superMainGameCount"];
      const terminal = states.at(-1);
      const remaining = counters.map(key => terminal?.[key]).filter(Number.isFinite);
      if (!remaining.length || remaining.some(count => count !== 0)) return;
      if (!states.slice(0, -1).some(state => counters.some(key => state?.[key] > 0))) return;
      const total = terminal.freespinWinnings ?? terminal.totalWinnings;
      if (!Number.isFinite(total) || total < 0) return;
      window.dispatchEvent(new CustomEvent("BLACKDOMAIN_TURBO_FREE_GAME_PREVIEW", { detail: { total } }));
    }
    for (const name of ["parseNewSpin", "parseNewEarlySpin"]) {
      const original = parser[name];
      if (typeof original !== "function") continue;
      parser[name] = function (payload, ...args) {
        try { showPreview(payload); } catch { /* Keep game response processing independent of the panel. */ }
        return original.call(this, payload, ...args);
      };
    }
    previewParsers.add(parser);
  }

  function sync() {
    const rate = requestedRate();
    const targets = new Set();
    let reelsReady = false;
    try {
      const loader = window.System;
      const engine = loader?.get(loader.resolve("cc"));
      const ReelView = engine?.js.getClassByName("ReelView");
      const scene = engine?.director.getScene();
      if (scene && document.getElementById("GameCanvas")) {
        connectFreeGameSummary(findComponent(loader, engine, "FreeGameAlertView"));
        connectFreeGamePreview(loader.get("chunks:///_virtual/ParseResponse.ts")?.default);
      }
      reelsReady = Boolean(scene && document.getElementById("GameCanvas")
        && (installReelControls(loader.get("chunks:///_virtual/SymbolView.ts")?.SymbolView)
          || installReelControls(engine?.js.getClassByName("SymbolView"))));
      if (scene && document.getElementById("GameCanvas") && engine.Tween) {
        for (const [name, methods] of Object.entries(effectMethods)) {
          installEffectControls(findComponent(loader, engine, name), engine.Tween, methods);
        }
        if (rate !== 1) {
          for (const [name, fields] of Object.entries(skeletonFields)) {
            const Component = findComponent(loader, engine, name);
            if (!Component) continue;
            for (const view of scene.getComponentsInChildren(Component)) {
              const effectNode = name === "BigwinView" ? view.coinSprays : name === "CurrentTimesView" ? view.node : null;
              const extraSpines = effectNode?.getComponentsInChildren(engine.sp.Skeleton) || [];
              for (const spine of [...fields.map(field => view[field]), ...extraSpines]) {

                if (spine instanceof engine.sp.Skeleton && spine.isValid && spine.enabledInHierarchy
                  && Number.isFinite(spine.timeScale)) targets.add(spine);
              }
            }
          }
        }
      }
      if (rate !== 1 && scene && document.getElementById("GameCanvas") && engine.sp?.Skeleton) {
        const EffectsView = findComponent(loader, engine, "EffectsView");
        if (EffectsView) {
          for (const view of scene.getComponentsInChildren(EffectsView)) {
            for (const spine of view.node.getComponentsInChildren(engine.sp.Skeleton)) {
              const animation = spine.getCurrent(0)?.animation?.name;
              if (spine.isValid && spine.enabledInHierarchy && Number.isFinite(spine.timeScale)
                && /^fireball(?:_[a-z0-9]+)+$/i.test(animation || "")) targets.add(spine);
            }
          }
        }
      }
      if (ReelView && scene && document.getElementById("GameCanvas")) {
        for (const view of scene.getComponentsInChildren(ReelView)) {
          const spine = view.spine;
          if (
            spine instanceof engine.sp.Skeleton && spine.isValid && spine.enabledInHierarchy
            && spine.node.name === "spine" && spine.node.parent?.name === "winboard"
            && animationNames.has(spine.getCurrent(0)?.animation?.name)
            && Number.isFinite(spine.timeScale)
          ) targets.add(spine);
        }
      }
    } catch {
      targets.clear();
    }
    for (const [spine, saved] of controlled) {
      if (rate !== 1 && targets.has(spine)) continue;
      if (spine.isValid && spine.timeScale === saved.applied) spine.timeScale = saved.original;
      controlled.delete(spine);
    }
    if (rate !== 1) {
      for (const spine of targets) {
        const previous = controlled.get(spine);
        const original = previous?.applied === spine.timeScale ? previous.original : spine.timeScale;
        const applied = original * rate;
        if (spine.timeScale !== applied) spine.timeScale = applied;
        controlled.set(spine, { original, applied });
      }
    }
    if (reelsReady) root.setAttribute(seth2ReadyAttribute, "reels");
    else if (targets.size > 0) root.setAttribute(seth2ReadyAttribute, "scoreboard");
    else root.removeAttribute(seth2ReadyAttribute);
  }

  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: [seth2RateAttribute] });
  addEventListener("pagehide", () => {
    root.removeAttribute(seth2RateAttribute);
    sync();
  });
  setInterval(sync, 250);
  sync();
})();
