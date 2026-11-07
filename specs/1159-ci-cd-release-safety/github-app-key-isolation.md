# GitHub App private-key isolation (#1159 follow-up)

## Approved goal / design choice

Keep the existing ghx/Git interfaces and repository-limited, one-hour installation tokens. The long-lived
key must leave copilot custody only after separate OWNER GO and replacement-path acceptance. No live
key read, mint, installation, relocation, deletion, rotation or service action is part of this PR.

Selected implementation: reuse on-demand issuance, with a fixed isolated signer UID (no login), fixed
root-owned Python/OpenSSL program and key path. A narrowly scoped sudo rule allows copilot to run only
that program as the signer, never root; no arbitrary command, URL, repository, permission or key input.
No daemon/socket/framework. The existing root-on-demand catalog prepares the identity/directory/rule;
OWNER supplies the key separately. Public App/installation IDs are pinned to the audited existing setup.

Alternatives: leaving 0600 under copilot does not isolate the key. Termux-only per-token delivery would
interrupt autonomous gh/Git work. A general credential server is unnecessary. A different UID with a
fixed non-root command retains the current process-per-request model. Python/OpenSSL are already
installed; no package is added. This is the coordinator's implementation choice within OWNER scope.

## Plan / fundamental checks

- [x] Pin repository and six required code-work/dispatch permissions; validate the returned scope/expiry.
- [x] Reject unsafe key metadata, ACLs, symlinks and run-as identity; never print key, JWT or raw API errors.
- [x] Add one prepare-only catalog action; preflight before mutation, protected manifest on partial failure.
- [x] Preserve ghx/credential get/store/erase and provider --info interfaces; no old-key fallback.
- [x] Extend existing Python/infra suites for security and compatibility; fixture-only, no private key or network.
- [ ] Independent Claude Code review, maximum three rounds; Draft PR and CI. Runtime DAC/GitHub acceptance
      remains NOT TESTED until separately approved installation and OWNER key import.

## Constitution check

Only deterministic fundamental security tests, existing stdlib/OpenSSL and fixed catalog/approval path.
No Poker/runtime/Preview isolation changes, Production deployment, SQL, Redis, CSP or UI changes.

## Audit evidence and remaining verification

- Authoritative base: main `ff98e9f45462ba938449ec54f770dad10b42ee38`.
- The local provider signs an App JWT with the copilot-owned 0600 key on every invocation; ghx and
  credential `get` start it synchronously. `--info` also mints a token. There was no matching long-lived
  Node signer process at inspection. This is a point-in-time observation, not continuous monitoring.
- Its requested ceiling is contents/pull_requests/issues/actions write, checks/metadata read for this
  repository. The key holder can bypass the local script and request the installation's full granted
  authority, including other repositories if installed there. Exact current installed App grants could
  not be proved without App authentication; the public App metadata endpoint returned 404. OWNER must
  inspect the installation's actual permission/repository grants during cutover. No current key/JWT
  was read or generated to perform this audit.
- Read-only effective sudo inspection found only the existing specific WS/Caddy/status helper grants,
  no general shell/read-file root grant. Existing unrelated grants are not changed here.
- Public GitHub Environment metadata confirms OWNER reviewer, prevent_self_review=true and
  can_admins_bypass=false for both vps-admin and ws-production; both select exactly the main branch, no tags; these settings remain unchanged.
- The existing wrapper symlink is `~/.arcade-code-agent/bin/gh -> ../ghx`; symlink mode 777 is normal.
  In this audit shell, plain gh resolves to the real `~/.local/bin/gh`, not that shim. Cutover must verify
  the actual Codex launch environment's PATH. Use explicit ghx until plain gh resolves to the shim;
  never overwrite the real binary or fall back to OWNER auth when minting fails.
- Existing issue searches for app.pem, ghx and private-key isolation found no dedicated duplicate;
  this PR remains a narrow #1159 security follow-up, no new issue created.

The six fixed permissions are the union needed by the preserved interface: code/PR/issue writes,
workflow dispatch (Actions write) and checks read. They are not arbitrary user-selectable permissions.
Actions write is broader than dispatch: it also permits run cancellation and other Actions changes.
GitHub installation tokens do not express a per-workflow-only permission. OWNER protections therefore
remain essential. No administration, secrets, environments or workflows-file write permission is added;
existing inability to push .github/workflows changes through this App remains. Long-lived key isolation
is not a sandbox for every repository action the agent was already authorized to perform.

Token lifetime is GitHub's one-hour installation-token lifetime. The issuer explicitly requests the
repository ID and permissions, validates the returned expiry/scope and refuses mismatches. It accepts
both legacy and newer longer ghs_ installation-token formats. Tokens exist in issuer/client memory,
credential stdout or the gh child environment, so code sharing copilot's UID can access a live token.
They never contain the private key. There is no token cache, cron, retry loop, JWT output or raw API error
logging. The fixed signer command disables sudo I/O recording because stdout is a credential channel;
normal command audit remains. No request body, key bytes or token is written to the admin manifest.

Official contracts: [installation tokens and repository/permission limits](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
[workflow dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Exact changed surfaces

- `infra/vps/github-app-token.py`: fixed issuer plus prepare-only catalog implementation. Reuse existing
  SecureFiles atomic-write primitives for preparation; Python stdlib and existing OpenSSL for issuance.
- `infra/vps/github-app-client/{arcade-agent-token.mjs,ghx,git-credential-arcade-agent}`: reviewed
  compatibility files for later unprivileged switch, never copied into the live agent directory by this PR.
- `infra/vps/{vps-admin.mjs,arcade-admin.sudoers,vps-admin-approval.mjs}` and the existing
  `vps-admin-operation.yml`: two fixed catalog entries with the same requester/OWNER/audit/lock rules.
- `stage-vps-admin.sh` and fresh-host `bootstrap.sh`: stage the reviewed root-owned module only;
  no signer account, key, client or token activation in the installer.
- Existing Python configuration and infra workflow guards: fixture-only tests for scope, custody,
  refusal, partial preparation and wrapper compatibility; no live token/key/network operation.

## OWNER GO: migration, acceptance and recovery

1. **Approve merge and trusted catalog reinstall separately.** Pin the final reviewed merged SHA and
   existing installer hashes; preserve the prior installed catalog backup. Do not execute an agent-owned
   checkout as root. Preserve a tested OWNER Termux/recovery channel. This PR authorizes no live step.
2. **Request preparation through the App from OWNER Termux**, using the existing channel; no local
   legacy signer execution is needed. Operation `github-app-token-prepare`, confirmation
   `RUN github-app-token-prepare`, reason describing this key-isolation preparation. OWNER approves
   vps-admin. Result must be `prepared_no_key_no_client_switch`. On failure inspect
   `/var/lib/arcade-admin/github-app-token/manifest.json` and account/policy state; never retry automatically.
   Preparation is one-shot; existing account/targets/manifest refuse automatic reuse.
3. **Separate OWNER GO for key provisioning.** Prefer generating a NEW App private key in GitHub Settings
   and keeping it in Termux OWNER, leaving the old key temporarily valid. Through the existing trusted
   OWNER maintenance channel, import directly into `/var/lib/arcade-github-app/app.pem` as root with group
   arcade-github-token, mode 0640, no ACL, regular single-link file; parent root:arcade-github-token 0750.
   Do not stage it in copilot, a shared directory, chat, argv, repo, logs or installer artifacts. Do not
   copy or delete the existing key. This is an explicit future OWNER-controlled secret action, not a new
   upload endpoint/catalog parameter. If using the old key instead, it remains exposed until rotated.
4. **Validate custody and one redacted mint before switching.** As copilot verify that the new private
   directory/key cannot be read or listed, account groups are separate and the only new run-as grant is
   the fixed signer (no shell/root). Invoke only `/usr/bin/sudo -n -u arcade-github-token -- /usr/local/sbin/arcade-github-app-token --info`; inspect exact repo, six permissions and
   one-hour expiry, never raw tokens. Verify UID confinement, no ACLs and effective sudo rules as OWNER.
   Issuance remains fail-closed for unavailable API, changed scope or missing/misconfigured key.
5. **Switch only the three public client files as copilot**, from the reviewed exact SHA; preserve the
   old public provider/wrappers as a source-only backup, never duplicate app.pem. Preserve existing
   credential configuration and gh symlink. Ensure the actual agent PATH resolves the existing shim
   before the real gh binary; the wrapper itself still execs the absolute real binary. Open a fresh
   Codex shell and verify ghx/gh read-only repository access and Git credential plumbing without
   printing token output. On failure restore only old public client files while the old key is retained;
   do not delete a key or lose the trusted OWNER channel during troubleshooting.
6. **Separate bounded GitHub acceptance GO.** Read-only checks are insufficient to prove write scope:
   agree one disposable branch update, Draft PR/issue create-update-cleanup, and one existing
   ledger-dispatchers-status request as arcade-code-agent[bot]. Confirm request success and operate
   waiting for OWNER; stop before approving it. Check WS Server Deploy dispatch eligibility/inputs and
   unchanged ws-production gate without deploying Poker. Actual WS dispatch/start is not authorized by
   this plan. A Production deployment must not be used as an authentication test.
7. **Only after acceptance: separate GO for old-key quarantine.** Request `github-app-key-quarantine`
   via VPS Admin Operation, confirmation `RUN github-app-key-quarantine`; OWNER checks the new path has
   passed gh/Git acceptance and approves. Its signer-info proof issues one scoped token and discards it;
   old key movement reuses pinned descriptors, process-reference refusal, journal, fsync and MANIFEST
   recovery from the existing quarantine implementation. No bulk Netlify snapshots are touched.
   A partial/uncertain result is STOP, inspect the protected quarantine manifest before any next action.
8. **Rotate/revoke the exposed OLD private key in GitHub Settings**, after the distinct replacement key
   is confirmed working. Never remove all App keys or revoke the replacement by mistake. Quarantine alone
   cannot invalidate earlier copies. Already minted installation tokens may remain valid until expiry;
   allow at least their one-hour expiry window and revoke individually known tokens via trusted OWNER
   handling if incident response requires it, never log them. Verify the replacement still works.
9. **Final acceptance:** no readable App private key/copy under copilot; effective new DAC/ACL and
   signer scope PASS; normal Codex gh/Git work PASS; requester is the App, OWNER approvals unchanged;
   exact revision/permissions/expiry and token-free logs recorded. Root-only old quarantine material is
   retained until separately approved retention/deletion. No cleanup deletes it automatically.

Before quarantine, recovery can restore only old public client files without deleting any key. After
quarantine/revocation, recovery uses the protected signer/new key or trusted OWNER Termux, never puts
an exposed long-lived key back into copilot. OWNER can disable the new fixed sudoers file using the
existing trusted maintenance path after explicit GO; the dedicated user remains inert. A partial
prepare manifest needs bounded repair through the same approved channel, not permission widening.

## Breaking changes / completion limits

- Minting requires the prepared signer and imported key; missing installation or GitHub scope drift
  fails closed with no OWNER-token fallback. Cutover order is mandatory to avoid interrupting work.
- Root-owned key replacement/rotation becomes an OWNER action; changing copilot's old app.json no
  longer changes App identity, endpoint or repository. Public IDs are pinned to this installation.
- Extra provider arguments and non-HTTPS credential requests are refused; --info and ordinary
  HTTPS Git/ghx behavior remain. Plain gh PATH must be checked in the actual agent launch context.
- Real copilot DAC denial, App token issuance and write/dispatch compatibility are NOT TESTED here:
  exercising them would require the separately authorized runtime installation/key provisioning.
- Production, Poker, WS Preview isolation, Environment protections, Supabase and Redis are unchanged.
