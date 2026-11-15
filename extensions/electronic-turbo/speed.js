"use strict";

// Controls explicitly marked presentation animations on the document timeline.
function createAnimationSpeed(root) {
  const controlled = new Map();
  let multiplier = 1;

  function apply() {
    const animations = new Set(root.getAnimations({ subtree: true }).filter(animation => {
      const target = animation.effect?.target;
      return target?.closest("[data-blackdomain-presentation]") && animation.timeline === root.ownerDocument.timeline;
    }));

    for (const [animation, rate] of controlled) {
      if (multiplier === 1 || !animations.has(animation)) {
        animation.updatePlaybackRate(rate);
        controlled.delete(animation);
      }
    }
    if (multiplier !== 1) {
      for (const animation of animations) {
        if (controlled.has(animation) || animation.playbackRate === 0) continue;
        controlled.set(animation, animation.playbackRate);
        animation.updatePlaybackRate(animation.playbackRate * multiplier);
      }
    }
    return controlled.size;
  }

  return {
    set(value) {
      if (!Number.isInteger(value) || value < 1 || value > 10) return 0;
      if (value !== multiplier && multiplier !== 1) {
        for (const [animation, rate] of controlled) animation.updatePlaybackRate(rate * value);
      }
      multiplier = value;
      return apply();
    },
    refresh: apply,
  };
}
