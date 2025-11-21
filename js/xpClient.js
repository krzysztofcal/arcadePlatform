(function () {
  const FN_URL = "/.netlify/functions/award-xp";
  const START_SESSION_URL = "/.netlify/functions/start-session";
  const USER_KEY = "kcswh:userId";
  const SESSION_KEY = "kcswh:sessionId";
  const SERVER_SESSION_KEY = "kcswh:serverSessionId";
  const SERVER_SESSION_TOKEN_KEY = "kcswh:serverSessionToken";
  const SERVER_SESSION_EXPIRES_KEY = "kcswh:serverSessionExpires";
  const MAX_TS = Number.MAX_SAFE_INTEGER;
  const DEFAULT_DELTA_CAP = 300;

  const state = {
    fallbackIds: null,
    statusBootstrapped: false,
    statusPromise: null,
    backoffUntil: 0,
    lastTs: 0,
    serverSessionPromise: null,
    serverSessionToken: null,
  };

  function randomId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  function loadServerSession() {
    try {
      const ls = window.localStorage;
      const token = ls.getItem(SERVER_SESSION_TOKEN_KEY);
      const expires = Number(ls.getItem(SERVER_SESSION_EXPIRES_KEY) || "0");

      // Check if session is still valid (with 60 second buffer)
      if (token && expires > Date.now() + 60000) {
        state.serverSessionToken = token;
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
    } catch (_) {
      // Fallback to in-memory only
      state.serverSessionToken = sessionToken;
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

    state.serverSessionPromise = (async () => {
      try {
        const res = await fetch(START_SESSION_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
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
        state.serverSessionPromise = null;
        throw err;
      } finally {
        state.serverSessionPromise = null;
      }
    })();

    return state.serverSessionPromise;
  }

  async function ensureServerSession() {
    const existing = loadServerSession();
    if (existing) {
      return existing;
    }
    return startServerSession();
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

  async function sendRequest(body) {
    try {
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
      });
      const status = res.status;
      if (!res.ok) {
        let parsed = null;
        try {
          const text = await res.text();
          parsed = text ? JSON.parse(text) : null;
        } catch (_) {
          return { ok: false, network: true, status };
        }
        const result = { ok: false, network: true, status, body: parsed };
        if (status === 422 && parsed && parsed.error === "delta_out_of_range") {
          result.network = false;
        }
        return result;
      }
      try {
        const json = await res.json();
        return { ok: true, body: json };
      } catch (_) {
        return { ok: false, network: true, status: res.status };
      }
    } catch (err) {
      return { ok: false, network: true, status: 0, error: err };
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

  async function postWindow(payload) {
    const source = (payload && typeof payload === "object") ? payload : {};
    ensureStatusBootstrap(false);
    await maybeBackoff();

    const { userId, sessionId } = ensureIds();
    let delta = sanitizeDelta(source);
    let ts = sanitizeTs(source);
    const metadata = buildMetadata(source);

    // Get server session token (if available, non-blocking)
    let sessionToken = loadServerSession();
    // If no session token, try to get one (but don't fail if we can't)
    if (!sessionToken) {
      try {
        sessionToken = await ensureServerSession();
      } catch (_) {
        // Continue without server session - server may accept the request anyway
      }
    }

    const body = { userId, sessionId, delta, ts };
    if (sessionToken) body.sessionToken = sessionToken;
    if (metadata) body.metadata = metadata;

    let attempt = 0;
    let sessionRefreshed = false;
    while (attempt < 3) {
      const result = await sendRequest(body);
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
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

  window.XPClient = {
    postWindow,
    fetchStatus,
    startServerSession,
    clearServerSession,
  };
})();
