"use strict";

globalThis.createTurboPanel = function createTurboPanel(container, { demo = false, speed, bankroll }) {
  const host = document.createElement("div");
  container.append(host);
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host {
        display: block;
        color-scheme: dark;
        font: 13px/1.5 Inter, system-ui, sans-serif;
        color: #edf5ff;
        --muted: #a0b1cb;
        --line: #a1caff29;
        --accent: #80e4ff;
      }
      :host([data-overlay]) { position: fixed; inset: 12px auto auto 12px; z-index: 2147483647; max-width: calc(100vw - 24px); }
      section {
        box-sizing: border-box;
        width: min(264px, 100%);
        padding: 13px;
        background: radial-gradient(ellipse at top left, #19354b, transparent 65%), #0c1321;
        border: 1px solid #567a9c;
        border-radius: 14px;
        box-shadow: 0 12px 32px #0309139c, inset 0 1px #a2e9ff24;
      }
      header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      header strong { font-size: 15px; letter-spacing: .02em; }
      button { color: inherit; font: inherit; border: 1px solid var(--line); border-radius: 8px; background: #121f33; cursor: pointer; }
      #toggle { padding: 3px 8px; color: var(--muted); font-size: 12px; }
      #status { margin: 7px 0 10px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
      .controls { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
      .controls button { min-height: 34px; padding: 3px 1px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .controls button[aria-pressed="true"] {
        background: linear-gradient(145deg, #22516c, #183149);
        border-color: #6ecce8;
        color: #e3faff;
        box-shadow: inset 0 1px #aeedff47;
      }
      button:hover:not(:disabled), summary:hover { color: var(--accent); }
      :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      :disabled { cursor: default; opacity: .55; }
      #latest {
        margin: 10px 0 0;
        padding: 10px 11px 11px;
        border: 1px solid #6fc8ee54;
        border-radius: 10px;
        background: radial-gradient(ellipse at 90% 0%, #244c66, transparent 72%), #101c2c;
      }
      .result-caption { display: flex; justify-content: space-between; align-items: center; gap: 4px; flex-wrap: wrap; color: #c3d5e6; font-size: 11px; }
      #result-state { padding: 1px 6px; border: 1px solid #75d9ec65; border-radius: 5px; color: #a2ecff; }
      #latest[data-preview] #result-state { border-color: #edc77b66; color: #ffdc96; }
      .result-value { display: flex; align-items: baseline; gap: 5px; margin-top: 4px; color: #cbdfef; }
      #result-points { font-size: clamp(23px, 7vw, 32px); line-height: 1.15; font-weight: 700; letter-spacing: -.045em; font-variant-numeric: tabular-nums; color: #f0faff; overflow-wrap: anywhere; min-width: 0; }
      #history li { padding-block: 2px; }
      details { border-top: 1px solid var(--line); padding-top: 7px; margin-top: 8px; }
      #latest, details { font-size: 12px; color: var(--muted); }
      summary { cursor: pointer; }
      form { display: grid; gap: 6px; margin-top: 8px; }
      form label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      form input { width: 88px; }
      ol { margin: 6px 0 0; padding-left: 22px; font-variant-numeric: tabular-nums; }
      .feature { margin-top: 9px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: #111e2f; }
      .feature-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .feature-switch { min-width: 66px; min-height: 28px; display: inline-flex; align-items: center; justify-content: space-between; padding: 2px 5px; border-radius: 20px; color: var(--muted); }
      .switch-track { position: relative; width: 28px; height: 14px; border-radius: 12px; background: #08111d; border: 1px solid #557084; }
      .switch-track::after { content: ""; position: absolute; inset: 2px auto 2px 2px; width: 10px; border-radius: 100%; background: #9aacc0; }
      .feature-switch[aria-checked="true"] { color: #daf8ff; border-color: #72d9ef; background: linear-gradient(135deg, #18344a, #1b4b5c); box-shadow: inset 0 0 8px #66dfff29; }
      .feature-switch[aria-checked="true"] .switch-track::after { left: 16px; background: #a9f1ff; box-shadow: 0 0 8px #62ddff; }
    </style>
    <section aria-label="黑域 AI 電子加速器">
      <header><strong>黑域 AI · 電子加速器</strong><button type="button" id="toggle" aria-expanded="true" aria-controls="body">收合</button></header>
      <div id="body">
        <p id="status" role="status"></p>
        <div class="controls" role="group" aria-label="加速倍率"></div>
        <div id="spoiler-content">
          <div id="latest" hidden role="status">
            <div class="result-caption"><span>免遊總贏分</span><span id="result-state"></span></div>
            <div class="result-value"><strong id="result-points"></strong><span>分</span></div>
          </div>
        <details><summary>最近五次紀錄</summary><ol id="history"></ol></details></div>
      </div>
    </section>`;
  if (!demo) host.dataset.overlay = "";
  const status = shadow.getElementById("status");
  const latest = shadow.getElementById("latest");
  const list = shadow.getElementById("history");
  const controls = shadow.querySelector(".controls");
  const rateButtons = [1, 10, 20, 50].map(rate => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${rate}×`;
    button.value = String(rate);
    button.setAttribute("aria-pressed", String(rate === 1));
    button.addEventListener("click", () => changeSpeed(rate));
    controls.append(button);
    return button;
  });

  const history = [];
  let preview = null;
  const formatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 8 });

  function renderHistory() {
    const hasPreview = preview !== null;
    const points = hasPreview ? preview : history[0]?.points;
    latest.hidden = points === undefined;
    latest.toggleAttribute("data-preview", hasPreview);
    shadow.getElementById("result-state").textContent = hasPreview ? "待結算" : "已結算";
    shadow.getElementById("result-points").textContent = points === undefined ? "" : formatter.format(points);
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
    for (const button of rateButtons) button.setAttribute("aria-pressed", String(Number(button.value) === value));
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
  renderHistory();

  function addFeatureSwitch(title, content, initial, onChange) {
    const card = document.createElement("div");
    card.className = "feature";
    const header = document.createElement("div");
    header.className = "feature-head";
    const label = document.createElement("strong");
    label.textContent = title;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feature-switch";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", title);
    button.innerHTML = '<span class="switch-track" aria-hidden="true"></span><span aria-hidden="true"></span>';
    function render(enabled) {
      button.setAttribute("aria-checked", String(enabled));
      button.lastElementChild.textContent = enabled ? "開啟" : "關閉";
      content.hidden = !enabled;
    }
    button.addEventListener("click", () => {
      const enabled = button.getAttribute("aria-checked") !== "true";
      render(enabled);
      onChange(enabled);
    });
    header.append(label, button);
    content.before(card);
    card.append(header, content);
    render(initial);
  }

  let spoilerEnabled = true;
  addFeatureSwitch("免遊劇透", shadow.getElementById("spoiler-content"), true, enabled => {
    spoilerEnabled = enabled;
    if (!enabled) {
      history.length = 0;
      preview = null;
      renderHistory();
    }
  });

  if (bankroll) {
    const settings = document.createElement("div");
    settings.innerHTML = `

      <form>
        <label>自動轉模式 <select name="mode"><option value="count">指定轉數</option><option value="continuous">持續自動轉</option></select></label>
        <label>轉數 <input name="count" type="number" min="1" step="1" value="20" required></label>
        <label>最低餘額 <input name="floor" type="number" min="0" step="0.01" required></label>
        <button type="submit">儲存設定</button>
      </form>
      <p role="status">等待遊戲連接</p>`;
    body.append(settings);
    addFeatureSwitch("本金控管", settings, false, enabled => { if (!enabled) bankroll.clear(); });
    const form = settings.querySelector("form");
    const message = settings.querySelector("p");
    let lastStatus;
    const refresh = () => {
      const state = bankroll.status();
      form.querySelector("button").disabled = !state;
      if (state && state !== lastStatus) message.textContent = state;
      lastStatus = state;
    };
    form.elements.mode.addEventListener("change", () => {
      form.elements.count.disabled = form.elements.mode.value === "continuous";
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!bankroll.status()) return;
      bankroll.save({
        count: form.elements.mode.value === "continuous" ? -1 : form.elements.count.valueAsNumber,
        floor: form.elements.floor.valueAsNumber,
      });
      message.textContent = "已儲存。請用遊戲內的自動轉按鈕開始。";
    });
    refresh();
    setInterval(refresh, 250);
  }
  return {
    setState(message, enabled = false) {
      status.textContent = message;
      for (const button of rateButtons) button.disabled = !enabled;
      if (!enabled) changeSpeed(1);
    },
    clearHistory() {
      history.length = 0;
      preview = null;
      renderHistory();
    },
    preview(points) {
      if (!spoilerEnabled || !Number.isFinite(points) || points < 0) return;
      preview = points;
      renderHistory();
    },
    record(id, points) {
      if (!spoilerEnabled || typeof id !== "string" || !id.trim() || id.length > 128 || !Number.isFinite(points) || points < 0) return;
      preview = null;
      if (history.some(entry => entry.id === id)) { renderHistory(); return; }
      history.unshift({ id, points });
      history.length = Math.min(history.length, 5);
      renderHistory();
    },
  };
};
