# XP service

## Authoritative XP endpoint

Playable pages use `js/xpClient.js` and `js/xp/core.js`; they must not call XP functions directly. The authoritative gameplay endpoint is:

```
POST /.netlify/functions/calculate-xp
```

For gameplay, it receives `operation: "award"` (or the default operation), validates a bounded activity window, and calculates the grant on the server. For reads, `operation: "status"` returns the canonical totals without creating, registering, or touching an award session. The browser sends its anon id and Supabase bearer token when authenticated; award requests additionally send session data. The JWT subject is the authoritative account identity.

The former `/.netlify/functions/award-xp` compatibility endpoint has been removed. All supported status and award requests use `calculate-xp`.

## Required configuration

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `SUPABASE_JWT_SECRET` or `SUPABASE_JWT_SECRET_V2`
- `XP_DAILY_SECRET` / `XP_SESSION_SECRET` with a strong value
- `XP_CORS_ALLOW` and `URL`

Recommended production enforcement: `XP_REQUIRE_SERVER_SESSION=1` and `XP_REQUIRE_ACTIVITY=1`. Roll out signed-session enforcement through warn mode only while observing `klog` events.

## Anonymous conversion

On an authenticated request carrying the browser anon id, the server atomically transfers a positive anon lifetime total up to `XP_ANON_CONVERSION_MAX_XP`. It records a Redis marker as the receipt and will not convert again for that account. A zero balance creates no marker, so later guest XP remains eligible.
