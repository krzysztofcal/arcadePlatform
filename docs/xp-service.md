# XP service

## Authoritative gameplay endpoint

Playable pages use `js/xpClient.js` and `js/xp/core.js`; they must not call XP functions directly. The authoritative gameplay endpoint is:

```
POST /.netlify/functions/calculate-xp
```

It receives a bounded activity window and calculates the grant on the server. The browser sends its anon id, session id, optional signed server-session token, and Supabase bearer token when authenticated. The JWT subject is the authoritative account identity.

`/.netlify/functions/award-xp` is retained for status reads and legacy compatibility. It shares XP policy, identity resolution, and one-time anonymous conversion with `calculate-xp`; new gameplay code must not use it for awards.

## Required configuration

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `SUPABASE_JWT_SECRET` or `SUPABASE_JWT_SECRET_V2`
- `XP_DAILY_SECRET` / `XP_SESSION_SECRET` with a strong value
- `XP_CORS_ALLOW` and `URL`

Recommended production enforcement: `XP_REQUIRE_SERVER_SESSION=1` and `XP_REQUIRE_ACTIVITY=1`. Roll out signed-session enforcement through warn mode only while observing `klog` events.

## Anonymous conversion

On an authenticated request carrying the browser anon id, the server atomically transfers a positive anon lifetime total up to `XP_ANON_CONVERSION_MAX_XP`. It records a Redis marker as the receipt and will not convert again for that account. A zero balance creates no marker, so later guest XP remains eligible.
