import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

const RETIRED_RESPONSE = {
  ok: false,
  error: "sweep_http_retired",
  message: "Active gameplay cleanup is WS-owned. This legacy HTTP sweep endpoint is retired for gameplay authority."
};

export async function handler(event) {
  const method = String(event?.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };

  klog("poker_sweep_http_retired", {
    method,
    path: typeof event?.path === "string" ? event.path : null,
    userAgent: event?.headers?.["user-agent"] || event?.headers?.["User-Agent"] || null
  });

  return {
    statusCode: 410,
    headers: baseHeaders(corsHeaders()),
    body: JSON.stringify(RETIRED_RESPONSE)
  };
}
