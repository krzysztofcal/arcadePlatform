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
- `curl`, `git`, `gzip`, `postgresql-client`, `rsync`, `tar`, `ufw`, `unzip`,
  `openssh-server`, and the GitHub CLI for the external Stage dispatcher and
  runner prerequisites. The PostgreSQL client is required by `DB Stage Apply
  PR` for its direct Stage read-only preflight and migration apply.
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

The current `arcade` membership in privileged `sudo`/`docker` groups and
command-specific deploy grants are intentionally not changed or redefined
here; they are tracked separately under #994. No runner `.credentials` file is
part of the recovery source.

## Network baseline

The fresh-host baseline is UFW default deny for incoming and routed traffic,
allow for outgoing traffic, with inbound TCP 22, 80, and 443. WS port 3000 is
explicitly denied; WS services remain behind Caddy. IPv6 rules must mirror the
public SSH/HTTP/HTTPS rules, and IPv6 must remain enabled for the Stage DB
runner.

## Secret and disposable state boundary

`ws-production.env.example` and `ws-preview.env.example` contain names plus
placeholders/defaults only. The real env files, GitHub CLI authentication, and
any other credential-bearing material must be restored from an encrypted,
off-host source. Never commit or print their values.

Do not back up deployed release trees, `node_modules`, temporary archives,
runner `_work`/`_diag`, npm/NVM caches, Docker caches, `/tmp` state, or
journald output. These are reconstructed or disposable; cleanup is outside
Phase B and belongs to #996.

The Caddyfile is reproducible from Git. Caddy's certificate/account state under
`/var/lib/caddy/.local/share/caddy` is private provider-managed state: retain it
only through an approved encrypted/off-host mechanism if desired, otherwise
allow Caddy to re-obtain certificates after DNS and ports 80/443 are ready.

## Runner contract

Register the repository runner from the documented recovery procedure with
exact labels `self-hosted`, `Linux`, `X64`, and `stage-db-ipv6`. The registration
token is supplied interactively by an owner and is never stored in this repo,
bootstrap script, or a unit file.
