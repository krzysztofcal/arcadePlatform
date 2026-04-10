# Poker deployment notes

## Funds safety invariant

Poker funds must always have a deterministic path back to the user. Each buy-in
moves chips from USER → ESCROW using `TABLE_BUY_IN`, and each leave/timeout must
cash those chips back from ESCROW → USER using `TABLE_CASH_OUT`.

Stack authority:
- Authoritative (active gameplay): `poker_state.state.stacks`.
- Authoritative (seat snapshot): `public.poker_seats.stack`.
- Gameplay decisions use `poker_state.state.stacks`; `public.poker_seats.stack` is the persisted snapshot for join/lobby/seat validation and recovery/reconciliation starting state.
- `public.poker_seats.stack` must never be NULL after a successful join.

Stack synchronization is required at lifecycle boundaries:
- successful join
- hand end / settlement
- leave / cash-out

If both stack stores are present, `poker_state.state.stacks` drives gameplay
decisions and `public.poker_seats.stack` must not contradict funds-safety
outcomes. This prevents stranded escrow balances and avoids gameplay issues such
as "stack = 0" with no legal actions.

## Retired HTTP gameplay endpoints

HTTP gameplay endpoints are intentionally retired and return `410 Gone`:
- `/.netlify/functions/poker-join`
- `/.netlify/functions/poker-heartbeat`
- `/.netlify/functions/poker-get-table`
- `/.netlify/functions/poker-start-hand`
- `/.netlify/functions/poker-act`
- `/.netlify/functions/poker-leave`
- `/.netlify/functions/poker-sweep`


## Poker Bots (Phase 1)

Runtime config should be read in code via `process.env.*` (WS server runtime and supporting functions).

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
- Bot/gameplay orchestration runs server-side in WS runtime (no client-side bot scripts).

### Local development

- Local `.env` is supported for development only (gitignored, never committed).
- Deployed environments should use Netlify environment variables.
- Keep naming consistent between docs and code: Netlify environment variables read through `process.env`.

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

### HTTP gameplay endpoint retirement check

Gameplay HTTP endpoints are intentionally non-authoritative and must return `410 Gone`:
- `/.netlify/functions/poker-join`
- `/.netlify/functions/poker-start-hand`
- `/.netlify/functions/poker-act`
- `/.netlify/functions/poker-leave`
- `/.netlify/functions/poker-sweep`

### Optional CSP check (only if client logs show request but server logs are empty)

Run these from Termux (or anywhere) and confirm headers look sane:

```sh
# Poker page CSP (should allow self scripts)
curl -sSI "https://play.kcswh.pl/poker/" | sed -n '1,120p' | grep -iE 'content-security-policy|x-content-type-options|x-frame-options'

# Legacy gameplay endpoint should be retired (410)
curl -sSI "https://play.kcswh.pl/.netlify/functions/poker-leave" | sed -n '1,120p'
```

What you’re looking for:
- CSP should have `script-src 'self' ...` (or no CSP at all).
- If you use nonces/hashes and inline scripts, CSP must allow them; otherwise the poker JS may not run.
- For network calls, CSP uses `connect-src`. It should include `'self'` (or explicitly `https://play.kcswh.pl`).

## WS preview deploy

The preview WS deploy is manual-only and isolated from the production WS workflows.
It targets only the preview host, preview filesystem root, preview service, preview env file, and preview health checks.
It does not manage Caddy.
Repo-side Caddy ownership is unified: `infra/vps/Caddyfile` is the single source of truth for both production and preview WS routing, so any Caddy change for either host must be made in that file.

### Dispatch a preview deploy for a selected ref

Run the workflow from GitHub CLI and pass the target ref explicitly:

```sh
gh workflow run ws-preview-deploy.yml --ref main -f ref=<branch-or-sha>
```

Examples:

```sh
gh workflow run ws-preview-deploy.yml --ref main -f ref=feature/ws-preview-health-fix
gh workflow run ws-preview-deploy.yml --ref main -f ref=3b6f2d4
```

- `--ref main` selects the branch that contains `.github/workflows/ws-preview-deploy.yml`.
- `-f ref=...` is the application ref that the workflow checks out and deploys.
- The workflow remains `workflow_dispatch`-only and is not wired into the existing WS PR or production deploy workflows.
- The workflow does not write `/etc/caddy/Caddyfile`; infra applies Caddy and uses `infra/vps/Caddyfile` for both `ws.kcswh.pl` and `ws-preview.kcswh.pl`.

### Preview runtime contract

The preview VPS contract is:

- Host: `ws-preview.kcswh.pl`
- Base root: `/opt/arcade-ws-preview`
- Active app dir: `/opt/arcade-ws-preview/ws-server`
- Env file: `/opt/arcade-ws-preview/.env.preview`
- Systemd unit: `ws-server-preview.service`
- Local health endpoint: `http://127.0.0.1:3001/healthz`
- Public health endpoint: `https://ws-preview.kcswh.pl/healthz`
- Preview port: `3001`
- Remote upload staging directory: `/tmp/arcadeplatform-ws-preview`
- Optional close grace: `POKER_TABLE_CLOSE_GRACE_MS=60000` keeps newly created empty tables open for 60s before cleanup may close them

Preview deploys unpack into a temporary directory under `/tmp/arcadeplatform-ws-preview` and then sync the extracted files into `/opt/arcade-ws-preview/ws-server`.
The workflow fails fast before mutating preview app contents when the preview base root, app dir, env file, service, Node.js, `tar`, `rsync`, `curl`, or required `PORT=3001`, `WS_AUTHORITATIVE_JOIN_ENABLED=1`, and non-empty `SUPABASE_DB_URL` settings are missing.
Preview routing stays in `infra/vps/Caddyfile`, which must continue to define both the `ws.kcswh.pl -> 127.0.0.1:3000` and `ws-preview.kcswh.pl -> 127.0.0.1:3001` site blocks.

### Preview secrets

Configure these GitHub Actions secrets for preview access only:

- `WS_PREVIEW_HOST`
- `WS_PREVIEW_USER`
- `WS_PREVIEW_SSH_KEY`

These secrets are intentionally separate from the production WS deploy credentials so preview runs cannot mutate production WS resources.


## Post-deploy migration note
Legacy HTTP sweep is retired for gameplay authority. Any stale active gameplay cleanup must run from WS-owned runtime/ops flows, not from `/.netlify/functions/poker-sweep`.
