# Implementation Plan: Poker Google photos with E + Blob

## Design

- Account uses existing revision-checked confirmation and Google Photo eligibility. Only explicitly supported g2 and Stage g3 grants can confirm g4. PL/EN Privacy remains a candidate.
- GET poker-table-photo accepts comma-separated UUIDs in ids and optional comma-separated UUID:version pairs in known. Version is the server's consent and avatar revision pair, never a key. Only ready images supply known versions. The response maps all requested IDs to null, {version}, or {version,url}. It is private and no-store. Use HTTP 400 for malformed requests, 401/403 for invalid or forbidden viewers, 404 with a distinct flag-off marker, 429 for rate limiting and 503 for dependency failures.
- Netlify uses the current SQL eligibility rules, signs a changed subset in one private Storage request and rechecks that subset. A signed URL necessarily includes a Storage object identifier and can be copied. Never log it or pass it in WS.
- Poker V2 uses one bounded context and a ready image map, reconciled on authoritative state, composition, reconnect, focus and local UGC/profile events. Concurrent obsolete requests are aborted and stale results discarded. No periodic network or presentation timer. Temporary request timeouts only.
- Existing Preview error-header evidence does not prove CORS on a successful signed WebP request. T007 must verify both Android API and Storage CORS, then reuse across render, expiry and reconnect. STOP on failure. No implicit proxy fallback.
- Cost scenarios and compatibility are documented in specs/1140-ugc-safety/poker-table-photo.md.

## Constitution Check

Reuse existing auth, consent, Storage, gameplay hooks and tests. No migration, new service, new public WS message or financial change. Use JSP-compatible JavaScript, narrow Poker CSP and klog. Stage, Production, legal publication and device testing are separate gates. Keep Draft and use R7/R8 only for the implementation diff. This implementation does not authorize a deployment or DB apply.
