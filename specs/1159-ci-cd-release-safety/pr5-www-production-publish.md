# #1159 PR5 / T003 — WWW Production publication separated from merge

Status: Draft. Inert until the separate OWNER GO below; no Netlify setting, deploy or publication was changed while preparing it.

## Read-only audit (2026-10-30, site `playkcswh`)

- Published Production deploy `6ae3785cd7852c1a7f9588b0`, `commit_ref` `0f77574d`, `locked=false`. Live `/js/build-info.js` matches (context `production`, `pokerWsUrl` `wss://ws.kcswh.pl/ws`).
- `stop_builds=false`, no build hooks, no scheduled functions, 56 functions. `allowed_branches` = `main`, `feat/1114-profiles-phase-a`.
- WWW Production lags main by four `[skip netlify]` merges (#1162, #1163, #1166, #1167) with runtime changes (`netlify.toml`, `api-cors.mjs`, `store-upstash.mjs`, `poker/poker-ws-client.js`, `generate-build-info.js`, `shared/netlify-stage-context.cjs`).
- Active WS Production per GitHub deploy evidence: `a63e44b0`. WS surface equal to live WWW, different from main HEAD.
- `landing-kcswh` (base `/landing`, `stop_builds=true`) is published manually by CLI; Netlify `ignore` does not run for CLI deploys.

## Why Lock alone is not enough (P1)

Every Production deploy, published or not, is reachable at `https://<deployId>--playkcswh.netlify.app`, including `/.netlify/functions/*` and `/api/*`, with Production env. `isOriginAllowed` accepts requests without `Origin`, and `start-session` / `poker-guest-session` need no account; with any Production user token, chips/XP/profile/account functions also run. So an unpublished candidate **can mutate Production** (Redis XP, Supabase) before release. Lock stops publication only, not these side effects.

## Mechanism

1. **No automatic Production builds** (`netlify.toml` `[build] ignore`): a Git build is skipped unless it is a PR (`PULL_REQUEST=true`) or a non-`main` branch; missing metadata skips. PR Previews, stacked Previews and branch deploys keep building. `Stop builds` is not used. Merging no longer needs `[skip netlify]`.
2. **Lock** auto publishing on the current deploy: protects against a candidate or an accidental build being auto-published, including if `ignore` is ever removed.
3. **Candidate on demand**: a Netlify build hook on `main`, known only to OWNER (not in GitHub). Netlify documents that `ignore` never cancels build-hook builds. A candidate therefore exists only for the approved release, minutes before publication. A candidate that is not published is deleted by OWNER. The exposure window is limited to the approved code.
4. **Publish** `scripts/www-production-release.mjs`, run locally by OWNER with their own `NETLIFY_AUTH_TOKEN` and `gh`. Dry-run by default; `--execute --confirm "PUBLISH WWW PRODUCTION <sha> <deployId>"`.
5. **No rollback mode** until T004: restoring an older WWW could bring back removed auth/privacy/legal restrictions or mismatch the DB schema. Recovery is roll-forward through the same tool. Emergency UI "Publish deploy" stays a separate, manual OWNER decision outside the tool.

### What the tool verifies (partial, listed in `receipt.checked`)

| Area | Verified | Not verified |
| --- | --- | --- |
| Build context | API: `production`, `main`, `ready`, not PR, `commit_ref == sha`, current `origin/main` HEAD (rechecked before restore) | — |
| Identity | permalink `build-info.js`: SHA, deploy id, context, site URL, WS URL | Supabase/Redis targets of functions at runtime (only the build-time `generate-build-info.js` validation) |
| Functions | set of names equals `netlify/functions` at `sha` | code digests, env values |
| Headers | `/` CSP equals first `_headers` CSP at `sha`; HSTS present | other paths and header rules |
| Redirects | — | not checked |
| WS | active WS release from evidence; no diff on `ws-server/`, `shared/`, `poker/poker-ws-client.js` | protocol semantics beyond that diff |

Smoke is GET-only on static files, because permalink functions use Production env.

### WS evidence (P1)

The active WS SHA is taken from GitHub, not from operator input: across the latest 50 non-PR `WS Server Deploy` runs on `main` (all attempts), the most recently started, non-skipped `deploy` job must be `completed/success`. A later failed, cancelled or running deploy, or no evidence, fails closed (`ws_release_unproven`). The deploy job health-gates the switch and fails on rollback, so success means it switched. Limitation: out-of-band VPS changes are invisible. Follow-up (needs a WS runtime change and release): expose the release SHA in `/healthz`.

### Auditable result (P2)

The receipt is always written: `dry_run_pass`, `checks_failed`, `not_published`, `published`, `published_smoke_failed` or `uncertain`. Any error from the `restore` call onwards is `uncertain` and records the observed published deploy and lock. Only `published` exits 0 with `--execute`.

## Limitations / OPEN

- Historical published deploys stay reachable at permalinks with Production env (pre-existing). Visitor access protection for non-production URLs depends on the Netlify plan — OPEN.
- Not documented: whether `restore` keeps the lock (the tool relocks once or fails `uncertain`), and the exact Netlify state of an `ignore`-skipped Production build. Both are measured after GO.
- No merges during a release (the candidate stops being main HEAD).
- Combined WWW+WS ordering, T004 preflight and GitHub Environment remain later scopes.

## Breaking impact

- After merge, main pushes no longer build or change WWW Production. Releases need the hook and the tool; a forgotten release leaves WWW behind main.
- `netlify deploy --prod`, unlock and Stop builds are prohibited for this site (`agents.md`).
- No tool rollback; recovery is roll-forward.

## OWNER GO required (separate, in order)

1. Lock auto publishing on `6ae3785cd7852c1a7f9588b0` and verify (`locked=true`, id unchanged).
2. Merge this PR (squash, empty body; the Netlify marker is optional). Acceptance: the main Production build is skipped by `ignore`, the published deploy is unchanged, and a PR Preview still builds.
3. Create the OWNER-only `main` build hook (Netlify setting).
4. First release: decide WS compatibility first (main HEAD differs on the WS surface: release WS for that SHA through PR4 or wait), trigger the hook, dry-run, then `--execute`. Record the receipt and the restore/lock behavior in #1159.

Rollback of the mechanism: revert this PR (Git Production builds resume, still unpublished while locked). Unlock only after confirming the published deploy is the intended one.
