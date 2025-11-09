(function (window, document) {
  const STORAGE_LOG_KEY = "kcswh:debug:log";
  const STORAGE_META_KEY = "kcswh:debug:meta";
  const STORAGE_ADMIN_KEY = "kcswh:admin";
  const MAX_LINES = 1000;
  const MIRROR_THRESHOLD = 100;
  const ENTRY_MAX_CHARS = 2000;
  const ADMIN_DURATION_MS = 24 * 60 * 60 * 1000;

  let buffer = [];
  let started = false;
  let level = 0;
  let startedAt = 0;
  let totalLines = 0;
  let dirtySinceMirror = 0;
  let truncateLogged = false;
  let adminActive = false;

  function getStorage() {
    try {
      if (typeof window === "undefined") return null;
      if (!window.localStorage) return null;
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }

  function readJson(key) {
    const store = getStorage();
    if (!store) return null;
    try {
      const raw = store.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function buildEntry(kind, data) {
    const ts = new Date().toISOString();
    let payload = "{}";
    if (data != null) {
      try {
        payload = JSON.stringify(data);
      } catch (_) {
        payload = JSON.stringify({ value: String(data) });
      }
    }
    if (payload.length > ENTRY_MAX_CHARS) {
      payload = payload.slice(0, ENTRY_MAX_CHARS) + "…";
    }
    return `[${ts}] ${kind} ${payload}`;
  }

  function enforceLimit(skipLog) {
    if (!Array.isArray(buffer)) buffer = [];
    if (buffer.length <= MAX_LINES) return;
    const dropCount = buffer.length - MAX_LINES;
    buffer.splice(0, dropCount);
    if (!skipLog && !truncateLogged) {
      truncateLogged = true;
      const entry = buildEntry("recorder_truncate", { dropped: dropCount });
      buffer.push(entry);
      totalLines += 1;
      dirtySinceMirror += 1;
      enforceLimit(true);
    }
  }

  function hydrateFromStorage() {
    const storedBuffer = readJson(STORAGE_LOG_KEY);
    if (Array.isArray(storedBuffer)) {
      buffer = storedBuffer.slice(-MAX_LINES);
    } else {
      buffer = [];
    }
    const meta = readJson(STORAGE_META_KEY);
    if (meta && typeof meta === "object") {
      if (typeof meta.level === "number") level = meta.level;
      if (typeof meta.startedAt === "number") startedAt = meta.startedAt;
      if (typeof meta.lines === "number") totalLines = meta.lines;
    }
    enforceLimit(true);
  }

  function truncateForStorage() {
    if (!Array.isArray(buffer) || buffer.length <= 1) {
      return false;
    }
    const dropCount = Math.max(1, Math.ceil(buffer.length * 0.1));
    buffer.splice(0, dropCount);
    if (!truncateLogged) {
      truncateLogged = true;
      const entry = buildEntry("recorder_truncate", { dropped: dropCount });
      buffer.push(entry);
      totalLines += 1;
      dirtySinceMirror += 1;
    }
    return true;
  }

  function persist(force) {
    if (!started) return;
    if (!force && dirtySinceMirror < MIRROR_THRESHOLD) return;
    const store = getStorage();
    if (!store) return;

    let attempts = 0;
    while (attempts < 2) {
      attempts += 1;
      try {
        const payload = buffer.slice(-MAX_LINES);
        store.setItem(STORAGE_LOG_KEY, JSON.stringify(payload));
        store.setItem(STORAGE_META_KEY, JSON.stringify({
          level,
          startedAt,
          lines: totalLines,
        }));
        dirtySinceMirror = 0;
        return;
      } catch (_) {
        if (!truncateForStorage()) {
          break;
        }
      }
    }
  }

  function refreshAdmin() {
    const record = readJson(STORAGE_ADMIN_KEY);
    const now = Date.now();
    let active = false;
    if (record && record.v === true && typeof record.exp === "number") {
      if (record.exp > now) {
        active = true;
      } else {
        const store = getStorage();
        if (store) {
          try { store.removeItem(STORAGE_ADMIN_KEY); } catch (_) {}
        }
      }
    }
    adminActive = active;
    return adminActive;
  }

  function notifyAdminChange() {
    try {
      window.dispatchEvent(new CustomEvent("klog:admin", { detail: { active: adminActive } }));
    } catch (_) {}
  }

  function enableAdmin(durationMs) {
    const store = getStorage();
    if (!store) return false;
    const now = Date.now();
    const exp = now + Math.max(Number(durationMs) || 0, ADMIN_DURATION_MS);
    try {
      store.setItem(STORAGE_ADMIN_KEY, JSON.stringify({ v: true, exp }));
    } catch (_) {
      return false;
    }
    refreshAdmin();
    notifyAdminChange();
    if (adminActive && !started) {
      start(1);
    }
    return adminActive;
  }

  function maybeEnableFromUrl() {
    try {
      if (!window || !window.location || !window.location.search) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("admin") === "1") {
        enableAdmin(ADMIN_DURATION_MS);
      }
    } catch (_) {}
  }

  function isAdmin() {
    return adminActive;
  }

  function recordDump(method, success, extra) {
    const payload = { method, success: !!success };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach((key) => {
        if (extra[key] != null) {
          payload[key] = extra[key];
        }
      });
    }
    try {
      log("diagnostic_dump", payload);
    } catch (_) {}
  }

  async function dumpToClipboard() {
    const text = getText();
    if (!window || typeof window.open !== "function") {
      recordDump("window", false, { reason: "no_window" });
      return false;
    }

    let child = null;
    try {
      child = window.open("about:blank", "_blank");
    } catch (_) {
      child = null;
    }

    if (!child || child.closed) {
      recordDump("window", false, { reason: "blocked" });
      return false;
    }

    try {
      try {
        child.opener = null;
      } catch (_) {}

      const doc = child.document;
      if (!doc) {
        throw new Error("no_document");
      }

      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Arcade Hub Diagnostics</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:monospace;background:#050910;color:#e6ecff;margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;}header{font-size:14px;margin-bottom:12px;opacity:0.8;}textarea{width:100%;height:240px;margin-top:12px;background:#0b1020;color:#e6ecff;border:1px solid rgba(230,236,255,0.2);padding:8px;font-family:inherit;}</style></head><body><header>Diagnostics dump generated ${new Date().toISOString()}</header><pre>${escaped || "(no diagnostics recorded)"}</pre><textarea readonly>${escaped}</textarea></body></html>`;

      if (typeof doc.write === "function") {
        doc.open();
        doc.write(html);
        doc.close();
      } else {
        doc.documentElement.innerHTML = html;
      }

      recordDump("window", true, { length: text.length });
      return true;
    } catch (error) {
      const message = error && error.message ? String(error.message).slice(0, 120) : "error";
      try {
        child.close();
      } catch (_) {}
      recordDump("window", false, { reason: message });
      return false;
    }
  }

  function downloadFile() {
    try {
      const text = getText();
      if (typeof Blob === "undefined" || typeof URL === "undefined") {
        return false;
      }
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `kcswh-diagnostic-${stamp}.txt`;
      (document && document.body ? document.body : document.documentElement || document).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (_) {
      return false;
    }
  }

  function getText() {
    if (!Array.isArray(buffer) || buffer.length === 0) return "";
    return buffer.join("\n");
  }

  function start(requestedLevel) {
    const nextLevel = Number(requestedLevel);
    level = Number.isFinite(nextLevel) && nextLevel > 0 ? nextLevel : 1;
    if (started) {
      return true;
    }
    started = true;
    if (!startedAt) {
      startedAt = Date.now();
    }
    if (!Number.isFinite(totalLines) || totalLines < buffer.length) {
      totalLines = buffer.length;
    }
    persist(true);
    return true;
  }

  function stop() {
    if (!started) return;
    started = false;
    persist(true);
  }

  function ensureStartedForLog() {
    if (started) return true;
    if (!adminActive) return false;
    return start(level > 0 ? level : 1);
  }

  function log(kind, data) {
    if (!started && !ensureStartedForLog()) return false;
    if (!kind || typeof kind !== "string") return false;
    try {
      const entry = buildEntry(kind, data || {});
      buffer.push(entry);
      totalLines += 1;
      dirtySinceMirror += 1;
      truncateLogged = false;
      enforceLimit(false);
      persist(false);
      return true;
    } catch (_) {
      return false;
    }
  }

  function status() {
    return {
      level,
      lines: totalLines,
      startedAt,
    };
  }

  hydrateFromStorage();
  refreshAdmin();
  maybeEnableFromUrl();
  if (adminActive) {
    start(1);
  }

  const api = {
    start,
    stop,
    log,
    getText,
    dumpToClipboard,
    downloadFile,
    status,
    enableAdmin,
    isAdmin,
  };

  window.KLog = Object.assign({}, window.KLog || {}, api);

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      try {
        if (!event) return;
        if (event.key === STORAGE_ADMIN_KEY) {
          const before = adminActive;
          refreshAdmin();
          if (before !== adminActive) {
            notifyAdminChange();
            if (adminActive && !started) {
              start(1);
            }
          }
        }
      } catch (_) {}
    });
  }
})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : undefined);
