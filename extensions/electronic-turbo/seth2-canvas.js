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
    return Number.isInteger(requested) && requested >= 1 && requested <= 10 ? requested : 1;
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
    EffectsView: ["showFireBall", "showSplitFireBall", "showTimesMoving", "showCloneTimesMoving"],
    BigwinView: ["playBounceTween", "showWinResult", "playBigFontLoop"],
    FullComboView: ["openAlert", "closeAlert"],
    FreeGameAlertView: ["playBounceTween"],
    JackpotView: ["playBounceTween", "showJpResult"],
    TreasuresView: ["playBounceTween", "showWinResult"],
    CurrentTimesView: ["playBreatheTween"],
  };
  const skeletonFields = {
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
    return loader.get(`chunks:///_virtual/${name}.ts`)?.[name] || engine.js.getClassByName(name);
  }

  function installEffectControls(Component, Tween, names) {
    const prototype = Component?.prototype;
    const tween = Tween?.prototype;
    const durations = ["to", "by", "delay"];
    if (!prototype || !tween || checkedEffects.has(prototype)
      || !durations.every(name => typeof tween[name] === "function"
        && Object.getOwnPropertyDescriptor(tween, name)?.writable)) return;

    for (const name of names) {
      const method = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof method?.value !== "function" || !method.writable) continue;
      const original = method.value;
      prototype[name] = function (...args) {
        const rate = requestedRate();
        if (rate === 1 || scalingEffect) return original.apply(this, args);
        const saved = durations.map(key => tween[key]);
        // The winning symbol uses a one-shot hold before the game's removal event.
        const scheduler = name === "playWinAnim" && this.scheduleOnce;
        const ownScheduler = scheduler && Object.getOwnPropertyDescriptor(this, "scheduleOnce");
        const scaleHold = typeof scheduler === "function"
          && (ownScheduler ? ownScheduler.configurable : Object.isExtensible(this));
        scalingEffect = true;
        try {
          if (scaleHold) Object.defineProperty(this, "scheduleOnce", {
            configurable: true,
            value(callback, seconds) {
              return scheduler.call(this, callback, Number.isFinite(seconds) ? seconds / rate : seconds);
            },
          });
          durations.forEach((key, index) => {
            tween[key] = function (seconds, ...rest) {
              return saved[index].call(this, Number.isFinite(seconds) ? seconds / rate : seconds, ...rest);
            };
          });
          return original.apply(this, args);
        } finally {
          durations.forEach((key, index) => { tween[key] = saved[index]; });
          if (scaleHold) {
            if (ownScheduler) Object.defineProperty(this, "scheduleOnce", ownScheduler);
            else delete this.scheduleOnce;
          }
          scalingEffect = false;
        }
      };
    }
    checkedEffects.add(prototype);
  }

  let scalingEffect = false;

  function sync() {
    const rate = requestedRate();
    const targets = new Set();
    let reelsReady = false;
    try {
      const loader = window.System;
      const engine = loader?.get(loader.resolve("cc"));
      const ReelView = engine?.js.getClassByName("ReelView");
      const scene = engine?.director.getScene();
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
              for (const field of fields) {
                const spine = view[field];
                if (spine instanceof engine.sp.Skeleton && spine.isValid && spine.enabledInHierarchy
                  && Number.isFinite(spine.timeScale)) targets.add(spine);
              }
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
