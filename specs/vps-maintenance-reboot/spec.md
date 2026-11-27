# Feature Specification: Gated automatic reboot of the VPS in a maintenance window

**Branch**: `docs/vps-maintenance-reboot-spec` · **Created**: 2026-11-27 · **Status**: draft for OWNER decision
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
- WS Production keeps game state in memory. Its restart gate (`/usr/local/sbin/arcade-ws-restart-gate`, `infra/vps/ws-restart-gate.mjs`) already provides what a safe stop needs:
  - `prepare <runId>`: holds new hands, waits for running hands, drains, and requires `humanSeatsOpen=0` and `closedWithEscrow=0`;
  - `switching <runId>`: the point of no return;
  - `resume <runId> <sha>`: lifts the hold only after a restart into the same release, with `/healthz` ok and `RESTART_SAFE`;
  - `abort <runId>`: removes the run's own hold before the switch.
- The hold file `/etc/arcadeplatform/ws-hold/new-hands` is on disk, so it survives a reboot.
- Releases and the weekly maintenance serialize on `/opt/ws-server/.deploy-maintenance.lock` (`flock`).

## User stories

### US1: Kernel and libc fixes take effect without the OWNER doing it by hand (P1)
When an update needs a reboot, the VPS reboots by itself in the next maintenance window in which nobody is playing.

**Acceptance**
1. No reboot happens while `/var/run/reboot-required` is absent.
2. A reboot happens only inside the configured window.
3. At most one reboot per 24 hours, also when `reboot-required` is still present after the boot.

### US2: Nobody loses a hand or money (P1)
A reboot never interrupts seated human players or leaves chips in escrow.

**Acceptance**
1. The reboot starts only after `arcade-ws-restart-gate prepare <runId>` printed `PREPARED` and `switching <runId>` succeeded. Both already require `humanSeatsOpen=0`, `closedWithEscrow=0`, no running hands and verified money.
2. Any other gate outcome skips the night: `abort <runId>` removes only this run's hold and the next window tries again. Nothing is restarted.
3. While the reboot is in progress, the hold stays on disk, so the restarted WS starts no new hands until `resume` succeeds.

### US3: The system comes back, or the OWNER knows that it did not (P1)
**Acceptance**
1. A boot-time unit runs `resume <runId> <sha>` for the recorded run once `ws-server` is active, after the WS warm-up.
   - `<sha>` is the release that ran before the reboot.
   - `resume` must print `RESUMED`.
2. It also checks `ws-server`, `ws-server-preview`, `caddy`, `postgresql` and the runner service.
3. Every outcome is written to the journal as one line: `MAINT_REBOOT_<SKIPPED|PREPARED|REBOOTING|RESUMED|FAILED> <reason>`. The last state is written to `/var/lib/arcadeplatform/maintenance-reboot/state`.
4. On `RESUME_BLOCKED`, a failed service or no resume within 15 minutes of boot, the hold stays (C7) and the state says `FAILED`. The OWNER is alerted through the channel chosen in decision D3.

### US4: Other work is not cut off (P2)
**Acceptance**
1. The decision skips the night while any of these is running:
   - a WS release or the weekly maintenance (the deploy maintenance lock is busy);
   - a ledger dispatch service (`arcade-chips-ledger-dispatch.service`, `arcade-chips-ledger-production-dispatch.service`);
   - an active GitHub Actions job on the runner (a `Runner.Worker` process).
2. WS Preview may be hard-restarted by the reboot. The repository already accepts hard-kick restarts of Stage/WS Preview.

### US5: The OWNER can turn it off at once (P1)
**Acceptance**
1. The feature is off after installation.
2. Enabling it and disabling it are separate `VPS Admin Operation` entries.
3. When disabled, the timer runs but only logs `MAINT_REBOOT_SKIPPED disabled`.

## Functional requirements

- **FR-001** A root-owned script `/usr/local/sbin/arcade-maintenance-reboot`, from `infra/vps/maintenance-reboot.mjs`, with two modes: `run` (timer) and `resume` (boot). It uses fixed absolute commands and no shell interpolation. It prints only codes and counts. It never reads or prints secrets.
- **FR-002** A pure decision function `decideReboot(facts)` returns `skip:<reason>` or `proceed`. It checks in this order:
  1. disabled;
  2. outside the window;
  3. no `reboot-required`;
  4. a reboot in the last 24 h;
  5. deploy lock busy;
  6. a ledger dispatch active;
  7. a runner job active;
  8. a previous run not finished.

  `facts` are collected by the script. This function is the unit-tested core.
- **FR-003** On `proceed` the script, holding the deploy maintenance lock:
  1. records the run ID (`maint-<UTC timestamp>`) and the current release SHA (from `readlink -f /opt/ws-server/current`);
  2. runs `prepare`, then `switching`;
  3. writes `REBOOTING` and calls `systemctl reboot`.

  Any non-success line before `switching` runs `abort` and ends with `SKIPPED`.
- **FR-004** The boot unit `arcade-maintenance-reboot-resume.service` (`Type=oneshot`, `After=ws-server.service network-online.target`) runs only when the state is `REBOOTING`:
  1. waits for `ws-server` to be active and `/healthz` to be ok, for at most 15 minutes;
  2. runs `resume <runId> <sha>`;
  3. checks the services in US3;
  4. writes `RESUMED` or `FAILED <reason>`.

  It never retries a reboot.
- **FR-005** Systemd units: `arcade-maintenance-reboot.timer` (`OnCalendar` = the D1 window start, `RandomizedDelaySec=0`, `Persistent=false`), the service for `run`, and the boot unit. The window end is enforced by the script, not by systemd.
- **FR-006** Configuration in `/etc/arcadeplatform/maintenance-reboot.conf` (root:root 0644):
  - `ENABLED=0|1`;
  - `WINDOW_START` and `WINDOW_END` (UTC, `HH:MM`);
  - `DAYS` (D2).

  Values outside a strict pattern disable the feature.
- **FR-007** New `VPS Admin Operation` entries, added to `docs/vps-admin-operations.md` and the executor by a reviewed PR:
  - `maintenance-reboot-install`: installs the script and units from `main` with the same SHA and blob checks as `ws-restart-gate-install`, leaving the feature disabled;
  - `maintenance-reboot-enable` and `maintenance-reboot-disable`;
  - `maintenance-reboot-status`: read-only.
- **FR-008** The alert for `FAILED` and for `SKIPPED` on more than `N` nights in a row (D4) uses the channel from D3. No new secret is stored for it without a separate GO.

## Decisions for the OWNER

- **D1 Window.** Proposed: 03:00–04:00 UTC (04:00–05:00 in Warsaw in winter), avoiding the Sunday 03:30 maintenance. Better: confirm the quietest hour from Production traffic first; the coordinator can read it (read-only).
- **D2 Days.** Proposed: every night, since a reboot only happens when needed. Alternative: one or two fixed nights a week.
- **D3 Alert channel.** Options:
  - (a) a GitHub issue comment by the App identity;
  - (b) e-mail;
  - (c) only the journal and the state file, checked by `maintenance-reboot-status`.

  Recommendation: (a), which needs no new secret on the VPS beyond what `github-app-token-prepare` is preparing. Otherwise (c) for the first version.
- **D4 Skip alert.** Proposed: alert after 7 skipped nights while a reboot is required.
- **D5 Livepatch.** Canonical Livepatch could apply kernel fixes without a reboot. It is out of scope here, because libc and other library updates still need a restart.

## Out of scope

- Installing updates (`unattended-upgrades` already does it).
- Reboots that are not required.
- Changing the WS restart gate itself. Only its existing commands are used.
- WS Preview presence checks, Android and WWW.

## Risks

- **The VPS does not come back after a reboot** (hardware, disk, network). Recovery is the Hetzner console (OWNER). The alert from D3 must not depend on the VPS itself for this case; otherwise only the existing external monitoring notices.
- **A boot that is not new, or a kernel that fails to boot.** `reboot-required` stays; the 24 h limit prevents a loop and D4 alerts.
- **A gate change in the future.** The script depends on gate output lines (`PREPARED`, `RESUMED`). The plan pins them in tests.
- **The runner job check may miss a job that starts after the check.** Accepted: such a job fails and GitHub retries can rerun it. The window is chosen when CI is idle.
