# #1159 PR5 / T003 — WWW Production publication separated from merge

Status: Draft. Code is inert until the separate OWNER GO below; no Netlify setting, deploy or publication was changed while preparing it.

## Read-only audit (2026-10-30, site `playkcswh`)

- Published Production deploy `6ae3785cd7852c1a7f9588b0`, `commit_ref` `0f77574d`, published 2026-10-29T16:53Z, `locked=false`. Live `/js/build-info.js` matches (context `production`, `pokerWsUrl` `wss://ws.kcswh.pl/ws`).
- `stop_builds=false`, `skip_prs=null`, `untrusted_flow=review`, no build hooks, no scheduled functions, 56 functions. `allowed_branches` = `main`, `feat/1114-profiles-phase-a` (branch deploys of that branch use `branch-deploy`/branch-scoped values, never the main URL).
- Merges #1162, #1163, #1166, #1167 used `[skip netlify]`, so WWW Production lags main by four commits. Runtime files among them: `netlify.toml`, `api-cors.mjs`, `store-upstash.mjs`, `poker/poker-ws-client.js`, `generate-build-info.js`, `shared/netlify-stage-context.cjs`. The next merge without the marker would auto-publish all of them today.
- Last successful WS Production deploy recorded by GitHub: `a63e44b0` (2026-10-26). WS surface (`ws-server/`, `shared/`, `poker/poker-ws-client.js`) is identical between `a63e44b0` and live WWW `0f77574d`; main HEAD differs from both.

## Netlify mechanism (official)

- **Lock to stop auto publishing** (Deploys list; API `POST /deploys/{id}/lock`, `POST /deploys/{id}/unlock`): pins the main site to the published deploy. New Production builds still run and end `ready` but unpublished. Unlocking does not auto-publish earlier builds. No documented auto-unlock.
- **Publish deploy** (`POST /sites/{site}/deploys/{id}/restore`): instant atomic switch of static files, functions, headers and redirects of that immutable deploy; no rebuild. Deploy env/functions are those captured at its build.
- Deploy Previews, stacked PR previews and branch deploys never publish to the main site, so the lock does not change them. `Stop builds` is not used: it would also stop Previews.
- Hazard: `netlify deploy --prod` on a locked site interactively offers to **unlock** (netlify-cli 26.2.0 `prepareProductionDeploy`). It is forbidden for this site.
- Not documented, so measured under GO step 2: whether `restore` keeps `locked=true` on the new deploy. The tool handles both outcomes (relocks the target once, then fails closed).

## Design

1. **Pin**: OWNER locks the currently published deploy `6ae3785c` (one API call or UI). Verify `published_deploy.locked=true` and id unchanged.
2. **Candidates**: after the lock is verified, main merges stop using `[skip netlify]` (still never any Actions marker). Every main SHA then gets one immutable, unpublished Production-context deploy; Previews stay automatic.
3. **Publish** `scripts/www-production-release.mjs`, run locally by OWNER with their own `NETLIFY_AUTH_TOKEN` (an account-wide Netlify token is not stored in GitHub):
   - Inputs `--sha`, `--deploy`, `--ws-release`; dry-run by default; `--execute --confirm "PUBLISH WWW PRODUCTION <sha> <deployId>"`.
   - Fails closed unless: site locked; deploy is this site, `production`, `main`, `ready`, not a PR, `commit_ref == sha`; `sha` is the current `origin/main` HEAD (no stale/backlog commits); deploy permalink `build-info.js` has the same SHA/deploy id/context/site URL/WS URL; its function set equals `netlify/functions` at `sha`; `/` CSP equals `_headers` at `sha` and HSTS is present; WS surface has no diff between the deployed WS release and `sha`.
   - Execute: recheck lock and main HEAD, `restore`, require `published_deploy.id == target` and `locked=true` (relock once if Netlify dropped it), then live smoke of `https://play.kcswh.pl/js/build-info.js`. JSON receipt to stdout and `--receipt <file>` (previous/published deploy, SHA, WS release, checks, relocked, live smoke).
   - Env/identity: a `ready` Production deploy already passed `generate-build-info.js` build validation (`XP_REDIS_*` Production target, Stage/Production separation); the permalink identity check proves the context. Functions on the permalink run with Production env, so smoke is GET-only static files.
4. **Rollback**: same tool, `--rollback`, phrase `ROLLBACK WWW PRODUCTION <sha> <deployId>`; target must have been published before and pass every other check (including WS compatibility). Previous deploy id is in the receipt. Emergency fallback: UI "Publish deploy" on that id, then verify lock.

## Limitations / OPEN

- Permalinks of every Production deploy (old and unpublished candidates) are publicly reachable with Production env functions. This already exists for historical deploys; unpublished candidates extend it to merged-but-unreleased code. Options: Netlify non-production protection (plan-dependent) — OPEN.
- WS release SHA is an operator input taken from the WS deploy receipt; automatic lookup is a follow-up. A WS surface diff blocks publication: release WS for that SHA first (PR4 dispatch) or keep WWW.
- Exact-SHA window: a merge between the main-HEAD recheck and `restore` cannot change the published files (the deploy is immutable), but makes the release no longer main HEAD. Operator rule: no merges during a release.
- Lock state is not monitored continuously; the tool and `agents.md` forbid unlock, and every run verifies the lock. Lock/unlock notifications are plan-dependent — OPEN.
- Combined WWW+WS ordering, T004 preflight and GitHub Environment remain later scopes.

## Breaking impact

- After GO step 1, a merge no longer changes WWW Production. Releases need the tool; forgotten releases leave Production behind main (visible in the dry-run receipt).
- `[skip netlify]` merge convention ends after the lock is verified; before that it must stay.
- `netlify deploy --prod` and UI unlock become prohibited for this site.

## OWNER GO required (separate, in order)

1. Lock auto publishing on deploy `6ae3785cd7852c1a7f9588b0` and verify (`locked=true`, id unchanged). Reversible by unlock (would not publish backlog by itself).
2. Merge this PR with `[skip netlify]` and an empty squash body.
3. First release: one main merge without `[skip netlify]` to create a candidate; dry-run, then `--execute` with the exact phrase; WS compatibility decided first (current main differs on the WS surface). Record restore/lock behavior and the receipt in #1159.

Rollback of the mechanism: unlock (only after confirming the published deploy is the intended one, because the next main build would publish), revert this PR, resume the previous merge convention.
