# WS Preview V3 — administrative procedure for review only

No root execution, installation, restart, deploy or live Redis verification is authorized by this change. The old /tmp procedure and private JSON fragment were removed. Do not reuse the earlier sudo command. This procedure is configuration-only; it does not activate deletion or attest cutover/Storage/HMAC.

## Current hard NO-GO

Read-only metadata shows /opt/arcade-ws-preview is arcade:arcade0755, while .env.preview is root:root0600. The directory owner can rename/replace its entries; mode0600 on the file alone is insufficient. Both the installer and new preflight reject untrusted parent ownership or group/world write access. Under the current VPS layout apply fails before any target/backup/lock write.

The selected correction is root:root0755 on this ONE directory only, preserving all deploy subtrees. The exact audited procedure and rollback are below; execution still requires separate GO. No systemd, sudoers, recursive ownership change or Production modification is required.


## Audited parent ownership correction — NOT EXECUTED (19 October)

Read-only stat/lstat/namei/getfacl and copilot access walk confirmed /opt root:root0755; Preview base arcade:arcade0755 (UID/GID1000), no symlink or extended/default ACL; .env.preview root:root0600, no extended ACL. copilot is in arcade-deploy (GID986); arcade is NOT. Traversal remains available through root0755. This supplements, rather than repeats/replaces, Phase A in docs/vps-disaster-recovery.md: its four deploy subtrees contain the workflow's five synchronization roots.

| Synchronization root relative to Preview | Actual owner/group/mode | Descendant entries | Non-writable files/dirs; errors; symlinks |
| --- | --- | ---: | --- |
| ws-server | root:arcade-deploy2775 | 302 | 0;0;0 |
| shared | root:arcade-deploy2775 | 33 | 0;0;0 |
| netlify/functions/_shared | copilot:arcade-deploy2775 | 37 | 0;0;0 |
| netlify/functions/_generated | copilot:arcade-deploy2775 | 1 | 0;0;0 |
| node_modules | root:arcade-deploy2775 | 66 | 0;0;0 |

All five roots have copilot write+execute access; only basic ACL entries. A full descendant lstat/ACL-xattr audit also found zero extended/default ACLs. Descendants are copilot-owned (UID1001), mode0644 files or0755 directories, group arcade-deploy986 or copilot1001; preserve both groups rather than recursively normalizing them. Intermediate netlify is root:arcade-deploy2775; netlify/functions is copilot:arcade-deploy0775, also basic ACLs. Preserve them exactly, including the two copilot-owned roots: Phase A deliberately assigned descendants to copilot. No recursive chown, chmod, setfacl or remigration. Existing mkdir -p needs no write on the base because all target directories already exist; fail preflight if any of these roots disappears. Five rsyncs target subdirectories only with --no-owner --no-group --omit-dir-times and compatible2775 roots. No write access to base/.env is required. Access walk is real read-only evidence, not an actual deployment; existing CI rsync fixture verifies the2775 contract independently.

After separate administrative GO, quiesce Preview deploy/config writers and revalidate this audit (especially ACLs, all five roots and intermediate paths). The following ROOT-shell one-liner checks the fixed safe /opt ancestry and base metadata/ACL, changes ONLY the base owner/group and verifies the result. chown is nonrecursive and does not follow a symlink; existing0755 mode is preserved. It accepts the already-correct state for repeatability. The rollback metadata is the observed original arcade:arcade0755 with basic ACL; no secret backup is needed for this one metadata change. The separate environment/helper transaction still backs up BOTH files as before.

```sh
test "$(stat -c '%F:%a:%u:%g' -- /opt)" = 'directory:755:0:0' && test ! -L /opt/arcade-ws-preview && test "$(getfacl -cp -- /opt/arcade-ws-preview)" = "$(printf 'user::rwx\ngroup::r-x\nother::r-x\n')" && { case "$(stat -c '%F:%a:%u:%g' -- /opt/arcade-ws-preview)" in directory:755:1000:1000|directory:755:0:0) chown --no-dereference root:root -- /opt/arcade-ws-preview ;; *) false ;; esac; } && test "$(stat -c '%F:%a:%u:%g' -- /opt/arcade-ws-preview)" = 'directory:755:0:0'
```

If final verification fails, stop; do not proceed to installation/apply/deploy. Re-run stat/getfacl and copilot test -w/-x on ALL five roots and verify .env remains root0600. Parent correction precedes protected bundle staging and apply. It does not start/stop services, touch data or change any descendant inode.

Explicit ROOT-shell rollback, only before configuration apply or deployment, with a separate operator decision to restore the KNOWN UNSAFE legacy owner (preflight/deployment will again be NO-GO):

```sh
test "$(stat -c '%F:%a:%u:%g' -- /opt)" = 'directory:755:0:0' && test ! -L /opt/arcade-ws-preview && test "$(getfacl -cp -- /opt/arcade-ws-preview)" = "$(printf 'user::rwx\ngroup::r-x\nother::r-x\n')" && test "$(stat -c '%F:%a:%u:%g' -- /opt/arcade-ws-preview)" = 'directory:755:0:0' && chown --no-dereference arcade:arcade -- /opt/arcade-ws-preview && test "$(stat -c '%F:%a:%u:%g' -- /opt/arcade-ws-preview)" = 'directory:755:1000:1000'
```

After an apply, first reconcile/roll back the two configuration files while their parent is still protected. Never weaken the parent as a shortcut to bypass failed security checks. Unexpected permissions/ACL/identity changes are NO-GO, not permission for forced repair.

## Required main workflow delivery — NOT DEPLOYED

Current main40f51d6c still ignores the helper's output. This PR changes the workflow to pass xpRedisVersion to the remote shell and require the EXACT live V3 Stage result for input3 BEFORE any rsync. An older helper, missing/legacy configuration, config-only result or failed live request therefore cannot deploy V3. Existing exact no-argument sudo permission is unchanged; new helper auto-verifies LIVE for V3, including before the FIRST deployment. Both extracted and installed generated deploy-context copies must be deploy-preview/3/stage. Existing metadata verification independently compares exact resolved RELEASE_SHA/ref at extraction, before restart and after health gates. The helper independently pins actual Supabase Stage and kcswh:stage:xp:v3, and the live check authenticates approved credentials. These checks do NOT activate deletion/cutover.

The workflow definition must reach main before any V3 dispatch. Minimal delivery: separately reviewed workflow-only PR based on main with this YAML gate/context verification and its focused workflow tests (no feature/migration/config/deploy). Do not copy the entire #1124, execute PR workflow definitions, manually deploy, or broaden sudo. Root helper installation comes only from the separately reviewed protected bundle; a workflow merge does not install it or grant execution GO. No merge or extra PR created during this preparation. Until owner-reviewed main delivery AND root preparation/LIVE pass are complete, WS Preview Deploy remains BLOCKED.

## Protected code staging — after review and separate GO

Operator stages only these two files from the reviewed exact commit, without executing them, under /usr/local/libexec/arcade-ws-preview-v3:

- prepare-ws-preview-v3.py — root:root0644.
- ws-preview-env-preflight.mjs — root:root0644.

The directory and every ancestor must be root-owned, not symlinks, and not group/world writable (directory0755). Verify the installed copies against the reviewed public code hashes AFTER staging and BEFORE execution; do not execute from a working tree or /tmp. The Python script checks its exact installed path, protected parent chain, ownership, mode, link count and the helper content pin. /usr/bin/python3 -I -B excludes user/CWD Python imports; -B prevents bytecode writes outside the declared files. No sudo allowlist expansion is requested.

Reviewed SHA256:

- Python: fe49197b9657dff54d44836a2ed1d407b174207cb7e36ac1f2d213e468f34e23
- helper: 87f1fd25ca5db2ce0203b2dc438deb2bca43ab615514fdb478ca03589305cde8

A root operator can copy reviewed files using install, then compare sha256sum on both protected copies. Copying from a user-owned checkout is not sufficient verification; compare the final protected bytes with these review values. Code is public; no credential is installed in this bundle.

## Existing credential source — no secret files or command-line values

export-redis runs as copilot against its existing Netlify CLI credential inode (owner0600, regular single-link, O_NOFOLLOW). It uses the linked site only if its name is playkcswh and the deploy-preview/functions configuration's public Supabase URL is the pinned Stage project. Netlify context_name=deploy-preview is requested; returned contexts outside all/deploy-preview abort. Production contexts/DB/service-role keys are not exported. Shared all-context Upstash credentials are the already-approved single Free database pair used by Stage, not a new Production credential copy.

Only the two existing Upstash fields are transmitted through a FIFO directly to the root consumer. Export refuses terminals and regular-file stdout. Do not use tee, output redirection, set -x, logging wrappers or shell arguments/environment variables carrying values. The consumer rejects any other JSON field, endpoint redirects/unsafe URL syntax, control characters or changed existing nonempty credentials. No temporary JSON/file or token hash is published. Existing credentials remain unchanged.

Read-only source verification during preparation successfully resolved both fields through a pipe, printing only a fixed PASS; nothing was persisted. This does NOT prove the Redis token works: live verification is a separate step below.

## One-line execution — ROOT shell, only after separate GO and the directory NO-GO is resolved

```sh
sudo -H -u copilot /usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/prepare-ws-preview-v3.py export-redis | /usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/prepare-ws-preview-v3.py apply
```

The producer is unprivileged; only the fixed protected consumer runs as root. Sudo reads no password/secret from the credential pipe. Do not run now. Preview deploy/config writers must be quiescent during this operation. The lock coordinates this procedure's invocations; it cannot coordinate an unrelated root editor or deployment that ignores the lock.

## Exact filesystem effects

Apply may replace ONLY these live files (fixed constants, no CLI target override):

1. /opt/arcade-ws-preview/.env.preview — root:root0600. Keep non-managed lines/values; set XP_REDIS_VERSION3, XP_REDIS_ENVstage, XP_KEY_NSkcswh:stage:xp:v3, ACCOUNT_DELETION_ENABLED0, and the existing approved Redis pair. Refuse foreign project/namespace, test mode, enabled deletion and credential changes.
2. /usr/local/sbin/arcade-ws-preview-env-preflight — root:root0755, exact reviewed helper bytes.

Necessary protected bookkeeping, not additional live configuration:

- /var/backups/arcade-ws-preview-v3/ — root:root0700.
- env.before, helper.before — root:root0600, immutable original bytes, never replaced by a subsequent configuration snapshot.
- manifest.json — root:root0600; original/desired digests and prepared/complete/rolled_back state. No plaintext credential in this manifest.
- operation.lock — root:root0600, exclusive nonblocking flock.
- Random .1117-* temporary files only inside the protected target/backup directories; fsync+atomic rename, cleaned on normal errors. SIGKILL may leave a protected temporary file: reconcile manually, never broad-delete unknown files.

Protected bundle code files above are created only by the separate staging operation. No Production file, service/sudo config, account, database, V2/V3 Redis key, epoch or approval row is changed. No root backup exists yet from this preparation.

## Failure handling, repeat and rollback

Backups and prepared manifest are durable before replacing either live file. Each replacement is atomic and fsynced, but the TWO files are NOT one atomic transaction. No service is restarted and operation completion is not reported until both exact outputs are re-read. After interruption, repeat apply with unchanged approved credentials/helper: only original-or-desired file digests are accepted. It resumes without making new backups. Unknown edits, wrong metadata, altered inputs or corrupted backups cause NO-GO, not forced overwrite. Interrupted backup creation leaves originals untouched; incomplete/foreign evidence is never guessed away.

Rollback, from ROOT shell after reviewed operator authorization:

```sh
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/prepare-ws-preview-v3.py rollback
```

Rollback validates backup hashes and current files against the same original/desired digests, then restores BOTH original files with their original required modes. It is repeatable and resumable too. It refuses intervening operator changes. It does not read new credentials, restart services, restore Redis or turn deletion on. It is a configuration-only rollback before deployment/acceptance, not permission to restore unfenced V2 writers. Retain this single protected backup only for the agreed rollback/reconciliation window; operator erasure after that window needs its own review. No unbounded backup history.

## Verification gates — CONFIG is not LIVE

The exact existing no-argument sudo invocation now performs LIVE verification automatically for V3 on EVERY deployment; legacy configuration still emits an explicitly legacy result. Explicit --config-only is diagnostic only (not added to sudoers and not accepted by the V3 deployment gate). After separately authorized apply, a root operator may also explicitly run:

```sh
/usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight --verify-redis
```

This and the automatic no-argument V3 mode use the same verification code; the administrative Python apply/rollback never contacts Redis. Before any request it requires the root-protected completed preparation manifest and matching whole-environment digest. Thus a different working pair substituted after preparation is NO-GO, not an approved-source proof. It sends exactly PING and EXISTS kcswh:stage:xp:v3:lifecycle:epoch to the configured HTTPS *.upstash.io endpoint, refuses redirects, enforces timeout, checks provider success and validates that the opened protected environment did not change. No key values, endpoint/token, error body or credential digest is printed. Wrong token, quota/network/redirect error or changed config is NO-GO. No V2 command, SCAN, seed/SET/DEL, flush or fallback.

A PASS LIVE proves only that the pair installed from the approved source authenticates and the exact Stage-prefixed probe works. Shared credentials still authorize the database; namespaces are logical separation, not a Redis ACL. The epoch presence bit is diagnostic, not proof of reconciled lifecycle/cutover, ownership cleanup or Storage/HMAC readiness. Keep those gates separate. The workflow additionally rejects anything except the exact LIVE Stage V3 result when xpRedisVersion=3, before any rsync. It checks BOTH generated context copies for deploy-preview/3/stage before synchronization and before restart; existing release metadata checks bind extracted/installed artifacts to the resolved exact SHA/ref. Stage project and exact namespace are pinned by the privileged helper. A V2 input cannot downgrade a V3 runtime. After actual proof, separately authorize WS deployment. Presence checks or mocks cannot substitute.

## Self-review / fundamental evidence

Existing Python stdlib only; no package/service/framework. Tests use unprivileged temporary paths, fake credentials and mocked HTTP for the JS checker. Cover repeat/rollback, interruption between writes, lock conflict, foreign edits/inputs/corrupt backup, symlink/hardlink/parent permissions, disabled deletion/Stage namespace and redacted read-only live verification. They do not invoke root, real apply, real Redis or WS deployment. CI runs them in the existing WS job.
