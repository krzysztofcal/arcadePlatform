import { api, snippet } from "./poker-e2e-http.mjs";

const fallbackKlog = (line) => {
  try {
    console.warn(line);
  } catch {}
};

const withTimeout = (promise, ms, label) => {
  let id = null;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => {
      const err = new Error(`timeout:${label || "op"}:${ms}ms`);
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (id) {
      try {
        clearTimeout(id);
      } catch {}
      id = null;
    }
  });
};

const requestId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const apiLeave = async ({ baseUrl, origin, token, tableId, label, klog }) => {
  const log = klog || fallbackKlog;
  const res = await api({
    base: baseUrl,
    origin,
    method: "POST",
    path: "/.netlify/functions/poker-leave",
    token,
    body: { tableId, requestId: requestId(`leave-${label || "user"}`) },
    label: `leave:${label || "user"}`,
  });
  if (res.status !== 200) {
    log(`[cleanup] poker-leave ${label || "user"} status=${res.status} body=${snippet(res.text, 220)}`);
  }
  return res;
};

const cleanupPokerTable = async ({ baseUrl, origin, tableId, users, timers, klog } = {}) => {
  const log = klog || fallbackKlog;
  const list = Array.isArray(users) ? users : [];
  const handles = Array.isArray(timers) ? timers : [];
  const effectiveOrigin = origin || baseUrl;

  for (const handle of handles) {
    try {
      clearInterval(handle);
    } catch {}
  }

  if (!tableId) return;

  const leaveTasks = list
    .filter((user) => user?.token && user?.joined)
    .map((user) => {
      const label = user?.label || "user";
      return withTimeout(
        apiLeave({
          baseUrl,
          origin: effectiveOrigin,
          token: user.token,
          tableId,
          label,
          klog: log,
        }),
        8000,
        `leave:${label}`
      ).catch((err) => {
        const reason = err?.code === "TIMEOUT" ? "timeout" : "failed";
        log(`[cleanup] poker-leave ${label} ${reason}: ${err?.message || err}`);
        return null;
      });
    });

  await Promise.allSettled(leaveTasks);
};

export { apiLeave, cleanupPokerTable };
