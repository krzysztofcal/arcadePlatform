# Feature Specification: Gated automatic reboot of the VPS in a maintenance window

**Branch**: `docs/vps-maintenance-reboot-spec` · **Created**: 2026-11-27 · **Status**: draft for OWNER decision (D1–D8)
**Scope**: the Production VPS (Hetzner, Ubuntu 24.04). It runs WS Production, WS Preview, Caddy, PostgreSQL, Docker, the GitHub Actions runner and the ledger dispatch timers. No application, Netlify, DB schema or WWW change.

## Evidence (2026-11-27, read-only)

- `/var/run/reboot-required` has existed since 2026-11-26. Its package list contains `libc6`, `linux-base` and 18 newer kernel images.
- The running kernel is `6.8.0-101-generic`; the installed one is `6.8.0-151-generic`. Uptime is 274 days.
- `unattended-upgrades` is enabled and installs security updates. `Unattended-Upgrade::Automatic-Reboot` is not set, so installed kernel and libc fixes never take effect.
- All services needed after a boot are `enabled`:
  - `ws-server` and `ws-server-preview`, both with `Restart=always`;
  - `caddy`, `postgresql`, `docker` and the GitHub Actions runner;
  - `ssh.socket`;
  - the timers `arcade-chips-ledger-dispatch`, `arcade-chips-ledger-production-dispatch` and `arcadeplatform-vps-maintenance` (Sunday 03:30 UTC; prunes WS releases and temp directories, runs as `arcade`, cannot reboot).
- A reboot is not in the `VPS Admin Operation` catalog (`docs/vps-admin-operations.md`). Today only the OWNER can reboot, by hand.
- WS Production keeps game state in memory. Its restart gate (`infra/vps/ws-restart-gate.mjs`, installed as `/usr/local/sbin/arcade-ws-restart-gate`) provides these commands:
  - `check`: prints `RESTART_SAFE` only when hold and drain are active, the queue is idle, money is verified, and `humanSeatsOpen=0` and `closedWithEscrow=0`.
  - `prepare <opId>`: holds new hands, waits up to 10 min for running hands, drains, waits up to 2 min for `RESTART_SAFE`, and prints `PREPARED`. On a stop it removes its own hold. If the WS process changes while it waits, it prints `…_process_changed,hold_kept`.
  - `switching <opId>`: checks only the owner, the unchanged PID and `drain`, then marks the point of no return. **It does not re-check presence or money.**
  - `resume <opId> <sha>`: lifts the hold only after a marked switch and a restart into `releases/<sha>`, with `/healthz` ok and `RESTART_SAFE`. It prints `RESUMED`, or `RESUMED not_held` when no marker or hold exists.
  - `abort <opId>`: works before the switch only, while the prepared PID still runs. It prints `ABORTED`, `ABORTED not_held` or `ABORT_BLOCKED <reason>`.
  - `opId` must match `^[1-9][0-9]{0,19}$`. Releases use GitHub run IDs, currently 11 digits.
- The hold file `/etc/arcadeplatform/ws-hold/new-hands` and its marker are on disk, so they survive a reboot.
- Releases and the weekly maintenance serialize on `/opt/ws-server/.deploy-maintenance.lock` (`flock`).

## User stories

### US1: Kernel and libc fixes take effect without the OWNER doing it by hand (P1)
**Acceptance**
1. No reboot happens while `/var/run/reboot-required` is absent.
2. A reboot happens only inside the configured window.
3. At most one reboot **attempt** per 24 hours, whatever its outcome, and also when `reboot-required` is still present after the boot.

### US2: Nobody loses a hand or money (P1)
**Acceptance**
1. The point of no return (`switching`) is passed only after all of these, in this order:
   1. `prepare` printed `PREPARED`;
   2. a fresh `check` printed `RESTART_SAFE` and the WS MainPID is unchanged;
   3. window, enabled flag, `reboot-required`, the attempt limit, ledger idleness and runner idleness were re-checked.

   If anything fails before `switching`, the run aborts.
2. After `switching`, the host is rebooted at once, with no further waits.
3. While the reboot is in progress, the hold stays on disk, so the restarted WS starts no new hands until `resume` succeeds.

### US3: The system comes back, or the OWNER knows that it did not (P1)
**Acceptance**
1. Resume happens only after a **new boot**: the kernel `boot_id` differs from the one recorded before `switching`.
2. Before every `resume` attempt, within one 15-minute budget, the **required service list** must be active, with `/healthz` ok:
   - `ws-server`;
   - `ws-server-preview`, `caddy`, `postgresql`, `docker`;
   - the runner service.

   The follow-up check uses the same list.

   Then `resume` is retried within the same budget until it prints `RESUMED` with exit code 0.
3. If the budget runs out or a service is down, the state becomes `FAILED`, the hold stays (C7) and an alert is sent.
4. A service failure seen after a successful `RESUMED` is recorded as `RESUMED_DEGRADED` with an alert. The hold is not put back.
5. If the host never comes back, an **external** check alerts the OWNER (D3).

### US4: Other work is not cut off (P2)
**Acceptance**
1. Ledger dispatch: before `prepare`, both dispatch timers are stopped (D6) and both dispatch services must be `inactive` (any other state, including `activating`, blocks). The idleness is re-checked before `switching`.
   - On any skip, the timers are started again.
   - After the reboot they start by themselves, because they are `enabled`.
2. Runner: there must be no `Runner.Worker` process at the start and again right before `switching`. The runner service is **not** stopped: the self-hosted runner has no verified way to refuse new jobs without cancelling an assigned one. A job assigned in the seconds between the last check and the reboot can therefore be interrupted. GitHub marks it failed and it can be re-run. This residual risk is decision D8.
3. One lock covers every step that reads or changes the operation state: timer runs, the boot unit, `enable`, `disable` and `clear`. It is the deploy maintenance lock, which releases and the weekly maintenance also take. It is taken before the state is read and held until the result is written, or until `systemctl reboot` is called. `disable` therefore either cancels a run that has not reached `switching`, or reports that the run is past the point of no return.
4. WS Preview may be hard-restarted. The repository accepts hard-kick restarts of Stage/WS Preview.

### US5: The OWNER can turn it off at once (P1)
**Acceptance**
1. The feature is off after installation.
2. Enabling it, disabling it and clearing a `FAILED` latch are separate `VPS Admin Operation` entries.
3. `disable` first writes a cancel file, `/etc/arcadeplatform/maintenance-reboot.cancel`, atomically and without waiting for the lock. Then it sets `ENABLED=0` under the lock.
   - A running attempt checks the cancel file as the very last step before writing `SWITCHING`, and aborts if it is there.
   - `disable` reports `cancelled` or `past_point_of_no_return`, by reading the state once it gets the lock.
   - After `switching`, the reboot can no longer be cancelled.
4. After `FAILED`, no further attempt runs until the OWNER clears the latch.

## State machine

The state file is `/var/lib/arcadeplatform/maintenance-reboot/state` (root, written atomically with `fsync`). It holds `{ stage, opId, releaseSha, bootIdBefore, startedAt, reason }`.

The attempt log is a separate append-only file, `.../attempts`. Before `prepare` it gets one reservation line per attempt (`opId`, time, boot ID). The 24 h limit counts the other lines; before `switching` the script also confirms its own reservation is there. Results go to the state file and the journal, never as a second line. Plain skips never write to it.

The state records the initial state of both ledger timers and the intent to stop them **before** the first stop. A run interrupted mid-stop is reconciled from that record. After a confirmed `abort`, the units this run stopped are started again and verified before the state returns to `IDLE`. If a ledger timer was already stopped (for example a pause the OWNER approved), the run skips without touching anything.

| Stage | Entered when | Next |
|---|---|---|
| `IDLE` | Installed, or after `RESUMED` or `SKIPPED` | `PREPARING` |
| `PREPARING` | Before `prepare` (`opId`, sha and boot ID recorded) | `IDLE`+`SKIPPED` after a confirmed `ABORTED`/`ABORTED not_held`; `FAILED` when an abort is blocked or uncertain |
| `SWITCHING` | Written **before** calling `switching` | `REBOOTING` |
| `REBOOTING` | `switching` printed `SWITCH_MARKED` | `RESUMING` (after boot) or `FAILED` |
| `RESUMING` | Written once the services are ready and the script has confirmed its own `switching` marker and hold, before the first `resume` call | `IDLE` (with `RESUMED`, then a recorded follow-up check deadline), `RESUMED_DEGRADED` or `FAILED` |
| `FAILED` | Any uncertain step | `IDLE` only by the OWNER `clear` operation |

Reconciliation, under the lock, at every boot (whatever `ENABLED` says) and every timer run:
- `SWITCHING` or `REBOOTING` with the **same** boot ID: the reboot did not happen (the process died, or `systemctl reboot` was refused or never took effect). Result: `FAILED reboot_not_started`, hold kept, alert.
- `PREPARING` with the **same** boot ID: an earlier run died during `prepare`. The script calls `abort <opId>`. `ABORTED` or `ABORTED not_held` → `IDLE`; anything else → `FAILED`.
- `PREPARING` or `SWITCHING` with a **new** boot ID: the host rebooted mid-operation. Result: `FAILED interrupted_by_boot`, hold kept (C7), alert. No `abort` runs across boots.
- `REBOOTING` with a new boot ID: the boot unit resumes as in US3.
- `RESUMING` (written before the first `resume` call) with a new boot ID: an earlier attempt may have lifted part or all of the hold. The gate removes the hold first and the marker second. After re-checking the required services:
  - own marker with `stage=switching` and the hold present → call `resume` again;
  - own marker without the hold → call `resume`, which then clears the marker and prints `RESUMED`;
  - neither file → accept `RESUMED not_held` as `RESUMED reconciled`;
  - a marker of another owner → `FAILED foreign_hold`.

  Every `FAILED` records whether the hold file was observed present or absent.

Any `FAILED` also writes `ENABLED=0` to the config. Re-enabling needs a new `enable` operation, which is a new D7 approval; `clear` only clears the latch.

Known gate limitation: `resume` requires the WS MainPID to differ from the prepared PID. After a reboot the same PID number can be reused by chance. The gate then prints `RESUME_BLOCKED not_restarted`. The script treats this as `FAILED pid_reused`, hold kept, and the OWNER resumes under C7. Handling this automatically would need a reviewed gate change that also checks the boot ID; that is out of scope.

## Functional requirements

- **FR-001** A root-owned script `/usr/local/sbin/arcade-maintenance-reboot`, from `infra/vps/maintenance-reboot.mjs`, with two modes: `run` (timer) and `resume` (boot). It uses fixed absolute commands, checks exit code **and** the exact output line of every gate call, prints only codes and counts, and never reads or prints secrets.
- **FR-002** Pure functions: `decideStart(facts)`, `decideSwitch(facts)`, `reconcile(state, bootId)`, `resumeOutcome(exitCode, line, stage)`, `parseConfig(text)`, and the skip-series counter. They are the unit-tested core.
- **FR-003** `opId` = `9` followed by the epoch milliseconds zero-padded to 19 digits (20 digits in total). It matches the gate pattern, cannot collide with GitHub run IDs, and the same recorded value is used for every gate call.
- **FR-004** `resumeOutcome`:
  - `RESUMED` with exit code 0 succeeds.
  - `RESUMED not_held` succeeds only during reconciliation of a run whose earlier `resume` call may have completed, and is logged as `RESUMED reconciled`.
  - Everything else fails.
- **FR-005** Systemd units:
  - `arcade-maintenance-reboot.timer`, whose `OnCalendar` is written by the enable operation from the config (UTC, `Persistent=false`) and read back by `status`;
  - `arcade-maintenance-reboot.service`, running `run`;
  - `arcade-maintenance-reboot-resume.service`: `Type=oneshot`, `After=ws-server.service network-online.target`, running `resume`.

  The config is the single source of the schedule.
- **FR-006** Configuration in `/etc/arcadeplatform/maintenance-reboot.conf` (root:root 0644):
  - `ENABLED=0|1`;
  - `WINDOW_START` and `WINDOW_END` (UTC, `HH:MM`, start before end, no window across midnight);
  - `DAYS` (D2).

  Any value outside a strict pattern disables the feature. The window may not overlap Sunday 03:00–04:30 UTC (weekly maintenance).
- **FR-007** New `VPS Admin Operation` entries, added to `docs/vps-admin-operations.md` and `infra/vps/vps-admin.mjs` by a reviewed PR:
  - `maintenance-reboot-install`: script and units from `main`, with the `ws-restart-gate-install` checks, disabled;
  - `maintenance-reboot-enable`: writes the config and timer, reads both back;
  - `maintenance-reboot-disable`;
  - `maintenance-reboot-clear`: `FAILED` → `IDLE`. It never touches the WS hold; a kept hold is lifted by the OWNER per C7;
  - `maintenance-reboot-status`: read-only.

  The installed executor only knows the current catalog, so updating it goes through its existing OWNER installation path (`infra/vps/stage-vps-admin.sh`) after merge.
- **FR-008** Alerts (D3) are sent for `FAILED`, `RESUMED_DEGRADED` and a skip series (D4). The skip series counts only qualifying windows: enabled, `reboot-required` present, inside the window, and skipped by a blocking condition. It is written once per window and reset by a successful reboot.

## Decisions for the OWNER

- **D1 Window.** Proposed: 02:00–02:45 UTC every day (03:00–03:45 in Warsaw in winter). This keeps clear of the Sunday 03:30 maintenance. Better: first confirm the quietest hour from Production traffic; the coordinator can read it (read-only).
- **D2 Days.** Proposed: every day; a reboot happens only when needed. Alternative: fixed days.
- **D3 Alerts.** Options:
  - (a) A GitHub issue comment from the VPS for `FAILED`, `RESUMED_DEGRADED` and skip series, **plus** an hourly GitHub Actions workflow on a GitHub-hosted runner (`ubuntu-latest`, never the VPS runner). It checks the public WS health and the site from outside, independent of the window, and covers the case where the host does not come back.
  - (b) Only the journal, the state file and `status`. Then US3.5 is dropped and the OWNER checks by hand.

  Recommendation: (a). The VPS side needs a GitHub App token, which `github-app-token-prepare` is preparing; no new secret without a separate GO.
- **D4 Skip series.** Proposed: alert after 7 qualifying skipped windows.
- **D5 Livepatch.** Out of scope (libc and other libraries still need a restart).
- **D6 Ledger timers.** Proposed and planned: the script stops both dispatch timers for the run, if both are running, and on any skip starts again only the ones it stopped. This is the same effect as `ledger-dispatchers-pause`/`-resume`, done automatically, and is part of the D7 scope. If the OWNER rejects this, the plan changes to "skip whenever a dispatch service is not `inactive`" (residual risk: a timer firing during `prepare`), and spec, plan and tasks are updated before implementation.
- **D8 Runner jobs.** A CI job assigned in the last seconds before the reboot may be interrupted (US4.2). Proposed: accept it, since the window is chosen when CI is idle. Otherwise the runner needs a verified way to refuse new jobs before this can be activated.
- **D7 Standing approval.** After `maintenance-reboot-enable`, each automatic run does what otherwise needs a GO per run: drain WS Production and reboot the host. Today `AGENTS.md` requires a separate GO for a DRAIN change and runs root administration through `VPS Admin Operation`. So before activation, a reviewed and OWNER-approved `AGENTS.md` change must allow automatic runs of this exact mechanism, within this spec. Until then, every run needs its own GO, and the feature stays disabled.
  - The config records the approved versions: the git blob SHA of the script and of the gate. The script verifies the gate SHA immediately before **every** gate call, including recovery after a boot. A mismatch → `FAILED version_mismatch`, no automatic recovery, the OWNER decides.
  - `ws-restart-gate-install` and `maintenance-reboot-install` take the deploy maintenance lock (T004), so they cannot swap a file in the middle of an attempt.
  - `disable` and any `FAILED` (which sets `ENABLED=0`) also withdraw the approval.
  - The first activation is a one-time window with an expiry (`ONE_TIME_UNTIL`), checked at the start and before `switching`, and watched by the OWNER. After it expires, nothing runs until `enable` with the recurring window.

## Out of scope

- Installing updates (`unattended-upgrades` already does it).
- Reboots that are not required.
- Changing the WS restart gate. Only its existing commands are used.
- WS Preview presence checks, Android and WWW.

## Risks

- **The host does not come back** (hardware, disk, network). Recovery is the Hetzner console (OWNER). Only the external check in D3(a) notices this.
- **A kernel that fails to boot.** The 24 h attempt limit and the `FAILED` latch prevent a loop.
- **The gate changes in the future.** The script depends on gate output lines and exit codes, which tests pin. Any gate change withdraws D7.
- **The seconds between the final `check` and the reboot.** The hold blocks new hands and `drain` is set, but the gate does not re-check presence after `switching`. The final `check` runs immediately before `switching`, and the reboot follows `switching` with no wait. The remaining window is seconds, and joins during it are blocked from playing by the hold. Accepted, subject to D7.
