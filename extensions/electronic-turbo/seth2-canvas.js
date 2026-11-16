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

  function installReelControls(SymbolView, engine) {
    const prototype = SymbolView?.prototype;
    if (!prototype) return false;
    if (checkedSymbolViews.has(prototype)) return true;
    if (!reelMethods.every(name => {
      const method = Object.getOwnPropertyDescriptor(prototype, name);
      return method?.writable && typeof method.value === "function"
        && /\.configModel\.reelConfig/.test(Function.prototype.toString.call(method.value));
    })) return false;
    if (!installEffectControls(SymbolView, engine, [...reelMethods, ...effectMethods.SymbolView])) return false;
    checkedSymbolViews.add(prototype);
    return true;
  }

  const checkedEffects = new WeakSet();
  const effectMethods = {
    Symbol: [
      "playWinAnim", "playOutAnim", "showSplitA_Anim", "showSplitB_Anim",
      "playScatterInAnim", "playJackpotInAnim", "playScatterWinAnim", "playTotemWinAnim", "playTotemHitAnim", "playJpWinAnim",
      "showTimesStage_Anim", "showTimesLock_Anim", "openTimesSymbol", "closeTimesSymbol", "showTimesSymbol",
      "closeTimesLabel", "cloneLockAnime", "playTimesSymbolsFunction", "playTimesSymbolsUpgrade",
    ],
    SymbolView: [
      "playOutAnimAndRemoveSymbols", "showSplitA_Anim", "showSplitSymbolAnime", "playSymbolsWin", "playScatterWin",
      "showSymbolsQuickIn", "showLockSymbols", "showCloneSymbols", "showCurrentViewFall", "showNewSymbolFall",
      "symbolsBezierByTimeTurbo", "symbolsBezierByTime", "startCloneTimeSymbol", "showTimesLock_Anim",
      "showTimesLock_LevelDown", "timeLock_out", "timeLock_Allout",
    ],
    ReelView: ["IncreaseFgRemaining", "updateWinAmount", "fontNodeOpacityTween", "expandWinnings", "mergeWinnings", "playBounceTween", "playFadeOut"],
    WinView: ["playWinCashTween"],
    RunScore: ["runScore"],
    InfoBarController: ["playTotalWinTween"],
    InfoBarPController: ["playTotalWinTween"],
    EffectsView: ["showFireBall", "showSplitFireBall", "showTimesMoving", "showCloneTimesMoving"],
    BigwinView: ["playBounceTween", "showWinResult", "playBigFontLoop", "playAnimation", "playWin", "playBigwin", "showCoinSpray", "showBigwin", "addClickAlertCompleteCb"],
    FullComboView: ["openAlert", "closeAlert", "showFullCombo"],
    FreeGameAlertView: ["playBounceTween", "showIntroAlert", "showSummaryAlert"],
    TransitionView: ["showTransitionIn", "showTransitionOut"],
    JackpotView: ["playBounceTween", "showJpResult", "showJp", "closeAlert", "playAnimation", "showCoinSpray", "addClickAlertCompleteCb", "completedCB"],
    TreasuresView: ["playBounceTween", "showWinResult", "playAnimation", "playWin", "playCoinSprayAndRunScore",
      "addClickAlertCompleteCb", "showCoinSpray", "showTreasureWin", "completedCB"],
    CurrentTimesView: ["playBreatheTween", "updateFGTotalTimes"],
  };
  const skeletonFields = {
    AnimaView: ["womenAnimation", "menAnimation", "menLevel2Animation", "frameAnime"],
    Symbol: ["symbolAnimation", "symbolOutSpine", "frameSpine", "timesSplitASpine", "timesSplitBSpine", "timesLockSpine", "timesStageSpine", "upgradeAnimation"],
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
    let module;
    try { module = loader.get(`chunks:///_virtual/${name}.ts`); } catch { /* Module may still be loading. */ }
    // AnimaView.ts exports and registers the Cocos class as AnimView.
    const className = name === "AnimaView" ? "AnimView" : name;
    return module?.[className] || module?.default || engine.js.getClassByName(className);
  }

  const tweenDurations = ["to", "by", "delay"];
  const activeVisuals = new WeakSet();
  const schedulerWrappers = new WeakSet();
  let visualOwner;
  let syncQueued = false;

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  }

  function withVisualTiming(owner, engine, run) {
    const rate = requestedRate();
    if (rate === 1) return run();
    const alreadyActive = activeVisuals.has(owner);
    const previousOwner = visualOwner;
    visualOwner = owner;
    activeVisuals.add(owner);
    try {
      return previousOwner ? run() : withTweenRate(engine, rate, run);
    } finally {
      visualOwner = previousOwner;
      if (!alreadyActive) activeVisuals.delete(owner);
      queueSync();
    }
  }

  function followVisual(owner, engine, callback) {
    if (typeof callback !== "function") return callback;
    return function (...args) {
      return withVisualTiming(owner, engine, () => callback.apply(this, args));
    };
  }

  function withTweenRate(engine, rate, run) {
    const tween = engine.Tween.prototype;
    const spine = engine.sp?.Skeleton?.prototype;
    const setComplete = spine && Object.getOwnPropertyDescriptor(spine, "setCompleteListener");
    const wrapComplete = setComplete?.writable && typeof setComplete.value === "function";
    const originals = tweenDurations.map(name => tween[name]);
    const call = Object.getOwnPropertyDescriptor(tween, "call");
    const wrapCall = call?.writable && typeof call.value === "function";
    let forwarding = false;
    try {
      tweenDurations.forEach((name, index) => {
        tween[name] = function (seconds, ...args) {
          if (forwarding) return originals[index].call(this, seconds, ...args);
          const options = args[1];
          if (name !== "delay" && (typeof options?.onStart === "function" || typeof options?.onComplete === "function")) {
            args[1] = { ...options,
              onStart: followVisual(visualOwner, engine, options.onStart),
              onComplete: followVisual(visualOwner, engine, options.onComplete),
            };
          }
          forwarding = true;
          try {
            return originals[index].call(this, Number.isFinite(seconds) ? seconds / rate : seconds, ...args);
          } finally {
            forwarding = false;
          }
        };
      });
      if (wrapCall) {
        tween.call = function (callback, ...args) {
          return call.value.call(this, followVisual(visualOwner, engine, callback), ...args);
        };
      }
      if (wrapComplete) {
        spine.setCompleteListener = function (callback, ...args) {
          return setComplete.value.call(this, followVisual(visualOwner, engine, callback), ...args);
        };
      }
      return run();
    } finally {
      if (wrapComplete) spine.setCompleteListener = setComplete.value;
      tweenDurations.forEach((name, index) => { tween[name] = originals[index]; });
      if (wrapCall) tween.call = call.value;
    }
  }

  function installVisualScheduler(prototype, engine) {
    const scheduleOnce = prototype.scheduleOnce;
    const schedule = prototype.schedule;
    const unschedule = prototype.unschedule;
    if (typeof scheduleOnce !== "function" || schedulerWrappers.has(scheduleOnce)) return;
    const canReplace = name => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      return descriptor ? descriptor.writable : Object.isExtensible(prototype);
    };
    if (!canReplace("scheduleOnce") || (typeof unschedule === "function" && !canReplace("unschedule"))) return;

    const callbacks = new WeakMap();
    const forwarding = new WeakSet();
    function callbackFor(owner, callback, rate) {
      let registered = callbacks.get(owner);
      if (rate !== 1 && typeof callback === "function") {
        if (!registered) callbacks.set(owner, registered = new WeakMap());
        if (!registered.has(callback)) registered.set(callback, followVisual(owner, engine, callback));
      }
      return registered?.get(callback) || callback;
    }
    function replaceMethod(name, value) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      Object.defineProperty(prototype, name, descriptor ? { ...descriptor, value } : {
        value, writable: true, configurable: true,
      });
    }
    function duration(seconds, rate) {
      return Number.isFinite(seconds) ? seconds / rate : seconds;
    }
    if (typeof schedule === "function" && canReplace("schedule")) {
      replaceMethod("schedule", function (callback, interval, repeat, delay) {
        if (forwarding.has(this)) return schedule.apply(this, arguments);
        const rate = activeVisuals.has(this) ? requestedRate() : 1;
        return schedule.call(this, callbackFor(this, callback, rate), duration(interval, rate), repeat, duration(delay, rate));
      });
    }
    if (typeof unschedule === "function") {
      replaceMethod("unschedule", function (callback, ...args) {
        return unschedule.call(this, callbackFor(this, callback, 1), ...args);
      });
    }
    function scheduleVisual(callback, seconds, ...args) {
      const rate = activeVisuals.has(this) ? requestedRate() : 1;
      forwarding.add(this);
      try {
        return scheduleOnce.call(this, callbackFor(this, callback, rate), duration(seconds, rate), ...args);
      } finally {
        forwarding.delete(this);
      }
    }
    replaceMethod("scheduleOnce", scheduleVisual);
    schedulerWrappers.add(scheduleVisual);
  }

  function installEffectControls(Component, engine, names) {
    const prototype = Component?.prototype;
    const tween = engine.Tween?.prototype;
    if (checkedEffects.has(prototype)) return true;
    if (!prototype || !tween || !tweenDurations.every(name => typeof tween[name] === "function"
        && Object.getOwnPropertyDescriptor(tween, name)?.writable)) return false;

    installVisualScheduler(prototype, engine);
    for (const name of names) {
      const method = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof method?.value !== "function" || !method.writable) continue;
      prototype[name] = function (...args) {
        const rate = requestedRate();
        const result = withVisualTiming(this, engine, () => method.value.apply(this, args));
        if (rate !== 1 && reelMethods.includes(name)) root.setAttribute("data-blackdomain-seth2-applied", String(rate));
        return result;
      };
    }
    checkedEffects.add(prototype);
    return true;
  }

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
      const scene = document.getElementById("GameCanvas") && engine?.director.getScene();
      const components = new Map();
      const component = name => {
        if (!components.has(name)) components.set(name, findComponent(loader, engine, name));
        return components.get(name);
      };
      const ReelView = scene && component("ReelView");
      const Skeleton = engine?.sp?.Skeleton;
      if (scene) {
        connectFreeGameSummary(component("FreeGameAlertView"));
        reelsReady = installReelControls(component("SymbolView"), engine);
        try { connectFreeGamePreview(loader.get("chunks:///_virtual/ParseResponse.ts")?.default); }
        catch { /* An unavailable preview parser must not block visual timing. */ }
      }
      if (scene && engine.Tween) {
        for (const [name, methods] of Object.entries(effectMethods)) {
          installEffectControls(component(name), engine, methods);
        }
        if (rate !== 1 && Skeleton) {
          for (const [name, fields] of Object.entries(skeletonFields)) {
            const Component = component(name);
            if (!Component) continue;
            for (const view of scene.getComponentsInChildren(Component)) {
              const effectNode = name === "BigwinView" ? view.coinSprays
                : ["CurrentTimesView", "TransitionView", "FreeGameAlertView"].includes(name) ? view.node : null;
              const extraSpines = effectNode?.getComponentsInChildren?.(Skeleton) || [];
              for (const spine of [...fields.map(field => view[field]), ...extraSpines]) {
                if (spine instanceof Skeleton && spine.isValid && spine.enabledInHierarchy
                  && Number.isFinite(spine.timeScale)) targets.add(spine);
              }
            }
          }
        }
      }
      if (rate !== 1 && scene && Skeleton) {
        const EffectsView = component("EffectsView");
        if (EffectsView) {
          for (const view of scene.getComponentsInChildren(EffectsView)) {
            for (const spine of view.node?.getComponentsInChildren?.(Skeleton) || []) {
              const animation = spine.getCurrent?.(0)?.animation?.name;
              if (spine.isValid && spine.enabledInHierarchy && Number.isFinite(spine.timeScale)
                && /^fireball(?:_[a-z0-9]+)+$/i.test(animation || "")) targets.add(spine);
            }
          }
        }
      }
      if (ReelView && Skeleton) {
        for (const view of scene.getComponentsInChildren(ReelView)) {
          const spine = view.spine;
          if (
            spine instanceof Skeleton && spine.isValid && spine.enabledInHierarchy
            && spine.node.name === "spine" && spine.node.parent?.name === "winboard"
            && animationNames.has(spine.getCurrent?.(0)?.animation?.name)
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
