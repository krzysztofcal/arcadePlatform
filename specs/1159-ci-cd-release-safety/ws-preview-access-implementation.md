# WS Preview isolation implementation / activation handoff (#1159)

Implements [the approved design](ws-preview-access.md), including OWNER's Stage hard-kick decision.
This follow-up prepares code only. Installation, service operations, Environment/secret changes,
DRAIN removal and deployment require separate GO. The dedicated public key remains unchanged.

## Minimal plan and Constitution Check

- Keep the existing catalog, requester/OWNER separation, journal, shared lock and exact-SHA deployment.
- Remove standalone safe-stop, receipt and external isolation-preflight; no new package or workflow.
- Complete read-only configuration, identity, source inventory, SSH and sudo syntax preflight first.
- Provision stops only `ws-server-preview.service`, checks inactive/MainPID=0 and empty cgroup,
  then creates backup/accounts and switches Preview files. Occupied tables do not block Stage stop.
- Rollback requires already stopped Preview and empty cgroup; neither operation starts a service.
- Remove only Preview presence counters; Production HOLD/DRAIN, escrow and recovery stay unchanged.
- Fundamental fixture/contract tests, required CI and independent Claude review precede Draft handoff.
- Live runtime verification remains pending separate OWNER authorization; green CI is not deployment.

The Python module runs only through the existing fixed catalog with `python3 -I -B`, a fixed action
and numeric run ID. No configurable unit, path, account, key or shell command is accepted.

## Filesystem and identity contract

Provisioning refuses pre-existing target users/groups/home/configuration and any previous backup.
It creates `arcade-preview-deploy` (only its own primary group, root-owned home, Bash for existing
SCP/SSH actions) and `arcade-preview` (different UID/group, no login). The deployer's entire effective
sudo listing must equal the two-command Preview allowlist; the runtime must have no sudo rights.
Unexpected inherited rules or groups block before enabling the key.

Only a public Ed25519 key is accepted in `infra/vps/ws-preview-owner.pub`. OWNER supplied the
dedicated public key with fingerprint `SHA256:CcBapvgkJbBbcg6WpR6a59xx4NwEpZxDzfRmH7anVAI`.
It differs from the keys in the read-only `copilot` authorized_keys audit. No private key was received,
generated or copied. The public asset is not installed on the VPS by this PR. Replacing it requires
review of the updated diff and reinstalling the reviewed public asset.
Root owns `/var/lib/arcade-preview-deploy`, its `.ssh` directory and `authorized_keys`; all are
unwritable by the deployer. It cannot add keys or replace the default second authorized_keys file.
`restrict` disables forwarding, PTY and user rc for this key, retaining exec/SCP. The account has an
unusable password; effective SSH preflight refuses external key providers, trusted CAs, hostbased or
keyboard-interactive authentication and nondefault key paths. No global sshd configuration is changed
or reloaded. An actual OWNER read-only SSH connection is still required to verify the remote-source
policy, including any Match Address conditions not represented by the loopback diagnostic.
A key-bound forced command starts every unprivileged session in the deployer-owned `staging` child
(mode 0700); authorization and the home remain root-owned. It passes `SSH_ORIGINAL_COMMAND` as one
quoted argument to Bash, without profiles/rc. This also supports the relative auxiliary archive used
by the pinned [drone-scp 1.6.14 implementation](https://github.com/appleboy/drone-scp/blob/v1.6.14/plugin.go),
while the existing workflow's final target remains absolute. No private-key input or output exists.

After preflight and confirmed Preview stop, provision stages a new copy of the four existing application roots
under `/var/lib/arcade-admin/ws-preview-isolation` (root:root 0700), then renames the original roots
there as `before-*`. It never recursively chowns an existing tree or follows source symlinks. Sources
are read through pinned descriptors; devices/sockets/hardlinks and links outside copied Preview roots
are refused. The Netlify copy includes only `functions/_shared` and `functions/_generated`.
Only new files receive deploy ownership. Permission bits are never widened: private/non-other-readable
files or directories and files/directories writable by the original runtime require inventory and cause STOP before
persistent mutation. Group/other write and special privilege bits are removed from copies. Runtime reads
via existing other-read/search bits without joining its writable group. Netlify ancestors remain root-owned. Existing five rsync destinations are retained.

The root-owned `99-preview-isolation.conf` drop-in changes only the Preview unit's User/Group,
clears supplementary groups, enables NoNewPrivileges, ProtectHome, strict ProtectSystem and PrivateTmp,
and clears writable-system paths/capabilities and all extra execution hooks. Effective properties,
exact unprivileged Node ExecStart flags and allowed drop-ins are checked before enabling the key.
Preflight also refuses existing hooks/changed Node arguments, undeclared writable/mounted state paths,
or missing/symlinked sync roots before persistent mutation; existing gates cannot be silently reset. Existing Stage signing and hold drop-ins remain. Required and optional EnvironmentFiles
must be exactly Preview's environment plus its optional signing file; all present files are protected and validated
for Stage. The signing file may define only `WS_AUTH_HS256_SECRET`; it cannot override Stage identity,
financial storage or feature flags. The existing protected configuration preflight remains the authority
for attested deletion-window ON/OFF; this operation does not change that setting. Local `WS_PERSISTED_STATE_FILE` is STOP: financial file-store migration is outside scope.
The configuration preflight is reused; no database table or application data is changed by this module.

Root-only `manifest.json` records the run, phase, original/installed directory identities and expected
configuration hashes with fsync at rename checkpoints. Candidate sudoers syntax is validated through `visudo -c -f -` stdin before any mutation; a failed post-install check removes that new rule so
admin rollback remains reachable. Original application trees and copied post-rollback
trees are retained, not deleted. This is operational recovery, not proof that a previously compromised
account retained no open descriptor/copy of its old files. No secret values are written to the manifest.

## OWNER activation — separate GO; no activation in this PR

1. Approve merge separately after CI/review. Freeze Preview dispatches and historical reruns throughout
   migration. Keep OWNER's trusted access, old Preview secret copies and protected backups until acceptance.
   The strict new workflow has no broad-account fallback: plan a paused-deployment window after merge.
2. OWNER reinstalls the exact reviewed merged catalog/assets using the existing `stage-vps-admin.sh`
   through the previously verified trusted OWNER-controlled channel. Never execute agent-writable files
   as root. Do not use full bootstrap, agent sudo, or ask the old catalog to install its own replacement.
   The now-unused installed Preview adapter and its private copy of `ws-restart-gate.mjs` are inert;
   they receive no catalog/sudo grant. Retain old protected receipts/backups for audit, not authorization.
   Never remove `/usr/local/sbin/arcade-ws-restart-gate` or its Production implementation.
3. An eligible App requester requests one `ws-preview-isolation-provision`; OWNER reads the summary
   and approves `vps-admin` (main-only, prevent self-review, no bypass). Preflight occurs before stop.
   Stop hard-kicks Stage players even at occupied tables; this does not guarantee hand/escrow settlement.
   Success is `provisioned_runtime_not_started`. After any failure STOP and inspect the protected manifest,
   unit and account state: an attempted stop is FAILED, not a claim that nothing changed. No retry.
4. OWNER verifies actual dedicated SSH identity, public fingerprint, fixed sudo allowlist, runtime and
   filesystem confinement, and existing SCP staging compatibility without deploying. Keep the old trusted
   recovery access until acceptance; do not enable a broad-account fallback in the workflow.
5. OWNER configures `ws-preview`: selected branch exactly `main`, no tags, secrets `WS_PREVIEW_HOST`,
   `WS_PREVIEW_USER=arcade-preview-deploy`, `WS_PREVIEW_SSH_KEY`. The private key goes directly from Termux
   to GitHub, never to an agent. No second reviewer gate for ordinary Stage deploy; OWNER-only main dispatch
   remains mandatory. Do not change `vps-admin`/`ws-production` protections. The GitHub App private key
   remains only in OWNER Termux, never on VPS. Existing repository-level Preview secrets do not become
   Environment-scoped retroactively; freeze legacy runs until their separately approved retirement.
6. Separate GO for the existing `WS Preview Deploy` using the reviewed exact application SHA. Confirm
   dedicated user, Stage Redis/database preflight, actual runtime UID/SHA, local/public health and relevant
   read-only smoke. This first workflow restart starts the isolated runtime. No counter-only deployment.
   Then OWNER may retire obsolete repository-level Preview secrets after acceptance.
7. Health does not prove playability: current Stage DRAIN is intentionally unchanged. There is no catalog
   DRAIN-off operation. The smallest existing path is separate OWNER GO to clear only the protected Stage
   hold file `/etc/arcadeplatform/ws-hold-preview/new-hands` through OWNER's trusted maintenance access,
   using the existing hold-file mechanism. The deployer gains no write access there. Verify DRAIN/HOLD
   status and recovery/ledger state before playable acceptance; never clear Production HOLD/DRAIN.

## STOP / rollback

Rollback is a separately approved `ws-preview-isolation-rollback`, not automatic. Preview must again
be inactive; any process of either new UID blocks restoration. It validates protected manifest and
configuration hashes, withdraws the new key, verifies no new-identity processes, restores the original
application directory identities, removes only its own unchanged drop-ins/policy/sudo file, validates
sudoers and reloads systemd metadata (never SSH). It starts no service and changes no
Production unit/path. New accounts and root-owned home remain inert without the authorized key; they
are never silently deleted or repurposed. Therefore provision is intentionally one-shot: even after
rollback the retained accounts/backup block re-provision. A new attempt requires a separate reviewed
bounded recovery change, not deleting state or retrying this operation. Original and replaced trees remain in the protected backup.
A changed policy, unexpected inode or incomplete/unverifiable state is STOP for bounded recovery review.
The owner must approve subsequent Preview startup; never silently switch GitHub back to the broad key.

Risks: Preview downtime until the separately approved acceptance run; temporary loss of deploy access;
read-permission/umask or signing/hold dependency mismatches (root-owned home/key directories are
explicitly chmodded, independently of installer umask); interrupted provisioning requiring recovery;
loss of local file persistence is prevented by refusal. Production changes are excluded; Environment/secret migration and retirement are separate OWNER actions. This does not remediate the existing broad `copilot` authority.

The symlink inventory is a lexical boundary check. Root never follows copied links; it is not a proof
that every later unprivileged path traversal remains inside Preview when links are chained with `..`.
Filesystem DAC, distinct UIDs and the verified service sandbox remain the authority boundary.

## Accepted Stage risk and breaking changes

A standard Preview restart may interrupt an active hand. Committed persisted snapshots and idempotent
ledger operations support existing recovery, but uncommitted in-memory actions can be lost; pending
hands, requests, version or escrow mismatches may require manual Stage intervention. No automatic
refund, balance repair or reset is added. Preserve existing recovery refusals and inspect before play.
Production restart gate and financial contracts are unchanged. New workflow dispatch requires an exact
40-character SHA and the dedicated user/Environment; old branch-name inputs and broad-user secrets
fail closed. Removed catalog operations and two Preview status fields are intentional breaking changes.
