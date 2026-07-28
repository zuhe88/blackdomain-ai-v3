(function () {
  "use strict";

  if (window.__blackdomainElectronicBridgeInstalled) return;
  window.__blackdomainElectronicBridgeInstalled = true;

  const TABLE_PAGE_RESPONSE = "SlotFrameworkEvent:SLOT_TABLE_PAGE_DATA_RESPONSE";
  const TABLE_DETAIL_RESPONSE = "SlotFrameworkEvent:SLOT_TABLE_RESPONSE";
  const TABLE_PAGE_REQUEST = "SlotFrameworkEvent:SEND_GET_SLOT_TABLE_PAGE_DATA_REQUEST";
  const TABLE_DETAIL_REQUEST = "SlotFrameworkEvent:SEND_GET_SLOT_TABLE_DETAIL_REQUEST";
  const SPIN_EVENTS = new Set([
    "SlotFrameworkEvent:SPIN_RESPONSE",
    "SlotFrameworkEvent:EARLY_SPIN_RESPONSE",
    "SlotFrameworkEvent:BUY_FEATURE_RESPONSE",
  ]);
  let wrappedDispatch = null;
  let gameName = null;
  let currentRoom = {};
  let lastPageRefreshAt = 0;
  let detailQueue = [];
  let detailTimer = null;

  function emit(body) {
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_RELAY", { detail: body }));
  }

  function detectGameName(payload) {
    const hints = [
      location.href,
      payload?.engine?.gameType,
      payload?.engine?.gameName,
      payload?.gameType,
      payload?.gameName,
      ...[...document.scripts].map((script) => script.src),
    ].filter(Boolean).join(" ");
    if (/g1001|egyptian-mythology|erase-any-times-1/i.test(hints)) return "戰神賽特1";
    if (/g1005|golden-seth|erase-any-times-2/i.test(hints)) return "戰神賽特2";
    return null;
  }

  function findData(payload) {
    const candidates = [
      payload,
      payload?.data,
      payload?.platform,
      payload?.platform?.data,
      payload?.platform?.tableMeta,
    ];
    return candidates.find((value) => value && typeof value === "object") || {};
  }

  function normalizeTable(table) {
    const number = Number(table?.number ?? table?.roomNumber ?? table?.tableNumber);
    const roomId = table?.roomId;
    const status = String(table?.status || "");
    if (!Number.isInteger(number) || number <= 0 || roomId == null || !status) return null;
    return {
      roomId: String(roomId),
      number,
      status,
      dayWin: table.dayWin,
      dayBet: table.dayBet,
      hourWin: table.hourWin,
      hourBet: table.hourBet,
      todayWin: table.todayWin,
      todayBet: table.todayBet,
      mgCounts: Array.isArray(table.mgCounts) ? table.mgCounts.slice(0, 3) : undefined,
    };
  }

  function tablePayload(payload) {
    const candidates = [payload, payload?.data, payload?.platform, payload?.platform?.tableMeta];
    const container = candidates.find((item) => Array.isArray(item?.tables));
    if (!container) return null;
    const tables = container.tables.map(normalizeTable).filter(Boolean);
    if (!tables.length) return null;
    return {
      tables,
      page: Number(container.currentPage ?? container.page ?? payload?.currentPage ?? payload?.page) || 1,
      totalPages: Number(container.totalPages ?? payload?.totalPages) || null,
    };
  }

  function detailPayload(payload) {
    const candidates = [payload?.detail, payload?.data?.detail, payload?.data, payload];
    const detail = candidates.find((item) => item?.roomId != null && (
      item.dayBet != null || item.hourBet != null || item.todayBet != null || item.mgCounts != null
    ));
    if (!detail) return null;
    return {
      roomId: String(detail.roomId),
      number: Number(detail.number ?? detail.roomNumber) || undefined,
      status: detail.status,
      dayWin: detail.dayWin,
      dayBet: detail.dayBet,
      hourWin: detail.hourWin,
      hourBet: detail.hourBet,
      todayWin: detail.todayWin,
      todayBet: detail.todayBet,
      mgCounts: Array.isArray(detail.mgCounts) ? detail.mgCounts.slice(0, 3) : undefined,
    };
  }

  function spinPayload(payload) {
    const engine = payload?.engine;
    if (!engine || !Array.isArray(engine.gameState) || !engine.gameState.length) return null;
    return {
      roomId: currentRoom.roomId || undefined,
      roomNumber: currentRoom.number || undefined,
      totalStake: payload?.totalStake,
      engine: {
        spinId: engine.spinId,
        gameState: engine.gameState.slice(0, 500).map((state) => ({
          spinId: state?.spinId,
          totalWinnings: state?.totalWinnings,
          totalStake: state?.totalStake,
          currentView: state?.currentView,
          totalViews: state?.totalViews,
          action: state?.action,
        })),
      },
    };
  }

  function queueEmptyDetails(tables) {
    const empty = tables.filter((table) => table.status === "Empty");
    for (const table of empty) {
      if (!detailQueue.some((item) => item.roomId === table.roomId)) detailQueue.push(table);
    }
    detailQueue = detailQueue.slice(0, 40);
    if (detailTimer || !detailQueue.length) return;
    detailTimer = setInterval(() => {
      const table = detailQueue.shift();
      if (!table || typeof window.dispatch !== "function") {
        clearInterval(detailTimer);
        detailTimer = null;
        return;
      }
      window.dispatch(TABLE_DETAIL_REQUEST, { roomId: table.roomId });
    }, 350);
  }

  function handleDispatch(eventName, payload) {
    gameName ||= detectGameName(payload);
    if (!gameName) return;

    if (eventName === "SlotFrameworkEvent:INIT_RESPONSE") {
      const table = payload?.platform?.table || payload?.platform?.slotTable || payload?.table;
      const normalized = normalizeTable(table);
      if (normalized) currentRoom = normalized;
      const initialTables = tablePayload(payload);
      if (initialTables) {
        emit({ type: "tables", gameName, ...initialTables });
        queueEmptyDetails(initialTables.tables);
      }
      setTimeout(() => requestPage(1), 1000);
      return;
    }

    if (eventName === TABLE_PAGE_RESPONSE) {
      const data = tablePayload(payload);
      if (!data) return;
      emit({ type: "tables", gameName, ...data });
      queueEmptyDetails(data.tables);
      if (data.totalPages && data.page < data.totalPages) {
        setTimeout(() => requestPage(data.page + 1), 180);
      }
      return;
    }

    if (eventName === TABLE_DETAIL_RESPONSE) {
      const detail = detailPayload(payload);
      if (detail) emit({ type: "detail", gameName, detail });
      return;
    }

    if (SPIN_EVENTS.has(eventName)) {
      const spin = spinPayload(payload);
      if (spin) emit({ type: "spin", gameName, ...spin });
    }
  }

  function installDispatchWrapper() {
    if (typeof window.dispatch !== "function" || window.dispatch === wrappedDispatch) return;
    const original = window.dispatch;
    wrappedDispatch = function blackdomainElectronicDispatch(eventName, payload, ...rest) {
      try {
        handleDispatch(eventName, payload);
      } catch {
        // Keep the original game event flow untouched.
      }
      return original.call(this, eventName, payload, ...rest);
    };
    window.dispatch = wrappedDispatch;
  }

  function requestPage(page = 1) {
    installDispatchWrapper();
    if (typeof window.dispatch !== "function" || !detectGameName()) return;
    if (page === 1) lastPageRefreshAt = Date.now();
    window.dispatch(TABLE_PAGE_REQUEST, { page });
  }

  setInterval(installDispatchWrapper, 20);
  setInterval(() => {
    if (Date.now() - lastPageRefreshAt > 60000) requestPage(1);
  }, 10000);
  setTimeout(() => requestPage(1), 2500);

  console.info("[BLACKDOMAIN Electronic] ATG room observer active");
}());
