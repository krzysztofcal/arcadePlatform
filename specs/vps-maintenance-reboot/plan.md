# Plan: gated automatic VPS reboot

Spec: `specs/vps-maintenance-reboot/spec.md`. Implementation starts only after the OWNER decides D1–D4 and gives a GO. Installation and enabling are separate `VPS Admin Operation` runs, each approved in `vps-admin`.

## Files

| File | Change |
|---|---|
| `infra/vps/maintenance-reboot.mjs` | New. ES module run by `/usr/bin/node`, like `ws-restart-gate.mjs`. Exports `decideReboot(facts)`, `parseConfig(text)` and `resumeOutcome(lines)`; `main(mode)` for `run` and `resume`. |
| `infra/vps/arcade-maintenance-reboot.service` / `.timer` | New. Root `Type=oneshot` running `run`; timer at `WINDOW_START` (D1), `Persistent=false`. |
| `infra/vps/arcade-maintenance-reboot-resume.service` | New. `Type=oneshot`, `After=ws-server.service network-online.target`, `WantedBy=multi-user.target`, running `resume`. |
| `infra/vps/maintenance-reboot.conf.example` | New. `ENABLED=0`, `WINDOW_START`, `WINDOW_END`, `DAYS`. |
| `infra/vps/vps-admin.mjs` (executor, installed as `/usr/local/sbin/arcade-vps-admin`) | Add `maintenance-reboot-install`, `-enable`, `-disable`, `-status`. Reuse the `ws-restart-gate-install` checks: in-progress dispatch on `main`, `main` unchanged, git blob SHA, `node --check`, atomic `rename(2)`. |
| `docs/vps-admin-operations.md` | Catalog rows for the four operations. |
| `ws-tests/maintenance-reboot.behavior.test.mjs` | New fundamental tests (below). |
| `docs/vps-maintenance-reboot.md` | Short runbook: what it does, how to read the status, how to disable, and what to do on `FAILED`. |

## `run` flow (`main("run")`)

1. Read the config (`parseConfig`). If it is invalid or `ENABLED!=1`, write `SKIPPED disabled`.
2. Collect the facts:
   - the UTC time;
   - whether `/var/run/reboot-required` exists;
   - the last reboot time from the state file;
   - the deploy lock, tried with a non-blocking `flock -n` on `/opt/ws-server/.deploy-maintenance.lock`;
   - `systemctl is-active` for both ledger dispatch services;
   - `pgrep -x Runner.Worker`;
   - the state file stage.
3. `decideReboot(facts)`. On `skip:<reason>`, write `SKIPPED <reason>` and exit 0.
4. Keep the lock fd open:
   1. write the state `PREPARING runId sha`;
   2. run `arcade-ws-restart-gate prepare <runId>`. If the output is not exactly `PREPARED`, run `abort <runId>` and write `SKIPPED gate_<code>`;
   3. run `switching <runId>`. If that fails, run `abort` and write `SKIPPED switching_<code>`;
   4. write `REBOOTING runId sha` with `fsync`, then call `systemctl reboot`.

## `resume` flow (`main("resume")`, at boot)

1. If the state is not `REBOOTING`, exit 0 without doing anything.
2. Poll for up to 15 minutes: `ws-server` active and `http://127.0.0.1:3000/healthz` ok.
3. Run `arcade-ws-restart-gate resume <runId> <sha>`. `resumeOutcome` accepts only `RESUMED`.
4. Run `systemctl is-active` for `ws-server-preview`, `caddy`, `postgresql` and the runner service.
5. Write `RESUMED` and the boot time, or `FAILED <reason>`. On `FAILED` the hold stays (C7) and the D3 alert is sent.

## Tests (fundamental only, per AGENTS.md Testing Policy)

`ws-tests/maintenance-reboot.behavior.test.mjs`, deterministic, with no systemd or network:

- `decideReboot`:
  - each skip reason, in priority order;
  - the window across midnight;
  - the 24 h limit;
  - `proceed` only when every condition holds.
- `parseConfig`: a malformed value disables the feature, and `ENABLED` defaults to 0.
- `resumeOutcome`: only `RESUMED` succeeds; `RESUME_BLOCKED …` and empty or unknown output fail.
- The command sequence on a fake runner:
  - `prepare` fails → `abort` and no reboot;
  - `switching` fails → `abort` and no reboot;
  - success → `reboot` is called once, after the `REBOOTING` state is written.

No UI, CSS or broad suites.

## Rollout

1. PR with spec, code and tests: Codex review per `REVIEW.md` (ops/runbook rules), CI green.
2. OWNER GO, then `maintenance-reboot-install` (disabled) and `maintenance-reboot-status`.
3. First reboot by hand, with the OWNER watching: `maintenance-reboot-enable` with a one-time window right after the GO, then verify `RESUMED` and the services.
4. Leave it enabled with the D1/D2 window. After the first automatic reboot, report the evidence (journal lines, state, service status).

## Rollback

`maintenance-reboot-disable` stops all decisions at once. The units and the script stay inactive. Removal is a later reviewed operation. A hold left by a `FAILED` resume is lifted only by the OWNER (C7), as for releases.
