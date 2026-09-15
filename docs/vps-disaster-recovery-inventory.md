# VPS disaster recovery inventory (Phase A)

This inventory records the non-destructive Phase A baseline needed for
recovery. It intentionally contains paths, classifications, and actions only;
disposable state is identified without enumerating transient contents;
it contains no secret values, tokens, runner credential contents, or transient
runtime dumps.

| Component | Path | Classification | Source of truth | Recovery action |
| --- | --- | --- | --- | --- |
| Unified Caddy config | `/etc/caddy/Caddyfile` | Reproducible repository configuration | `infra/vps/Caddyfile` | Install the file, validate it, then owner-approved Caddy activation; automatic TLS state is recreated or restored only from an approved private source |
| Caddy package service | `/usr/lib/systemd/system/caddy.service` | Package-managed prerequisite | Supported Ubuntu package, current service contract | Install Caddy; do not copy package files into Git |
| Caddy certificate/account state | `/var/lib/caddy/.local/share/caddy` | Private provider-managed state, safely recreatable after DNS/80/443 readiness | Caddy package/runtime | Optionally restore through encrypted off-host backup; otherwise let Caddy obtain certificates again |
| Production WS unit | `/etc/systemd/system/ws-server.service` | Configuration that should be versioned | `infra/vps/ws-server.service` | Install unit, preserve `arcade:arcade`, `/opt/ws-server/current`, absolute Node entrypoint, restart policy, hardening and `/opt/ws-server` write boundary |
| Production WS env drop-in | `/etc/systemd/system/ws-server.service.d/override.conf` | Configuration that should be versioned | `infra/vps/ws-server.service.d/override.conf` | Install drop-in with required `EnvironmentFile=/etc/arcadeplatform/ws-server.env` |
| Production WS environment | `/etc/arcadeplatform/ws-server.env` | Secret/private state; names only in repo | Encrypted off-host secret backup and the env schema example | Restore exact values out-of-band; current Phase A ownership/mode was `root:root 0600`; never commit or print values |
| Production release layout | `/opt/ws-server`, `/opt/ws-server/releases`, `/opt/ws-server/current` | Reconstructible application/runtime state | `WS Server Deploy` workflow and unit contract | Create empty layout; deploy approved artifacts through the existing workflow; exclude source trees, `node_modules`, releases and caches from backup |
| Preview WS unit | `/etc/systemd/system/ws-server-preview.service` | Configuration that should be versioned | `infra/vps/ws-server-preview.service.example` | Install unit with `arcade`, `/opt/arcade-ws-preview/ws-server`, external env path and port 3001 |
| Preview WS environment | `/opt/arcade-ws-preview/.env.preview` | Secret/private state; names only in repo | Encrypted off-host secret backup and the env schema example | Restore exact Stage-targeted values out-of-band; Phase A observed `arcade:arcade 0664`; hardening/old plaintext backup retirement belongs to #995 |
| Preview release layout | `/opt/arcade-ws-preview`, `/opt/arcade-ws-preview/ws-server` | Reconstructible application/runtime state | `WS Preview Deploy` workflow and unit contract | Create empty layout; deploy an approved ref through the existing manual workflow; exclude release/build/cache state |
| Stage scheduler service | `/etc/systemd/system/arcade-chips-ledger-dispatch.service` | Configuration that should be versioned | `infra/vps/arcade-chips-ledger-dispatch.service` | Install as `copilot`, restore GitHub CLI auth externally, and enable only in an owner-approved recovery |
| Stage scheduler timer | `/etc/systemd/system/arcade-chips-ledger-dispatch.timer` | Configuration that should be versioned | `infra/vps/arcade-chips-ledger-dispatch.timer` | Install the 15-minute and `02:04 UTC` calendar; do not add the future Production retention scheduler from #891 |
| Stage dispatcher | `/usr/local/bin/arcade-chips-ledger-dispatch.sh` | Configuration/script that should be versioned | `infra/vps/arcade-chips-ledger-dispatch.sh` | Install executable; it only wakes existing GitHub workflows, holds no Supabase credentials, and is not invoked during implementation |
| GitHub CLI binary/config | `/home/copilot/.local/bin/gh`, `/home/copilot/.config/gh` | Binary is reproducible; auth config is private credential state | Ubuntu package plus external owner-managed GitHub CLI authentication | Install/re-authenticate with minimum workflow-dispatch/content-read capability; do not back up or commit token contents |
| Stage self-hosted runner | `/var/lib/arcade-stage-runner/actions-runner` | Reproducible installation with private registration state | Official GitHub Actions runner release and repository registration | Install under `arcade-stage-runner`, re-register with a fresh owner-provided token, use exact labels `self-hosted`, `Linux`, `X64`, `stage-db-ipv6`; Do not restore runner `.credentials` |
| Runner service | `/etc/systemd/system/actions.runner.krzysztofcal-arcadePlatform.arcadePlatform-stage-db-ipv6-ubuntu-4gb-nbg1-2.service` | Generated/reproducible from runner registration; hardening contract must be retained | Runner `svc.sh` plus generated unit override | Re-register and reinstall the service; preserve private work directory, hardening flags, and inaccessible WS paths |
| Runner work/diagnostics | `/var/lib/arcade-stage-runner/actions-runner/_work`, `/var/lib/arcade-stage-runner/actions-runner/_diag` | Disposable runtime/build state | Runner runtime | Recreate empty directories; do not back up; cleanup policy is outside Phase B/#996 |
| Runtime users/groups | `arcade`, `copilot`, `arcade-stage-runner`, `wslogs` | Reproducible machine prerequisites | Unit/scheduler/runner contracts and bootstrap | Create accounts/groups and required ownership; do not alter current privileged `sudo`/`docker` membership or deploy grants under #994 |
| UFW/network baseline | UFW defaults plus TCP 22/80/443 and explicit deny TCP 3000, IPv4+IPv6 | Reproducible machine configuration | Phase A `ufw status verbose`, provider IPv6 route, bootstrap | Apply baseline on a fresh host; keep WS ports private and verify IPv6 route for Stage DB runner |
| Stage DB network dependency | Provider IPv6 address/default route and direct Stage PostgreSQL reachability | External prerequisite, not a database backup | `DB Stage Apply PR` runner label/contract | Verify IPv6 before runner jobs; do not change Supabase or store Stage DB credentials in VPS recovery files |
| Journald | `/var/log/journal` and service journal | Disposable operational evidence | Ubuntu/systemd defaults | Recreate defaults and inspect bounded output when troubleshooting; do not include routine logs in recovery backup |
| Temporary/cache/Docker state | `/tmp`, npm/NVM caches, Docker images/volumes/build cache, stale worktrees/processes | Disposable runtime/build artifacts | Host runtime, not a recovery source | Exclude from backup; bounded cleanup is explicitly outside Phase B and tracked by #996 |
| Supabase data/Storage | External Stage/Production projects | Separate durability domain, outside this VPS recovery scope | Supabase's own backup/retention controls | Do not touch, back up, restore, or mutate through bootstrap or this issue |

## Recovery boundary

The repository versions non-secret machine configuration. Encrypted off-host
storage is required for the two active WS env files and owner-managed GitHub
authentication. The runner credential path
`/var/lib/arcade-stage-runner/actions-runner/.credentials` and its generated
variants are excluded. Runner `.credentials` files, secret values, caches,
deployed source, `node_modules`, temporary release archives, Docker state, and
routine journald output are excluded. #994 (least-privilege sudo/token
hardening), #995 (Preview secret permissions/plaintext backups), and #996
(runtime/disk cleanup) remain separate follow-up work and were not implemented
here.
