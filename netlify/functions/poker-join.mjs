import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

const RETIRED_RESPONSE = {
  ok: false,
  error: "join_http_retired",
  message: "Browser gameplay join is WS-only. This legacy HTTP endpoint is retired and unsupported for normal gameplay usage."
};

export async function handler(event) {
  const method = String(event?.httpMethod || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  klog("poker_join_http_retired", {
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
