# WS auth token minting (hybrid user + admin)

This guide explains how to mint WebSocket auth tokens for the WS server and test `hello -> auth -> join` with `wscat`.

## Required environment variables

Set these in Netlify (function runtime) and keep WS verifier settings aligned with what `ws-server` expects:

- `WS_MINT_ENABLED=1` — enables `/.netlify/functions/ws-mint-token`.
- `WS_MINT_ADMIN_SECRET=<strong-random-secret>` — required to mint for arbitrary subjects (`admin mint` mode).
- `WS_AUTH_HS256_SECRET=<shared-hs256-secret>` — signing key used by mint endpoint; must match WS server verify secret.
- Optional: `WS_MINT_TTL_SEC=300` — minted token expiry in seconds.

User-mode CORS allowlist (`corsHeaders(origin)` from `netlify/functions/_shared/supabase-admin.mjs`):

- `XP_CORS_ALLOW` — comma-separated explicit origin allowlist used by user mint.
- `URL` — automatically added to the same allowlist when present.
- `https://*.netlify.app` origins are accepted by built-in Netlify domain rule.

WS server verification env alignment:

- `ws-server` verifies with `WS_AUTH_HS256_SECRET` (or `WS_AUTH_TEST_SECRET` in test mode).
- If mint and verify secrets differ, minting succeeds but WS `auth` fails with token/signature errors.

## Mint modes

## Admin mint (arbitrary `sub` for manual testing)

Admin mint is gated only by `x-ws-mint-secret` and **does not require** `Origin`.

```bash
curl -sS -X POST "https://kcswh.pl/.netlify/functions/ws-mint-token" \
  -H "content-type: application/json" \
  -H "x-ws-mint-secret: ${WS_MINT_ADMIN_SECRET}" \
  --data '{"sub":"user_manual_test_123"}'
```

Expected response shape:

```json
{
  "ok": true,
  "token": "<ws-jwt>",
  "userId": "user_manual_test_123",
  "mode": "admin",
  "expiresInSec": 300
}
```

## User mint (self only, frontend-compatible)

User mint requires:

- `Authorization: Bearer <supabase_jwt>`
- `Origin` header present
- origin must be allowlisted by runtime CORS logic (`XP_CORS_ALLOW` / `URL` / `*.netlify.app` rule)

The endpoint always mints for the authenticated user id and ignores body `sub`.

```bash
# Example: XP_CORS_ALLOW includes https://app.example.test
curl -sS -X POST "https://kcswh.pl/.netlify/functions/ws-mint-token" \
  -H "origin: https://app.example.test" \
  -H "authorization: Bearer ${SUPABASE_JWT}" \
  -H "content-type: application/json" \
  --data '{}'
```

Expected response shape:

```json
{
  "ok": true,
  "token": "<ws-jwt>",
  "userId": "<supabase-user-id>",
  "mode": "user",
  "expiresInSec": 300
}
```

## Manual `wscat` recipe (`wss://ws.kcswh.pl/ws`)

1. Connect:

```bash
wscat -c wss://ws.kcswh.pl/ws
```

2. Send `hello` (version must be `1.0`):

```json
{"version":"1.0","type":"hello","requestId":"11111111-1111-4111-8111-111111111111","ts":"2026-01-01T00:00:00Z","payload":{"supportedVersions":["1.0"],"client":{"name":"wscat","build":"manual"}}}
```

3. Send `auth` with minted token:

```json
{"version":"1.0","type":"auth","requestId":"22222222-2222-4222-8222-222222222222","ts":"2026-01-01T00:00:01Z","payload":{"token":"<PASTE_MINTED_TOKEN>"}}
```

Expected: `authOk` frame.

4. Send `join` for room/table id:

```json
{"version":"1.0","type":"join","requestId":"33333333-3333-4333-8333-333333333333","roomId":"table_manual_test","ts":"2026-01-01T00:00:02Z","payload":{"tableId":"table_manual_test"}}
```

Expected: server replies with `table_state` containing `payload.tableId` and `payload.members`.
