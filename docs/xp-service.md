# Server-verified XP via Netlify Functions

This PR introduces a minimal server endpoint to award XP only after a **verified** 30 seconds of active play per user and game.

## What this adds
- `netlify/functions/_shared/store-upstash.mjs` (helper for Upstash Redis REST)
- `netlify/functions/award-xp.mjs` (POST endpoint)
- `docs/xp-service.md` (how to configure & call)

## Configure on Netlify
1. Add env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `XP_SERVICE_API_KEY`, optional `XP_STEP`.
2. Deploy. Endpoint becomes `/.netlify/functions/award-xp`.

## Client usage (example)
Call from UI **only when 30s of active play elapsed**:

```js
await fetch('/.netlify/functions/award-xp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': '<set-in-env>' },
  body: JSON.stringify({ userId, gameId, claimedAt: Date.now() })
});
```

Responses:
- 200: `{ ok: true, added, total }`
- 409: `Too soon`
- 422: timestamp window invalid
- 401: missing/invalid API key

Idempotency & spam: a short lock prevents rapid duplicates; per-game 30s spacing enforced server-side.
