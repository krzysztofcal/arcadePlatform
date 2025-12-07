(function () {
  const FN_URL = "/.netlify/functions/award-xp";
  const CALC_URL = "/.netlify/functions/calculate-xp";
  const START_SESSION_URL = "/.netlify/functions/start-session";
  const USER_KEY = "kcswh:userId";
  const SESSION_KEY = "kcswh:sessionId";
  const SERVER_SESSION_KEY = "kcswh:serverSessionId";
  const SERVER_SESSION_TOKEN_KEY = "kcswh:serverSessionToken";
  const SERVER_SESSION_EXPIRES_KEY = "kcswh:serverSessionExpires";
  const MAX_TS = Number.MAX_SAFE_INTEGER;
  const DEFAULT_DELTA_CAP = 300;
  const AUTH_CACHE_MS = 60000;

  // Session states: "none" | "pending" | "ready"
  const SESSION_NONE = "none";
  const SESSION_PENDING = "pending";
  const SESSION_READY = "ready";

  const state = {
    fallbackIds: null,
    statusBootstrapped: false,
    statusPromise: null,
    backoffUntil: 0,
    lastTs: 0,
    serverSessionPromise: null,
    serverSessionToken: null,
    sessionStatus: SESSION_NONE,
    authToken: null,
    authCheckedAt: 0,
    authPromise: null,
    shownConversions: {},
  };

  let serverCalcInitRequested = false;

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
      if (typeof console !== "undefined" && console && typeof console.log === "function") {
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
          if (window && window.console && typeof console.debug === "function") {
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
          if (window && window.console && typeof console.debug === "function") {
            console.debug("[XPClient] auth_client_result", { hasToken: !!token });
          }
        }

        state.authToken = token || null;
        state.authCheckedAt = Date.now();
        return state.authToken;
      } catch (err) {
        if (window && window.console && typeof console.warn === "function") {
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

  function decodeJwtSub(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(payload);
      const json = JSON.parse(decoded);
      return typeof json.sub === "string" ? json.sub : null;
    } catch (_) {
      return null;
    }
  }

  function currentUserIdForConversion() {
    const token = state.authToken;
    const sub = decodeJwtSub(token);
    if (sub) return sub;
    try {
      const ids = ensureIds();
      return ids && ids.userId ? ids.userId : null;
    } catch (_) {
      return null;
    }
  }

  function showConversionToast(amount) {
    if (typeof document === "undefined") return;
    const existing = document.getElementById("xp-conversion-toast");
    if (existing) {
      existing.textContent = `We converted ${amount.toLocaleString()} XP from your guest profile to your account.`;
      return;
    }
    const el = document.createElement("div");
    el.id = "xp-conversion-toast";
    el.textContent = `We converted ${amount.toLocaleString()} XP from your guest profile to your account.`;
    el.style.position = "fixed";
    el.style.bottom = "16px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.padding = "12px 16px";
    el.style.background = "#0b1021";
    el.style.color = "#fff";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
    el.style.zIndex = "9999";
    el.style.fontSize = "14px";
    el.style.lineHeight = "18px";
    el.style.textAlign = "center";
    el.setAttribute("aria-live", "polite");
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => {
      try {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (_) {}
    }, 5000);
  }

  function handleConversion(conversion) {
    if (!conversion || conversion.converted !== true || !conversion.amount || conversion.amount <= 0) return;
    const userId = currentUserIdForConversion();
    if (!userId) return;
    const key = `kcswh:xpConversionShown:${userId}`;
    if (state.shownConversions[userId]) return;
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(key)) {
        state.shownConversions[userId] = true;
        return;
      }
    } catch (_) {}
    showConversionToast(conversion.amount);
    state.shownConversions[userId] = true;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, String(conversion.amount));
      }
    } catch (_) {}
  }

  function ensureIds() {
    try {
      const ls = window.localStorage;
      let userId = ls.getItem(USER_KEY);
      let sessionId = ls.getItem(SESSION_KEY);
      if (!userId) {
        userId = randomId();
        ls.setItem(USER_KEY, userId);
      }
      if (!sessionId) {
        sessionId = randomId();
        ls.setItem(SESSION_KEY, sessionId);
      }
      return { userId, sessionId };
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
          const text = await res.text().catch(() => "");
          console.error("[XPClient] Failed to start session:", res.status, text);
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

  function currentClientCap() {
    const globalCap = Number(window.XP_DELTA_CAP_CLIENT);
    if (Number.isFinite(globalCap) && globalCap >= 0) return globalCap;
    return DEFAULT_DELTA_CAP;
  }

  function setClientCap(value) {
    if (!Number.isFinite(value) || value <= 0) return;
    window.XP_DELTA_CAP_CLIENT = value;
  }

  function sanitizeDelta(source) {
    let delta = 0;
    if (typeof source.delta === "number") delta = source.delta;
    else if (typeof source.scoreDelta === "number") delta = source.scoreDelta;
    else if (typeof source.pointsPerPeriod === "number") delta = source.pointsPerPeriod;

    if (!Number.isFinite(delta)) delta = 0;
    delta = Math.max(0, delta);
    const cap = currentClientCap();
    if (delta > cap) delta = cap;
    return Math.floor(delta);
  }

  function sanitizeTs(source) {
    let raw = source.ts;
    if (raw == null) raw = source.windowEnd;
    let ts = Number(raw);
    if (!Number.isFinite(ts)) ts = Date.now();
    ts = Math.floor(ts);
    if (ts < 0) ts = 0;
    if (ts > MAX_TS) ts = MAX_TS;
    if (ts <= state.lastTs) {
      const candidate = Math.max(Date.now(), state.lastTs + 1);
      ts = candidate <= MAX_TS ? candidate : MAX_TS;
    }
    state.lastTs = ts;
    return ts;
  }

  function buildMetadata(source) {
    if (!source || typeof source !== "object") return null;
    const metadata = {};
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (key === "userId" || key === "sessionId" || key === "delta" || key === "ts" || key === "windowEnd") continue;
      if (key === "scoreDelta" || key === "pointsPerPeriod") continue;
      metadata[key] = source[key];
    }
    return Object.keys(metadata).length ? metadata : null;
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

  async function sendRequest(body, options) {
    const opts = options || {};
    const keepalive = opts.keepalive === true;
    const allowBeacon = opts.allowBeacon === true;
    const payload = JSON.stringify(body);
    await ensureAuthTokenWithRetry();
    const headers = await buildAuthHeaders({ "content-type": "application/json" });
    const requestInit = {
      method: "POST",
      headers,
      body: payload,
      cache: "no-store",
      credentials: "omit",
    };
    if (keepalive) requestInit.keepalive = true;
    let transport = keepalive ? "keepalive" : "fetch";
    try {
      const res = await fetch(FN_URL, requestInit);
      const status = res.status;
      if (!res.ok) {
        let parsed = null;
        try {
          const text = await res.text();
          parsed = text ? JSON.parse(text) : null;
        } catch (_) {
          return { ok: false, network: true, status };
        }
        const result = { ok: false, network: true, status, body: parsed, transport };
        if (status === 422 && parsed && parsed.error === "delta_out_of_range") {
          result.network = false;
        }
        return result;
      }
      try {
        const json = await res.json();
        handleConversion(json && json.conversion ? json.conversion : null);
        return { ok: true, body: json, transport };
      } catch (_) {
        return { ok: false, network: true, status: res.status, transport };
      }
    } catch (err) {
      if (allowBeacon && typeof navigator !== "undefined" && navigator && typeof navigator.sendBeacon === "function") {
        try {
          const beaconPayload = new Blob([payload], { type: "application/json" });
          const beaconOk = navigator.sendBeacon(FN_URL, beaconPayload);
          if (beaconOk) {
            return { ok: true, body: null, transport: "beacon", status: 0 };
          }
        } catch (_) {}
      }
      return { ok: false, network: true, status: 0, error: err, transport };
    }
  }

  function updateCapFromPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    if (Number.isFinite(payload.capDelta)) setClientCap(Number(payload.capDelta));
    else if (Number.isFinite(payload.cap)) setClientCap(Number(payload.cap));
  }

  function clampAfterServerCap(body, response) {
    const cap = Number(response?.cap ?? response?.capDelta);
    if (Number.isFinite(cap) && cap > 0) {
      setClientCap(cap);
      state.backoffUntil = Date.now() + (2000 + Math.floor(Math.random() * 3000));
      const safeCap = Math.max(0, cap - 1);
      setClientCap(safeCap > 0 ? safeCap : cap);
    } else {
      state.backoffUntil = Date.now() + (2000 + Math.floor(Math.random() * 3000));
    }
    ensureStatusBootstrap(true);
  }

  async function postWindow(payload, options) {
    const opts = options || {};
    const source = (payload && typeof payload === "object") ? payload : {};
    ensureStatusBootstrap(false);
    await maybeBackoff();

    const { userId, sessionId } = ensureIds();
    let delta = sanitizeDelta(source);
    let ts = sanitizeTs(source);
    const metadata = buildMetadata(source);

    // Session token should be provided by caller (via ensureServerSession gate)
    // or loaded from storage. No lazy acquisition here - caller is responsible.
    let sessionToken = source.sessionToken || loadServerSession();

    const body = { userId, sessionId, delta, ts };
    if (sessionToken) body.sessionToken = sessionToken;
    if (metadata) body.metadata = metadata;

    let attempt = 0;
    let sessionRefreshed = false;
    while (attempt < 3) {
      const result = await sendRequest(body, {
        keepalive: opts.keepalive === true,
        allowBeacon: opts.allowBeacon === true,
      });
      if (!result.ok) {
        // Handle invalid session - refresh and retry once
        if (result.status === 401 && result.body?.error === "invalid_session" && !sessionRefreshed) {
          clearServerSession();
          try {
            const newToken = await startServerSession(true);
            body.sessionToken = newToken;
            sessionRefreshed = true;
            attempt += 1;
            continue;
          } catch (_) {
            // If we can't get a new session, try without (server may allow it)
            delete body.sessionToken;
            attempt += 1;
            continue;
          }
        }

        if (result.status === 422 && result.body && result.body.error === "delta_out_of_range") {
          clampAfterServerCap(body, result.body);
          const capMsg = Number.isFinite(result.body.capDelta || result.body.cap)
            ? ` (cap=${result.body.capDelta ?? result.body.cap})`
            : "";
          throw new Error(`XP request failed: delta_out_of_range${capMsg}`);
        }
        const serverMsg = result.body?.error || result.error?.message || "unknown_error";
        const code = result.status ?? 0;
        throw new Error(`XP request failed: ${serverMsg} (status ${code})`);
      }

      const responseBody = result.body || {};
      if (result.transport) {
        responseBody._transport = result.transport;
      }
      updateCapFromPayload(responseBody);
      if (responseBody && responseBody.locked && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 200)));
        body.ts = sanitizeTs({ ts: Math.max(Date.now(), body.ts + 1) });
        attempt += 1;
        continue;
      }
      return responseBody;
    }
    throw new Error("XP request failed: exhausted retries");
  }

  async function fetchStatus() {
    const { userId, sessionId } = ensureIds();
    const body = { userId, sessionId, gameId: "status", statusOnly: true };
    await ensureAuthTokenWithRetry();
    const headers = await buildAuthHeaders({ "content-type": "application/json" });
    const res = await fetch(FN_URL, {
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
    handleConversion(payload && payload.conversion ? payload.conversion : null);
    return payload;
  }

  async function refreshBadgeFromServer(options) {
    const opts = options || {};
    try {
      const payload = await fetchStatus();
      if (typeof window !== "undefined" && window.XP && typeof window.XP.refreshFromServerStatus === "function") {
        try {
          window.XP.refreshFromServerStatus(payload, {
            bump: opts.bumpBadge === true,
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
    ensureServerCalcInit();

    let serverCalcEnabled = window.XP_SERVER_CALC === true;
    try {
      if (!serverCalcEnabled && typeof location !== "undefined" && location && typeof location.search === "string") {
        if (/\bxpserver=1\b/.test(location.search)) serverCalcEnabled = true;
      }
    } catch (_) {}
    try {
      if (!serverCalcEnabled && typeof localStorage !== "undefined" && localStorage) {
        if (localStorage.getItem("xp:serverCalc") === "1") serverCalcEnabled = true;
      }
    } catch (_) {}

    try {
      if (window && window.console && typeof console.debug === "function") {
        console.debug("[xpClient] Server calc decision", {
          XP_SERVER_CALC: window.XP_SERVER_CALC,
          serverCalcEnabled,
        });
      }
    } catch (_) {}

    return serverCalcEnabled;
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
    await ensureAuthTokenWithRetry();
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
        handleConversion(responseBody && responseBody.conversion ? responseBody.conversion : null);

        if (window && window.console && typeof window.console.debug === "function" && responseBody) {
          window.console.debug("[XP] server_calc_apply", {
            awarded: responseBody.awarded || 0,
            totalLifetime: responseBody.totalLifetime,
            remaining: responseBody.remaining,
          });
        }

        // Update client cap from server response
        if (responseBody && typeof responseBody === "object") {
          if (Number.isFinite(responseBody.capDelta)) setClientCap(Number(responseBody.capDelta));
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

  /**
   * Unified postWindow that routes to server calc or legacy endpoint
   * based on configuration
   */
  async function postWindowAuto(payload, options) {
    if (isServerCalcEnabled()) {
      return postWindowServerCalc(payload, options);
    }
    return postWindow(payload, options);
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
    isAuthenticated,
  };
})();
