# Plan: gated automatic VPS reboot

Spec: `specs/vps-maintenance-reboot/spec.md`. Implementation starts only after the OWNER decides D1–D8 and gives a GO. Installation, enabling and clearing are separate `VPS Admin Operation` runs, each approved in `vps-admin`.

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
| `.github/workflows/maintenance-reboot-watch.yml` | Only with D3(a). Hourly on `ubuntu-latest` (a GitHub-hosted runner, never the VPS runner), independent of the window: GET the public WS health and the site. On failure it opens or updates an issue. No secrets beyond `GITHUB_TOKEN`. |

## `run` flow (timer)

Every step runs under the deploy maintenance lock (`/opt/ws-server/.deploy-maintenance.lock`). It is taken first with `flock -n`; if it is busy, the run skips. `enable`, `disable`, `clear` and the boot unit take the same lock.

1. Under the lock, read the config, the state and the boot ID.
2. Run `reconcile` (spec → State machine). A `FAILED` latch → `SKIPPED failed_latch`.
3. If the config is invalid or `ENABLED!=1` → `SKIPPED disabled`; this does not count toward the skip series.
4. `decideStart`:
   - the approved script and gate blob SHAs match the installed files;
   - inside the window;
   - `reboot-required` is present;
   - no other attempt in the last 24 h (unreadable log → skip);
   - no `Runner.Worker` process.
5. Release identity. `readlink -f /opt/ws-server/current` must equal `/opt/ws-server/releases/<sha>/ws-server`, with `<sha>` 40 lowercase hex characters. `release-metadata.json` there must say `<sha>`, and the running WS process directory must be the same. Otherwise skip.
6. Write `PREPARING` (`opId` from `nextOpId`, `<sha>`, `bootIdBefore`, the initial state of both ledger timers and the intent to stop them), then append the reservation line.
7. Ledger (D6):
   - both timers must be active, else return to `IDLE` and skip without changes;
   - stop both and record each stop in the state;
   - both dispatch services must be `inactive`.

   On failure, start again what this run stopped, verify it, then `IDLE` and skip. The runner is not stopped (D8).
8. `prepare <opId>`. Anything other than exit 0 with `PREPARED` → `abort <opId>`:
   - `ABORTED` or `ABORTED not_held` → start this run's units again and verify them, then `IDLE` and `SKIPPED gate_<code>`;
   - anything else → `FAILED abort_<code>`, `ENABLED=0`, alert. The units stay as they are and the state records them.
9. `check` must exit 0 with `RESTART_SAFE`, and the MainPID must equal the one in the marker. Otherwise abort as in step 8.
10. `decideSwitch`:
    - re-read the config (enabled, window, approved SHAs) under the same lock;
    - `reboot-required` is present;
    - this run's own reservation is there and there is no other attempt in 24 h;
    - both ledger services are `inactive` and there is no `Runner.Worker`.

    If it fails, abort as in step 8.
11. Last checks: the cancel file must be absent, `ONE_TIME_UNTIL` (if set) not passed, and the gate blob SHA verified again. Write `SWITCHING`. Call `switching <opId>` (exit 0 and `SWITCH_MARKED`). Write `REBOOTING`. Call `systemctl reboot`.
    - If `switching` fails → `FAILED switching_<code>`.
    - If `systemctl reboot` returns an error → `FAILED reboot_refused`.

    Both cases set `ENABLED=0` and alert.

## `resume` flow (boot)

Runs under the same lock, whatever `ENABLED` says.

1. Run `reconcile`; it handles `PREPARING`, `SWITCHING`, the same boot and `RESUMING`. Continue only for `REBOOTING` (or `RESUMING`) with a new boot ID.
2. Within one 15-minute budget, repeat:
   1. Require the spec's required service list to be active and `/healthz` ok (`ws-server`, `ws-server-preview`, `caddy`, `postgresql`, `docker`, the runner). Verify the gate blob SHA.
   2. Read the gate marker and the hold file, and follow the matching `RESUMING` recovery case in the spec: own marker with or without the hold, neither file, or a foreign marker.
   3. Write `RESUMING` (first time only).
   4. Call `resume <opId> <sha>`.
      - Exit 0 with `RESUMED` → done.
      - `RESUME_BLOCKED not_restarted` → `FAILED pid_reused` (the gate limitation in the spec).
      - Anything else → wait 20 s and repeat from 2.1.
3. Done: write `IDLE`, the `RESUMED` journal line and the follow-up deadline (now + 10 min) in the state, and reset the skip series. Budget used up → `FAILED <reason>`, hold kept, `ENABLED=0`, alert.
4. Follow-up check: a separate oneshot timer (`OnActiveSec=10min`), also reconciled on every timer run, so an interrupted process still runs it. Any required service down → `RESUMED_DEGRADED`, alert.

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
- Release identity: the sha is taken from `/opt/ws-server/releases/<sha>/ws-server` and checked against the metadata; any other path → skip.
- Reconciliation: `PREPARING`/`SWITCHING` on a new boot → `FAILED`; `RESUMING` + `RESUMED not_held` → reconciled; `not_restarted` → `FAILED pid_reused`.
- Unit restore: only the units this run stopped are started again; a ledger timer that was already stopped → skip without changes.
- A fake command runner covers these sequences:
  - `prepare` fails → `abort` with no reboot;
  - `check` fails → `abort`;
  - `ABORT_BLOCKED` → `FAILED`;
  - success → the order is `SWITCHING` written, `switching`, `REBOOTING` written, then a single `reboot` call.

No UI, CSS or broad suites.

## Rollout

1. PR with spec, code and tests: Codex review per `REVIEW.md` (ops rules), CI green.
2. OWNER GO, then the executor update via `stage-vps-admin.sh` (OWNER), then `maintenance-reboot-install` (disabled), then `status`.
3. A reviewed `AGENTS.md` change approved by the OWNER (D7). Then `maintenance-reboot-enable` with a one-time window right after it, watched by the OWNER. Verify `RESUMED`, the services and the external check.
4. `enable` with the D1/D2 window. After the first automatic reboot, report the evidence (journal lines, state, attempt log, service status).

## Rollback

`maintenance-reboot-disable` stops all runs that have not passed `switching`. The units stay inactive; removing them is a later reviewed operation. A hold kept by `FAILED` is lifted only by the OWNER (C7), as for releases.
