# WS Production restart gate: installation and first gated deployment

Runbook for staging the Production WS restart gate (`infra/vps/stage-ws-restart-gate.sh`) on the existing VPS
and for the first Production deployment through it. Every step that changes state needs a separate owner GO.
Root steps run in one root shell that stays open for the whole procedure (it is the recovery path if sudo breaks).
Every command is a single line. Nothing here prints secrets: env files are only counted or read inside the helper.

Placeholders: `<SHA>` is the approved `main` commit that contains the gate; `<PREV>` is the release currently
behind `/opt/ws-server/current` (`readlink -f /opt/ws-server/current`).

## Why the first deployment needs a safe stop

The gate (`/usr/local/sbin/arcade-ws-restart-gate`) allows a restart of a running WS only when the running process
reports hold + drain, an idle queue and verified money through `/internal/admin/poker-maintenance`. A release
older than the gate does not report this, so the gate answers `RESTART_BLOCKED runtime_without_restart_preflight`.
The only path for the first deployment is therefore a stopped service with root's single-use `safe-stop` evidence,
the hold file set to `drain` and a quiet database.

## A. Gate installation (root)

### A0. Precheck (read-only; the only write is the checkout under `/root`)

1. `git init -q /root/t4-<SHA> && git -C /root/t4-<SHA> fetch -q --depth 1 https://github.com/krzysztofcal/arcadePlatform.git <SHA> && git -C /root/t4-<SHA> checkout -q FETCH_HEAD && git -C /root/t4-<SHA> rev-parse HEAD`
   Expected: `<SHA>`.
2. `ls -la /etc/sudoers.d/ && grep -Hn -E 'ws-server|caddy|preflight|closed-table|restart-gate|ARCADE_DEPLOY_COMMANDS' /etc/sudoers.d/*`
   Expected: the ws-server, caddy and preflight rules and the `ARCADE_DEPLOY_COMMANDS` alias appear only in `/etc/sudoers.d/arcade-deploy`. A duplicate alias in another file would break `sudo` after installation.
3. `diff /etc/sudoers.d/arcade-deploy /root/t4-<SHA>/infra/vps/arcade-deploy.sudoers`
   Expected differences only: `restart ws-server.service` removed, the two gate lines added, and any grant added by hand outside the repository contract removed (see "Sudoers impact"). Anything else: STOP.
4. `grep -c '^WS_POKER_NEW_HANDS_HOLD_FILE=' /etc/arcadeplatform/ws-server.env /etc/arcadeplatform/ws-production-signing.env; grep -cE '^(SUPABASE_DB_URL|POKER_WS_INTERNAL_TOKEN)=' /etc/arcadeplatform/ws-server.env`
   Expected: `:0` for both files, then `2`. The staging script only checks `ws-server.env`; an `EnvironmentFile=` defining the hold variable would override the drop-in.
5. `ls -la /usr/local/sbin/arcade-ws-restart-gate /etc/arcadeplatform/ws-hold /etc/systemd/system/ws-server.service.d/50-new-hands-hold.conf 2>&1; systemctl show ws-server.service -p MainPID,ActiveState,NeedDaemonReload; visudo -c`
   Expected: three `No such file`, `ActiveState=active`, `NeedDaemonReload=no`, `parsed OK`. Record `MainPID`.
6. `ls -la /usr/bin/psql; P=$(readlink -e /usr/bin/psql); stat -c '%n %U:%G %a' "$P" "$(dirname "$P")"`
   Expected: both `root:root`, not writable by group or others. The staging script refuses otherwise.
7. Gate database path, read-only (aggregate counts and the port only; the password goes to the `psql` child's environment, never to argv or output; `psql` errors are not printed):
   `T4_DIR=/root/t4-<SHA> /usr/bin/node --input-type=module -e 'const m=await import("file://"+process.env.T4_DIR+"/infra/vps/ws-restart-gate.mjs");const {spawnSync}=await import("node:child_process");const v=m.readEnvValues();const u=new URL(v.SUPABASE_DB_URL);const r=spawnSync("/usr/bin/psql",["-h",u.hostname,"-p",u.port||"5432","-U",decodeURIComponent(u.username),"-d",u.pathname.replace(/^\//,"")||"postgres","-X","-Atq","-v","ON_ERROR_STOP=1","-c",m.DB_QUIET_SQL],{env:{PATH:"/usr/bin:/bin",PGPASSWORD:decodeURIComponent(u.password),PGOPTIONS:"-c default_transaction_read_only=on",...(u.searchParams.get("sslmode")?{PGSSLMODE:u.searchParams.get("sslmode")}:{})},timeout:15000,encoding:"utf8"});const q=m.parseDbQuiet(r.stdout);console.log((r.status===0&&q?"DBQ_OK ":"DBQ_FAIL status="+r.status+" ")+"port="+(u.port||"5432")+" "+JSON.stringify(q))'`
   This runs the gate's exact query with the gate's exact connection settings. Expected: `DBQ_OK`, every financial count `0` and `unresolvedRequests=0`; `handsInProgress` may be non-zero while tables play. `DBQ_FAIL` (for example a pooler rejecting `PGOPTIONS`) or historic `unresolvedRequests>0` means the safe-stop path can never pass: STOP before the first deployment.

### A1. Installation (separate GO)

1. `install -d -m 0700 /root/t4-backup && cp -a /etc/sudoers.d /etc/systemd/system/ws-server.service.d /root/t4-backup/ && ls -la /root/t4-backup/sudoers.d /root/t4-backup/ws-server.service.d`
2. `bash /root/t4-<SHA>/infra/vps/stage-ws-restart-gate.sh`
   Expected: `stage-ws-restart-gate: OK (RESTART_BLOCKED runtime_without_restart_preflight)` (`RESTART_BLOCKED http_503` is also acceptable). The script never restarts a service.

### A2. Verification

- Root: `stat -c '%n %U:%G %a' /usr/local/sbin/arcade-ws-restart-gate /etc/arcadeplatform/ws-hold /etc/systemd/system/ws-server.service.d/50-new-hands-hold.conf /etc/sudoers.d/arcade-deploy && cmp /usr/local/sbin/arcade-ws-restart-gate /root/t4-<SHA>/infra/vps/ws-restart-gate.mjs && ls -A /etc/arcadeplatform/ws-hold`
  Expected: `root:root` `755`, `755`, `644`, `440`; `cmp` silent; the hold directory empty.
- Root: `systemctl show ws-server.service -p MainPID,ActiveState,Environment; visudo -c`
  Expected: the `MainPID` from A0.5 (no restart), `active`, `WS_POKER_NEW_HANDS_HOLD_FILE=/etc/arcadeplatform/ws-hold/new-hands`, `parsed OK`.
- Deploy account (list mode only, nothing is executed): `sudo -n -l /usr/bin/systemctl restart ws-server.service` exits 1; `sudo -n -l /usr/bin/systemctl restart ws-server-preview.service` exits 0; `sudo -n /usr/local/sbin/arcade-ws-restart-gate check` prints `RESTART_BLOCKED runtime_without_restart_preflight`; Production and Preview `/healthz` return `ok`.

### A3. Withdrawal (no WS restart)

`cp -a /root/t4-backup/sudoers.d/arcade-deploy /etc/sudoers.d/arcade-deploy && visudo -c && rm -f /etc/systemd/system/ws-server.service.d/50-new-hands-hold.conf && systemctl daemon-reload && rm -f /usr/local/sbin/arcade-ws-restart-gate && rmdir /etc/arcadeplatform/ws-hold && systemctl show ws-server.service -p MainPID,Environment`

### Notes

- The drop-in takes effect at the next start of the process, including an automatic restart after a crash (`Restart=always`). A release without hold support ignores the variable; with no hold file the new code is not held.
- Hold and `safe-stop` files must be `root:root` `0644`. The process user cannot read a `0600` file, which fails closed as hold + drain; the gate refuses entries writable by group or others.

### Sudoers impact (breaking)

| Operation | Before | After |
|---|---|---|
| `copilot`: `systemctl restart ws-server.service` | allowed | **removed**; Production restarts only through the gate |
| `copilot`: gate `check` / `restart` | none | allowed |
| `copilot`: Preview restart, Caddy reload, env preflights | allowed | unchanged |
| `copilot`: `systemctl stop ws-server-preview.service` (granted by hand, never in the repository contract) | allowed | **removed** (accepted); Preview is stopped by root or replaced by a restart |
| grants in other sudoers files (e.g. `arcade-ws-closed-table-status`) | allowed | unchanged |
| WS Server Deploy from `main` | — | gate only; before installation it stops before the release switch |
| automatic rollback in the deploy workflow | plain restart | gate only; for a first deployment it is effectively blocked, so rollback is manual (C7) |
| root | unrestricted | unrestricted; the gate never limits root |

## C. First gated Production deployment

The service is down from the stop until the new process passes its health checks (typically minutes). Choose a
low-traffic window and announce it. A release older than the gate cannot hold new hands, so the wind-down relies on
games ending naturally; the check after the stop (C3.4) covers the remaining race.

**C0. Preconditions:** A2 passed; A0.7 returned `DBQ_OK`; `main` still equals `<SHA>`.

**C1. Read-only state**

1. Production SQL, read-only and aggregate only (no ids), by the operator:
   `begin transaction read only; select (select count(*) from public.poker_tables where status='OPEN') as open_tables, (select count(*) from public.poker_tables where status='OPEN' and lifecycle_kind<>'STANDARD') as open_managed, (select count(*) from public.poker_tables t join public.poker_state ps on ps.table_id=t.id where t.status='OPEN' and ps.state->>'phase' in ('PREFLOP','FLOP','TURN','RIVER','SHOWDOWN')) as live_hands, (select count(*) from public.poker_seats s join public.poker_tables t on t.id=s.table_id where t.status='OPEN' and s.status='ACTIVE' and not s.is_bot) as human_seats_open, (select count(*) from public.poker_requests where result_json is null) as unresolved_requests, (select count(*) from public.poker_tables t join public.chips_accounts a on a.account_type='ESCROW' and a.system_key='POKER_TABLE:'||t.id::text where t.status='CLOSED' and a.balance<>0) as closed_with_escrow; rollback;`
   Money consistency of OPEN tables comes from A0.7 (`missingState`, `missingEscrow`, `invalidAmounts`, `balanceMismatches`).
2. Root: `ss -Htn state established '( sport = :3000 )' | wc -l` (proxied WS connections, an approximation of connected clients).
3. Root: `tar -C /opt/ws-server/releases -cf /root/t4-backup/release-<PREV>.tar <PREV> && sha256sum /root/t4-backup/release-<PREV>.tar`

**C2. Wind-down (separate GO; admin state change)**

1. Admin → Poker maintenance (`set_desired_state`): continuous bot tables `enabled=false`, `desiredTableCount=0`. Record the previous values. The supervisor retires each table after its current hand settles; retirement waits while a human is present.
2. Announce the maintenance window.
3. Repeat C1.1, C1.2 and A0.7 until `open_managed=0`, `live_hands=0`, `unresolved_requests=0`, all A0.7 counts `0`, and human seats and connections are at 0 or an accepted minimum. Remaining STANDARD tables between hands with escrow equal to stacks are allowed.
4. Never force a Leave, close a table or change a hand or a ledger entry.

**C3. Safe stop (separate GO; root, one uninterrupted session)**

1. Drain file (an old release ignores it): `umask 022 && printf 'drain\n' > /etc/arcadeplatform/ws-hold/new-hands.tmp && chown root:root /etc/arcadeplatform/ws-hold/new-hands.tmp && chmod 0644 /etc/arcadeplatform/ws-hold/new-hands.tmp && mv -f /etc/arcadeplatform/ws-hold/new-hands.tmp /etc/arcadeplatform/ws-hold/new-hands && cat /etc/arcadeplatform/ws-hold/new-hands`
2. Immediately before the stop: A0.7 with every count `0`, otherwise STOP and return to C2.3.
3. `systemctl stop ws-server.service && systemctl is-active ws-server.service` → `inactive`.
4. A0.7 again, every count `0`. If a hand started in the meantime: `systemctl start ws-server.service` (same old release, the hand continues) and STOP.
5. Evidence (single use, valid for 2 hours): `umask 022 && date -u +'safe-stop %Y-%m-%dT%H:%M:%SZ' > /etc/arcadeplatform/ws-hold/safe-stop && chmod 0644 /etc/arcadeplatform/ws-hold/safe-stop && cat /etc/arcadeplatform/ws-hold/safe-stop`
6. `sudo -u copilot sudo -n /usr/local/sbin/arcade-ws-restart-gate check` → `RESTART_SAFE safe_stop_evidence`. Anything else: `rm -f /etc/arcadeplatform/ws-hold/safe-stop && systemctl start ws-server.service` and STOP.

**C4. Deployment (separate GO; owner, within 2 hours of C3.5)**

Actions → WS Server Deploy → Run workflow on `main` with `releaseSha=<SHA>` and `confirmation=DEPLOY WS PRODUCTION <SHA>`.
Expected log: `PASS LIVE Redis V3 prod`, `RESTART_SAFE safe_stop_evidence`, `RESTARTED safe_stop_evidence` (the helper removes the evidence before restarting), local and public healthz, WebSocket handshake smoke (`hello` is not rejected by drain).

**C5. Verification (read-only)**

1. `readlink -f /opt/ws-server/current` ends in `<SHA>/ws-server`; its `release-metadata.json` has `releaseSha=<SHA>`; new `MainPID`; local and public `/healthz` `ok`; no `safe-stop` file.
2. `sudo -n /usr/local/sbin/arcade-ws-restart-gate check` → `RESTART_SAFE`: the running-process path now works on Production.
3. C1.1 all zero, `closed_with_escrow` unchanged from C1.
4. Journal since the start: no `ws_restart_preflight_db_failed`, `terminal_accounting_invariant_failed` or startup error.

**C6. Lift drain and hold (separate GO; root)**

1. Hold without drain (actions, Leave and cash-outs work; no new hand starts): `umask 022 && : > /etc/arcadeplatform/ws-hold/new-hands.tmp && chmod 0644 /etc/arcadeplatform/ws-hold/new-hands.tmp && mv -f /etc/arcadeplatform/ws-hold/new-hands.tmp /etc/arcadeplatform/ws-hold/new-hands`
2. After a short check with a test account, lift the hold: `rm -f /etc/arcadeplatform/ws-hold/new-hands` (read on every check, no restart).
3. Admin: restore the continuous bot table settings recorded in C2.1.
4. C1.1 and A0.7 after the first hands: escrow consistent, `unresolved_requests=0`.

**C7. Emergency (root)**

- New release unhealthy after the restart (the workflow prints `ROLLBACK_BLOCKED` or `RESTART_UNCERTAIN` and leaves the decision to the operator): `ln -sfn /opt/ws-server/releases/<PREV>/ws-server /opt/ws-server/current.tmp && mv -Tf /opt/ws-server/current.tmp /opt/ws-server/current && systemctl restart ws-server.service && sleep 3 && curl -fsS http://127.0.0.1:3000/healthz`
  A release older than the gate ignores the hold, so new hands may start at once; continuous bot tables stay disabled because their desired state is stored in the database.
- Deployment failed before the release switch (preflight or gate): the old release is still in place. `rm -f /etc/arcadeplatform/ws-hold/safe-stop && systemctl start ws-server.service`
- Gate or sudoers in the way: root acts without the gate (`systemctl …`); A3 withdraws the installation.
