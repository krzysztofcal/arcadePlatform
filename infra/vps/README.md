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

The fresh-host contract creates the system group `arcade-deploy` and adds only
`copilot` to it. `arcade` is not added to `arcade-deploy`, `sudo`, or `docker`
by bootstrap. The deploy group owns only application state:

- Production: `/opt/ws-server` and `/opt/ws-server/releases`,
  `root:arcade-deploy` mode `2775`;
- Preview: `/opt/arcade-ws-preview/ws-server`, `shared`, `netlify`, and
  `node_modules`, each `root:arcade-deploy` mode `2775`;
- Caddy: `/etc/caddy/Caddyfile`, `root:arcade-deploy` mode `0664`.

The Preview env file and Production env file remain `root:root` mode `0600`.
Systemd units, `/etc/sudoers*`, and the Preview root directory remain
root-owned and are not group-writable. The root-owned fixed Preview env helper
is installed at `/usr/local/sbin/arcade-ws-preview-env-preflight`.

The versioned `/etc/sudoers.d/arcade-deploy` contract gives `copilot` only the
exact service restart/reload commands and the fixed Preview env preflight. It
contains no shell, interpreter, archive, file-operation, generic
`systemctl`, or wildcard grant. No runner `.credentials` file is part of the
recovery source.

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
