# VPS recovery configuration

This directory contains the non-secret configuration needed to rebuild the
Arcade Platform VPS. It is a recovery source, not an application deployment
system. `WS Server Deploy` and `WS Preview Deploy` remain the only application
deployment workflows.

## Supported baseline

- Ubuntu 24.04 LTS.
- Node.js 20.x at `/usr/bin/node`.
- Caddy from the supported Ubuntu package source, with the repository
  `Caddyfile` installed at `/etc/caddy/Caddyfile`.
- Bootstrap runtime-masks `caddy.service` during package installation, then
  removes the temporary mask and leaves Caddy disabled and unstarted until
  the owner-approved activation step in the recovery runbook.
- `age`, `curl`, `git`, `gzip`, `postgresql-client`, `rsync`, `tar`, `ufw`,
  `unzip`, `openssh-server`, and the GitHub CLI for the external Stage
  dispatcher and runner prerequisites. `age` is used by the local encrypted
  VPS secret artifact contract; only its public recipient is supplied to the
  backup command. The PostgreSQL client is required by `DB Stage Apply PR` for
  its direct Stage read-only preflight and migration apply.
- IPv6 enabled with a working provider route. The self-hosted Stage DB runner
  must be able to reach the direct Stage PostgreSQL endpoint over IPv6.

## Accounts, groups, and directories

The WS services run as `arcade:arcade`. The production release layout is
`/opt/ws-server/releases` with `/opt/ws-server/current` pointing at the active
release. Preview uses `/opt/arcade-ws-preview/ws-server` and its external env
file at `/opt/arcade-ws-preview/.env.preview`.

The Stage dispatcher runs as `copilot` with `HOME=/home/copilot` and
`GH_CONFIG_DIR=/home/copilot/.config/gh`. The self-hosted runner uses the
dedicated `arcade-stage-runner` account under
`/var/lib/arcade-stage-runner/actions-runner`.

The bootstrap creates the system group `arcade-deploy` and adds only `copilot`
to it. `arcade` is not added to `arcade-deploy`, `sudo`, or `docker` by
bootstrap. The deploy group owns only application state:

- Production: `/opt/ws-server` and `/opt/ws-server/releases`,
  `root:arcade-deploy` mode `2775`;
- Preview: `/opt/arcade-ws-preview/ws-server`, `shared`, `netlify`, and
  `node_modules`, each `root:arcade-deploy` mode `2775`;
- Caddy: `/etc/caddy/Caddyfile`, `root:arcade-deploy` mode `0664`.

The Preview env file and Production env file remain `root:root` mode `0600`.
Systemd units, `/etc/sudoers*`, the Preview root directory, and the fixed
Preview env helper remain root-owned and are not group-writable. The helper is
installed at `/usr/local/sbin/arcade-ws-preview-env-preflight`.

The versioned `/etc/sudoers.d/arcade-deploy` contract gives `copilot` only the
exact Preview restart, Production restart, Caddy reload, and fixed Preview env
preflight commands. It contains no shell, interpreter, archive, file
operation, generic `systemctl`, or wildcard grant. No runner `.credentials`
file is part of the recovery source.

The production `WS_USER` GitHub Actions secret used by both the WS Server and
Infra VPS workflows must resolve to `copilot` before either Phase B workflow is
used. The corresponding `WS_SSH_KEY` must be authorized for that account.
Secret values are owner-managed and are never recorded here; changing the
secret is a separate owner gate from filesystem staging.

### Existing-host least-privilege migration — separate from bootstrap

This is a future owner-approved migration for an already-running VPS. It is
not a bootstrap mode. `infra/vps/bootstrap.sh` is guarded for a fresh VPS and
must not be run against an existing host with runtime markers, active releases,
or live env files.

Before any migration mutation, perform a fresh read-only inventory and save a
non-secret rollback manifest. The manifest must record per-entry type,
symlink target, owner, group, mode, ACL/attribute state, and the service
identity/PID baseline. Save a per-entry manifest for every existing entry
under the four Preview deployable subtrees before changing Preview ownership,
and every Production release directory entry whose directory metadata will be
changed. Record Production files and symlinks as well so the directory-only
migration can prove their ownership was not altered.

The owner-approved migration has separate Preview and Production/Caddy stages.
Phase A already staged only Preview. The Phase B staging order is:

1. Create `arcade-deploy` if absent and add only `copilot` to it. Do not add
   `arcade`; retain its existing groups during staging.
2. Change `/opt/ws-server` and `/opt/ws-server/releases` to
   `root:arcade-deploy` mode `2775`.
3. For every real directory recursively below `/opt/ws-server/releases`,
   including each legacy release root, set group `arcade-deploy` and group
   `rwx` without changing existing file or symlink ownership. Do not follow
   symlinks. This is required for `rm -rf "$NEW_RELEASE_DIR"` when the
   workflow redeploys an existing SHA; changing only the release root would
   leave nested `root:root 0755` directories undeletable by `copilot`.
4. Re-verify the completed Phase A Preview contract read-only. Do not remigrate
   the four Preview subtrees or touch `/opt/arcade-ws-preview/.env.preview`.
5. Change `/etc/caddy/Caddyfile` to `root:arcade-deploy` mode `0664`. Keep its
   parent `/etc/caddy` root-owned and non-group-writable.
6. Verify the root-owned Preview env helper and install/validate the exact
   four-command sudoers contract from this repository. Keep the helper
   `root:root 0755` and sudoers `root:root 0440`.

During Task 9 staging, retain all existing broad grants as a recovery
fallback. Do not run `daemon-reload`, restart or reload a service, or dispatch
any deploy. If any pre-migration manifest or post-migration validation does
not match the contract, stop and restore the recorded ownership/modes before
proceeding. The independent provider Rescue System remains the recovery path
if SSH or sudo becomes unusable.

Before Task 10, repeat the systemd read-only audit. If `NeedDaemonReload=yes`
is reported, obtain a separate owner approval for the required `daemon-reload`
before any service restart; do not treat the warning as cleared by a normal
restart.

## Network baseline

The fresh-host baseline is UFW default deny for incoming and routed traffic,
allow for outgoing traffic, with inbound TCP 22, 80, and 443. WS port 3000 is
explicitly denied; WS services remain behind Caddy. IPv6 rules must mirror the
public SSH/HTTP/HTTPS rules, and IPv6 must remain enabled for the Stage DB
runner.

## Secret and disposable state boundary

`ws-production.env.example` and `ws-preview.env.example` contain names plus
placeholders/defaults only. The two real env files are the only secret-bearing
files in the Phase C artifact. GitHub CLI authentication and any other
credential-bearing material use separate owner-managed external contracts and
are not included in this artifact. The active Preview env file must be a
regular, non-symlinked file owned by `root:root` with mode `0600`. Phase A
observed the historical `arcade:arcade 0664` Preview baseline; historical
plaintext `.env.preview.*` files are not a recovery source. Never commit or
print secret values.

The Phase C secret artifact contract is implemented by
`vps-secrets-backup.sh` and `vps-secrets-restore.sh`. The backup hardcodes the
two active env files, streams `tar` directly into `age`, and writes a
non-secret `manifest.json` beside the encrypted `vps-secrets.tar.age` object.
The restore accepts the private age identity only through stdin and writes
only to a newly-created isolated directory; live restore is intentionally
disabled in this contract. Copy the completed artifact directory to approved
off-host storage using an existing owner-controlled channel.

Do not back up deployed release trees, `node_modules`, temporary archives,
historical `.env.preview.*` files, runner `_work`/`_diag`, npm/NVM caches,
Docker caches, `/tmp` state, journald output, Caddy ACME state, or Supabase
DB/Storage. These are reconstructed or disposable; cleanup is outside this
recovery contract and belongs to #996.

## Weekly VPS maintenance

`arcadeplatform-vps-maintenance.service` is a `copilot` `oneshot` installed from
this directory and invoked only through
`/usr/local/sbin/arcadeplatform-vps-maintenance.sh --apply`. Its persistent weekly
timer is scheduled for Sunday 03:30 UTC. Bootstrap installs both units, the
script, and the shared regular lock
`/opt/ws-server/.deploy-maintenance.lock` (`root:arcade-deploy`, `0660`), then
runs `systemctl daemon-reload`; it neither runs maintenance nor enables the
timer.

The Production deploy and maintenance paths use that same lock and fail closed
if it is unavailable or busy. Production waits up to 300 seconds for the lock;
maintenance remains non-blocking and skips a run when the lock is busy. The
first Production deploy on an existing host performs a bounded, non-restarting
pre-stage before artifact upload: it verifies that the SSH session is actually
`copilot`, rejects symlinked fixed Production directories, creates the missing
regular lock if necessary, and validates/normalizes it to `arcade-deploy` group
and mode `0660`. If that pre-stage cannot complete safely, the deploy stops
before any release or service mutation. Fresh-host bootstrap still creates the
lock as `root:arcade-deploy`.

The maintenance command is read-only with no arguments or with `--dry-run`;
only an explicit `--apply` permits deletion, and the systemd service is the
only scheduled caller using `--apply`. The service runs as `copilot`: the
`arcade-deploy` group permits release cleanup, and Production/Preview workflow
temporary directories are created by the `copilot` deploy user. Automatic
temporary cleanup additionally requires the exact directory owner to be
`copilot`, so the current legacy directories owned by `arcade` are skipped.
After a fresh owner-approved read-only inventory, those legacy directories may
be handled by a separate one-time root cleanup; they are not part of the
weekly automation. No service restart is part of maintenance.

Release cleanup treats a valid release-root `.deployed-at` marker as taking
precedence over all filesystem metadata. A markerless legacy release is
eligible only after its positive birth-time value from `stat %W` is validated;
invalid or unavailable metadata aborts cleanup before deletion. Automated
cleanup considers only direct release directories whose complete basename is a
40-character lowercase Git SHA. Manual/non-SHA releases are left untouched
and require separate owner-approved cleanup. The job retains `current` plus
the five newest previous SHA releases and considers only older releases beyond
7 days. Temporary cleanup is limited to direct `/tmp` directories whose full
basename matches exactly
`arcadeplatform-ws-<numeric run_id>-<numeric attempt>` or
`arcadeplatform-infra-<numeric run_id>-<numeric attempt>`, older than 48 hours.

An owner must first complete an owner-approved read-only review, then may run:

```bash
systemctl enable --now arcadeplatform-vps-maintenance.timer
```

That review is also a prerequisite for any deferred one-time root-level
reconciliation. It must inventory Docker with `docker ps -a` and
`docker system df -v`, runner state, process/PID state, and local
Postgres/cache ownership before any separately approved exact cleanup. Broad
prune and broad kill commands are prohibited. Recovery backups, secrets,
`.env` files, and active services remain outside the cleanup boundary; do not
record live inventory values or secret contents in this repository.

The Caddyfile is reproducible from Git. Caddy's certificate/account state under
`/var/lib/caddy/.local/share/caddy` is private provider-managed state and is not
included in the Phase C secret artifact. Allow Caddy to re-obtain certificates
after DNS and ports 80/443 are ready; any separate ACME-state recovery needs a
new owner-approved scope.

## Runner contract

Register the repository runner from the documented recovery procedure with
exact labels `self-hosted`, `Linux`, `X64`, and `stage-db-ipv6`. The registration
token is supplied interactively by an owner and is never stored in this repo,
bootstrap script, or a unit file.
