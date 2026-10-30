# #1159 PR5 / T003 — WWW Production publication separated from merge

Status: Draft. Inert until the separate OWNER GO below; no Netlify setting, deploy or publication was changed while preparing it.

## Read-only audit (2026-10-30, site `playkcswh`)

- Published Production deploy `6ae3785cd7852c1a7f9588b0`, `commit_ref` `0f77574d`, `locked=false`. Live `/js/build-info.js` matches (context `production`, `pokerWsUrl` `wss://ws.kcswh.pl/ws`).
- `stop_builds=false`, no build hooks, no scheduled functions, 56 functions. `allowed_branches` = `main`, `feat/1114-profiles-phase-a`.
- WWW Production lags main by four `[skip netlify]` merges (#1162, #1163, #1166, #1167) with runtime changes (`netlify.toml`, `api-cors.mjs`, `store-upstash.mjs`, `poker/poker-ws-client.js`, `generate-build-info.js`, `shared/netlify-stage-context.cjs`).
- Active WS Production `a63e44b0`, proven by both sources: GitHub deploy evidence, and a read-only VPS read (`copilot`, no sudo) of `current -> /opt/ws-server/releases/a63e44b0…/ws-server`, `release-metadata.json` (`production`/`main`), `.deployed-at` 2026-10-26T12:10:52Z, and `ws-server.service` active since 2026-10-29T16:53:59Z. That restart does not appear in GitHub history, which shows that GitHub evidence alone is insufficient. WS surface equal to live WWW, different from main HEAD.
- `landing-kcswh` (base `/landing`, `stop_builds=true`) is published manually by CLI; Netlify `ignore` does not run for CLI deploys.

## Why Lock alone is not enough (P1)

Every Production deploy, published or not, is reachable at `https://<deployId>--playkcswh.netlify.app`, including `/.netlify/functions/*` and `/api/*`, with Production env. `isOriginAllowed` accepts requests without `Origin`, and `start-session` / `poker-guest-session` need no account; with any Production user token, chips/XP/profile/account functions also run. So an unpublished candidate **can mutate Production** (Redis XP, Supabase) before release. Lock stops publication only, not these side effects.

## Mechanism

1. **No automatic Production builds** (`netlify.toml` `[build] ignore`): a Git build is skipped unless it is a PR (`PULL_REQUEST=true`) or a non-`main` branch; missing metadata skips. PR Previews, stacked Previews and branch deploys keep building. `Stop builds` is not used. Merging no longer needs `[skip netlify]`.
2. **Lock** auto publishing on the current deploy: protects against a candidate or an accidental build being auto-published, including if `ignore` is ever removed.
3. **Candidate on demand**: a Netlify build hook on `main`, known only to OWNER (not in GitHub). Netlify documents that `ignore` never cancels build-hook builds. A candidate therefore exists only for the approved release, minutes before publication. The exposure window is limited to the approved code.
   - **Mandatory discard** of any candidate that is not published (failed checks, aborted or interrupted release): `--discard --deploy <id> --confirm "DISCARD WWW CANDIDATE <id>"`. It refuses a deploy that is published, was ever published, is still building or is not Production. It calls `DELETE /sites/{site}/deploys/{id}` and reports `discarded` only if the API then returns 404 for the deploy **and** its permalink returns 404. Otherwise it reports `discard_unverified`, which is a STOP: the release is not complete and deletion must not be claimed. Netlify documents that deleted deploys disappear from UI/API and their permalinks return 404, and that the most recently published or an in-progress deploy cannot be deleted.
4. **Publish** `scripts/www-production-release.mjs`, run locally by OWNER with their own `NETLIFY_AUTH_TOKEN`, `gh` and read-only SSH target `WS_PROD_SSH`. Dry-run by default; `--execute --confirm "PUBLISH WWW PRODUCTION <sha> <deployId>"`.
5. **No rollback mode** until T004: restoring an older WWW could bring back removed auth/privacy/legal restrictions or mismatch the DB schema. Recovery is roll-forward through the same tool. Emergency UI "Publish deploy" stays a separate, manual OWNER decision outside the tool.

### What the tool verifies (partial, listed in `receipt.checked`)

| Area | Verified | Not verified |
| --- | --- | --- |
| Build context | API: `production`, `main`, `ready`, not PR, `commit_ref == sha`, current `origin/main` HEAD (rechecked before restore) | — |
| Identity | permalink `build-info.js`: SHA, deploy id, context, site URL, WS URL | Supabase/Redis targets of functions at runtime (only the build-time `generate-build-info.js` validation) |
| Functions | set of names equals `netlify/functions` at `sha` | code digests, env values |
| Headers | `/` CSP equals first `_headers` CSP at `sha`; HSTS present | other paths and header rules |
| Redirects | — | not checked |
| WS | VPS `current`/metadata/service and GitHub evidence agree; no unfinished WS run; no diff on the WS artifact surface between the active WS release and `sha`; rechecked before restore | protocol semantics beyond that diff; the process's loaded code beyond "started after installation" |

Smoke is GET-only on static files, because permalink functions use Production env.

### WS evidence (P1)

Publication requires two independent sources to name the same SHA, and fails closed (`ws_release_unproven`) otherwise:

- **VPS (read-only, fixed command, no sudo, no writes):** `readlink -e /opt/ws-server/current` must be `/opt/ws-server/releases/<sha>/ws-server`. `release-metadata.json` must have that `releaseSha`, `environment=production` and `deployRef=main`. `systemctl show ws-server.service` must report `ActiveState=active` with `ExecMainStartTimestamp` not earlier than the release's `.deployed-at`, which proves the running process was started after this release was installed. SSH uses `BatchMode` and `StrictHostKeyChecking=yes`. A missing target or a failed read yields no evidence.
- **GitHub:** across the latest 50 non-PR `WS Server Deploy` runs on `main`, any run that is not completed, or any non-skipped `deploy` job that is queued, waiting, running or not yet started, yields no evidence. Otherwise the most recently started `deploy` job (all attempts) must be `success`.

Both sources are read again immediately before `restore`; a change fails with `ws_release_changed`. Limitation: the service start time does not prove which files the process loaded beyond that ordering. Follow-up (needs a WS runtime change): expose the release SHA in `/healthz`.

### WS artifact surface

The compared paths are read from the package step of `.github/workflows/ws-server-deploy.yml` at both the active WS release and `sha` (union), so no list is duplicated:
- every `cp` source copied into the WS artifact: `ws-server/*`, `shared`, and `netlify/functions/_shared/{chips-ledger,poker-*,supabase-admin,api-cors,store-upstash,xp-ledger}.mjs`;
- `netlify/functions/_generated/deploy-context.mjs`, plus its generator `scripts/generate-build-info.js --server-context-only`;
- the browser client `poker/poker-ws-client.js`.

Packaging that cannot be parsed, or a failed `git show`/`git diff`, fails closed (`ws_surface_unknown`). This is wider than `scripts/ci-impact.mjs::deployPath`, which omits `store-upstash.mjs`, `xp-ledger.mjs` and the generator. Current pair: WS `a63e44b0` and live WWW `0f77574d` are equal on this surface; main HEAD is not.

### Auditable result (P2)

The receipt is always written: `dry_run_pass`, `checks_failed`, `not_published`, `published`, `published_smoke_failed` or `uncertain`. Any error from the `restore` call onwards is `uncertain` and records the observed published deploy and lock. Only `published` exits 0 with `--execute`.

## Limitations / OPEN

- Historical published deploys stay reachable at permalinks with Production env (pre-existing). Visitor access protection for non-production URLs depends on the Netlify plan — OPEN.
- Netlify deploy deletion is irreversible; the tool deletes only unpublished candidates.
- Not documented: whether `restore` keeps the lock (the tool relocks once or fails `uncertain`), and the exact Netlify state of an `ignore`-skipped Production build. Both are measured after GO.
- No merges during a release (the candidate stops being main HEAD).
- Combined WWW+WS ordering, T004 preflight and GitHub Environment remain later scopes.

## Breaking impact

- After merge, main pushes no longer build or change WWW Production. Releases need the hook and the tool; a forgotten release leaves WWW behind main.
- `netlify deploy --prod`, unlock and Stop builds are prohibited for this site (`agents.md`).
- No tool rollback; recovery is roll-forward.

## OWNER GO required (separate, in order)

1. DONE 2026-10-30: locked on `6ae52b31a745a6e69b60b668` (`83c8da88`, published by the #1168 merge; the audited backlog is live); `locked=true`, id unchanged.
2. Merge this PR (squash, empty body; the Netlify marker is optional). Acceptance: the main Production build is skipped by `ignore`, the published deploy is unchanged, and a PR Preview still builds.
3. Create the OWNER-only `main` build hook (Netlify setting).
4. First release: decide WS compatibility first (main HEAD differs on the WS surface: release WS for that SHA through PR4 or wait), trigger the hook, dry-run, then `--execute`. If the release is aborted at any point, discard the candidate and require `discarded` (permalink 404); `discard_unverified` = STOP. Record the receipts and the restore/lock behavior in #1159.

Rollback of the mechanism: revert this PR (Git Production builds resume, still unpublished while locked). Unlock only after confirming the published deploy is the intended one.
