# Arcade Platform VPS disaster recovery

This is the fresh-server recovery procedure for the production WS VPS. It
restores non-secret machine configuration from this repository and restores
secret-bearing files only from an approved encrypted off-host source. The
bootstrap script does not deploy application code; `WS Server Deploy` and
`WS Preview Deploy` remain the application deployment mechanisms.

The commands below are a runbook for a future recovery. They were not run as
part of Phase B. Every `PRODUCTION MUTATION` requires separate owner approval;
the Phase B implementation itself made no VPS or Production mutation.

## 1. Confirm the supported host — READ-ONLY

Start with a fresh Ubuntu 24.04 LTS VPS. Verify the image and architecture
before installing anything:

```bash
cat /etc/os-release
uname -m
```

The supported baseline is Ubuntu 24.04 LTS with Node.js 20.x, Caddy 2.x, and
the packages listed in [`infra/vps/README.md`](../infra/vps/README.md). The
provider must assign working IPv6 address and default-route support; this is
required for the self-hosted Stage DB runner.

## 2. Prepare packages, accounts, directories, and network — FRESH-VPS MUTATION

Clone or otherwise place the approved repository revision on the fresh host.
Run the repository bootstrap only on that fresh host:

```bash
sudo env \
  ARCADEPLATFORM_BOOTSTRAP_TARGET=fresh-vps \
  ARCADEPLATFORM_REPO_ROOT="$PWD" \
  ./infra/vps/bootstrap.sh
```

The bootstrap installs Node.js 20 when needed, Caddy, the deployment/runtime
utilities including `postgresql-client`, runner libraries, the `arcade`,
`copilot`, `arcade-stage-runner`, and `wslogs` accounts/groups, the `/opt` and
runner directories, the IPv6 sysctl baseline, and the UFW baseline. It
runtime-masks `caddy.service` during package installation to prevent a package
auto-start, then removes the temporary mask and disables Caddy without
starting it. It installs but does not enable or
start the WS services or Stage scheduler, and it does not register a runner,
restore secrets, contact Supabase, dispatch a workflow, deploy application
code, or run cleanup.

The expected inbound network policy is default deny for incoming and routed
traffic, allow for outgoing traffic, and allow TCP 22, 80, and 443 on both
IPv4 and IPv6. TCP 3000 is explicitly denied; port 3001 remains private by
the default deny policy. Do not expose either WS port directly.

## 3. Verify installed repository configuration — READ-ONLY

Check that the bootstrap placed the versioned files without activating their
services:

```bash
sudo systemctl cat ws-server.service
sudo systemctl cat ws-server-preview.service
sudo systemctl cat arcade-chips-ledger-dispatch.service
sudo systemctl cat arcade-chips-ledger-dispatch.timer
sudo systemctl is-enabled ws-server.service ws-server-preview.service || true
sudo systemctl is-enabled arcade-chips-ledger-dispatch.timer || true
```

The production unit must retain `User=arcade`, `Group=arcade`,
`WorkingDirectory=/opt/ws-server/current`, the absolute `/usr/bin/env node`
entrypoint, `Restart=always`, `RestartSec=2`, the existing hardening flags, and
`ReadWritePaths=/opt/ws-server`. Its drop-in loads
`/etc/arcadeplatform/ws-server.env` without adding a second runtime path.

## 4. Restore secret environment files — FRESH-VPS MUTATION

Retrieve the exact current Production and Preview env files from the approved
encrypted off-host recovery source. Verify the backup object/file integrity
before restoring it, and never paste values into a shell command or log.

Restore only the two active files:

```bash
sudo install -o root -g root -m 0600 \
  /path/from/approved-secret-source/ws-server.env \
  /etc/arcadeplatform/ws-server.env
sudo install -o arcade -g arcade -m 0664 \
  /path/from/approved-secret-source/.env.preview \
  /opt/arcade-ws-preview/.env.preview
```

The Production baseline observed in Phase A is `root:root` mode `0600`. The
current Preview baseline observed in Phase A is `arcade:arcade` mode `0664`,
and historical plaintext `.env.preview.*` files must not be restored. Preview
permission hardening and retirement of old plaintext copies belong to #995 and
are not implemented by this Phase B change. Update this step only after that
separate owner-approved contract changes.

Compare variable names, never values, with the repository examples:

```bash
sudo awk -F= '/^[A-Z][A-Z0-9_]*=/{print $1}' /etc/arcadeplatform/ws-server.env
sudo awk -F= '/^[A-Z][A-Z0-9_]*=/{print $1}' /opt/arcade-ws-preview/.env.preview
```

The off-host backup contract must be encrypted, retained and rotated outside
the VPS, with integrity verification and a tested restore procedure. It must
include only the active secret env files and any explicitly approved
credential-bearing recovery material; it must exclude values from Git,
comments, logs, tickets, and this repository.

## 5. Install and activate Caddy — PRODUCTION MUTATION

The repository [`infra/vps/Caddyfile`](../infra/vps/Caddyfile) is the source of
truth for both `ws.kcswh.pl` and `ws-preview.kcswh.pl`. Bootstrap places it at
`/etc/caddy/Caddyfile`. Validate it before activation:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl cat caddy
```

After separate owner approval, enable/start Caddy and verify that DNS points to
the host and ports 80/443 are reachable. Caddy's certificate/account state is
provider-managed private state under `/var/lib/caddy/.local/share/caddy`; it
may be restored only through an approved encrypted/off-host mechanism, or
recreated after DNS and ports 80/443 are ready. It is not committed here.

## 6. Apply Production and Preview systemd units — FRESH-VPS MUTATION / PRODUCTION MUTATION

Bootstrap installs the Production unit, its env drop-in, and the existing
Preview unit, then performs only the required systemd manager reload. It does
not start services. After the corresponding env files and application
directories exist, the owner-approved activation sequence is:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ws-server.service ws-server-preview.service
```

Starting or restarting `ws-server.service` is a `PRODUCTION MUTATION`. Start
Preview only after its Preview artifact has been deployed. Do not create a
second application supervisor or replace either existing deployment workflow.

## 7. Re-register the GitHub self-hosted runner — FRESH-VPS MUTATION

Install the runner from the official GitHub Actions runner release for the
host architecture under:

```text
/var/lib/arcade-stage-runner/actions-runner
```

Run it as the dedicated `arcade-stage-runner` account. Register it for
`https://github.com/krzysztofcal/arcadePlatform` with the exact labels:

```text
self-hosted
Linux
X64
stage-db-ipv6
```

Use a short-lived owner-provided registration token interactively; never put
it in this repository, a shell script, a unit file, or shell history. The
registration shape is equivalent to:

```bash
sudo -u arcade-stage-runner ./config.sh \
  --url https://github.com/krzysztofcal/arcadePlatform \
  --token "$RUNNER_REGISTRATION_TOKEN" \
  --name arcadePlatform-stage-db-ipv6-ubuntu-4gb-nbg1-2 \
  --labels self-hosted,Linux,X64,stage-db-ipv6 \
  --work _work \
  --unattended --replace
sudo ./svc.sh install arcade-stage-runner
sudo systemctl enable --now actions.runner.krzysztofcal-arcadePlatform.arcadePlatform-stage-db-ipv6-ubuntu-4gb-nbg1-2.service
```

Do not restore runner .credentials files or any other runner credential
contents. Re-registration creates fresh credentials.
Confirm the generated service
keeps the current runner hardening and prevents access to
`/opt/ws-server`/`/opt/arcade-ws-preview`. Confirm the host has IPv6 routing to
the direct Stage PostgreSQL endpoint before allowing `DB Stage Apply PR` jobs
to run; this runner is not a Production database backup mechanism.

## 8. Restore and activate the Stage external scheduler — FRESH-VPS MUTATION

The versioned scheduler is a wake-up/dispatch component only. It runs as
`copilot`, uses `/home/copilot/.local/bin/gh` and
`/home/copilot/.config/gh`, dispatches the existing Stage workflows on `main`,
and holds no Supabase credentials. Restore GitHub CLI authentication from the
approved external source or authenticate interactively with the minimum
repository-read/workflow-dispatch capability. Never store its token in Git or
in the scheduler unit.

The scheduler contract is:

- `02:04 UTC`: `external-existing-30d`;
- minute `02,17,32,47`: `external-scheduled-automatic` after its active-run
  guard;
- minute `03,18,33,48`: the existing Stage resource-health wake-up;
- no Production retention scheduler from #891.

Only after separate owner approval for Stage automation should the timer be
enabled and started on the fresh host:

```bash
sudo systemctl daemon-reload
sudo systemctl enable arcade-chips-ledger-dispatch.timer
sudo systemctl start arcade-chips-ledger-dispatch.timer
```

Do not manually invoke the dispatcher or dispatch a workflow during this
Phase B implementation. Verify its unit/timer state and bounded journal output
read-only after an approved recovery activation.

## 9. Deploy Production through the existing workflow — PRODUCTION MUTATION

After Caddy, env, directories, and the owner-approved Production service
activation prerequisites are ready, use the existing **WS Server Deploy**
workflow for the approved application revision. It builds the artifact,
performs the atomic release switch under `/opt/ws-server/releases`, restarts
the Production unit, and runs its local/public health gates and runner WS
smoke-check. Do not copy source trees or `node_modules` from a backup and do
not add an application deployment path to `bootstrap.sh`.

The workflow may be invoked through its existing approved push or
`workflow_dispatch` path. This runbook records the contract only; Phase B did
not dispatch it. Any Production deployment, restart, or rollback requires
separate owner approval.

## 10. Deploy Preview through the existing workflow — FRESH-VPS MUTATION

Use the existing manual **WS Preview Deploy** workflow with the approved
`ref`. It reconstructs `/opt/arcade-ws-preview/ws-server`, preserves the
external Preview env file, restarts only `ws-server-preview.service`, and
checks local/public Preview health. It does not manage Caddy and it is not a
Production deployment. Do not auto-dispatch it from this recovery bootstrap.

## 11. Check local and public health — READ-ONLY

After the owner-approved activations and deployments, check both local service
ports and both public Caddy routes:

```bash
curl --fail --silent http://127.0.0.1:3000/healthz
curl --fail --silent http://127.0.0.1:3001/healthz
curl --fail --silent https://ws.kcswh.pl/healthz
curl --fail --silent https://ws-preview.kcswh.pl/healthz
sudo systemctl is-active ws-server.service ws-server-preview.service caddy
```

Each health endpoint must return `ok`. Inspect only bounded, non-secret
journal diagnostics if a check fails; do not print env file values or tokens.

## 12. Verify the WebSocket handshake — READ-ONLY

Run the existing runner smoke-check or an equivalent client against `/ws` for
both public hosts. Confirm a valid HTTP 101 upgrade, the expected
`Sec-WebSocket-Accept`, and a `helloAck` response after the protocol hello.
Verify that Production routes to port 3000 and Preview routes to port 3001;
neither port should be directly reachable through UFW.

## 13. Reboot persistence check — PRODUCTION MUTATION

Only after separate owner approval, reboot the recovered host:

```bash
sudo reboot
```

This is a service-availability mutation. Do not use it as an implementation
test against the current Production VPS.

## 14. Verify after reboot — READ-ONLY

Once SSH returns, repeat the read-only checks:

```bash
sudo systemctl is-active caddy ws-server.service ws-server-preview.service
sudo systemctl is-active arcade-chips-ledger-dispatch.timer
curl --fail --silent https://ws.kcswh.pl/healthz
curl --fail --silent https://ws-preview.kcswh.pl/healthz
```

Confirm the runner is online with all four labels, IPv6 remains enabled, the
timer is waiting on its expected calendar, both WS handshakes succeed, and no
Production or Preview service is in a failed state. Keep any provider snapshot,
secret-backup receipt, runner registration token, and live credential contents
outside this repository.
