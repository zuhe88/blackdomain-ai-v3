"use strict";

(() => {
  const root = document.documentElement;
  const settingsName = "data-blackdomain-bankroll-settings";
  const statusName = "data-blackdomain-bankroll-status";
  let managed = false;

  function settings() {
    try {
      const value = JSON.parse(root.getAttribute(settingsName));
      if (!value || [value.floor, value.ceiling].every(limit => limit == null)) return null;
      if ([value.floor, value.ceiling].some(limit => limit != null && (!Number.isFinite(limit) || limit < 0))) return null;
      if (value.floor != null && value.ceiling != null && value.floor > value.ceiling) return null;
      return value;
    } catch {
      return null;
    }
  }

  function connect() {
    const get = name => window.System?.get(`chunks:///_virtual/${name}.ts`)?.default;
    const spin = get("CreateNewSpinFlowCmd");
    const early = get("CreateNewEarlySpinFlowCmd");
    const closed = get("NewSpinClosedCmd");
    const auto = get("AutoPlayModel");
    const platform = get("PlatformModel");
    const events = window.System?.get("chunks:///_virtual/SlotFrameworkEvent.ts")?.SlotFrameworkEvent;
    const gameType = window.System?.get("chunks:///_virtual/types.ts")?.EGameType;
    if (!spin?.execute || !spin.getAfterBettingBalance || !early?.execute || !closed?.createFlow
      || !auto || !platform || !events?.STOP_AUTO_SPIN || gameType?.MAIN_GAME == null
      || typeof window.dispatch !== "function") return false;

    function stop(message) {
      managed = false;
      root.setAttribute(statusName, message);
      window.dispatch(events.STOP_AUTO_SPIN);
    }

    function stopReason(config) {
      if (!config) return "已撤銷本金控管設定，自動轉已停止";
      if (!Number.isFinite(platform.amount)) return "無法確認餘額，已停止";
      if (config.ceiling != null && platform.amount > config.ceiling) return "餘額高於門檻，已停止";
      if (config.floor == null) return null;
      try {
        const remaining = spin.getAfterBettingBalance();
        if (!Number.isFinite(remaining)) return "無法確認扣款後餘額，已停止";
        return remaining < config.floor ? "扣款後餘額低於門檻，已停止" : null;
      } catch {
        return "無法確認扣款後餘額，已停止";
      }
    }

    const earlyExecute = early.execute;
    early.execute = function (...args) {
      if (managed) {
        this.data.isOpenEarlyFlag = false;
        return;
      }
      return earlyExecute.apply(this, args);
    };

    const execute = spin.execute;
    spin.execute = function (event, ...args) {
      const config = settings();
      const mainGame = this.data.currentGameType === gameType.MAIN_GAME;
      const continuation = event?.data?.data?.earlySpin;
      if (mainGame && auto.active && (managed || config) && !continuation) {
        const reason = stopReason(config);
        if (reason) {
          stop(reason);
          return;
        }
        managed = true;
        this.data.isOpenEarlyFlag = false;
        root.setAttribute(statusName, "本金控管中");
      }
      return execute.call(this, event, ...args);
    };

    const createFlow = closed.createFlow;
    closed.createFlow = function (...args) {
      if (managed && auto.active && this.data.currentGameType === gameType.MAIN_GAME) {
        const reason = stopReason(settings());
        if (reason) stop(reason);
      }
      const result = createFlow.apply(this, args);
      if (managed && !auto.active) {
        managed = false;
        root.setAttribute(statusName, "已停止自動轉");
      }
      return result;
    };

    root.setAttribute(statusName, "可設定本金控管");
    return true;
  }

  const timer = setInterval(() => {
    if (connect()) clearInterval(timer);
  }, 250);
})();
