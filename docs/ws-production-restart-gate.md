# WS Production restart gate: installation and first gated deployment

Runbook for staging the Production WS restart gate (`infra/vps/stage-ws-restart-gate.sh`) on the existing VPS
and for the first Production deployment through it. Every step that changes state needs a separate owner GO.
Root steps run in one root shell that stays open for the whole procedure (it is the recovery path if sudo breaks).
Every command is a single line. Nothing here prints secrets: env files are only counted or read inside the helper.

Placeholders: `<SHA>` is the approved `main` commit that contains the gate. `<PREV_SHA>` is the commit of the release
currently running: `basename "$(dirname "$(readlink -f /opt/ws-server/current)")"`. Its release directory is
`/opt/ws-server/releases/<PREV_SHA>` and its application directory (the target of `/opt/ws-server/current`) is
`/opt/ws-server/releases/<PREV_SHA>/ws-server`.

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
| automatic rollback in the deploy workflow | plain restart | gate only; it can succeed when the new process runs drained on a quiet database, otherwise it is blocked and rollback is manual (C7) |
| root | unrestricted | unrestricted; the gate never limits root |

## C. First gated Production deployment

**Status: BLOCKED** until the owner gives a separate GO for the temporary connection block (C-M1). Without it, a safe
stop of a release older than the gate cannot exclude a new hand: that release has no hold or drain, disabling a
buy-in tier only refuses new joins, and a settled table with a seated human (even one who has disconnected but
has not been removed yet) rolls over into a new hand on the server side.

**Rollback boundary.** Returning to the previous release is covered by this runbook only before C6.1. Until then the
new process runs drained: it rejects joins, actions and Leaves and starts no hand. From C6.1 on it can write table
state (actions, Leaves, cash-outs) even without a new hand. A rollback after C6.1 needs a separate compatibility
analysis and a separate GO.

### C-M1. Temporary block of new WS connections (separate GO; root; host firewall, not persisted)

WS Production listens only on IPv4 `0.0.0.0:3000` (`ss -Htln '( sport = :3000 )'`), and Caddy proxies to
`127.0.0.1:3000` without active upstream health checks. One `iptables` rule, inserted as the first rule of `INPUT`,
rejects **new** TCP connections to port 3000 on every interface. Established connections stay up (they are tracked
by conntrack), so running games are not cut, and Caddy or systemd do not react to the rejections.

Once both of these hold, no new hand can start:
- `established=0`: no client and no pooled Caddy connection left;
- the database shows no human seat, no managed table and no live hand.

After that point no client can connect, a table without an active human closes at rollover instead of starting a
hand, managed tables are disabled (C2.1), and the first hand of a table starts only on a client join.

While the rule is on:
- public `/healthz` and every internal HTTP call to WS fail;
- table creation in Netlify refuses because it checks WS `/healthz` first.

The rule is not saved; a reboot or an explicit delete removes it.

**The rule only works while it is the first rule of `INPUT`.** `ufw` accepts all loopback traffic in its own chains, so
`ufw reload`, `ufw enable` or any firewall change can put `ufw`'s jumps in front of the rule and silently let Caddy's
new connections through. Do not change the firewall during the window.

- Precheck: `iptables -V && iptables -S INPUT | head -5 && ss -Htln '( sport = :3000 )'`
  Expected: `nf_tables`; a single listener `0.0.0.0:3000`.
- On: `iptables -I INPUT 1 -p tcp --dport 3000 -m conntrack --ctstate NEW -m comment --comment t4-ws-block-new -j REJECT --reject-with tcp-reset && echo BLOCK_ON`
- Position (must be the first rule, i.e. line 2 after the policy line): `iptables -S INPUT | grep -n t4-ws-block-new`
  Expected: exactly one line starting with `2:-A INPUT`.
- Effect: `curl -sS -m3 http://127.0.0.1:3000/healthz; echo "rc=$?"` → connection reset or refused, `rc` not `0`.
- Off: `iptables -D INPUT -p tcp --dport 3000 -m conntrack --ctstate NEW -m comment --comment t4-ws-block-new -j REJECT --reject-with tcp-reset; iptables -S INPUT | grep -c t4-ws-block-new`
  Expected: `0`.
- Established count: `ss -Htn state established '( sport = :3000 )' | wc -l`

**Rule ineffective** (position not `2:`, more than one line, or the effect check returns `ok`):
- any client may have connected since the last good check, so every earlier quiet-point result is void;
- do not stop WS;
- C-M1 off, C-M1 on, position and effect again, then restart C3.2 from the beginning;
- if the position is still wrong: C-M1 off and abort the window.

The block goes on only once no human is seated (C2.3). This means that it does not trigger reconnect failures for
seated players, whose removal by the disconnect janitor in the middle of a hand is the path fixed only in newer releases.

The service is down from the stop until the new process passes its health checks (typically minutes). Choose a
low-traffic window outside `apt-daily-upgrade`, and announce it.

**C0. Preconditions:** A2 passed; A0.7 returned `DBQ_OK`; `main` still equals `<SHA>`; GO for C-M1.

**C1. Read-only state**

1. Production table counts (root; aggregate counts only, same connection settings as A0.7; the SQL uses `$$…$$` literals so the command needs no quote escaping):
   `T4_DIR=/root/t4-<SHA> /usr/bin/node --input-type=module -e 'const m=await import("file://"+process.env.T4_DIR+"/infra/vps/ws-restart-gate.mjs");const {spawnSync}=await import("node:child_process");const v=m.readEnvValues();const u=new URL(v.SUPABASE_DB_URL);const q="select concat_ws($$|$$,(select count(*) from public.poker_tables where status=$$OPEN$$),(select count(*) from public.poker_tables where status=$$OPEN$$ and lifecycle_kind<>$$STANDARD$$),(select count(*) from public.poker_tables t join public.poker_state ps on ps.table_id=t.id where t.status=$$OPEN$$ and ps.state->>$$phase$$ in ($$PREFLOP$$,$$FLOP$$,$$TURN$$,$$RIVER$$,$$SHOWDOWN$$)),(select count(*) from public.poker_seats s join public.poker_tables t on t.id=s.table_id where t.status=$$OPEN$$ and s.status=$$ACTIVE$$ and not s.is_bot),(select count(*) from public.poker_requests where result_json is null),(select count(*) from public.poker_tables t join public.chips_accounts a on a.account_type=$$ESCROW$$ and a.system_key=$$POKER_TABLE:$$||t.id::text where t.status=$$CLOSED$$ and a.balance<>0))";const r=spawnSync("/usr/bin/psql",["-h",u.hostname,"-p",u.port||"5432","-U",decodeURIComponent(u.username),"-d",u.pathname.replace(/^\//,"")||"postgres","-X","-Atq","-v","ON_ERROR_STOP=1","-c",q],{env:{PATH:"/usr/bin:/bin",PGPASSWORD:decodeURIComponent(u.password),PGOPTIONS:"-c default_transaction_read_only=on",...(u.searchParams.get("sslmode")?{PGSSLMODE:u.searchParams.get("sslmode")}:{})},timeout:15000,encoding:"utf8"});const k=["open_tables","open_managed","live_hands","human_seats_open","unresolved_requests","closed_with_escrow"];const x=String(r.stdout||"").trim().split("|");console.log(r.status===0&&x.length===6&&x.every(s=>/^[0-9]+$/.test(s))?"C1_OK "+k.map((n,i)=>n+"="+x[i]).join(" "):"C1_FAIL status="+r.status)'`
   Expected: one line `C1_OK open_tables=… open_managed=… live_hands=… human_seats_open=… unresolved_requests=… closed_with_escrow=…`. `C1_FAIL`: STOP. Money consistency of OPEN tables comes from A0.7 (`missingState`, `missingEscrow`, `invalidAmounts`, `balanceMismatches`).
2. Root: established count (C-M1). It includes idle Caddy keep-alive connections, which the WS server closes after a few seconds without traffic.
3. Root, a copy of the running release: `P=$(basename "$(dirname "$(readlink -f /opt/ws-server/current)")") && test -f "/opt/ws-server/releases/$P/ws-server/server.mjs" && tar -C /opt/ws-server/releases -cf "/root/t4-backup/release-$P.tar" "$P" && sha256sum "/root/t4-backup/release-$P.tar" && echo "PREV_SHA=$P"`
   Record `PREV_SHA`.

**C2. Wind-down (separate GO; admin state change)**

1. Admin → Poker maintenance (`set_desired_state`): continuous bot tables `enabled=false`, `desiredTableCount=0`. Record the previous values. The supervisor retires each table after its current hand settles; retirement waits while a human is present.
2. Announce the maintenance window and ask players to leave their tables.
3. Repeat C1.1 and A0.7 until `human_seats_open=0`, `open_managed=0`, `live_hands=0`, `unresolved_requests=0` and every A0.7 count is `0`. Players leave on their own or are removed by the regular janitor after disconnecting. Never force a Leave, close a table or change a hand or a ledger entry. If the window ends first: abort, and restore C2.1 when appropriate.

**C3. Block, quiet point, safe stop (separate GO; root, one uninterrupted session)**

1. Immediately after C2.3 passes: C-M1 on, then position and effect.
2. Wait until the established count is `0`. Lobby or observer connections without a seat still count, because they could join a table.
   - Then C1.1 and A0.7 again, every condition from C2.3 still met.
   - If a client was seated in the meantime (`human_seats_open>0`), or the count does not reach `0` within the window: C-M1 off, return to C2.3 or abort.
3. Drain file for the new process (the running release ignores it): `umask 022 && printf 'drain\n' > /etc/arcadeplatform/ws-hold/new-hands.tmp && chown root:root /etc/arcadeplatform/ws-hold/new-hands.tmp && chmod 0644 /etc/arcadeplatform/ws-hold/new-hands.tmp && mv -f /etc/arcadeplatform/ws-hold/new-hands.tmp /etc/arcadeplatform/ws-hold/new-hands && cat /etc/arcadeplatform/ws-hold/new-hands`
4. Immediately before the stop, in this order:
   - C-M1 position and effect again; if not good: "Rule ineffective";
   - established count `0`.
5. `systemctl stop ws-server.service && systemctl is-active ws-server.service` → `inactive`.
6. A0.7 again, every count `0`, plus C1.1 with `live_hands=0` and `human_seats_open=0`.
   **If anything is non-zero: STOP.** Do not create the safe-stop evidence, do not start the service and do not deploy. Restarting the old release is not a way to resume an interrupted hand. Leave the service stopped and the block on. The owner decides on a separate recovery procedure from the recorded counts.
7. C-M1 off: nothing listens on port 3000 while the service is stopped, and the deployment needs local health checks.
8. Evidence (single use, valid for **2 hours** from its timestamp): `umask 022 && date -u +'safe-stop %Y-%m-%dT%H:%M:%SZ' > /etc/arcadeplatform/ws-hold/safe-stop && chmod 0644 /etc/arcadeplatform/ws-hold/safe-stop && cat /etc/arcadeplatform/ws-hold/safe-stop`
   Record the time; C4 has to reach its restart before it plus 2 hours.
9. `sudo -u copilot sudo -n /usr/local/sbin/arcade-ws-restart-gate check` → `RESTART_SAFE safe_stop_evidence`. Anything else: `rm -f /etc/arcadeplatform/ws-hold/safe-stop`, leave the service stopped, STOP; the owner decides (C7.1 restores the old release).

**C4. Deployment (separate GO; owner, within 2 hours of C3.8)**

Actions → WS Server Deploy → Run workflow on `main` with `releaseSha=<SHA>` and `confirmation=DEPLOY WS PRODUCTION <SHA>`.
Expected log: `PASS LIVE Redis V3 prod`, `RESTART_SAFE safe_stop_evidence`, `RESTARTED safe_stop_evidence` (the helper removes the evidence before restarting), local and public healthz, WebSocket handshake smoke (`hello` is not rejected by drain).
The new process starts drained: clients can connect, while joins, actions and Leaves are rejected until C6.

**Evidence expired** (the run prints `RESTART_BLOCKED service_inactive_without_safe_stop_evidence` and `STOP: restart gate is not safe; nothing switched`):
- nothing was switched or restarted, and the service is still stopped on the old release;
- either repeat C3.6 while the service is still `inactive`, then C3.8–C3.9, and dispatch again (separate GO);
- or restore the old release (C7.1).

Never extend, edit or re-date an existing evidence file.

**C5. Verification (read-only)**

1. `readlink -f /opt/ws-server/current` is `/opt/ws-server/releases/<SHA>/ws-server`; its `release-metadata.json` has `releaseSha=<SHA>`; new `MainPID`; local and public `/healthz` `ok`; no `safe-stop` file; no `t4-ws-block-new` rule (`iptables -S INPUT | grep -c t4-ws-block-new` → `0`).
2. `sudo -n /usr/local/sbin/arcade-ws-restart-gate check` → `RESTART_SAFE`: the running-process path now works on Production.
3. C1.1 all zero, `closed_with_escrow` unchanged from C1.
4. Journal since the start: no `ws_restart_preflight_db_failed`, `terminal_accounting_invariant_failed` or startup error.

**C6. Lift drain and hold (separate GO; root)**

C6.1 ends the rollback boundary.

1. Hold without drain (actions, Leave and cash-outs work; no new hand starts): `umask 022 && : > /etc/arcadeplatform/ws-hold/new-hands.tmp && chmod 0644 /etc/arcadeplatform/ws-hold/new-hands.tmp && mv -f /etc/arcadeplatform/ws-hold/new-hands.tmp /etc/arcadeplatform/ws-hold/new-hands`
2. After a short check with a test account, lift the hold: `rm -f /etc/arcadeplatform/ws-hold/new-hands` (read on every check, no restart).
3. Admin: restore the continuous bot table settings recorded in C2.1.
4. C1.1 and A0.7 after the first hands: escrow consistent, `unresolved_requests=0`.

**C7. Recovery (root)**

`systemd` stops restarting a unit that fails 10 times within 60 seconds (`StartLimitBurst=10`, `RestartSec=2`), so a crash-looping release ends as `failed`. Every manual start below first clears that state with `systemctl reset-failed ws-server.service` (harmless when the unit is not failed).

1. **Deployment failed before the release switch** (preflight, gate check, artifact, runner or SSH failure, evidence expired). The link still points to `<PREV_SHA>` and the service is stopped with no hand running (C3.6). Restore the old release:
   `rm -f /etc/arcadeplatform/ws-hold/safe-stop; readlink -f /opt/ws-server/current; systemctl reset-failed ws-server.service; systemctl start ws-server.service && sleep 5 && systemctl is-active ws-server.service && curl -fsS http://127.0.0.1:3000/healthz`
   Expected: `/opt/ws-server/releases/<PREV_SHA>/ws-server`, `active`, `ok`. The old release ignores the hold file and the drop-in, so new hands can start as soon as clients return; continuous bot tables stay disabled because their desired state is stored in the database (restore them under C6.3 when appropriate).
2. **Switched, but the gate refused the restart** (`STOP: gate refused before restart; nothing was restarted`): the workflow puts the link back to `<PREV_SHA>` itself (`release link restored; no restart was performed`). Check `readlink -f /opt/ws-server/current` and continue as in C7.1.
3. **Restarted, then the health checks failed.** The workflow attempts an automatic rollback through the gate. That attempt passes the gate when the new process is up, drained and on a quiet database. It is blocked when the process is down or crash-looping, because the evidence was used. Read its output:
   - `RESTARTED …`: the workflow switched back to `<PREV_SHA>` and restarted it. Verify the link, `MainPID`, `is-active` and `/healthz`, then C1.1 and A0.7. The old release ignores the hold, so play can resume immediately; decide with the owner whether to keep it running.
   - `ROLLBACK_BLOCKED …`: the link was put back to the new release and nothing was restarted. Manual rollback (C7.4).
   - `RESTART_UNCERTAIN …`: the service state is unknown. Check `systemctl show ws-server.service -p ActiveState,SubState,MainPID,NRestarts` and `readlink -f /opt/ws-server/current`, then manual rollback (C7.4).
4. **Manual rollback to `<PREV_SHA>`**, only before C6.1:
   `test -f /opt/ws-server/releases/<PREV_SHA>/ws-server/server.mjs && ln -sfn /opt/ws-server/releases/<PREV_SHA>/ws-server /opt/ws-server/current.tmp && mv -Tf /opt/ws-server/current.tmp /opt/ws-server/current && readlink -f /opt/ws-server/current && systemctl reset-failed ws-server.service; systemctl restart ws-server.service && sleep 5 && systemctl is-active ws-server.service && curl -fsS http://127.0.0.1:3000/healthz`
   If the release directory is missing, first restore it from the C1.3 archive: `tar -C /opt/ws-server/releases -xf /root/t4-backup/release-<PREV_SHA>.tar`. Then verify as in C7.3 `RESTARTED`.
5. **After C6.1:** no rollback to `<PREV_SHA>` from this runbook. Keep the new release, hold new hands again if needed (C6.1 file without drain), and get a compatibility analysis and a separate GO before any rollback.
6. **Firewall:**
   - block left on by mistake: C-M1 off;
   - after an accidental `ufw reload` or another firewall change during the window: "Rule ineffective";
   - when the new release fails its local health check while the rule is still present: C-M1 off first, then re-run the check before any rollback.
7. **Getting the service back in any other state:** C-M1 off; `readlink -f /opt/ws-server/current` must point to an existing release; `systemctl reset-failed ws-server.service; systemctl start ws-server.service`; check `/healthz`.
8. Gate or sudoers in the way: root acts without the gate (`systemctl …`); A3 withdraws the installation.
