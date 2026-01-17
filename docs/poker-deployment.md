# Poker deployment notes

## Poker sweep endpoint

The poker sweep function requires a shared secret to run cleanup safely.

1. Set `POKER_SWEEP_SECRET` in the Netlify environment for the site.
2. Call the sweep endpoint from server-to-server automation (cron/CI) with:
   - `POST` method
   - `x-sweep-secret: <POKER_SWEEP_SECRET>`

Requests without the header (or with a mismatched value) are rejected with `401 unauthorized`.

## Acceptance

### Browser acceptance (primary)

1. Open the poker table page.
2. Open DevTools console (or your KLog collector).
3. Click Leave.
4. You must see, in order:
   - `poker_leave_bind` with `found:true`
   - `poker_leave_click`
   - `poker_leave_request`
   - then either:
     - `poker_leave_response` (non-pending) + UI updates, or
     - `poker_leave_response` pending + retry logs + eventual terminal result, or
     - `poker_leave_click_error` with a visible UI error

### Netlify function acceptance (secondary)

After clicking Leave once, Netlify logs must show:
- `poker_leave_start`
- then `poker_leave_ok` **or** `poker_leave_error`

If you still don’t see `poker_leave_start`, the issue is client-side (no request sent / blocked / wrong URL).

### Optional CSP check (only if client logs show request but server logs are empty)

Run these from Termux (or anywhere) and confirm headers look sane:

```sh
# Poker page CSP (should allow self scripts)
curl -sSI "https://play.kcswh.pl/poker/" | sed -n '1,120p' | grep -iE 'content-security-policy|x-content-type-options|x-frame-options'

# Function call should be same-origin; CSP shouldn't block it (CSP is enforced by browser)
curl -sSI "https://play.kcswh.pl/.netlify/functions/poker-leave" | sed -n '1,120p'
```

What you’re looking for:
- CSP should have `script-src 'self' ...` (or no CSP at all).
- If you use nonces/hashes and inline scripts, CSP must allow them; otherwise the poker JS may not run.
- For network calls, CSP uses `connect-src`. It should include `'self'` (or explicitly `https://play.kcswh.pl`).
