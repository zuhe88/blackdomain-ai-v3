"use strict";

const speed = createAnimationSpeed(document.querySelector("#stage"));
const panel = createTurboPanel(document.querySelector("#controls"), { demo: true, speed });
panel.setState("示範模式 · 1×", true);
let completed = 0;
document.querySelector("#record").addEventListener("click", () => {
  completed += 1;
  panel.record(String(completed), completed * 125);
});
