(function () {
  "use strict";

  if (window.__blackdomainElectronicBridgeInstalled) return;
  window.__blackdomainElectronicBridgeInstalled = true;

  const INIT_RESPONSE = "SlotFrameworkEvent:INIT_RESPONSE";
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
  const OBSERVED_DISPATCH_EVENTS = new Set([
    INIT_RESPONSE,
    TABLE_PAGE_RESPONSE,
    TABLE_DETAIL_RESPONSE,
    TABLE_DETAIL_REQUEST,
    TABLES_UPDATED_RESPONSE,
    ...SPIN_EVENTS,
  ]);
  let wrappedDispatch = null;
  let gameName = null;
  let currentRoom = {};
  const knownTables = new Map();
  let pendingDetailRoom = null;
  let scanPage = 0;
  let scanTotalPages = 8;
  let scanTimer = null;
  let scanWatchdogTimer = null;
  let scanPageRetries = 0;
  let scanFailureCycles = 0;
  let scanId = "";
  let scanEmptyCandidates = [];
  let detailQueueTimer = null;
  let wrappedSender = null;
  let wrappedSenderOwner = null;
  let originalSender = null;
  const detailFetchedAt = new Map();
  const naturalFeatureSpins = new Map();
  const emittedFeatureSpins = new Set();
  let activePurchasedFeature = null;
  const watchedRoomNumbers = new Set();
  let watchedRoomCursor = 0;
  let watchedRoomTimer = null;
  let watchedRoomDiscoveryRequested = false;
  let forceScanRequested = false;
  let pendingRefreshId = "";
  let activeRefreshId = "";
  let gameInitializedAt = 0;
  const SCAN_PAGE_INTERVAL_MS = 250;
  const SCAN_PAGE_TIMEOUT_MS = 5000;
  const SCAN_STARTUP_GRACE_MS = 5000;
  const SCAN_RESTART_BACKOFF_STEPS_MS = [2000, 5000, 10000];
  const MAX_SCAN_PAGE_RETRIES = 2;
  const WRAPPER_FAST_RETRY_MS = 20;
  const WRAPPER_FAST_RETRY_WINDOW_MS = 30000;
  const WRAPPER_HEALTH_CHECK_MS = 1000;
  const wrapperBootstrapStartedAt = Date.now();

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
      occupied: status !== "Empty",
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
    const reportedPage = Number(
      container.currentPage
      ?? container.page
      ?? payload?.currentPage
      ?? payload?.page
    );
    return {
      tables,
      page: Number.isInteger(reportedPage) && reportedPage > 0 ? reportedPage : null,
      totalPages: Number(
        container.totalPages
        ?? payload?.totalPages
        ?? payload?.platform?.tableMeta?.totalPages
        ?? payload?.data?.tableMeta?.totalPages
      ) || null,
    };
  }

  function clearScanWatchdog() {
    if (!scanWatchdogTimer) return;
    clearTimeout(scanWatchdogTimer);
    scanWatchdogTimer = null;
  }

  function restartFullScan(delay = null) {
    clearScanWatchdog();
    if (activeRefreshId) pendingRefreshId = activeRefreshId;
    activeRefreshId = "";
    scanPage = 0;
    scanPageRetries = 0;
    scanId = "";
    forceScanRequested = false;
    const backoff = delay ?? SCAN_RESTART_BACKOFF_STEPS_MS[
      Math.min(scanFailureCycles, SCAN_RESTART_BACKOFF_STEPS_MS.length - 1)
    ];
    scanFailureCycles += 1;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    scheduleFullScan(backoff);
  }

  function handleScanPageFailure(page) {
    if (scanPage !== page) return;
    clearScanWatchdog();
    scanPage = 0;
    if (scanPageRetries < MAX_SCAN_PAGE_RETRIES) {
      scanPageRetries += 1;
      setTimeout(() => requestScanPage(page), SCAN_PAGE_INTERVAL_MS);
      return;
    }
    restartFullScan();
  }

  function requestScanPage(page) {
    if (typeof window.dispatch !== "function" || scanPage !== 0) return;
    if (page === 1 && !gameInitializedAt) {
      scheduleFullScan(1000);
      return;
    }
    if (page === 1 && document.readyState !== "complete") {
      scheduleFullScan(1000);
      return;
    }
    const startupWaitMs = page === 1
      ? Math.max(0, gameInitializedAt + SCAN_STARTUP_GRACE_MS - Date.now())
      : 0;
    if (startupWaitMs > 0) {
      scheduleFullScan(startupWaitMs);
      return;
    }
    if (page === 1 && !scanId) {
      scanId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      scanEmptyCandidates = [];
      activeRefreshId = pendingRefreshId;
      pendingRefreshId = "";
    }
    scanPage = page;
    clearScanWatchdog();
    scanWatchdogTimer = setTimeout(() => handleScanPageFailure(page), SCAN_PAGE_TIMEOUT_MS);
    try {
      window.dispatch(TABLE_PAGE_REQUEST, { page });
    } catch {
      handleScanPageFailure(page);
    }
  }

  function scheduleFullScan(delay = SCAN_RESTART_BACKOFF_STEPS_MS[0]) {
    if (scanTimer || scanPage !== 0) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      requestScanPage(1);
    }, delay);
  }

  function requestForcedFullScan(event = {}) {
    const requestedId = String(event?.detail?.id || "");
    if (requestedId) pendingRefreshId = requestedId;
    if (detailQueueTimer) {
      clearTimeout(detailQueueTimer);
      detailQueueTimer = null;
    }
    detailFetchedAt.clear();
    scanEmptyCandidates = [];
    if (scanPage !== 0) {
      forceScanRequested = true;
      return;
    }
    forceScanRequested = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    requestScanPage(1);
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
      capturedAt: Date.now(),
    };
  }

  function scheduleCandidateDetails() {
    if (watchedRoomNumbers.size) return;
    if (detailQueueTimer) clearTimeout(detailQueueTimer);
    const now = Date.now();
    const queue = scanEmptyCandidates
      .slice(0, 10)
      .filter((table) => now - (detailFetchedAt.get(table.roomId) || 0) > 5 * 60 * 1000);
    let index = 0;
    const next = () => {
      const table = queue[index++];
      if (!table || typeof window.dispatch !== "function") {
        detailQueueTimer = null;
        return;
      }
      detailFetchedAt.set(table.roomId, Date.now());
      window.dispatch(TABLE_DETAIL_REQUEST, { roomId: table.roomId });
      detailQueueTimer = setTimeout(next, 1500);
    };
    detailQueueTimer = setTimeout(next, 3000);
  }

  function requestNextWatchedRoom() {
    if (!watchedRoomNumbers.size || typeof window.dispatch !== "function" || pendingDetailRoom) return;
    const numbers = [...watchedRoomNumbers];
    const roomNumber = numbers[watchedRoomCursor % numbers.length];
    watchedRoomCursor = (watchedRoomCursor + 1) % numbers.length;
    const table = [...knownTables.values()].find((item) => item.number === roomNumber);
    if (!table) {
      if (!watchedRoomDiscoveryRequested) {
        watchedRoomDiscoveryRequested = true;
        requestForcedFullScan();
      }
      return;
    }
    pendingDetailRoom = table;
    window.dispatch(TABLE_DETAIL_REQUEST, { roomId: table.roomId });
  }

  function getSpinStates(payload) {
    const engine = payload?.engine || payload?.data?.engine;
    const raw = engine?.gameState;
    if (Array.isArray(raw)) return { engine, states: raw.filter(Boolean) };
    if (raw && typeof raw === "object") return { engine, states: [raw] };
    return { engine, states: [] };
  }

  function isFeatureState(state = {}) {
    return Number(state.freeGameCount) > 0
      || Number(state.superMainGameCount) > 0
      || Number(state.startFreeGame) > 0
      || Number(state.numFreeSpins) > 0
      || state.isFreespin === true
      || state.isBonus === true
      || /free|super|feature/i.test(String(state.action || ""));
  }

  function maxNumeric(values = []) {
    return values.reduce((maximum, value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(maximum, numeric) : maximum;
    }, 0);
  }

  function featureWinnings(payload, engine, states) {
    return maxNumeric([
      payload?.totalWinnings,
      payload?.freespinWinnings,
      payload?.currentWinnings,
      payload?.win,
      engine?.totalWinnings,
      engine?.freespinWinnings,
      ...states.flatMap((state) => [
        state?.totalWinnings,
        state?.freespinWinnings,
        state?.currentWinnings,
        state?.win,
        state?.freespinWon,
        state?.jpWon,
      ]),
    ]);
  }

  function aggregateFeatureWinnings(payload, engine, states) {
    return maxNumeric([
      payload?.totalWinnings,
      payload?.freespinWinnings,
      engine?.totalWinnings,
      engine?.freespinWinnings,
      ...states.flatMap((state) => [
        state?.totalWinnings,
        state?.freespinWinnings,
      ]),
    ]);
  }

  function rememberEmittedFeatureSpin(spinId) {
    const key = String(spinId || "");
    if (!key) return;
    emittedFeatureSpins.add(key);
    if (emittedFeatureSpins.size > 250) {
      emittedFeatureSpins.delete(emittedFeatureSpins.values().next().value);
    }
  }

  function spinPayload(payload, trigger = "") {
    const { engine, states } = getSpinStates(payload);
    if (!engine || !states.length) return null;
    const spinId = String(engine.spinId || states.find((state) => state?.spinId)?.spinId || "");
    if (!spinId) return null;
    if (
      trigger === "buyFeature"
      && (!activePurchasedFeature || activePurchasedFeature.spinId !== spinId)
    ) {
      if (emittedFeatureSpins.has(spinId)) return null;
      activePurchasedFeature = {
        spinId,
        maxWinnings: 0,
        sawActiveGames: false,
        notified: false,
      };
    }
    if (!activePurchasedFeature && states.some(isFeatureState)) {
      if (emittedFeatureSpins.has(spinId)) return null;
      naturalFeatureSpins.set(spinId, "natural");
    }
    const isPurchased = Boolean(activePurchasedFeature);
    if (!isPurchased && !naturalFeatureSpins.has(spinId)) return null;
    const state = states.reduce((selected, candidate) => (
      Number(candidate?.currentView) >= Number(selected?.currentView) ? candidate : selected
    ), states[0]);
    const winnings = featureWinnings(payload, engine, states);
    const aggregateWinnings = aggregateFeatureWinnings(payload, engine, states);
    if (activePurchasedFeature) {
      activePurchasedFeature.maxWinnings = Math.max(
        activePurchasedFeature.maxWinnings,
        winnings,
      );
    }
    const remainingFields = states.flatMap((item) => [
      item?.numFreeSpins,
      item?.freeGameCount,
      item?.superMainGameCount,
    ]).filter((value) => value !== undefined && value !== null);
    const hasRemainingCounter = remainingFields.length > 0;
    const remainingGames = maxNumeric(remainingFields);
    if (activePurchasedFeature && remainingGames > 0) {
      activePurchasedFeature.sawActiveGames = true;
    }
    const currentView = Number(state?.currentView);
    const totalViews = Number(state?.totalViews);
    const hasViewProgress = Number.isFinite(currentView)
      && Number.isFinite(totalViews)
      && totalViews > 0;
    const viewComplete = hasViewProgress && currentView >= totalViews - 1;
    const counterComplete = Boolean(
      activePurchasedFeature?.sawActiveGames
      && hasRemainingCounter
      && remainingGames <= 0
    );
    const explicitEndSignal = states.some((item) => (
      item?.complete === true
      || /complete|finish|collect|settle|end/i.test(String(item?.status || item?.action || ""))
    ));
    const resolvedWinnings = activePurchasedFeature?.maxWinnings || winnings;
    const explicitComplete = explicitEndSignal && (
      resolvedWinnings > 0 || activePurchasedFeature?.sawActiveGames
    );
    const positiveWithoutProgress = trigger !== "buyFeature"
      && !hasRemainingCounter
      && !hasViewProgress
      && resolvedWinnings > 0;
    const completionReached = viewComplete
      || counterComplete
      || explicitComplete
      || positiveWithoutProgress;
    const purchasedTotalAvailable = isPurchased && aggregateWinnings > 0;
    if (isPurchased && activePurchasedFeature.notified) {
      rememberEmittedFeatureSpin(spinId);
      if (completionReached) activePurchasedFeature = null;
      return null;
    }
    const shouldEmit = isPurchased
      ? purchasedTotalAvailable
      : completionReached && resolvedWinnings > 0;
    if (!shouldEmit) {
      if (!isPurchased && completionReached) naturalFeatureSpins.delete(spinId);
      return null;
    }
    const featureTrigger = isPurchased ? "purchased" : naturalFeatureSpins.get(spinId);
    const resultSpinId = activePurchasedFeature?.spinId || spinId;
    const reportedWinnings = isPurchased ? aggregateWinnings : resolvedWinnings;
    if (isPurchased) {
      activePurchasedFeature.notified = true;
      if (completionReached) activePurchasedFeature = null;
    } else {
      naturalFeatureSpins.delete(spinId);
    }
    rememberEmittedFeatureSpin(resultSpinId);
    rememberEmittedFeatureSpin(spinId);
    return {
      spinId: resultSpinId,
      roomId: currentRoom.roomId || undefined,
      roomNumber: currentRoom.number || undefined,
      totalWinnings: reportedWinnings,
      totalStake: Number(payload?.totalStake ?? state?.totalStake) || 0,
      currentView: Number.isFinite(currentView) ? currentView : 0,
      totalViews: Number.isFinite(totalViews) ? totalViews : 0,
      action: state?.action,
      featureTrigger,
      capturedAt: Date.now(),
    };
  }

  function emitSpin(payload, trigger = "") {
    const spin = spinPayload(payload, trigger);
    if (spin) emit({ type: "spin", gameName, ...spin });
  }

  function handleDispatch(eventName, payload) {
    gameName ||= detectGameName(payload);
    if (!gameName) return;

    if (eventName === INIT_RESPONSE) {
      if (!gameInitializedAt) gameInitializedAt = Date.now();
      const table = payload?.platform?.table || payload?.platform?.slotTable || payload?.table;
      const normalized = normalizeTable(table);
      if (normalized) currentRoom = normalized;
      const initialTables = tablePayload(payload);
      if (initialTables) {
        emit({ type: "tables", gameName, ...initialTables });
        scanTotalPages = initialTables.totalPages || Number(payload?.platform?.tableMeta?.totalPages) || 8;
      }
      return;
    }

    if (eventName === TABLE_PAGE_RESPONSE) {
      const requestedScanPage = scanPage;
      const data = tablePayload(payload);
      if (!data) {
        if (requestedScanPage > 0) handleScanPageFailure(requestedScanPage);
        return;
      }
      if (requestedScanPage > 0) {
        if (data.page && data.page !== requestedScanPage) return;
        clearScanWatchdog();
        scanPageRetries = 0;
        if (data.totalPages) scanTotalPages = data.totalPages;
        data.page = requestedScanPage;
        data.scanId = scanId;
        data.scanComplete = requestedScanPage >= scanTotalPages;
        if (activeRefreshId) data.refreshId = activeRefreshId;
        scanEmptyCandidates.push(...data.tables.filter((table) => table.status === "Empty"));
      }
      emit({ type: "tables", gameName, ...data });
      if (requestedScanPage > 0 && requestedScanPage < scanTotalPages) {
        const nextPage = requestedScanPage + 1;
        scanPage = 0;
        setTimeout(() => requestScanPage(nextPage), SCAN_PAGE_INTERVAL_MS);
      } else if (requestedScanPage > 0) {
        scanPage = 0;
        scanPageRetries = 0;
        scanFailureCycles = 0;
        scanId = "";
        activeRefreshId = "";
        scheduleCandidateDetails();
        if (forceScanRequested) requestForcedFullScan();
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
      emitSpin(payload, eventName === "SlotFrameworkEvent:BUY_FEATURE_RESPONSE" ? "buyFeature" : "");
    }
  }

  function installDispatchWrapper() {
    if (typeof window.dispatch !== "function" || window.dispatch === wrappedDispatch) return;
    const original = window.dispatch;
    wrappedDispatch = function blackdomainElectronicDispatch(eventName, payload, ...rest) {
      if (!OBSERVED_DISPATCH_EVENTS.has(eventName)) {
        return original.call(this, eventName, payload, ...rest);
      }
      if (eventName === TABLE_DETAIL_REQUEST) {
        try {
          handleDispatch(eventName, payload);
        } catch {
          // Keep the original game event flow untouched.
        }
      }
      const result = original.call(this, eventName, payload, ...rest);
      if (eventName !== TABLE_DETAIL_REQUEST) {
        setTimeout(() => {
          try {
            handleDispatch(eventName, payload);
          } catch {
            // Keep the original game event flow untouched.
          }
        }, 0);
      }
      return result;
    };
    window.dispatch = wrappedDispatch;
  }

  function installSenderWrapper() {
    const sender = window.App?.senderManager?._datas?.get?.("g1005");
    if (!sender || typeof sender.send !== "function" || sender.send === wrappedSender) return;
    const senderOriginal = sender.send;
    originalSender = senderOriginal;
    wrappedSenderOwner = sender;
    wrappedSender = function blackdomainElectronicSend(request, requestPayload, callback, ...rest) {
      const shouldObserve = requestPayload?.action === "buyFeature" || activePurchasedFeature;
      if (!shouldObserve || typeof callback !== "function") {
        return senderOriginal.call(this, request, requestPayload, callback, ...rest);
      }
      const wrappedCallback = function blackdomainElectronicResponse(response, ...callbackArgs) {
        const result = callback.call(this, response, ...callbackArgs);
        setTimeout(() => {
          try {
            const trigger = requestPayload?.action === "buyFeature" ? "buyFeature" : "";
            emitSpin(response, trigger);
          } catch {
            // Keep the original network callback untouched.
          }
        }, 0);
        return result;
      };
      return senderOriginal.call(this, request, requestPayload, wrappedCallback, ...rest);
    };
    sender.send = wrappedSender;
  }

  function uninstallSenderWrapper() {
    if (wrappedSenderOwner?.send === wrappedSender && originalSender) {
      wrappedSenderOwner.send = originalSender;
    }
    wrappedSender = null;
    wrappedSenderOwner = null;
    originalSender = null;
  }

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_WATCH_ROOMS", (event) => {
    const rooms = Array.isArray(event.detail?.rooms) ? event.detail.rooms : [];
    const nextWatchedRoomNumbers = new Set();
    rooms.forEach((room) => {
      if (room?.gameName === gameName && Number.isInteger(Number(room.roomNumber))) {
        nextWatchedRoomNumbers.add(Number(room.roomNumber));
      }
    });
    const watchedRoomsChanged = nextWatchedRoomNumbers.size !== watchedRoomNumbers.size
      || [...nextWatchedRoomNumbers].some((roomNumber) => !watchedRoomNumbers.has(roomNumber));
    if (!watchedRoomsChanged) return;
    watchedRoomDiscoveryRequested = false;
    watchedRoomNumbers.clear();
    nextWatchedRoomNumbers.forEach((roomNumber) => watchedRoomNumbers.add(roomNumber));
    if (detailQueueTimer) {
      clearTimeout(detailQueueTimer);
      detailQueueTimer = null;
    }
    if (!watchedRoomNumbers.size) {
      if (watchedRoomTimer) clearInterval(watchedRoomTimer);
      watchedRoomTimer = null;
      uninstallSenderWrapper();
      return;
    }
    if (!watchedRoomTimer) {
      watchedRoomTimer = setInterval(requestNextWatchedRoom, 2500);
    }
    requestNextWatchedRoom();
  });

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_FORCE_REFRESH", requestForcedFullScan);

  function installSenderAfterUserInteraction() {
    if (gameInitializedAt && watchedRoomNumbers.size) installSenderWrapper();
  }

  window.addEventListener("pointerdown", installSenderAfterUserInteraction, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", installSenderAfterUserInteraction, {
    capture: true,
  });

  function maintainWrappers() {
    installDispatchWrapper();
    const dispatchReady = typeof window.dispatch === "function" && window.dispatch === wrappedDispatch;
    const withinFastRetryWindow = Date.now() - wrapperBootstrapStartedAt < WRAPPER_FAST_RETRY_WINDOW_MS;
    setTimeout(
      maintainWrappers,
      !dispatchReady && withinFastRetryWindow ? WRAPPER_FAST_RETRY_MS : WRAPPER_HEALTH_CHECK_MS,
    );
  }

  maintainWrappers();

  console.info("[BLACKDOMAIN Electronic] ATG room observer active");
}());
