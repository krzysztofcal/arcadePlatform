# Plan: gated automatic VPS reboot

Spec: `specs/vps-maintenance-reboot/spec.md`. Implementation starts only after the OWNER decides D1–D7 and gives a GO. Installation, enabling and clearing are separate `VPS Admin Operation` runs, each approved in `vps-admin`.

## Files

| File | Change |
|---|---|
| `infra/vps/maintenance-reboot.mjs` | New. ES module run by `/usr/bin/node`, like `ws-restart-gate.mjs`. Pure exports: `parseConfig`, `decideStart`, `decideSwitch`, `reconcile`, `resumeOutcome`, `nextOpId`, `skipSeries`. Plus `main(run\|resume)`. |
| `infra/vps/arcade-maintenance-reboot.service` / `.timer` | New. Root `Type=oneshot` running `run`. `OnCalendar` is written from the config by the enable operation. |
| `infra/vps/arcade-maintenance-reboot-resume.service` | New. `Type=oneshot`, `After=ws-server.service network-online.target`, `WantedBy=multi-user.target`, running `resume`. |
| `infra/vps/maintenance-reboot.conf.example` | New. `ENABLED=0`, `WINDOW_START`, `WINDOW_END`, `DAYS`. |
| `infra/vps/vps-admin.mjs` | Add `maintenance-reboot-install`, `-enable`, `-disable`, `-clear` and `-status`, reusing the `ws-restart-gate-install` checks (in-progress dispatch on `main`, `main` unchanged, git blob SHA, `node --check`, atomic `rename(2)`). The executor update goes through `infra/vps/stage-vps-admin.sh` (OWNER) after merge. |
| `docs/vps-admin-operations.md` | Catalog rows for the five operations. |
| `ws-tests/maintenance-reboot.behavior.test.mjs` | New fundamental tests (below), alongside `ws-tests/vps-maintenance.behavior.test.mjs`. |
| `docs/vps-maintenance-reboot.md` | Runbook: what it does, how to read `status`, how to disable, what to do on `FAILED` (C7). |
| `.github/workflows/maintenance-reboot-watch.yml` | Only with D3(a). Scheduled 30 minutes after the window end: GET the public WS health and the site. On failure it opens or updates an issue. No secrets beyond `GITHUB_TOKEN`. |

## `run` flow (timer)

1. Read the config. If it is invalid or disabled → `SKIPPED disabled` (does not count toward the skip series).
2. Read the boot ID and state. Run `reconcile`, which may stop with `FAILED` or `IDLE` (spec → State machine). A `FAILED` latch → `SKIPPED failed_latch`.
3. Take the deploy maintenance lock with `flock -n`. If it is busy → skip.
4. `decideStart`:
   - in the window;
   - `reboot-required` present;
   - no attempt in the last 24 h (the attempt log; unreadable → skip);
   - no `Runner.Worker` process.
5. Stop the two ledger dispatch timers (D6). Both services must be `inactive`, otherwise start the timers again and skip.
6. Write `PREPARING` (`opId` from `nextOpId`, release sha from `readlink -f /opt/ws-server/current`, `bootIdBefore`) and append one line to the attempt log.
7. `prepare <opId>`. Anything other than exit 0 with `PREPARED` → `abort <opId>`:
   - `ABORTED` or `ABORTED not_held` → `IDLE`, `SKIPPED gate_<code>`, timers started again;
   - anything else → `FAILED abort_<code>`, alert.
8. `check`. It must print `RESTART_SAFE` with exit 0, and the MainPID must equal the one in the marker. Otherwise abort as in 7.
9. `decideSwitch`: re-read the config (enabled, window), `reboot-required`, both ledger services `inactive`, and no `Runner.Worker`. If it fails, abort as in 7.
10. Write `SWITCHING`, call `switching <opId>` (exit 0 and `SWITCH_MARKED`), write `REBOOTING`, call `systemctl reboot`.
    - If `switching` fails → `FAILED switching_<code>`, alert (abort may no longer apply).
    - If `systemctl reboot` returns an error → `FAILED reboot_refused`, alert.

## `resume` flow (boot)

1. If the stage is not `REBOOTING`, exit 0. If the boot ID equals `bootIdBefore` → `FAILED reboot_not_started`.
2. Within one 15-minute budget:
   - wait until `ws-server` is active, `/healthz` is ok, and `ws-server-preview`, `caddy`, `postgresql` and the runner service are active;
   - then call `resume <opId> <sha>` every 20 s until it exits 0 with `RESUMED`.
3. `RESUMED` → `IDLE` (`RESUMED` journal line, attempt log updated, skip series reset). Budget used up or a service down → `FAILED <reason>`, hold kept, alert.
4. Ten minutes after `RESUMED`, check the services once more. If any is down → `RESUMED_DEGRADED`, alert.

## Tests (fundamental only, per AGENTS.md Testing Policy)

`ws-tests/maintenance-reboot.behavior.test.mjs`, deterministic, with no systemd or network:

- `decideStart` and `decideSwitch`: each blocking condition; the window edges; the 24 h limit; an unreadable attempt log; `activating` ledger services block.
- `reconcile`:
  - `SWITCHING`/`REBOOTING` with the same boot ID → `FAILED`;
  - `PREPARING` → abort path;
  - `REBOOTING` with a new boot ID → resume.
- `resumeOutcome`:
  - `RESUMED`/0 succeeds;
  - `RESUMED not_held` succeeds only in reconciliation;
  - a non-zero exit code, `RESUME_BLOCKED`, empty or unknown output fails.
- `nextOpId` matches `^[1-9][0-9]{0,19}$` and has 20 digits.
- `parseConfig`: malformed values or a window across midnight or overlapping Sunday 03:00–04:30 → disabled.
- `skipSeries`: only qualifying windows count; reset after `RESUMED`.
- A fake command runner covers these sequences:
  - `prepare` fails → `abort` with no reboot;
  - `check` fails → `abort`;
  - `ABORT_BLOCKED` → `FAILED`;
  - success → the order is `SWITCHING` written, `switching`, `REBOOTING` written, then a single `reboot` call.

No UI, CSS or broad suites.

## Rollout

1. PR with spec, code and tests: Codex review per `REVIEW.md` (ops rules), CI green.
2. OWNER GO, then the executor update via `stage-vps-admin.sh` (OWNER), then `maintenance-reboot-install` (disabled), then `status`.
3. D7 approval. `maintenance-reboot-enable` with a one-time window right after it, watched by the OWNER. Verify `RESUMED`, the services and the external check.
4. `enable` with the D1/D2 window. After the first automatic reboot, report the evidence (journal lines, state, attempt log, service status).

## Rollback

`maintenance-reboot-disable` stops all runs that have not passed `switching`. The units stay inactive; removing them is a later reviewed operation. A hold kept by `FAILED` is lifted only by the OWNER (C7), as for releases.
