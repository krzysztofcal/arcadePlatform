# Poker deployment notes

## Poker sweep endpoint

The poker sweep function requires a shared secret to run cleanup safely.

1. Set `POKER_SWEEP_SECRET` in the Netlify environment for the site.
2. Call the sweep endpoint from server-to-server automation (cron/CI) with:
   - `POST` method
   - `x-sweep-secret: <POKER_SWEEP_SECRET>`

Requests without the header (or with a mismatched value) are rejected with `401 unauthorized`.

## Acceptance

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
