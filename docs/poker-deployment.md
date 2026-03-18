# Poker deployment notes

## Funds safety invariant

Poker funds must always have a deterministic path back to the user. Each buy-in
moves chips from USER → ESCROW using `TABLE_BUY_IN`, and each leave/timeout must
cash those chips back from ESCROW → USER using `TABLE_CASH_OUT`. The sweep
timeout path is required to cash out inactive seats so escrow balances cannot
remain stranded.

Stack authority:
- Authoritative (active gameplay): `poker_state.state.stacks`.
- Authoritative (seat snapshot): `public.poker_seats.stack`.
- Gameplay decisions use `poker_state.state.stacks`; `public.poker_seats.stack` is the persisted snapshot for join/lobby/seat validation and recovery/reconciliation starting state.
- `public.poker_seats.stack` must never be NULL after a successful join.

Stack synchronization is required at lifecycle boundaries:
- successful join
- hand end / settlement
- leave / cash-out
- sweep cleanup

If both stack stores are present, `poker_state.state.stacks` drives gameplay
decisions and `public.poker_seats.stack` must not contradict funds-safety
outcomes. This prevents stranded escrow balances and avoids gameplay issues such
as "stack = 0" with no legal actions.

## Poker sweep endpoint

The poker sweep function requires a shared secret to run cleanup safely.

1. Set `POKER_SWEEP_SECRET` in the Netlify environment for the site.
2. Call the sweep endpoint from server-to-server automation (cron/CI) with:
   - `POST` method
   - `x-sweep-secret: <POKER_SWEEP_SECRET>`

Requests without the header (or with a mismatched value) are rejected with `401 unauthorized`.


## Poker Bots (Phase 1)

Runtime config should be read in code via `process.env.*` (Netlify Functions runtime style).

Authoritative behavior reference: `docs/poker-bots.md`.

Set these as Netlify environment variables (Site settings -> Environment variables):

- `POKER_BOTS_ENABLED` (`0`/`1`)
- `POKER_BOTS_MAX_PER_TABLE` (default: `2`)
- `POKER_BOT_PROFILE_DEFAULT` (default: `TRIVIAL`)
- `POKER_BOT_BUYIN_BB` (example: `100`)
- `POKER_BOT_BANKROLL_SYSTEM_KEY` (default now: `TREASURY`; optional later: `POKER_BOT_BANKROLL`)
- Optional later: `POKER_BOTS_MAX_ACTIONS_PER_POLL`

Operational notes:
- Bot runtime is guarded by `POKER_BOTS_ENABLED`.
- Values above are Netlify runtime config env vars (not secrets unless explicitly sensitive).
- Bot logic runs server-side in Netlify Functions runtime (no client-side bot scripts).

### Local development

- Local `.env` is supported for development only (gitignored, never committed).
- Deployed environments should use Netlify environment variables.
- Keep naming consistent between docs and code: Netlify environment variables read through `process.env`.

## WS preview manual deploy

Preview WS deploys are isolated from production and are dispatched manually with GitHub CLI:

```sh
gh workflow run ws-preview-deploy.yml --ref <feature-branch>
```

Preview runtime assumptions:
- systemd service: `ws-server-preview.service`
- release root: `/opt/arcade-ws-preview`
- working directory: `/opt/arcade-ws-preview/ws-server`
- environment file: `/opt/arcade-ws-preview/.env.preview`
- local health check: `http://127.0.0.1:3100/healthz`
- public preview host: configured through the `WS_PREVIEW_HOST` GitHub secret (for example `ws-preview.kcswh.pl`)

Example VPS assets live in `infra/vps/Caddyfile.preview.example`, `infra/vps/ws-preview.env.example`, and `infra/vps/ws-server-preview.service.example`.

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
