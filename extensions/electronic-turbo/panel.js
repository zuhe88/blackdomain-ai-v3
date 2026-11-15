"use strict";

globalThis.createTurboPanel = function createTurboPanel(container, { demo = false, speed }) {
  const host = document.createElement("div");
  container.append(host);
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { display: block; color-scheme: dark; font: 14px/1.45 system-ui, sans-serif; }
      :host([data-overlay]) { position: fixed; top: 12px; left: 12px; z-index: 2147483647; max-width: calc(100vw - 24px); }
      section { box-sizing: border-box; width: min(320px, 100%); padding: 14px; background: #141520; border: 1px solid #40405c; border-radius: 12px; color: #f4f3ff; box-shadow: 0 8px 24px #0006; }
      header, .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      header { justify-content: space-between; }
      p { margin: 8px 0; color: #c1bfd2; }
      select, button { font: inherit; color: inherit; background: #242539; border: 1px solid #777494; border-radius: 6px; padding: 5px 8px; }
      button, summary, select { cursor: pointer; }
      select:disabled { cursor: default; opacity: .55; }
      details { border-top: 1px solid #40405c; padding-top: 8px; margin-top: 8px; }
      ol { margin: 6px 0 0; padding-left: 24px; }
      a { color: #c5b6ff; }
    </style>
    <section aria-label="黑域 AI 電子加速器">
      <header><strong>黑域 AI · 電子加速器</strong><button type="button" id="toggle" aria-expanded="true" aria-controls="body">收合</button></header>
      <div id="body">
        <p id="status" role="status"></p>
        <div class="controls">
          <label for="rate">動畫倍率</label>
          <select id="rate"></select>
          <button type="button" id="reset">恢復 1×</button>
        </div>
        <p id="latest"></p>
        <details><summary>最近免遊</summary><ol id="history"></ol></details>
      </div>
    </section>`;
  if (!demo) host.dataset.overlay = "";
  const select = shadow.getElementById("rate");
  const reset = shadow.getElementById("reset");
  const status = shadow.getElementById("status");
  const latest = shadow.getElementById("latest");
  const list = shadow.getElementById("history");
  for (let rate = 1; rate <= 10; rate += 1) select.add(new Option(`${rate}×`, rate));

  const history = [];
  const formatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 8 });

  function renderHistory() {
    latest.textContent = history.length
      ? `本次免遊總得分 ${formatter.format(history[0].points)}`
      : "等候本分頁的免遊結算";
    list.replaceChildren(...history.map(entry => {
      const row = document.createElement("li");
      row.textContent = `${formatter.format(entry.points)} 分`;
      return row;
    }));
    if (!history.length) {
      const row = document.createElement("li");
      row.textContent = "目前沒有紀錄";
      list.append(row);
    }
  }

  function changeSpeed(value) {
    select.value = value;
    speed.set(value);
    if (demo) status.textContent = `示範模式 · ${value}×`;
  }

  const toggle = shadow.getElementById("toggle");
  const body = shadow.getElementById("body");
  toggle.addEventListener("click", () => {
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? "展開" : "收合";
    toggle.setAttribute("aria-expanded", String(!body.hidden));
  });
  select.addEventListener("change", () => changeSpeed(Number(select.value)));
  reset.addEventListener("click", () => changeSpeed(1));
  renderHistory();

  return {
    setState(message, enabled = false) {
      status.textContent = message;
      select.disabled = reset.disabled = !enabled;
      if (!enabled) changeSpeed(1);
    },
    clearHistory() {
      history.length = 0;
      renderHistory();
    },
    record(id, points) {
      if (typeof id !== "string" || !id.trim() || id.length > 128 || !Number.isFinite(points) || points < 0) return;
      if (history.some(entry => entry.id === id)) return;
      history.unshift({ id, points });
      history.length = Math.min(history.length, 5);
      renderHistory();
    },
  };
};
