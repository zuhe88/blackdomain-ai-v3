"use strict";

(() => {
  const seth2RateAttribute = "data-blackdomain-seth2-rate";
  const seth2ReadyAttribute = "data-blackdomain-seth2-ready";

  const root = document.documentElement;
  const animationNames = new Set(["mg_idle", "fg_idle", "golden_idle", "mg_win", "fg_win", "golden_win"]);
  const controlled = new Map();

  function sync() {
    const requested = Number(root.getAttribute(seth2RateAttribute));
    const rate = Number.isInteger(requested) && requested >= 1 && requested <= 10 ? requested : 1;
    const targets = new Set();
    try {
      const loader = window.System;
      const engine = loader?.get(loader.resolve("cc"));
      const ReelView = engine?.js.getClassByName("ReelView");
      const scene = engine?.director.getScene();
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
    root.toggleAttribute(seth2ReadyAttribute, targets.size > 0);
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
