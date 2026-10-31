# #1159 T004 — Plan

Reuse first. There is no new service, framework or workflow. Five small PRs; each is inert until the next one uses it.

## Design decisions

- **Gate channel: a root helper, as with the env preflight.** `copilot` cannot read `/etc/arcadeplatform/ws-server.env` (root 0600) and cannot signal the `arcade` process. A fixed root helper reads `POKER_WS_INTERNAL_TOKEN` and calls `127.0.0.1:3000/internal/admin/release-drain`, the same auth model as the existing `/internal/admin/*` routes. It prints sanitized JSON and is called through `sudo -n` with fixed arguments.
  - Rejected: a token copy as a GitHub secret (repository-level exposure, OPEN in PR4).
  - Rejected: a file request plus a journal status (`copilot` journal access unverified).
- **Readiness is computed by WS.** It already holds the runtime state, the DB client and the escrow/claim logic, so the helper adds no SQL.
- **Drain to the hand boundary, not resumption of a live hand.** This avoids depending on private-state recovery (spec STOP).
- **Freeze before restart.** It closes the window between the last check and SIGTERM. A SIGTERM handler is not needed for planned restarts (YAGNI).
- **The schema fingerprint** is sha256 over the sorted versions joined by newlines, plus the count. Expected: the manifest `baseline_applied` versions ∪ the `supabase/production-migrations/*.sql` versions at the SHA. Actual: `supabase_migrations.schema_migrations`. Equality is required.
- **The manifest is a GitHub Release** with one JSON asset. WWW = Netlify deploy ID (not a ZIP); WS = release SHA plus the `ws-server-dist.tgz` SHA-256 (not uploaded).
  - Verify before relying on it: Releases/immutable releases availability and a `prod-*` tag ruleset (settings GO).
  - There are 0 releases and 0 tags today, and no workflow triggers on `release`, `create` or tags.

## PR T004-1: WS release drain (runtime, inert) — about 250 LOC

**New file:** `ws-server/poker/runtime/release-drain.mjs::createReleaseDrain({ maxMs = 120000, hardMaxMs = 300000, nowMs })`

| Method | Behavior |
| --- | --- |
| `begin({ requestId, deadlineMs })` | Starts draining with a clamped deadline. |
| `freeze()` | Moves to frozen. |
| `cancel()` | Returns to idle. It is the only way to reopen a frozen process. |
| `phase(now)` | Reports the phase. Past the deadline, only `draining` returns to idle (drain failed). `frozen` never expires: it ends only with an explicit `cancel` or the process restart. |
| `blocksCommand(commandName, now)` | While draining, allows only `act`, `bot_step`, `turn_timeout`, `bot_timeout_safety`, `leave`, `guest_leave`, `disconnect_cleanup` and `guest_disconnect_cleanup`; anything else, unknown names included, is blocked. While frozen, everything is blocked. |
| `blocksWork(now)` | Blocks gifts, internal POSTs and cleanup sweeps. |

**Other files:**
- `ws-server/poker/runtime/table-command-queue.mjs`: add `pendingCount()` (sum of `pendingCount` across the queue states).
- `ws-server/server.mjs`:
  - `enqueueTableCommand()` throws `release_drain_active` when `blocksCommand` is true;
  - `runGiftWork()` rejects with `release_drain_active`;
  - `handleHttpRequest()`: internal POSTs (except the drain route) answer 503 `release_drain_active`;
  - the action-history/closed-table sweep is skipped while draining;
  - new route `/internal/admin/release-drain`, GET for status, POST `{operation: begin|freeze|cancel, requestId}`, with the same token check as `handleInternalPokerMaintenance`;
  - status `{ phase, deadlineMs, frozenAt, inFlight: { tableCommands, giftWork }, loadedTables, liveHandTables, connectedHumans, persistedVersions }` (`persistedVersions`: the in-memory `persistedStateVersion` per loaded table, used by the T004-2 external-write check).
- **Client:** `poker/poker-ws-client.js` needs no change; a rejected command already shows a generic reason. Release-time UX is accepted as breaking impact.

**Tests:**
- new `ws-server/poker/runtime/release-drain.behavior.test.mjs` (allowlist, unknown command blocked, frozen blocks all, deadline clamp, draining expiry, frozen does not expire, cancel);
- extend `table-command-queue.behavior.test.mjs` (`pendingCount` across tables and after a rejection); this test is not run by any workflow today;
- register both in `ws-server-deploy.yml` `validate` and `ws-pr-checks.yml`, next to the existing `conn-state` step.

**Exit:** CI green, plus an exact-SHA WS Preview check:
- begin, then bot tables stop at SETTLED with no new hand;
- freeze, then wait past the deadline: still frozen, no command accepted;
- cancel resumes them;
- a freeze followed by a Preview restart resumes the bot tables, and a seated human after the restart keeps seat and stack.

## PR T004-2: read-only readiness report — about 250 LOC

**New file:** `ws-server/poker/persistence/release-readiness.mjs::readReleaseReadiness({ beginSql, loadedStates })`, run in one `begin read only` transaction:
- `activeHumanSeats`: OPEN tables with an ACTIVE seat and `is_bot=false`;
- `pendingRequests`: `poker_requests` with a null `result_json`;
- `escrowMismatches`:
  - OPEN tables whose `POKER_TABLE:<id>` balance differs from the claims of the persisted boundary state; the claims projection reuses `shared/poker-domain/terminal-close.mjs`, exporting the existing helper without a copy;
  - CLOSED tables with escrow different from 0;
- `schemaFingerprint` and `schemaCount`;
- `externalWrites` (writers outside this process: Netlify `poker-create-table` / `poker-quick-seat` / admin functions, the chips-ledger automation, manual SQL):
  - `poker_state.version` of every loaded table equals the in-memory `persistedStateVersion`, and there is no OPEN table with an ACTIVE seat that is not loaded;
  - no `chips_transactions` row, `poker_seats` change or `poker_requests` row created after `frozenAt`;
  - `ledgerWatermark`: the max `chips_transactions` id plus the per-table versions, so that the gate can compare two readings.

Any query error returns `{ ok: false, reason }`. No writes.

**Changes:**
- `server.mjs` drain GET adds `readiness`;
- `ready = phase === "frozen" && every in-flight count is 0 && liveHandTables === 0 && connectedHumans === 0 && readiness.ok && activeHumanSeats === 0 && pendingRequests === 0 && escrowMismatches === 0 && externalWrites === 0`.

**Tests:** new `release-readiness.behavior.test.mjs` with the existing fake-SQL pattern (`persisted-bootstrap-db.mjs`): mismatch, CLOSED non-zero, pending request, DB version ahead of memory, ledger row after `frozenAt`, query failure means not ready, fingerprint order independence.

**Exit:** CI plus a WS Preview readout (no Production read).

## PR T004-3: VPS gate in the WS deploy — about 250 LOC

**New helper:** `infra/vps/ws-production-release-gate.mjs`, modelled on `ws-production-env-preflight.mjs` (`protectedRead`, `parseEnv`, `sanitizeOutput` reused by import):
- `status`: read-only;
- `drain`: begin, poll until boundary or deadline, freeze, then read readiness twice (a few seconds apart) and require an unchanged `ledgerWatermark`;
- `cancel`.

Output is a single JSON line; exit 0 only if ready.

**Infrastructure:** `infra/vps/arcade-deploy.sudoers` gets three exact lines; `infra/vps/bootstrap.sh` installs the helper as root 0755.

**Changes in `ws-server-deploy.yml`:**
- in the package step, `sha256sum` of the artifact goes to the summary;
- a runner step computes `EXPECTED_SCHEMA_FINGERPRINT` with `scripts/production-schema-fingerprint.mjs` (about 30 LOC, a pure function plus a CLI);
- the revalidate step also refuses a queued or in-progress `Chips Ledger Production Automation` run (`actions: read`);
- in the remote script, after `PROD_PREFLIGHT`: `GATE="$(sudo -n …release-gate drain)"`. Require `ready:true` and a matching fingerprint; otherwise call `…release-gate cancel` and exit before `ln -sfn` (a trap is set before the switch and cleared after `HAVE_SWITCHED=1`). After a successful gate nothing calls `cancel`: the frozen process is ended only by the restart.
- **Rollback-restart path (ERR trap after the switch):** the new process starts unfrozen, so it may already have started hands when its health check fails. The rollback restart runs only when one of these holds:
  - `systemctl is-active ws-server.service` is not `active` (no live process memory to lose; DB recovery as after a crash);
  - `release-gate drain` against the new process returns `ready:true` with the same schema fingerprint.
  Otherwise the trap does not restart. It leaves the new release running, prints `ROLLBACK_BLOCKED` with the gate JSON and fails the job for an OWNER decision. A runner smoke failure still causes no rollback.

**Tests:**
- extend `ws-tests/ws-server-deploy.workflow.guard.test.mjs`: gate after the env preflight and before `ln -sfn`, cancel only on the pre-switch failure path, no cancel after a ready gate, the rollback restart guarded by `is-active` or a ready gate, the fingerprint passed through env;
- new `ws-tests/ws-production-release-gate.behavior.test.mjs`: fake HTTP for ready / not ready / timeout / missing token; sanitized output.

**Breaking:** until the root install, deploys fail closed. Activation is a separate admin GO (install plus sudoers), followed by a `status` check.

## PR T004-4: single operator entrypoint — about 300 LOC

**New file:** `scripts/production-release.mjs` (OWNER local, dry-run by default). Reused from `www-production-release.mjs`: `activeWsRelease`, `githubWsRelease`, `vpsWsRelease`, `wsSurfaceChanged`, `netlifyApi`, `candidateFailures`, `headerFailures`, `publishLocked`, `discardCandidate`, `phrase`.

**Functions:**

| Function | Purpose |
| --- | --- |
| `planRelease({ sha, mainHead, checkRuns, activeWs, publishedWww, diff })` | Pure; returns `{ ws, www, failures }`. |
| `requiredCheckFailures(checkRuns, plan)` | Pure: every run on the SHA completed success/skipped/neutral; `validate` present when WS is selected. |
| `releasePhrase(plan)` | Builds the confirmation phrase. |
| `dispatchWs()` | `gh workflow run … -f releaseSha -f confirmation`, then waits on the exact run (bounded 30 min). |
| `triggerWwwCandidate()` | Takes the OWNER build hook URL from env; waits for a ready Production deploy with `commit_ref == sha` (bounded 15 min). |
| `writeReceipt()` | Writes the combined receipt. |

**Rules:**
- WWW selection is conservative: selected unless the diff lies only under `ws-server/**`, `ws-tests/**`, `specs/**`, `docs/**`, `infra/**`, `.github/**` or `mobile/**`;
- when WS is selected and WWW is not, the browser WS client must not have changed since the published WWW, otherwise both are required;
- the schema check runs `release-gate status` over SSH (read-only).

**Other changes:**
- in `www-production-release.mjs`, remove only its CLI main (keep the exports; there is one entrypoint);
- update `agents.md` and the PR5 spec reference.

**Tests:** new `tests/production-release.test.mjs` (selection matrix, browser-client coupling, check failures, the phrase, the WS→WWW order, discard on WWW abort after WS success = partial, recorded); keep the existing `tests/www-production-release.test.mjs`.

## PR T004-5: release record — about 120 LOC

**Changes:**
- in `production-release.mjs`, `--record` runs only after a `published`/`deployed` outcome: `gh release create prod-<ts> --target <sha> --notes-file … release-manifest.json`;
- add a guard to the existing workflow guard test: no workflow has a `release`, `create` or `push.tags` trigger.

**Tests:** manifest shape, no secret fields.

**Settings GO:** a `prod-*` tag ruleset and immutable releases, if available.

## Later, separately: rollback

Only after T004-5. Add a WS `rollbackToRelease` dispatch input (existing release directory, V3/prod, schema fingerprint unchanged, same gate) and a WWW publish of the previously recorded deploy with the same checks. A newer auth/privacy policy or a schema change means roll-forward only.

## Risks

- **R1** Crash/OOM/reboot during a live hand: not addressed (separate engine scope).
- **R2** Every activation step needs an admin root install.
- **R3** The chips-ledger dispatcher can dispatch after the check. Mitigated by the run guard plus the `externalWrites` check and the second `ledgerWatermark` reading; a write between the last reading and the restart remains possible and is transactional.
- **R4** Netlify `poker-create-table` / `poker-quick-seat` / admin functions are not drained. They are detected (not blocked) by `externalWrites`; the operator rule forbids admin operations during a release.
- **R5** The rollback restart is gated (`is-active` or a ready gate). When blocked, the unhealthy new release keeps running until the OWNER decides: this is a deliberate fail-closed choice that can extend an outage.
- **R8** A frozen process that loses its runner (cancelled job, SSH drop) stays frozen until `release-gate cancel` or a restart. Breaking impact: the tables stay paused; the operator command is documented in `agents.md`.
- **R6** The 300 s maximum flock wait plus the drain window extends PR4's merge-during-release window; the operator rule stays.
- **R7** Protocol compatibility between the old WWW client and the new WS for a few minutes is attested, not proven; mitigated by the WS→WWW order and the browser-client coupling rule.
