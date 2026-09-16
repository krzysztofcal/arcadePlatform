# Arcade Platform VPS disaster recovery

This is the fresh-server recovery procedure for the production WS VPS. It
restores non-secret machine configuration from this repository and restores
secret-bearing files only from an approved encrypted off-host source. The
bootstrap script does not deploy application code; `WS Server Deploy` and
`WS Preview Deploy` remain the application deployment mechanisms.

Every `PRODUCTION MUTATION` requires separate owner approval. Phase C adds a
local encrypted artifact contract, but this implementation does not read live
secret values, create a live backup, restore any live path, restart/reload a
service, dispatch a workflow, or rotate a key. The full fresh-VPS rehearsal was not performed.

The commands below are a runbook for a future recovery. They were not run as
part of Phase B or Phase C. Every `PRODUCTION MUTATION` requires separate owner
approval; the Phase B and Phase C implementations made no VPS or Production
mutation.

Before any live privilege cutover, the owner must prove an independent root
recovery path: either a tested root SSH login using a separately-held key, or a
working provider console/rescue path that can repair `/etc/sudoers*`, groups,
ownership, or systemd units. Keep that path available during the cutover and
test it read-only before removing broad grants. If it cannot be independently
confirmed, stop; a GitHub deploy key or the `copilot` account is not a root
recovery path.

## Existing-host least-privilege migration — separate owner gate

The procedure below is for an already-running VPS and is separate from this
fresh-server recovery. Never run `infra/vps/bootstrap.sh` to migrate an
existing host. The bootstrap intentionally rejects runtime markers such as
`/opt/ws-server/current`, the Production env, and `.env.preview`.

Before the migration owner GO, collect a fresh read-only inventory and a
non-secret rollback manifest. Record per-entry type, symlink target, owner,
group, mode, ACL/attribute state, and service PID/timestamp baselines. Before
any Preview ownership change, the manifest must contain every existing entry
under `ws-server`, `shared`, `netlify`, and `node_modules`, so each original
ownership and mode can be restored exactly.

The future Task 9 staging is limited to the following sequence:

1. Create `arcade-deploy` if absent and add `copilot`; do not add `arcade`.
2. Set `/opt/ws-server` and `/opt/ws-server/releases` to
   `root:arcade-deploy 2775`.
3. For every directory entry recursively below `/opt/ws-server/releases`
   (including each legacy release root), set group `arcade-deploy` and group
   `rwx` only when same-SHA redeploy support is required. Do not follow
   symlinks; existing Production file and symlink ownership remains
   unchanged. The recursive directory-only change lets `rm -rf
   "$NEW_RELEASE_DIR"` remove a legacy tree without changing its file or
   symlink ownership.
4. Set `/opt/arcade-ws-preview/ws-server`, `shared`, `netlify`, and
   `node_modules` to `root:arcade-deploy 2775`.
5. Set existing descendants of those four Preview subtrees to
   `copilot:arcade-deploy`, preserving their modes and never following
   symlinks. Exclude `/opt/arcade-ws-preview/.env.preview`, which remains
   `root:root 0600`.
6. Set `/etc/caddy/Caddyfile` to `root:arcade-deploy 0664`.
7. Install the fixed Preview env helper and exact narrow sudoers contract,
   validating syntax before and after installation.

All existing broad grants remain during this staging phase. Task 9 performs
no `daemon-reload`, service restart/reload, application deploy, scheduler
dispatch, credential rotation, or database/data mutation. Stop on any
manifest mismatch or runtime-impact ambiguity and use the independent Rescue
System only through a separate owner-approved recovery action.

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
`copilot`, `arcade-stage-runner`, `wslogs`, and `arcade-deploy`
accounts/groups, the `/opt` and runner directories, the IPv6 sysctl baseline,
and the UFW baseline. `copilot` receives `arcade-deploy`; `arcade` does not.
The deployable release directories and Caddyfile are group-owned as documented
in [`infra/vps/README.md`](../infra/vps/README.md), while both env files,
systemd units, and sudoers remain root-owned and protected. Bootstrap installs
the fixed Preview env helper and validates the exact sudoers contract with
`visudo` before installing it. It
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

## 4. Secret artifact operations — PRODUCTION MUTATION / FRESH-VPS MUTATION

### 4a. Create the encrypted artifact — PRODUCTION MUTATION

Creating a backup reads the two active live env files and is therefore a
secret operation requiring separate owner approval. The repository contract is
deliberately local and provider-neutral: `vps-secrets-backup.sh` accepts only a
public `age` recipient and writes one generation directory containing
`manifest.json` and `vps-secrets.tar.age`.

The scope is hardcoded to exactly:

```text
/etc/arcadeplatform/ws-server.env
/opt/arcade-ws-preview/.env.preview
```

The current Preview secret contract is a regular, non-symlinked
`/opt/arcade-ws-preview/.env.preview` owned by `root:root` with mode `0600`.
The Phase A audit observed the historical Preview baseline `arcade:arcade 0664`;
that value is retained as historical context only. Historical plaintext
`.env.preview.*` files are not a recovery source and must not be restored;
recovery relies on the encrypted artifact copied to approved off-host storage.

On an approved host, choose a private local artifact directory and supply the
public recipient from the owner-managed recovery-key record:

```bash
sudo install -d -o root -g root -m 0700 /var/lib/arcadeplatform/secret-backups
sudo ./infra/vps/vps-secrets-backup.sh \
  --output-dir /var/lib/arcadeplatform/secret-backups \
  --recipient "$AGE_RECIPIENT"
```

`AGE_RECIPIENT` is public key material, not a private identity. The script
computes source sizes and SHA-256 values directly for each bounded streaming
attempt, streams `tar -> age -> vps-secrets.tar.age`, retries when the
observable pre/post source checks differ, and creates no plaintext tar/archive
file. A successful generation contains
only the encrypted object and a manifest with metadata and checksums; it never
prints env contents. A failure cannot be reported as success if its temporary
artifact cleanup fails.

This is a bounded consistency check, not a filesystem snapshot. Do not edit
either active env file during the operation; if an external writer is active,
stop and repeat the owner-approved backup procedure after the writer is quiet.

The non-secret manifest fields are `format`, `version`, `timestamp`,
`encrypted_object`, `encrypted_sha256`, and one entry per required file with
`source_path`, `filename`, `plaintext_byte_size`, and `plaintext_sha256`.

Do not add any other path to the artifact. In particular, it excludes runner
`.credentials`, GitHub tokens, historical `.env.preview.*` files, Caddy ACME
state, release trees, `node_modules`, caches, `/tmp`, journald, and Supabase
DB/Storage.

### 4b. Copy and retain the artifact off-host — READ-ONLY

After the command succeeds, verify the generation directory contains only
`manifest.json` and `vps-secrets.tar.age`, and verify the
`encrypted_sha256` value from the manifest without opening or printing the
encrypted payload. Copy the
whole generation directory through an existing owner-controlled off-host
storage channel. This PR adds no uploader or storage provider integration.

The off-host retention policy must retain at least two independently verified
generations, must never delete the last known-good generation, and must keep
the manifest beside its encrypted object. Retention deletion and artifact
rotation are owner-approved off-host operations; do not use this procedure to
delete historical env backups on the VPS.

### 4c. Restore and verify into an isolated directory — FRESH-VPS MUTATION

The restore script requires a new, isolated `--restore-dir`; it rejects the
live Production, Preview, and release roots. It validates the manifest and
encrypted SHA-256, decrypts with `age`, checks the exact archive member names,
then compares the two restored filenames, byte sizes, and SHA-256 values
without printing their contents.

The private identity must be streamed from the owner's off-host key handling
into stdin. Never copy an identity file to the VPS, put it in an environment
file, shell history, Git, or the artifact directory. The following is a
shape-only example; `OWNER_OFF_HOST_IDENTITY_STREAM` must be an external
owner-controlled producer, not a VPS path:

```bash
RESTORE_PARENT="$(mktemp -d /var/tmp/arcadeplatform-vps-restore.XXXXXX)"
RESTORE_DIR="$RESTORE_PARENT/verified-secrets"

OWNER_OFF_HOST_IDENTITY_STREAM \
  | sudo ./infra/vps/vps-secrets-restore.sh \
      --artifact-dir /var/lib/arcadeplatform/secret-backups/arcadeplatform-vps-secrets-<UTC> \
      --restore-dir "$RESTORE_DIR" \
      --identity-stdin
```

The script keeps the decrypted archive only in a temporary directory during
verification and removes that archive and directory before returning success.
The verified plaintext files remain only in the explicitly isolated
`RESTORE_DIR` until the operator completes the verification and cleanup:

```bash
sudo rm -rf -- "$RESTORE_DIR"
sudo rmdir -- "$RESTORE_PARENT"
```

Those commands are limited to the newly-created dedicated restore directory;
never substitute a live path or a broad parent directory. A failed restore
also attempts to remove the newly-created isolated target and fails closed if
cleanup cannot be confirmed.

### 4d. Place verified env files on live paths — PRODUCTION MUTATION

This live placement is intentionally not implemented or executed in Phase C.
After a successful isolated verification and a separate owner approval, the
owner-controlled recovery procedure may write the verified values to exactly
`/etc/arcadeplatform/ws-server.env` and
`/opt/arcade-ws-preview/.env.preview`, preserving the active `root:root 0600`
ownership/mode contract. `vps-secrets-restore.sh` has no live mode and rejects
live targets; do not bypass that safety boundary in this PR. Never use the
repository examples as a source of live secret values.

### 4e. Recovery-key handling and rotation — READ-ONLY

The public `age` recipient may be recorded with the non-secret recovery
contract. The private identity key belongs only in an owner-approved external
key store. It must not be stored on the VPS, in Git, in runner credentials,
or in the artifact. If the recipient key is rotated, create a new generation,
verify its isolated restore, retain the previous known-good generation until
that verification is complete, and document the owner approval separately.

## 5. Install and activate Caddy — PRODUCTION MUTATION

The repository [`infra/vps/Caddyfile`](../infra/vps/Caddyfile) is the source of
truth for both `ws.kcswh.pl` and `ws-preview.kcswh.pl`. Bootstrap places it at
`/etc/caddy/Caddyfile`. Validate it before activation:

```bash
sudo -u copilot caddy validate --config /etc/caddy/Caddyfile
sudo systemctl cat caddy
```

After separate owner approval, enable/start Caddy and verify that DNS points to
the host and ports 80/443 are reachable. Caddy's certificate/account state is
provider-managed private state under `/var/lib/caddy/.local/share/caddy`; it is
not included in the Phase C artifact. Recreate it after DNS and ports 80/443
are ready. A separate ACME-state recovery would require a new owner-approved
scope and is not part of this runbook.

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
Phase C implementation. Verify its unit/timer state and bounded journal output
read-only after an approved recovery activation.

## 9. Deploy Production through the existing workflow — PRODUCTION MUTATION

After Caddy, env, directories, and the owner-approved Production service
activation prerequisites are ready, use the existing **WS Server Deploy**
workflow for the approved application revision. It builds the artifact,
performs the atomic release switch under `/opt/ws-server/releases` as
`copilot` through `arcade-deploy`, uses only the exact
`/usr/bin/systemctl restart ws-server.service` root operation, and runs its
local/public health gates and runner WS smoke-check. Do not copy source trees
or `node_modules` from a backup and do not add an application deployment path
to `bootstrap.sh`.

The workflow may be invoked through its existing approved push or
`workflow_dispatch` path. This runbook records the contract only; Phase B and
Phase C did not dispatch it. Any Production deployment, restart, or rollback requires
separate owner approval.

## 10. Deploy Preview through the existing workflow — FRESH-VPS MUTATION

Use the existing manual **WS Preview Deploy** workflow with the approved
`ref`. It reconstructs `/opt/arcade-ws-preview/ws-server`, preserves the
external Preview env file after its `root:root 0600` regular-file preflight,
performs file operations only in the four `arcade-deploy` Preview subtrees,
invokes only the fixed root-owned env preflight and exact
`/usr/bin/systemctl restart ws-server-preview.service`, and checks
local/public Preview health. It does not manage Caddy and it is not a
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
