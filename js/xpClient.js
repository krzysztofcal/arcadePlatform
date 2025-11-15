(function () {
  const AWARD_URL = "/.netlify/functions/award-xp";
  const STATUS_URL = "/.netlify/functions/xp-status";
  const USER_KEY = "kcswh:userId";
  const SESSION_KEY = "kcswh:sessionId";
  const MAX_TS = Number.MAX_SAFE_INTEGER;
  const DEFAULT_DELTA_CAP = 300;

  const state = {
    fallbackIds: null,
    statusBootstrapped: false,
    statusPromise: null,
    backoffUntil: 0,
    lastTs: 0,
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
      const res = await fetch(AWARD_URL, {
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

  function normalizeStatusPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    let capValue = Number(payload.cap);
    if (!Number.isFinite(capValue)) {
      const dailyCapValue = Number(payload.dailyCap);
      if (Number.isFinite(dailyCapValue)) {
        capValue = Math.max(0, Math.floor(dailyCapValue));
        payload.cap = capValue;
      }
    }
    if (!Number.isFinite(capValue)) {
      const envCap = Number(window && window.XP_DAILY_CAP);
      if (Number.isFinite(envCap)) {
        capValue = Math.max(0, Math.floor(envCap));
        payload.cap = capValue;
      }
    } else {
      capValue = Math.max(0, Math.floor(capValue));
      payload.cap = capValue;
    }

    payload.dailyCap = capValue;

    let todayRaw = Number(payload.totalToday);
    if (!Number.isFinite(todayRaw)) {
      todayRaw = Number(payload.awardedToday);
    }
    let remainingRaw = Number(payload.remaining);
    if (!Number.isFinite(remainingRaw)) {
      remainingRaw = Number(payload.remainingToday);
    }
    const hasToday = Number.isFinite(todayRaw);
    const hasRemaining = Number.isFinite(remainingRaw);

    if (!hasToday && hasRemaining && Number.isFinite(capValue)) {
      const normalizedRemaining = Math.max(0, Math.floor(remainingRaw));
      payload.totalToday = Math.max(0, capValue - normalizedRemaining);
    }

    if (!hasRemaining && hasToday && Number.isFinite(capValue)) {
      const normalizedToday = Math.max(0, Math.floor(todayRaw));
      payload.remaining = Math.max(0, capValue - normalizedToday);
    }

    return payload;
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

    const body = { userId, sessionId, delta, ts };
    if (metadata) body.metadata = metadata;

    let attempt = 0;
    while (attempt < 2) {
      const result = await sendRequest(body);
      if (!result.ok) {
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

  async function fetchStatusFrom(url, body) {
    const res = await fetch(url, {
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
    return normalizeStatusPayload(payload);
  }

  async function fetchStatus() {
    const { userId, sessionId } = ensureIds();
    const baseBody = { userId, sessionId };
    let primaryError = null;
    try {
      return await fetchStatusFrom(STATUS_URL, baseBody);
    } catch (err) {
      primaryError = err;
    }
    const fallbackBody = { userId, sessionId, gameId: "status", statusOnly: true };
    try {
      return await fetchStatusFrom(AWARD_URL, fallbackBody);
    } catch (err) {
      throw primaryError || err;
    }
  }

  window.XPClient = { postWindow, fetchStatus };
})();
