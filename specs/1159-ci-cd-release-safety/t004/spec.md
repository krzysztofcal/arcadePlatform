# #1159 T004 — Spec: one controlled WWW + WS Production release

Status: analysis and plan only (base main `b70102ad`). No workflow, setting, Production or DB change is made by this document.

## Goal

One OWNER-invoked release for an exact `main` SHA that selects WWW and/or WS, refuses on unsafe or unknown state, restarts WS only at a proven quiescent point, publishes WWW through the existing locked-deploy tool, and records one result (receipt plus an optional GitHub Release manifest).

## Current state (verified in code)

### WS deploy (`.github/workflows/ws-server-deploy.yml`, job `deploy`)

- Starts only on an OWNER `workflow_dispatch` from `main` with `releaseSha` equal to the main HEAD and the phrase `DEPLOY WS PRODUCTION <sha>`. Main HEAD is checked twice, the second time in step `Revalidate current main HEAD before release switch`.
- Step `Pre-stage shared deploy/maintenance lock on VPS` acquires `/opt/ws-server/.deploy-maintenance.lock` and releases it when that SSH session ends. It holds nothing across steps.
- Step `Atomic release switch + restart + health gate on VPS` does the real work: it takes `flock -w 300`, extracts and verifies the artifact, runs `arcade-ws-production-env-preflight` (`PASS LIVE Redis V3 prod`), then calls `ln -sfn` → `systemctl restart ws-server.service`, then the local and public `/healthz` (30×1 s). Its ERR trap rolls back to the previous release only if that release is V3/prod, and restarts again.
- **The automatic preflight goes inside that step, after `PROD_PREFLIGHT` and immediately before `ln -sfn "$NEW_RELEASE_APP_DIR"`**, while the flock is held. The rollback restart in the ERR trap is a recovery path and stays ungated (residual risk R5).
- After the trap, the runner WS smoke (`helloAck`) runs, so a smoke failure causes no rollback.
- Today the active-human/escrow preconditions are only an operator attestation (`agents.md`, PR4 spec).

### WS runtime (`ws-server/server.mjs`, `poker/table/table-manager.mjs`, `poker/runtime/`)

- **Signals:** there is no SIGTERM handler. A restart (systemd SIGTERM; unit `infra/vps/ws-server.service`, `Restart=always`) ends the process immediately; there is no drain. `uncaughtException` and `unhandledRejection` call `process.exit(1)`.
- **One mutation chokepoint:** every table mutation goes through `enqueueTableCommand()` (`createTableCommandQueue`, per-table serial promise chain). This covers act, bot_step, turn_timeout, bot_timeout_safety, settled_rollover, join, rebuy, leave, start_hand, the cleanups, inactivity_ejection, continuous-bot materialize/retirement, account_delete_privacy and admin bot-claims recovery.
  - Paths outside that queue: `runGiftWork()` (gift ledger BURN, per-table chain `giftWorkByTable`), the internal HTTP POSTs (`/internal/admin/*`, `/internal/lobby/materialize-table`), and the timers `actionHistoryCleanup.sweep()` / `closedTableCleanup.sweep()`.
- **Human action persistence:**
  - `poker/handlers/act.mjs::handleActCommand` does `tableManager.applyAction()` in memory, then `persistMutatedState()` (CAS `poker_state.version` plus a durable `poker_requests` row), and acknowledges only after commit.
  - A failure restores the table from the DB.
  - An acknowledged human action is therefore durable; an unacknowledged one may be lost and the client retries via `requestId`.
- **Bot steps, timeouts and rollover:** the in-memory change comes first, then the CAS persist. If the process dies between them, the change is not durable; the next load returns the last committed version.
  - Financial effects (replacement funding, top-ups, human stack projection, cash-outs) are posted inside the same DB transaction as the state write (`persisted-state-writer.mjs::writeMutation`).
- **Lost on restart (memory only):**
  - sessions (`session-store.mjs`), the stream replay log, presence and connections, and the non-durable replay cache;
  - bot reaction and reveal timers, rollover timers, access and policy caches;
  - process-local admin overrides, reaction cooldowns.
  - Tables reload lazily from the DB (`persisted-bootstrap-adapter.mjs`), and presence is rebuilt as disconnected.
- **Live private hand state:** `persisted-state-writer.mjs` strips `deck` and `holeCardsByUserId` from `poker_state`. Hole cards go to `poker_hole_cards`; the remaining deck is not stored.
  - On reload, a live hand is rebuilt by `poker/shared/runtime-hand-state.mjs::deriveDeterministicRuntimeHandState()`, and `live_hand_runtime_unrecoverable` is raised only in one narrow case.
  - This recovery is not proven complete for every live-hand state, and the OPEN engine work R1 may change it.
- **Existing evidence:** `tableManager.hasActiveHumanMember()`, `hasConnectedHumanPresence()`, `persistedPokerState()`, the GET `/internal/admin/poker-maintenance` status, `shared/poker-domain/terminal-close.mjs` (claims against escrow), and the DB rows `poker_seats` (ACTIVE, `is_bot=false`), `poker_requests` (pending `result_json`) and `chips_accounts` (escrow `POKER_TABLE:<id>`).
- **Other writers:**
  - `Chips Ledger Production Automation` is dispatched by the VPS timer and runs on GitHub. It does not use the deploy lock.
  - Netlify `poker-create-table` / `poker-quick-seat` and the admin functions write the DB independently of WS.

## Restart safety verdict (point 4)

**STOP: no restart while any table holds a live hand.** The current architecture does not prove a safe restart during a live hand, bot-only tables included:

- the remaining deck is not stored privately;
- recovery depends on deterministic re-derivation, not on stored private state;
- in-memory work that is accepted but not persisted is lost;
- `/healthz` (static `ok`) and a correct escrow balance do not prove any of this.

**Allowed only at a proven boundary**, all verified by the WS process itself after it has stopped new work:

- zero ACTIVE human seats in the DB on any OPEN table, and zero connected humans (the existing rule; humans are not drained);
- every loaded table outside PREFLOP/FLOP/TURN/RIVER/SHOWDOWN;
- no queued or running table command, gift work or internal mutation;
- no pending `poker_requests`;
- escrow equal to the table claims for every OPEN table, and zero escrow for every CLOSED table;
- the Production schema version set equal to the set expected at the SHA.

Bot-only tables are drained to the boundary. "No humans" does not skip any check.

The current crash and auto-restart behavior (OOM, VPS reboot) during a live hand stays an open risk outside T004 (R1). It is a separate product/engine decision.

## Requirements

1. **R-DRAIN:** an inert WS "release drain" with phases `idle → draining → frozen`.
   - Draining blocks new work: joins, rebuys, start_hand, settled_rollover (and so the next hand), gifts, materialize/admin/deletion commands and internal POSTs. It keeps act, bot_step, the turn/bot timeouts, leave and the disconnect cleanups so the current hands finish.
   - Frozen blocks every command and waits until in-flight work reaches 0.
   - Bounded: the drain deadline defaults to 120 s (maximum 300 s); expiry while draining returns to idle (drain failed). Frozen never expires and never reopens by itself: only an explicit `cancel` on the pre-switch failure path, or the restart, ends it. Unknown commands are blocked (fail closed).
2. **R-READY:** a read-only readiness report covering all boundary items above, built in one read-only DB transaction plus runtime state. Missing evidence means not ready.
   - It also covers writers outside the WS process (Netlify functions, the chips-ledger automation, manual SQL): DB state versions equal to memory, no ledger/seat/request rows after the freeze, and an unchanged ledger watermark across two readings.
   - It also covers the rollback-restart path: the rollback restart runs only when the WS service is not active or a fresh gate is ready; otherwise the restart is blocked for an OWNER decision.
3. **R-GATE:** the WS deploy calls the gate after the env preflight and before the switch.
   - Any failure means `cancel` and nothing switched.
   - The schema set expected at the SHA is computed on the runner from `supabase/production-migrations/manifest.json` (`baseline_applied`) plus the `supabase/production-migrations/*.sql` versions.
   - No Production secret leaves the VPS.
4. **R-ENTRY:** one local OWNER CLI that builds the plan and executes it.
   - **Plan:** exact current main SHA; required checks on the SHA; component selection (WS = packaged WS surface changed against the active WS; WWW = any WWW-relevant change against the published WWW); schema readiness; locks; no unfinished WS, WWW or chips-ledger Production runs.
   - **Execute** with one phrase `RELEASE PRODUCTION <sha> WS=<on|off> WWW=<on|off>`:
     1. WS through the existing dispatch (OWNER `gh`), wait, then verify VPS plus GitHub evidence;
     2. WWW through the build hook plus the existing `www-production-release.mjs` checks, publish, or discard on abort.
   - **Order:** WS first, then WWW; WWW then requires WS equal to the SHA (existing check).
   - **Result:** one receipt.
5. **R-RECORD:** after success, a GitHub Release at tag `prod-<UTC yyyymmddHHMM>`, pointing at the SHA, with a `release-manifest.json` containing:
   - the SHA and per-component action (released/unchanged) with versions: the Netlify deploy ID, the WS release SHA plus the artifact SHA-256, Android `not part of this process`;
   - the schema fingerprint, check runs, receipts and outcome.
   - It holds no binaries, no secrets and no Stage data. A release or tag never triggers any workflow.
6. **R-ROLLBACK (later PR):** a compatible return only to the previously recorded release, with the same gate, the same schema set and no newer auth/privacy restriction. Never a schema rollback. Until that PR: roll-forward, plus the existing V3-only automatic WS rollback on a failed health check.

## Out of scope

- Crash-safe live hands (separate engine scope);
- T005/T006, Android/Play;
- a GitHub Environment `ws-production` (still OPEN);
- a WS `/healthz` release SHA (follow-up).

## Breaking impact

- **During a WS release (≤ 5 min):** new joins/rebuys/gifts/hands are rejected with `release_drain_active`; current bot hands finish; then all sockets drop and clients reconnect.
- **The WS deploy fails closed** until the root gate helper is installed (admin action). WS releases stop entirely until then.
- **A blocked rollback** leaves an unhealthy new release running until the OWNER decides; a frozen process without its runner stays paused until `release-gate cancel`.
- **A release is refused** while any human is seated or connected. This is the existing rule, now enforced.
- **The WWW CLI entry moves** to the new orchestrator; `www-production-release.mjs` stays a library.
