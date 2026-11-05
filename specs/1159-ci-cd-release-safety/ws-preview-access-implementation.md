# WS Preview isolation implementation / activation handoff (#1159)

Implements [the approved design](ws-preview-access.md). This PR is code preparation only: no live
installation, key generation, SSH change, dispatch, restart or deploy. `ws-preview-deploy.yml` and
all secrets remain unchanged. Missing OWNER public key and the running Preview service currently
block activation; this is deliberate, not runtime acceptance.

## Implementation / checks

- [x] Extend the existing `VPS Admin Operation` catalog with exactly `ws-preview-isolation-preflight`,
  `ws-preview-isolation-provision` and `ws-preview-isolation-rollback`. Keep its OWNER/main,
  environment approval, fixed arguments, journal and shared lock. No new privileged SSH endpoint.
- [x] Reuse `prepare-ws-preview-v3.py`'s protected-file, Stage identity, environment parsing and
  atomic-write primitives. Install code/public-data dependencies with the existing admin installer
  (and fresh-host bootstrap), never the private key. No new package or service.
- [x] Add only fundamental fixture tests to the existing Preview configuration tests and infra guard.
- [ ] Independent Claude Code review and hosted CI on the final diff.
- [ ] OWNER public key, approved administrative activation and runtime acceptance (not executed here).

The Python module is not a separate sudo grant. The catalog executes one installed root-owned module
with `python3 -I -B`, one fixed action and numeric run ID. It accepts no path, username, unit, key or shell
command from a dispatch. Both mutations require `ActiveState=inactive` and `MainPID=0`; they never
stop/start/restart the service. A missing/unverifiable prerequisite is STOP. No automatic retry.

## Filesystem and identity contract

Provisioning refuses pre-existing target users/groups/home/configuration and any previous backup.
It creates `arcade-preview-deploy` (only its own primary group, root-owned home, Bash for existing
SCP/SSH actions) and `arcade-preview` (different UID/group, no login). The deployer's entire effective
sudo listing must equal the two-command Preview allowlist; the runtime must have no sudo rights.
Unexpected inherited rules or groups block before enabling the key.

Only a public Ed25519 key is accepted in `infra/vps/ws-preview-owner.pub`. It is intentionally empty:
OWNER has not created a dedicated key. No generated substitute or reused broad key is embedded.
Adding it later requires review of the updated diff and reinstalling the reviewed public asset.
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

With Preview already stopped, provision stages a new copy of the four existing application roots
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
exact unprivileged Node ExecStart flags and allowed drop-ins are checked before enabling the key. Existing Stage signing and hold drop-ins remain. Required and optional EnvironmentFiles
must be exactly Preview's environment plus its optional signing file; all present files are protected and validated
for Stage. The signing file may define only `WS_AUTH_HS256_SECRET`; it cannot override Stage identity,
financial storage or feature flags. The existing protected configuration preflight remains the authority
for attested deletion-window ON/OFF; this operation does not change that setting. Local `WS_PERSISTED_STATE_FILE` is STOP: financial file-store migration is outside scope.
The configuration preflight is reused; no database table or application data is changed by this module.

Root-only `manifest.json` records the run, phase, original/installed directory identities and expected
configuration hashes with fsync at rename checkpoints. Candidate sudoers syntax is validated in a
root-private transient file before provisioning; a failed post-install check removes that new rule so
admin rollback remains reachable. Original application trees and copied post-rollback
trees are retained, not deleted. This is operational recovery, not proof that a previously compromised
account retained no open descriptor/copy of its old files. No secret values are written to the manifest.

## OWNER activation — each administrative action requires separate approval

1. Review/merge this PR only after CI and independent review. Supply/review the dedicated public key
   before attempting provisioning. OWNER generates/retains the private key locally; never send it to
   an agent or put it in the repository. Keep current OWNER/Termux access and old GitHub secrets intact.
2. Use the approved owner-controlled reinstall of `infra/vps/stage-vps-admin.sh` from the reviewed
   merged SHA. This only registers dependencies/catalog, not Preview users or keys. The workflow
   cannot install its own new catalog operation. Do not substitute manual SSH/root/sudo by the agent,
   full bootstrap on the existing VPS, or release-agent activation. Existing approval-role constraints
   remain: if there is no eligible requester distinct from the required approver, STOP.
3. Freeze old-key Preview dispatches/reruns. Establish an approved Preview-only quiet window with no
   active users, reconnectable seats, hands, pending financial operations or unsafe recovery state.
   The new catalog deliberately does not provide an unchecked stop/restart. If Preview is active or
   there is no existing reviewed way to quiesce/stop it under that window, **STOP**: obtain a separately
   reviewed, approved quiesce operation before activation. Never work around this precondition.
4. With Preview already inactive, request `ws-preview-isolation-preflight`; inspect the result, then
   separately request `ws-preview-isolation-provision` through `VPS Admin Operation`. Each uses `main`,
   the existing confirmation phrase and OWNER environment approval. Any failure leaves a protected
   manifest/backup for inspection; no retry. Successful provisioning says
   `provisioned_runtime_not_started`, explicitly not a successful deployment or runtime acceptance.
5. Verify public-key fingerprint, actual SSH identity/restrictions, exact sudo rights, installed-file
   modes/umask, runtime inability to write code, and lack of Production/state/credential authority.
   Treat this deployment key as Stage-sensitive: it controls code that will receive Stage credentials.
   Keep all secrets/private keys out of reports and artifacts. The root preflight imports only Node built-ins (`node:fs`, `node:crypto`), not deployed code. Check the
   forced-session staging with the pinned SCP action: its auxiliary archive is relative, but the
   existing extraction/deploy target stays absolute under `/tmp`.
   Source SHA/unit/permissions and rollback
   evidence must be recorded before proceeding; preserve the former account access for recovery.
6. Only after provisioning acceptance, the separate Environment binding PR and OWNER setup can follow
   the approved design. The first approved exact-SHA workflow run starts Preview with the isolated user.
   Verify actual process UID, Stage database/Redis preflight, signing/hold readability, installed SHA,
   local/public health and relevant read-only smoke. Until then: runtime acceptance PENDING. A green
   CI/Netlify check does not validate SSH provisioning or effective runtime confinement.

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
read-permission/umask or signing/hold dependency mismatches; interrupted provisioning requiring recovery;
loss of local file persistence is prevented by refusal. Production changes, secret migration and cleanup
of old repository secrets are excluded. This does not remediate the existing broad `copilot` authority.
