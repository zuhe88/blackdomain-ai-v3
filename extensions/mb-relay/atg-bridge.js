(function () {
  "use strict";

  if (window.__blackdomainElectronicBridgeInstalled) return;
  window.__blackdomainElectronicBridgeInstalled = true;

  const TABLE_PAGE_RESPONSE = "SlotFrameworkEvent:SLOT_TABLE_PAGE_DATA_RESPONSE";
  const TABLE_DETAIL_RESPONSE = "SlotFrameworkEvent:SLOT_TABLE_RESPONSE";
  const TABLE_PAGE_REQUEST = "SlotFrameworkEvent:SEND_GET_SLOT_TABLE_PAGE_DATA_REQUEST";
  const TABLE_DETAIL_REQUEST = "SlotFrameworkEvent:SEND_GET_SLOT_TABLE_DETAIL_REQUEST";
  const TABLES_UPDATED_RESPONSE = "SlotFrameworkEvent:SLOT_TABLES_UPDATED_RESPONSE";
  const SPIN_EVENTS = new Set([
    "SlotFrameworkEvent:SPIN_RESPONSE",
    "SlotFrameworkEvent:EARLY_SPIN_RESPONSE",
    "SlotFrameworkEvent:BUY_FEATURE_RESPONSE",
  ]);
  let wrappedDispatch = null;
  let gameName = null;
  let currentRoom = {};
  const knownTables = new Map();
  let pendingDetailRoom = null;
  let scanPage = 0;
  let scanTotalPages = 8;
  let scanTimer = null;

  function emit(body) {
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_RELAY", { detail: body }));
  }

  function detectGameName(payload) {
    if (location.pathname.includes("cfca28d832b0ae2c364caae4b6de4e11aa22f0c4")) return "戰神賽特1";
    if (location.pathname.includes("361d567d94ac569664c82068a30b762e8d8438b8")) return "戰神賽特2";
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
      occupied: Boolean(table?.user?.userId ?? table?.user),
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
    tables.forEach((table) => knownTables.set(table.roomId, table));
    return {
      tables,
      page: Number(container.currentPage ?? container.page ?? payload?.currentPage ?? payload?.page) || 1,
      totalPages: Number(
        container.totalPages
        ?? payload?.totalPages
        ?? payload?.platform?.tableMeta?.totalPages
        ?? payload?.data?.tableMeta?.totalPages
      ) || null,
    };
  }

  function requestScanPage(page) {
    if (typeof window.dispatch !== "function" || scanPage !== 0) return;
    scanPage = page;
    window.dispatch(TABLE_PAGE_REQUEST, { page });
  }

  function scheduleFullScan(delay = 30000) {
    if (scanTimer || scanPage !== 0) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      requestScanPage(1);
    }, delay);
  }

  function detailPayload(payload, requestedTable = null) {
    const candidates = [payload?.detail, payload?.data?.detail, payload?.data, payload];
    const detail = candidates.find((item) => item && (
      item.dayBet != null || item.hourBet != null || item.todayBet != null || item.mgCounts != null
    ));
    if (!detail) return null;
    return {
      roomId: String(detail.roomId ?? requestedTable?.roomId ?? ""),
      number: Number(detail.number ?? detail.roomNumber ?? requestedTable?.number) || undefined,
      status: detail.status ?? requestedTable?.status,
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
        scanTotalPages = initialTables.totalPages || Number(payload?.platform?.tableMeta?.totalPages) || 8;
      }
      scheduleFullScan(30000);
      return;
    }

    if (eventName === TABLE_PAGE_RESPONSE) {
      const data = tablePayload(payload);
      if (!data) return;
      if (scanPage > 0) data.page = scanPage;
      emit({ type: "tables", gameName, ...data });
      if (scanPage > 0 && scanPage < scanTotalPages) {
        const nextPage = scanPage + 1;
        scanPage = 0;
        setTimeout(() => requestScanPage(nextPage), 800);
      } else if (scanPage > 0) {
        scanPage = 0;
        scheduleFullScan(90000);
      }
      return;
    }

    if (eventName === TABLE_DETAIL_REQUEST) {
      const roomId = String(payload?.roomId || "");
      pendingDetailRoom = knownTables.get(roomId) || (roomId ? { roomId } : null);
      return;
    }

    if (eventName === TABLE_DETAIL_RESPONSE) {
      const requestedTable = pendingDetailRoom;
      pendingDetailRoom = null;
      const detail = detailPayload(payload, requestedTable);
      if (detail) emit({ type: "detail", gameName, detail });
      return;
    }

    if (eventName === TABLES_UPDATED_RESPONSE) {
      const updates = Object.entries(payload || {}).map(([roomId, status]) => ({
        roomId: String(roomId),
        status: String(status || ""),
      })).filter((item) => item.roomId && item.status);
      updates.forEach((item) => {
        const table = knownTables.get(item.roomId);
        if (!table) return;
        table.status = item.status;
        table.occupied = item.status !== "Empty";
      });
      if (updates.length) emit({ type: "updates", gameName, updates });
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

  setInterval(installDispatchWrapper, 20);

  console.info("[BLACKDOMAIN Electronic] ATG room observer active");
}());
