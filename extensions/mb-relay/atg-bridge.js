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
  let pendingDetailRequestedAt = 0;
  const DETAIL_REQUEST_TIMEOUT_MS = 4000;
  let scanPage = 0;
  const SOURCE_PAGE_COUNT = 8;
  let activeSourcePageCount = SOURCE_PAGE_COUNT;
  const SCAN_BATCH_SIZE = 3;
  let scanBatchPages = [];
  let scanBatchIndex = 0;
  let scanPageQueue = [];
  const cachedEmptyPages = new Map();
  let scanTimer = null;
  let scanWatchdogTimer = null;
  let scanPageRetries = 0;
  let scanFailureCycles = 0;
  let scanId = "";
  let wrappedSender = null;
  let wrappedSenderOwner = null;
  let originalSender = null;
  const naturalFeatureSpins = new Map();
  const emittedFeatureSpins = new Set();
  const observedPageResponses = new WeakSet();
  let activePurchasedFeature = null;
  let activeNaturalFeature = null;
  const watchedRoomNumbers = new Set();
  let watchedRoomQueue = [];
  let watchedRoomSignature = "";
  let watchedRoomCursor = 0;
  let watchedRoomTimer = null;
  let watchedRoomDiscoveryRequested = false;
  let forceScanRequested = false;
  let pendingRefreshId = "";
  let activeRefreshId = "";
  let gameInitializedAt = 0;
  // Rendering a page means rebuilding as many as 500 room cards.  Small cloud
  // VMs regularly need more than five seconds for that work, so the previous
  // watchdog restarted a healthy scan between pages 1 and 2 forever.
  const SCAN_PAGE_INTERVAL_MS = 1000;
  const SCAN_PAGE_TIMEOUT_MS = 30000;
  const SCAN_STARTUP_GRACE_MS = 8000;
  const ROTATING_PAGE_REFRESH_MS = 60000;
  const SCAN_RESTART_BACKOFF_STEPS_MS = [3000, 8000, 15000];
  const MAX_SCAN_PAGE_RETRIES = 3;
  const WRAPPER_FAST_RETRY_MS = 20;
  const WRAPPER_FAST_RETRY_WINDOW_MS = 30000;
  const WRAPPER_HEALTH_CHECK_MS = 1000;
  const ATG_INIT_TIMEOUT_MS = 45 * 1000;
  const SESSION_STALE_COOLDOWN_MS = 30 * 1000;
  const wrapperBootstrapStartedAt = Date.now();
  let lastSessionStaleAt = 0;
  let tokenErrorCheckTimer = null;
  const startupGameName = detectGameName();
  const startupRecoveryTimer = startupGameName
    ? setTimeout(() => {
      if (gameInitializedAt) return;
      window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_SESSION_STALE", {
        detail: { gameName: startupGameName, reason: "init-timeout" },
      }));
    }, ATG_INIT_TIMEOUT_MS)
    : null;

  function reportSessionStale(reason) {
    const now = Date.now();
    if (now - lastSessionStaleAt < SESSION_STALE_COOLDOWN_MS) return;
    lastSessionStaleAt = now;
    window.dispatchEvent(new CustomEvent("BLACKDOMAIN_ELECTRONIC_SESSION_STALE", {
      detail: { gameName: gameName || startupGameName, reason },
    }));
  }

  function detectTokenError() {
    tokenErrorCheckTimer = null;
    const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
    if (/找不到\s*Token\s*資料|verify-login-132|token\s*(?:missing|not found|expired)/i.test(text)) {
      reportSessionStale("token-error-dialog");
    }
  }

  function scheduleTokenErrorCheck() {
    if (tokenErrorCheckTimer) return;
    tokenErrorCheckTimer = setTimeout(detectTokenError, 200);
  }

  function installTokenErrorObserver() {
    if (!document.documentElement) {
      document.addEventListener?.("DOMContentLoaded", installTokenErrorObserver, { once: true });
      return;
    }
    new MutationObserver(scheduleTokenErrorCheck).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scheduleTokenErrorCheck();
  }

  installTokenErrorObserver();

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
      todayRtp: table.todayRtp ?? table.todayRate ?? table.todayScoreRate ?? table.hourRtp ?? table.hourRate,
      dayRtp: table.dayRtp ?? table.dayRate ?? table.dayScoreRate ?? table.rtp ?? table.scoreRate,
      mgCounts: Array.isArray(table.mgCounts) ? table.mgCounts.slice(0, 3) : undefined,
    };
  }

  function tablePayload(payload) {
    const candidates = [payload, payload?.data, payload?.platform, payload?.platform?.tableMeta];
    const container = candidates.find((item) => Array.isArray(item?.tables));
    if (!container) return null;
    const rawTables = container.tables;
    const tables = rawTables.map(normalizeTable).filter(Boolean);
    // A genuinely empty page is a valid result and must advance the scan.
    // A non-empty response where every row is malformed remains retryable.
    if (rawTables.length > 0 && !tables.length) return null;
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
    if (!gameInitializedAt) {
      scheduleFullScan(1000);
      return;
    }
    if (document.readyState !== "complete") {
      scheduleFullScan(1000);
      return;
    }
    const startupWaitMs = Math.max(0, gameInitializedAt + SCAN_STARTUP_GRACE_MS - Date.now());
    if (startupWaitMs > 0) {
      scheduleFullScan(startupWaitMs);
      return;
    }
    if (!scanId) {
      scanId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  function sourcePagesInOrder() {
    return Array.from({ length: activeSourcePageCount }, (_unused, index) => index + 1);
  }

  function createScanBatch() {
    // ATG rebuilds the filtered empty-room list while statuses change. Request
    // pages in order so a batch cannot jump across a moving pagination window.
    // Recommendations continue using the previously published pool meanwhile.
    if (!scanPageQueue.length) scanPageQueue = sourcePagesInOrder();
    return scanPageQueue.splice(0, SCAN_BATCH_SIZE);
  }

  function cachedEmptyTables() {
    const merged = new Map();
    cachedEmptyPages.forEach((tables) => {
      tables.forEach((table) => merged.set(table.roomId, table));
    });
    return [...merged.values()];
  }

  function startScanBatch() {
    if (scanPage !== 0) return;
    scanBatchPages = createScanBatch();
    scanBatchIndex = 0;
    requestScanPage(scanBatchPages[0]);
  }

  function scheduleFullScan(delay = SCAN_RESTART_BACKOFF_STEPS_MS[0]) {
    if (scanTimer || scanPage !== 0) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      startScanBatch();
    }, delay);
  }

  function requestForcedFullScan(event = {}) {
    const requestedId = String(event?.detail?.id || "");
    if (requestedId) pendingRefreshId = requestedId;
    if (scanPage !== 0) {
      forceScanRequested = true;
      return;
    }
    forceScanRequested = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    startScanBatch();
  }

  function detailPayload(payload, requestedTable = null) {
    const candidates = [payload?.detail, payload?.data?.detail, payload?.data, payload];
    const detail = candidates.find((item) => item && (
      item.dayBet != null
      || item.hourBet != null
      || item.todayBet != null
      || item.todayRtp != null
      || item.todayRate != null
      || item.dayRtp != null
      || item.dayRate != null
      || item.scoreRate != null
      || item.mgCounts != null
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
      todayRtp: detail.todayRtp ?? detail.todayRate ?? detail.todayScoreRate ?? detail.hourRtp ?? detail.hourRate,
      dayRtp: detail.dayRtp ?? detail.dayRate ?? detail.dayScoreRate ?? detail.rtp ?? detail.scoreRate,
      mgCounts: Array.isArray(detail.mgCounts) ? detail.mgCounts.slice(0, 3) : undefined,
      capturedAt: Date.now(),
    };
  }

  function requestNextWatchedRoom() {
    if (!watchedRoomNumbers.size || typeof window.dispatch !== "function") return;
    if (pendingDetailRoom) {
      if (Date.now() - pendingDetailRequestedAt < DETAIL_REQUEST_TIMEOUT_MS) return;
      pendingDetailRoom = null;
      pendingDetailRequestedAt = 0;
    }
    const numbers = watchedRoomQueue.length ? watchedRoomQueue : [...watchedRoomNumbers];
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
    pendingDetailRequestedAt = Date.now();
    try {
      window.dispatch(TABLE_DETAIL_REQUEST, { roomId: table.roomId });
    } catch {
      pendingDetailRoom = null;
      pendingDetailRequestedAt = 0;
    }
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
      if (!activeNaturalFeature) {
        if (emittedFeatureSpins.has(spinId)) return null;
        activeNaturalFeature = {
          spinId,
          maxWinnings: 0,
          sawActiveGames: false,
          notified: false,
        };
      }
      naturalFeatureSpins.set(spinId, "natural");
    }
    const isPurchased = Boolean(activePurchasedFeature);
    const isNatural = !isPurchased && Boolean(activeNaturalFeature);
    if (!isPurchased && !isNatural && !naturalFeatureSpins.has(spinId)) return null;
    const state = states.reduce((selected, candidate) => (
      Number(candidate?.currentView) >= Number(selected?.currentView) ? candidate : selected
    ), states[0]);
    const winnings = featureWinnings(payload, engine, states);
    const aggregateWinnings = aggregateFeatureWinnings(payload, engine, states);
    const activeFeature = activePurchasedFeature || activeNaturalFeature;
    if (activeFeature) {
      activeFeature.maxWinnings = Math.max(
        activeFeature.maxWinnings,
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
    if (activeFeature && remainingGames > 0) {
      activeFeature.sawActiveGames = true;
    }
    const currentView = Number(state?.currentView);
    const totalViews = Number(state?.totalViews);
    const hasViewProgress = Number.isFinite(currentView)
      && Number.isFinite(totalViews)
      && totalViews > 0;
    const viewComplete = hasViewProgress && currentView >= totalViews - 1;
    const counterComplete = Boolean(
      activeFeature?.sawActiveGames
      && hasRemainingCounter
      && remainingGames <= 0
    );
    const explicitEndSignal = states.some((item) => (
      item?.complete === true
      || /complete|finish|collect|settle|end/i.test(String(item?.status || item?.action || ""))
    ));
    const resolvedWinnings = activeFeature?.maxWinnings || winnings;
    const explicitComplete = explicitEndSignal && (
      resolvedWinnings > 0 || activeFeature?.sawActiveGames
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
    const naturalTotalAvailable = isNatural && aggregateWinnings > 0;
    if (activeFeature?.notified) {
      rememberEmittedFeatureSpin(spinId);
      if (completionReached) {
        if (isPurchased) activePurchasedFeature = null;
        else {
          activeNaturalFeature = null;
          naturalFeatureSpins.clear();
        }
      }
      return null;
    }
    const shouldEmit = isPurchased
      ? purchasedTotalAvailable
      : naturalTotalAvailable || (completionReached && resolvedWinnings > 0);
    if (!shouldEmit) {
      if (!isPurchased && completionReached) naturalFeatureSpins.delete(spinId);
      return null;
    }
    const featureTrigger = isPurchased ? "purchased" : "natural";
    const resultSpinId = activeFeature?.spinId || spinId;
    const reportedWinnings = aggregateWinnings > 0 ? aggregateWinnings : resolvedWinnings;
    if (isPurchased) {
      activePurchasedFeature.notified = true;
      if (completionReached) activePurchasedFeature = null;
    } else if (activeNaturalFeature) {
      activeNaturalFeature.notified = true;
      if (completionReached) {
        activeNaturalFeature = null;
        naturalFeatureSpins.clear();
      }
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
      if (startupRecoveryTimer) clearTimeout(startupRecoveryTimer);
      if (!gameInitializedAt) gameInitializedAt = Date.now();
      const table = payload?.platform?.table || payload?.platform?.slotTable || payload?.table;
      const normalized = normalizeTable(table);
      if (normalized) currentRoom = normalized;
      const initialTables = tablePayload(payload);
      if (initialTables) {
        emit({ type: "tables", gameName, ...initialTables });
      }
      // Scan three distinct random pages per batch. This gives the RTP ranker
      // a broader pool without making the user wait for all eight pages.
      scheduleFullScan(SCAN_STARTUP_GRACE_MS);
      return;
    }

    if (eventName === TABLE_PAGE_RESPONSE) {
      const requestedScanPage = scanPage;
      if (payload && typeof payload === "object") {
        // ATG can reuse the same response object while paging. During an
        // active scan, the requested page is authoritative; only suppress a
        // duplicate after that request has already been completed.
        if (observedPageResponses.has(payload) && requestedScanPage === 0) return;
        observedPageResponses.add(payload);
      }
      const data = tablePayload(payload);
      if (!data) {
        if (requestedScanPage > 0) handleScanPageFailure(requestedScanPage);
        return;
      }
      if (requestedScanPage > 0) {
        const reportedSourcePage = Number(data.page);
        const reportedSourcePageCount = Number(data.totalPages);
        if (
          Number.isInteger(reportedSourcePageCount)
          && reportedSourcePageCount > 0
          && reportedSourcePageCount <= SOURCE_PAGE_COUNT
        ) {
          activeSourcePageCount = reportedSourcePageCount;
          scanPageQueue = scanPageQueue.filter((page) => page <= activeSourcePageCount);
          scanBatchPages = [
            ...scanBatchPages.slice(0, scanBatchIndex + 1),
            ...scanBatchPages.slice(scanBatchIndex + 1)
              .filter((page) => page <= activeSourcePageCount),
          ];
          for (const page of cachedEmptyPages.keys()) {
            if (page > activeSourcePageCount) cachedEmptyPages.delete(page);
          }
        }
        const effectiveSourcePage = requestedScanPage > activeSourcePageCount
          && Number.isInteger(reportedSourcePage)
          && reportedSourcePage > 0
          && reportedSourcePage <= activeSourcePageCount
          ? reportedSourcePage
          : requestedScanPage;
        // In the "empty rooms" view ATG rebuilds and re-paginates the room
        // collection while statuses change.  The response can therefore carry
        // a stale visible-page number even though it was produced by our most
        // recent request.  scanPage is only non-zero during that request's
        // watchdog window, so use it as the authoritative page identity.
        clearScanWatchdog();
        scanPageRetries = 0;
        data.sourcePage = effectiveSourcePage;
        data.page = scanBatchIndex + 1;
        data.totalPages = scanBatchPages.length;
        data.scanId = scanId;
        data.scanComplete = data.page >= scanBatchPages.length;
        data.emptyOnly = true;
        if (activeRefreshId) data.refreshId = activeRefreshId;
        // The recommendation service only needs available rooms.  Keep the
        // complete table map in this page for watched-room lookups, but avoid
        // sending full and locked rooms to the cloud on every eight-page scan.
        data.tables = data.tables.filter((table) => table.status === "Empty");
        cachedEmptyPages.set(effectiveSourcePage, data.tables);
        data.sourcePagesCovered = cachedEmptyPages.size;
        data.sourcePageCount = activeSourcePageCount;
        if (data.scanComplete) data.tables = cachedEmptyTables();
      }
      emit({ type: "tables", gameName, ...data });
      if (requestedScanPage > 0) {
        scanPage = 0;
        scanPageRetries = 0;
        if (scanBatchIndex + 1 < scanBatchPages.length) {
          scanBatchIndex += 1;
          setTimeout(() => requestScanPage(scanBatchPages[scanBatchIndex]), SCAN_PAGE_INTERVAL_MS);
          return;
        }
        scanFailureCycles = 0;
        scanId = "";
        scanBatchPages = [];
        scanBatchIndex = 0;
        activeRefreshId = "";
        if (forceScanRequested) requestForcedFullScan();
        else scheduleFullScan(
          cachedEmptyPages.size < activeSourcePageCount
            ? SCAN_PAGE_INTERVAL_MS
            : ROTATING_PAGE_REFRESH_MS,
        );
      }
      return;
    }

    if (eventName === TABLE_DETAIL_REQUEST) {
      const roomId = String(payload?.roomId || "");
      pendingDetailRoom = knownTables.get(roomId) || (roomId ? { roomId } : null);
      pendingDetailRequestedAt = Date.now();
      return;
    }

    if (eventName === TABLE_DETAIL_RESPONSE) {
      const requestedTable = pendingDetailRoom;
      pendingDetailRoom = null;
      pendingDetailRequestedAt = 0;
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
      const isTablePageRequest = request === "getSlotTables"
        || requestPayload?.request === "getSlotTables";
      const shouldObserveSpin = requestPayload?.action === "buyFeature"
        || activePurchasedFeature
        || activeNaturalFeature;
      if ((!isTablePageRequest && !shouldObserveSpin) || typeof callback !== "function") {
        return senderOriginal.call(this, request, requestPayload, callback, ...rest);
      }
      const wrappedCallback = function blackdomainElectronicResponse(response, ...callbackArgs) {
        const result = callback.call(this, response, ...callbackArgs);
        setTimeout(() => {
          try {
            if (isTablePageRequest) {
              handleDispatch(TABLE_PAGE_RESPONSE, response);
            } else {
              const trigger = requestPayload?.action === "buyFeature" ? "buyFeature" : "";
              emitSpin(response, trigger);
            }
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
    const featureRoomNumbers = [];
    const rtpRoomNumbers = [];
    rooms.forEach((room) => {
      if (room?.gameName === gameName && Number.isInteger(Number(room.roomNumber))) {
        const roomNumber = Number(room.roomNumber);
        nextWatchedRoomNumbers.add(roomNumber);
        if (room.priority === "feature") featureRoomNumbers.push(roomNumber);
        else rtpRoomNumbers.push(roomNumber);
      }
    });
    const nextSignature = JSON.stringify({ featureRoomNumbers, rtpRoomNumbers });
    const watchedRoomsChanged = nextSignature !== watchedRoomSignature;
    if (!watchedRoomsChanged) return;
    watchedRoomSignature = nextSignature;
    watchedRoomDiscoveryRequested = false;
    watchedRoomNumbers.clear();
    nextWatchedRoomNumbers.forEach((roomNumber) => watchedRoomNumbers.add(roomNumber));
    watchedRoomQueue = [];
    if (featureRoomNumbers.length) {
      const queueLength = Math.max(featureRoomNumbers.length, rtpRoomNumbers.length);
      for (let index = 0; index < queueLength; index += 1) {
        watchedRoomQueue.push(featureRoomNumbers[index % featureRoomNumbers.length]);
        if (rtpRoomNumbers[index] != null) watchedRoomQueue.push(rtpRoomNumbers[index]);
      }
    } else {
      watchedRoomQueue = [...rtpRoomNumbers];
    }
    watchedRoomCursor = 0;
    if (!watchedRoomNumbers.size) {
      pendingDetailRoom = null;
      pendingDetailRequestedAt = 0;
      if (watchedRoomTimer) clearInterval(watchedRoomTimer);
      watchedRoomTimer = null;
      return;
    }
    if (!watchedRoomTimer) {
      watchedRoomTimer = setInterval(requestNextWatchedRoom, 1500);
    }
    requestNextWatchedRoom();
  });

  window.addEventListener("BLACKDOMAIN_ELECTRONIC_FORCE_REFRESH", requestForcedFullScan);

  function installSenderAfterUserInteraction() {
    if (gameInitializedAt) installSenderWrapper();
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
    installSenderWrapper();
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
