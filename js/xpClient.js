(function () {
  const CALC_URL = "/.netlify/functions/calculate-xp";
  const START_SESSION_URL = "/.netlify/functions/start-session";
  const USER_KEY = "kcswh:userId";
  const SESSION_KEY = "kcswh:sessionId";
  const SERVER_SESSION_KEY = "kcswh:serverSessionId";
  const SERVER_SESSION_TOKEN_KEY = "kcswh:serverSessionToken";
  const SERVER_SESSION_EXPIRES_KEY = "kcswh:serverSessionExpires";
  const DEFAULT_DELTA_CAP = 300;
  const AUTH_CACHE_MS = 60000;
  const LEGACY_XP_CACHE_KEY = "kcswh:xp:last";
  const LEGACY_XP_RUNTIME_KEY = "kcswh:xp:regen";
  const XP_MIGRATION_NOTICE_PREFIX = "kcswh:xp:server-migration-notice:v1:";
  const XP_MIGRATION_NOTICE_ID = "xpServerMigrationNotice";

  // Session states: "none" | "pending" | "ready"
  const SESSION_NONE = "none";
  const SESSION_PENDING = "pending";
  const SESSION_READY = "ready";

  const state = {
    fallbackIds: null,
    statusBootstrapped: false,
    statusPromise: null,
    backoffUntil: 0,
    serverSessionPromise: null,
    serverSessionToken: null,
    sessionStatus: SESSION_NONE,
    authToken: null,
    authCheckedAt: 0,
    authPromise: null,
    authChangeBound: false,
    initialStatusPending: false,
    migrationNotice: null,
    migrationNoticeText: null,
    migrationNoticeClose: null,
    migrationNoticeLangBound: false,
    awardSessionId: null,
  };

  let serverCalcInitRequested = false;

  function isDiagEnabled() {
    if (typeof window === "undefined" || !window) return false;
    if (window.XP_DIAG) return true;
    try {
      if (typeof location !== "undefined" && location && typeof location.search === "string") {
        return /\bxpdiag=1\b/.test(location.search);
      }
    } catch (_) {}
    return false;
  }

  function hostShouldUseServerCalc(win) {
    const host = win && win.location && win.location.hostname;
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host === "play.kcswh.pl" || host === "landing.kcswh.pl") return true;
    if (typeof host === "string" && host.endsWith(".netlify.app")) return true;
    return false;
  }

  function ensureServerCalcInit() {
    if (typeof window === "undefined") return;

    if (!serverCalcInitRequested && typeof window.XP_SERVER_CALC === "undefined") {
      window.XP_SERVER_CALC = hostShouldUseServerCalc(window);
    }

    if (window.XpServerCalc && typeof window.XpServerCalc.initServerCalc === "function") {
      try {
        window.XpServerCalc.initServerCalc(window, typeof document !== "undefined" ? document : undefined, {});
      } catch (_) {}
      return;
    }

    if (serverCalcInitRequested) return;
    serverCalcInitRequested = true;

    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") {
      serverCalcInitRequested = false;
      return;
    }

    const script = document.createElement("script");
    script.src = "/js/xp/server-calc.js";
    script.async = true;
    script.onload = function () {
      serverCalcInitRequested = false;
      if (window.XpServerCalc && typeof window.XpServerCalc.initServerCalc === "function") {
        try {
          window.XpServerCalc.initServerCalc(window, document, {});
        } catch (_) {}
      }
    };
    script.onerror = function () {
      serverCalcInitRequested = false;
    };

    (document.head || document.body || document.documentElement).appendChild(script);
  }

  ensureServerCalcInit();

  function klog(kind, data) {
    if (typeof window === "undefined") return;
    try {
      if (window.KLog && typeof window.KLog.log === "function") {
        window.KLog.log(kind, data || {});
        return;
      }
    } catch (_) {}
    try {
      if (isDiagEnabled() && typeof console !== "undefined" && console && typeof console.log === "function") {
        console.log(`[klog] ${kind}`, data || {});
      }
    } catch (_) {}
  }

  function getSupabaseClient() {
    if (typeof window === "undefined") return null;
    const existing = window.supabaseClient;
    if (existing && existing.auth) return existing;
    return null;
  }

  function getAuthBridge() {
    if (typeof window === "undefined") return null;

    if (window.SupabaseAuthBridge && typeof window.SupabaseAuthBridge.getAccessToken === "function") {
      return window.SupabaseAuthBridge;
    }

    try {
      if (window.parent
        && window.parent !== window
        && window.parent.SupabaseAuthBridge
        && typeof window.parent.SupabaseAuthBridge.getAccessToken === "function") {
        return window.parent.SupabaseAuthBridge;
      }
    } catch (_) {}

    try {
      if (window.opener
        && window.opener.SupabaseAuthBridge
        && typeof window.opener.SupabaseAuthBridge.getAccessToken === "function") {
        return window.opener.SupabaseAuthBridge;
      }
    } catch (_) {}

    return null;
  }

  async function fetchAuthToken(force) {
    const now = Date.now();
    if (!force && state.authToken && (now - state.authCheckedAt) < AUTH_CACHE_MS) {
      return state.authToken;
    }
    if (!force && state.authPromise) {
      return state.authPromise;
    }

    state.authPromise = (async () => {
      try {
        let token = null;

        const bridge = getAuthBridge();
        const getter = bridge && typeof bridge.getAccessToken === "function"
          ? bridge.getAccessToken
          : null;
        if (getter) {
          token = await getter();
          if (isDiagEnabled() && window && window.console && typeof console.debug === "function") {
            console.debug("[XPClient] auth_bridge_result", { hasToken: !!token });
          }
        }

        if (!token) {
          const client = getSupabaseClient();
          if (client && client.auth && typeof client.auth.getSession === "function") {
            const res = await client.auth.getSession();
            const session = res && res.data ? res.data.session : null;
            token = session && session.access_token ? session.access_token : null;
          }
          if (isDiagEnabled() && window && window.console && typeof console.debug === "function") {
            console.debug("[XPClient] auth_client_result", { hasToken: !!token });
          }
        }

        state.authToken = token || null;
        state.authCheckedAt = Date.now();
        return state.authToken;
      } catch (err) {
        if (isDiagEnabled() && window && window.console && typeof console.warn === "function") {
          try {
            const message = err && err.message ? String(err.message) : "error";
            console.warn("[XPClient] auth_token_fetch_error", { message });
          } catch (_) {
            console.warn("[XPClient] auth_token_fetch_error");
          }
        }
        state.authToken = null;
        state.authCheckedAt = Date.now();
        return null;
      } finally {
        state.authPromise = null;
      }
    })();

    return state.authPromise;
  }

  function isAuthenticated() {
    return !!state.authToken;
  }

  async function isUserLoggedIn() {
    try {
      const bridge = getAuthBridge();
      if (bridge && typeof bridge.getCurrentUserId === "function") {
        const userId = await bridge.getCurrentUserId();
        if (typeof userId === "string" && userId.trim()) return true;
      }
      if (bridge && typeof bridge.getAccessToken === "function") {
        const token = await bridge.getAccessToken();
        if (token) return true;
      }
    } catch (_) {}

    const client = getSupabaseClient();
    if (client && client.auth && typeof client.auth.getSession === "function") {
      try {
        const res = await client.auth.getSession();
        const session = res && res.data ? res.data.session : null;
        if (session && session.user) return true;
      } catch (_) {}
    }
    return false;
  }

  async function ensureAuthTokenWithRetry() {
    let token = await fetchAuthToken(false);
    let attempts = 0;
    while (!token && attempts < 2) {
      token = await fetchAuthToken(true);
      attempts += 1;
    }
    if (!token) {
      try {
        const loggedIn = await isUserLoggedIn();
        if (loggedIn) {
          klog("xp_missing_auth_token", {});
        }
      } catch (_) {}
    }
    return token;
  }

  async function buildAuthHeaders(baseHeaders) {
    const headers = Object.assign({}, baseHeaders || {});
    try {
      const token = await ensureAuthTokenWithRetry();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch (_) {}
    return headers;
  }

  function randomId() {
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      // Fallback: use crypto.getRandomValues for older browsers without randomUUID
      if (typeof crypto.getRandomValues === "function") {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return Array.from(arr, function(b) { return b.toString(16).padStart(2, "0"); }).join("");
      }
    }
    // Last resort fallback for environments without crypto (very rare)
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function ensureIds() {
    try {
      const ls = window.localStorage;
      let userId = ls.getItem(USER_KEY);
      if (!userId) {
        userId = randomId();
        ls.setItem(USER_KEY, userId);
      }
      if (!state.awardSessionId) state.awardSessionId = randomId();
      return { userId, sessionId: state.awardSessionId };
    } catch (_) {
      if (!state.fallbackIds) {
        state.fallbackIds = {
          userId: `anon-${randomId()}`,
          sessionId: `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        };
      }
      return state.fallbackIds;
    }
  }

  function rotateAwardSession() {
    state.awardSessionId = randomId();
  }

  // Server-side session management
  function isSessionExpired() {
    try {
      const ls = window.localStorage;
      const expires = Number(ls.getItem(SERVER_SESSION_EXPIRES_KEY) || "0");
      // Expired if we have an expiry time and it's in the past (with 60s buffer)
      return expires > 0 && expires <= Date.now() + 60000;
    } catch (_) {
      return false;
    }
  }

  function loadServerSession() {
    try {
      const ls = window.localStorage;
      const token = ls.getItem(SERVER_SESSION_TOKEN_KEY);
      const expires = Number(ls.getItem(SERVER_SESSION_EXPIRES_KEY) || "0");

      // Check if session is still valid (with 60 second buffer)
      if (token && expires > Date.now() + 60000) {
        state.serverSessionToken = token;
        state.sessionStatus = SESSION_READY;
        return token;
      }
      // Session expired or missing
      return null;
    } catch (_) {
      return state.serverSessionToken;
    }
  }

  function saveServerSession(sessionId, sessionToken, expiresIn) {
    try {
      const ls = window.localStorage;
      const expiresAt = Date.now() + (expiresIn * 1000);
      ls.setItem(SERVER_SESSION_KEY, sessionId);
      ls.setItem(SERVER_SESSION_TOKEN_KEY, sessionToken);
      ls.setItem(SERVER_SESSION_EXPIRES_KEY, String(expiresAt));
      state.serverSessionToken = sessionToken;
      state.sessionStatus = SESSION_READY;
    } catch (_) {
      // Fallback to in-memory only
      state.serverSessionToken = sessionToken;
      state.sessionStatus = SESSION_READY;
    }
  }

  function clearServerSession() {
    try {
      const ls = window.localStorage;
      ls.removeItem(SERVER_SESSION_KEY);
      ls.removeItem(SERVER_SESSION_TOKEN_KEY);
      ls.removeItem(SERVER_SESSION_EXPIRES_KEY);
    } catch (_) {}
    state.serverSessionToken = null;
    state.serverSessionPromise = null;
    state.sessionStatus = SESSION_NONE;
  }

  function clearIdentityBoundStorage() {
    try {
      const ls = window.localStorage;
      ls.removeItem(LEGACY_XP_CACHE_KEY);
      ls.removeItem(LEGACY_XP_RUNTIME_KEY);
    } catch (_) {}
  }

  function clearIdentityBoundXpCache(options) {
    if (!options || options.preserveLegacy !== true) {
      clearIdentityBoundStorage();
    }
    try {
      if (window.XP && typeof window.XP.resetIdentityCache === "function") {
        window.XP.resetIdentityCache({ preserveBadge: options?.preserveBadge === true });
      }
    } catch (_) {}
  }

  function readLegacyXp() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(LEGACY_XP_CACHE_KEY);
      if (!raw) return { total: 0, raw: null };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { total: 0, raw };
      const values = [parsed.totalLifetime, parsed.serverTotalXp, parsed.badgeShownXp]
        .filter((value) => Number.isSafeInteger(value) && value >= 0);
      return { total: values.length ? Math.max(...values) : 0, raw };
    } catch (_) {
      return { total: 0, raw };
    }
  }

  function getLocalizedText(key, fallback) {
    try {
      if (window.I18N && typeof window.I18N.format === "function") {
        const value = window.I18N.format(key);
        if (value) return value;
      }
      if (window.I18N && typeof window.I18N.t === "function") {
        const value = window.I18N.t(key);
        if (value) return value;
      }
    } catch (_) {}
    return fallback;
  }

  function updateMigrationNoticeText() {
    if (!state.migrationNoticeText) return;
    state.migrationNoticeText.textContent = getLocalizedText(
      "xpServerMigrationNotice",
      "Your account XP is now synchronized with the server. Some XP previously shown only on this device was not saved to your account and could not be transferred.",
    );
    if (state.migrationNoticeClose) {
      state.migrationNoticeClose.setAttribute("aria-label", getLocalizedText(
        "xpServerMigrationDismiss",
        "Dismiss XP synchronization notice",
      ));
    }
  }

  function ensureMigrationNotice() {
    if (typeof document === "undefined" || !document || !document.body) return null;
    if (state.migrationNotice && document.body.contains(state.migrationNotice)) return state.migrationNotice;

    const notice = document.createElement("div");
    notice.id = XP_MIGRATION_NOTICE_ID;
    notice.className = "xp-server-migration-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");

    const text = document.createElement("p");
    text.className = "xp-server-migration-notice__text";
    notice.appendChild(text);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "xp-server-migration-notice__close";
    close.textContent = "×";
    close.addEventListener("click", () => {
      notice.hidden = true;
      notice.remove();
      state.migrationNotice = null;
      state.migrationNoticeText = null;
      state.migrationNoticeClose = null;
    });
    notice.appendChild(close);
    document.body.appendChild(notice);

    state.migrationNotice = notice;
    state.migrationNoticeText = text;
    state.migrationNoticeClose = close;
    updateMigrationNoticeText();
    if (!state.migrationNoticeLangBound) {
      document.addEventListener("langchange", updateMigrationNoticeText);
      state.migrationNoticeLangBound = true;
    }
    return notice;
  }

  async function getAuthenticatedUserId() {
    try {
      const bridge = getAuthBridge();
      if (bridge && typeof bridge.getCurrentUserId === "function") {
        const userId = await bridge.getCurrentUserId();
        if (typeof userId === "string" && userId.trim()) return userId.trim();
      }
    } catch (_) {}
    try {
      if (window.SupabaseAuth && typeof window.SupabaseAuth.getCurrentUser === "function") {
        const user = await window.SupabaseAuth.getCurrentUser();
        if (user && typeof user.id === "string" && user.id.trim()) return user.id.trim();
      }
    } catch (_) {}
    return null;
  }

  function migrationMarkerKey(identity) {
    return `${XP_MIGRATION_NOTICE_PREFIX}${identity}`;
  }

  function showMigrationNoticeIfNeeded(legacyLocalXp, serverTotalXp, identity) {
    if (!identity || legacyLocalXp <= serverTotalXp) return;
    let shown = false;
    try { shown = window.localStorage.getItem(migrationMarkerKey(identity)) === "1"; } catch (_) {}
    if (shown) return;
    const notice = ensureMigrationNotice();
    if (!notice) return;
    notice.hidden = false;
    try { window.localStorage.setItem(migrationMarkerKey(identity), "1"); } catch (_) {}
  }

  function schedule(callback, delay) {
    const timer = typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : (typeof setTimeout === "function" ? setTimeout : null);
    if (timer) timer(callback, delay);
  }

  function handleAuthChange(event) {
    const eventName = typeof event === "string" ? event : "unknown";
    const isGameHost = window.XP_IS_GAME_HOST === true
      || (typeof document !== "undefined" && !!(document && document.body && document.body.hasAttribute("data-game-host")));
    const migrationLegacy = !isGameHost && (eventName === "SIGNED_IN" || eventName === "INITIAL_SESSION")
      ? readLegacyXp()
      : null;
    state.authToken = null;
    state.authCheckedAt = 0;
    state.authPromise = null;
    state.statusBootstrapped = false;
    state.statusPromise = null;
    state.awardSessionId = randomId();
    clearServerSession();
    clearIdentityBoundXpCache({
      preserveLegacy: !!migrationLegacy,
      preserveBadge: !!migrationLegacy,
    });
    klog("xp_auth_changed", { event: eventName });
    schedule(() => migrationLegacy
      ? refreshInitialStatus(migrationLegacy)
      : refreshBadgeFromServer(), 0);
  }

  function bindAuthChanges(attempt) {
    if (state.authChangeBound) return;
    try {
      if (window.SupabaseAuth && typeof window.SupabaseAuth.onAuthChange === "function") {
        window.SupabaseAuth.onAuthChange(handleAuthChange);
        state.authChangeBound = true;
        return;
      }
    } catch (_) {}
    if ((attempt || 0) < 10) {
      schedule(() => bindAuthChanges((attempt || 0) + 1), 50);
    }
  }

  function scheduleInitialStatusRefresh() {
    if (typeof document === "undefined" || !document || typeof document.getElementById !== "function") return;
    if (!document.getElementById("xpBadge")) return;
    if (window.XP_IS_GAME_HOST === true || (document.body && document.body.hasAttribute("data-game-host"))) return;
    schedule(() => refreshInitialStatus(), 0);
  }

  async function refreshInitialStatus(legacyOverride, attempt) {
    state.initialStatusPending = true;
    const legacy = legacyOverride && typeof legacyOverride === "object"
      ? legacyOverride
      : readLegacyXp();
    const retryAttempt = Number.isFinite(attempt) ? attempt : 0;
    let authToken = null;
    try { authToken = await ensureAuthTokenWithRetry(); } catch (_) {}
    if (!authToken) {
      let loggedIn = false;
      try { loggedIn = await isUserLoggedIn(); } catch (_) {}
      if (loggedIn) {
        if (retryAttempt < 4) {
          schedule(() => refreshInitialStatus(legacy, retryAttempt + 1), 500);
        } else {
          state.initialStatusPending = false;
        }
        return;
      }
      state.initialStatusPending = false;
      await refreshBadgeFromServer();
      return;
    }

    const identity = (await getAuthenticatedUserId()) || ensureIds().sessionId;
    const payload = await refreshBadgeFromServer({ allowServerRegression: true });
    const serverTotal = Number(payload?.totalLifetime);
    if (payload?.ok !== true || payload?.status !== "statusOnly"
      || !Number.isSafeInteger(serverTotal) || serverTotal < 0) {
      state.initialStatusPending = false;
      return;
    }
    if (!window.XP || typeof window.XP.refreshFromServerStatus !== "function") {
      if (retryAttempt < 4) {
        schedule(() => refreshInitialStatus(legacy, retryAttempt + 1), 250);
      } else {
        state.initialStatusPending = false;
      }
      return;
    }
    clearIdentityBoundStorage();
    showMigrationNoticeIfNeeded(legacy.total, serverTotal, identity);
    state.initialStatusPending = false;
  }

  async function startServerSession(force = false) {
    // Check if we already have a valid session
    if (!force) {
      const existing = loadServerSession();
      if (existing) {
        return existing;
      }
    }

    // Avoid concurrent session starts
    if (state.serverSessionPromise) {
      return state.serverSessionPromise;
    }

    const { userId } = ensureIds();
    state.sessionStatus = SESSION_PENDING;

    state.serverSessionPromise = (async () => {
      try {
        const headers = await buildAuthHeaders({ "content-type": "application/json" });
        const res = await fetch(START_SESSION_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ userId }),
          cache: "no-store",
          credentials: "omit",
        });

        if (!res.ok) {
          if (isDiagEnabled() && window && window.console && typeof console.error === "function") {
            console.error("[XPClient] Failed to start session", { status: res.status });
          }
          throw new Error(`Session start failed (${res.status})`);
        }

        const data = await res.json();
        if (data.ok && data.sessionToken) {
          saveServerSession(data.sessionId, data.sessionToken, data.expiresIn || 604800);
          return data.sessionToken;
        }
        throw new Error("Invalid session response");
      } catch (err) {
        state.sessionStatus = SESSION_NONE; // Back to none, allows retry
        state.serverSessionPromise = null;
        throw err;
      } finally {
        state.serverSessionPromise = null;
      }
    })();

    return state.serverSessionPromise;
  }

  /**
   * Ensures a server session is available.
   * Returns { token, error } - token is null if session failed.
   * Handles expiry by clearing and re-fetching.
   */
  async function ensureServerSession() {
    // Check for expired session - clear and allow re-fetch
    if (isSessionExpired()) {
      clearServerSession();
    }

    // Already ready? Return immediately
    if (state.sessionStatus === SESSION_READY && state.serverSessionToken) {
      return { token: state.serverSessionToken, error: null };
    }

    // Check localStorage (might have been set by another tab)
    const existing = loadServerSession();
    if (existing) {
      return { token: existing, error: null };
    }

    // Already pending? Wait for existing promise
    if (state.sessionStatus === SESSION_PENDING && state.serverSessionPromise) {
      try {
        const token = await state.serverSessionPromise;
        return { token, error: null };
      } catch (err) {
        return { token: null, error: err.message };
      }
    }

    // Start new session
    try {
      const token = await startServerSession();
      return { token, error: null };
    } catch (err) {
      return { token: null, error: err.message };
    }
  }

  /**
   * Get current session status without triggering fetch.
   * Returns { status, token }
   */
  function getSessionStatus() {
    // Check expiry first
    if (isSessionExpired()) {
      return { status: SESSION_NONE, token: null };
    }
    const token = loadServerSession();
    return { status: state.sessionStatus, token };
  }

  function isInitialStatusPending() {
    return state.initialStatusPending === true;
  }

  function currentClientCap() {
    const globalCap = Number(window.XP_DELTA_CAP_CLIENT);
    if (Number.isFinite(globalCap) && globalCap >= 0) return globalCap;
    return DEFAULT_DELTA_CAP;
  }

  function setClientCap(value) {
    if (!Number.isFinite(value) || value <= 0) return;
    window.XP_DELTA_CAP_CLIENT = value;
  }

  function ensureStatusBootstrap(force) {
    if (!force && state.statusBootstrapped) return;
    if (force) state.statusPromise = null;
    state.statusBootstrapped = true;
    if (!state.statusPromise) {
      state.statusPromise = fetchStatus().then(payload => {
        if (payload && typeof payload === "object") {
          if (Number.isFinite(payload.capDelta)) setClientCap(Number(payload.capDelta));
          else if (Number.isFinite(payload.cap)) setClientCap(Number(payload.cap));
        }
      }).catch(() => {}).finally(() => {
        state.statusPromise = null;
      });
    }
  }

  async function maybeBackoff() {
    const waitMs = state.backoffUntil - Date.now();
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  function updateCapFromPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    if (Number.isFinite(payload.capDelta)) setClientCap(Number(payload.capDelta));
    else if (Number.isFinite(payload.cap)) setClientCap(Number(payload.cap));
  }

  async function postWindow(payload, options) {
    return postWindowServerCalc(payload, options);
  }

  async function fetchStatus() {
    const { userId, sessionId } = ensureIds();
    const body = { anonId: userId, sessionId, operation: "status" };
    const authToken = await ensureAuthTokenWithRetry();
    if (!authToken && await isUserLoggedIn()) {
      throw new Error("XP status requires an authenticated token");
    }
    const headers = await buildAuthHeaders({ "content-type": "application/json" });
    const res = await fetch(CALC_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`XP status failed (${res.status}) ${text}`.trim());
    }
    const payload = await res.json();
    updateCapFromPayload(payload);
    return payload;
  }

  async function refreshBadgeFromServer(options) {
    try {
      const payload = await fetchStatus();
      const allowServerRegression = options?.allowServerRegression === true
        || state.initialStatusPending === true;
      if (typeof window !== "undefined" && window.XP && typeof window.XP.refreshFromServerStatus === "function") {
        try {
          window.XP.refreshFromServerStatus(payload, {
            source: "status",
            allowServerRegression,
          });
        } catch (_) {}
      }
      return payload;
    } catch (err) {
      klog("xp_refresh_error", { message: err && err.message ? String(err.message) : "error" });
      return null;
    }
  }

  /**
   * Check if server-side XP calculation is enabled
   */
  function isServerCalcEnabled() {
    return true;
  }

  /**
   * Post window to server-side calculation endpoint
   * Server calculates XP based on activity instead of trusting client delta
   */
  async function postWindowServerCalc(payload, options) {
    const opts = options || {};
    const source = (payload && typeof payload === "object") ? payload : {};
    ensureStatusBootstrap(false);
    await maybeBackoff();

    const { userId, sessionId } = ensureIds();

    // Build payload for server-side calculation
    // Note: We send raw activity data, NOT calculated delta
    const body = {
      userId,
      sessionId,
      gameId: source.gameId || "default",
      windowStart: source.windowStart || 0,
      windowEnd: source.windowEnd || Date.now(),
      inputEvents: Math.max(0, Math.floor(Number(source.inputEvents) || 0)),
      visibilitySeconds: Math.max(0, Number(source.visibilitySeconds) || 0),
      scoreDelta: Math.max(0, Math.floor(Number(source.scoreDelta) || 0)),
      gameplayActions: Math.max(0, Math.floor(Number(source.gameplayActions) || 0)),
    };

    // Add game events if present
    if (Array.isArray(source.gameEvents) && source.gameEvents.length > 0) {
      body.gameEvents = source.gameEvents.slice(0, 50);
    }

    // Add boost if present
    if (source.boostMultiplier && source.boostMultiplier > 1) {
      body.boostMultiplier = source.boostMultiplier;
    }

    // Add session token if available (from source or stored)
    const sessionToken = source.sessionToken || loadServerSession();
    if (sessionToken) {
      body.sessionToken = sessionToken;
    }

    let attempt = 0;
    const payloadJson = JSON.stringify(body);
    const allowBeacon = opts.allowBeacon === true;
    const authToken = await ensureAuthTokenWithRetry();
    if (!authToken && await isUserLoggedIn()) {
      throw new Error("Authenticated XP award requires an access token");
    }
    const headers = await buildAuthHeaders({ "content-type": "application/json" });
    while (attempt < 3) {
      let networkError = false;
      let lastError = null;
      let res = null;
      try {
        res = await fetch(CALC_URL, {
          method: "POST",
          headers,
          body: payloadJson,
          cache: "no-store",
          credentials: "include",
          keepalive: opts.keepalive === true,
        });
      } catch (err) {
        networkError = true;
        lastError = err;
      }

      if (res) {
        if (!res.ok) {
          let parsed = null;
          try {
            const text = await res.text();
            parsed = text ? JSON.parse(text) : null;
          } catch (_) {
            throw new Error(`Server calc failed (${res.status})`);
          }

          if (res.status === 429) {
            // Rate limited - back off
            state.backoffUntil = Date.now() + 60000;
            throw new Error("Rate limited");
          }

          throw new Error(parsed?.message || parsed?.error || `Server calc failed (${res.status})`);
        }

        const responseBody = await res.json();
        if (responseBody && typeof responseBody === "object" && opts.keepalive === true) {
          responseBody._transport = "keepalive";
        }

        if (isDiagEnabled() && window && window.console && typeof window.console.debug === "function" && responseBody) {
          window.console.debug("[XP] server_calc_apply", {
            awarded: responseBody.awarded || 0,
            totalLifetime: responseBody.totalLifetime,
            remaining: responseBody.remaining,
          });
        }

        // Update client cap from server response
        if (responseBody && typeof responseBody === "object") {
          if (Number.isFinite(responseBody.capDelta)) setClientCap(Number(responseBody.capDelta));
          if (responseBody.sessionCapped === true) rotateAwardSession();
        }

        // Dispatch event for listeners
        if (typeof window !== "undefined" && typeof CustomEvent === "function") {
          window.dispatchEvent(new CustomEvent("xp:server-calculated", {
            detail: responseBody,
          }));
        }

        return responseBody;
      }

      if (networkError && allowBeacon && typeof navigator !== "undefined" && navigator && typeof navigator.sendBeacon === "function") {
        try {
          const beaconPayload = new Blob([payloadJson], { type: "application/json" });
          const beaconOk = navigator.sendBeacon(CALC_URL, beaconPayload);
          if (beaconOk) {
            return { _transport: "beacon" };
          }
        } catch (_) {}
      }

      attempt += 1;
      if (attempt >= 3) {
        throw lastError || new Error("Server calc failed");
      }
      // Brief backoff before retry
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }

    throw new Error("Server calc failed: exhausted retries");
  }

  // Compatibility alias; all supported windows use server calculation.
  async function postWindowAuto(payload, options) {
    return postWindowServerCalc(payload, options);
  }

  window.XPClient = {
    postWindow,
    postWindowServerCalc,
    postWindowAuto,
    isServerCalcEnabled,
    fetchStatus,
    refreshBadgeFromServer,
    startServerSession,
    clearServerSession,
    ensureServerSession,
    getSessionStatus,
    isInitialStatusPending,
    isAuthenticated,
  };

  bindAuthChanges();
  scheduleInitialStatusRefresh();
})();
