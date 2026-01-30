import { api, snippet } from "./poker-e2e-http.mjs";

const fallbackKlog = (line) => {
  try {
    console.warn(line);
  } catch {}
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

  handles.forEach((handle) => {
    try {
      clearInterval(handle);
      clearTimeout(handle);
    } catch {}
  });

  if (!tableId) return;

  for (const user of list) {
    if (!user?.joined || !user?.token) continue;
    try {
      await apiLeave({
        baseUrl,
        origin,
        token: user.token,
        tableId,
        label: user.label || "user",
        klog: log,
      });
    } catch (err) {
      log(`[cleanup] poker-leave ${user?.label || "user"} failed: ${err?.message || err}`);
    }
  }
};

export { apiLeave, cleanupPokerTable };
