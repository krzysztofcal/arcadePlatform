(function (window, document) {
  const STORAGE_LOG_KEY = "kcswh:debug:log";
  const STORAGE_META_KEY = "kcswh:debug:meta";
  const STORAGE_ADMIN_KEY = "kcswh:admin";
  const MAX_LINES = 1000;
  const MIRROR_THRESHOLD = 5; // persist more eagerly
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

  function flush(force) {
    try {
      persist(!!force);
    } catch (_) {}
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

  function hasAdminFlag() {
    try {
      const store = getStorage();
      if (!store) return false;
      return !!store.getItem(STORAGE_ADMIN_KEY);
    } catch (_) {
      return false;
    }
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
    if (!hasAdminFlag()) {
      adminActive = false;
      return false;
    }
    return refreshAdmin();
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

  const ERROR_MARKERS = ["window_error", "error", "fatal", "exception", "uncaught"];
  const WARNING_MARKERS = ["award_skip", "block_cap", "warn", "warning", "retry"];

  function getLineSeverity(text) {
    if (!text) return null;
    const normalized = String(text).toLowerCase();
    for (let i = 0; i < ERROR_MARKERS.length; i += 1) {
      if (normalized.indexOf(ERROR_MARKERS[i]) !== -1) {
        return "error";
      }
    }
    for (let j = 0; j < WARNING_MARKERS.length; j += 1) {
      if (normalized.indexOf(WARNING_MARKERS[j]) !== -1) {
        return "warn";
      }
    }
    return null;
  }

  function renderLogLines(doc, container, rawText) {
    if (!container || !doc) return;
    container.textContent = "";
    const output = rawText && rawText.length > 0 ? rawText : "No diagnostics available…";
    const lines = output.split("\n");
    const frag = doc.createDocumentFragment();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineEl = doc.createElement("div");
      lineEl.className = "log-line";
      const severity = getLineSeverity(line);
      if (severity === "error") {
        lineEl.classList.add("line--error");
      } else if (severity === "warn") {
        lineEl.classList.add("line--warn");
      }
      lineEl.textContent = line || "";
      frag.appendChild(lineEl);
    }
    container.appendChild(frag);
  }

  async function dumpToClipboard() {
    flush(true);
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

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Arcade Hub Diagnostics</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:monospace;background:#050910;color:#e6ecff;margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;}header{font-size:14px;margin-bottom:12px;opacity:0.8;}pre{margin:0;background:#0b1020;padding:12px;border:1px solid rgba(230,236,255,0.2);display:flex;flex-direction:column;gap:2px;}button{cursor:pointer;font-family:inherit;font-size:13px;border:1px solid rgba(230,236,255,0.3);background:#142040;color:#fff;padding:6px 10px;border-radius:4px;margin-bottom:12px;}button:focus{outline:2px solid rgba(255,255,255,0.4);outline-offset:1px;}.log-line{display:block;white-space:pre-wrap;word-break:break-word;line-height:1.35;}.log-line:empty::after{content:"\00a0";}.line--error{color:#ff4d4f;font-weight:600;}.line--warn{color:#ffa940;}</style></head><body><header>Diagnostics dump generated ${new Date().toISOString()}</header><button id="copyLogsBtn" type="button">Copy all logs</button><pre id="diagnosticsLog">No diagnostics available…</pre><script>(function(){function getLogText(){var el=document.getElementById("diagnosticsLog");if(!el)return"";return el.innerText||el.textContent||"";}function fallbackCopy(text){return new Promise(function(resolve,reject){try{var textarea=document.createElement("textarea");textarea.value=text;textarea.setAttribute("readonly","readonly");textarea.style.position="absolute";textarea.style.left="-9999px";document.body.appendChild(textarea);textarea.select();var ok=false;try{ok=document.execCommand("copy");}catch(err){ok=false;}textarea.remove();if(ok){resolve();return;}reject(new Error("execCommand_failed"));}catch(error){reject(error);}});}function copyLogs(){var text=getLogText();if(!text){return Promise.reject(new Error("empty_log"));}if(navigator&&navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){return navigator.clipboard.writeText(text);}return fallbackCopy(text);}var btn=document.getElementById("copyLogsBtn");if(!btn)return;var baseLabel=btn.textContent||"Copy";var timer=null;function reset(){if(timer){clearTimeout(timer);}timer=setTimeout(function(){btn.textContent=baseLabel;},1600);}btn.addEventListener("click",function(){copyLogs().then(function(){btn.textContent="Copied!";reset();}).catch(function(error){console.warn("Copy logs failed",error);btn.textContent="Copy failed";reset();});});})();</script></body></html>`;

      if (typeof doc.write === "function") {
        doc.open();
        doc.write(html);
        doc.close();
      } else {
        doc.documentElement.innerHTML = html;
      }

      const logContainer = doc.getElementById("diagnosticsLog");
      if (logContainer) {
        renderLogLines(doc, logContainer, text);
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
    if (!isAdmin()) return false;
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
  if (isAdmin()) {
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
    flush,
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
