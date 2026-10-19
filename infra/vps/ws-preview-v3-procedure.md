# WS Preview V3 — administrative procedure for review only

No root execution, installation, restart, deploy or live Redis verification is authorized by this change. The old /tmp procedure and private JSON fragment were removed. Do not reuse the earlier sudo command. This procedure is configuration-only; it does not activate deletion or attest cutover/Storage/HMAC.

## Current hard NO-GO

Read-only metadata shows /opt/arcade-ws-preview is arcade:arcade0755, while .env.preview is root:root0600. The directory owner can rename/replace its entries; mode0600 on the file alone is insufficient. Both the installer and new preflight reject untrusted parent ownership or group/world write access. Under the current VPS layout apply fails before any target/backup/lock write.

The operator must first choose and separately approve a protected-directory arrangement compatible with the WS deploy user's permissions. Options are reviewed ownership/layout changes or moving the environment to a protected location with an explicit systemd adjustment. Neither is implemented here: changing parent ownership blindly may break artifact installation; changing EnvironmentFile would exceed this procedure's two-target scope. No sudo rule or service configuration is changed.

## Protected code staging — after review and separate GO

Operator stages only these two files from the reviewed exact commit, without executing them, under /usr/local/libexec/arcade-ws-preview-v3:

- prepare-ws-preview-v3.py — root:root0644.
- ws-preview-env-preflight.mjs — root:root0644.

The directory and every ancestor must be root-owned, not symlinks, and not group/world writable (directory0755). Verify the installed copies against the reviewed public code hashes AFTER staging and BEFORE execution; do not execute from a working tree or /tmp. The Python script checks its exact installed path, protected parent chain, ownership, mode, link count and the helper content pin. /usr/bin/python3 -I -B excludes user/CWD Python imports; -B prevents bytecode writes outside the declared files. No sudo allowlist expansion is requested.

Reviewed SHA256:

- Python: 4141380865f348764c070d3b6e94a80d7488abc4e651bb75c7c1ac2975a471f1
- helper: 385f3f13aac76b8a6f611aeb6fb779ec9231915dfa24ad4d24f1bb2d3a444373

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

Default preflight is local only and prints PASS CONFIG ONLY for V3, explicitly not proof of a working endpoint/credential pair. After separately authorized apply, the operator may explicitly run:

```sh
/usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight --verify-redis
```

This is the sole networked Redis verification mode; the administrative Python apply/rollback never contacts Redis. Before any request it requires the root-protected completed preparation manifest and matching whole-environment digest. Thus a different working pair substituted after preparation is NO-GO, not an approved-source proof. It sends exactly PING and EXISTS kcswh:stage:xp:v3:lifecycle:epoch to the configured HTTPS *.upstash.io endpoint, refuses redirects, enforces timeout, checks provider success and validates that the opened protected environment did not change. No key values, endpoint/token, error body or credential digest is printed. Wrong token, quota/network/redirect error or changed config is NO-GO. No V2 command, SCAN, seed/SET/DEL, flush or fallback.

A PASS LIVE proves only that the pair installed from the approved source authenticates and the exact Stage-prefixed probe works. Shared credentials still authorize the database; namespaces are logical separation, not a Redis ACL. The epoch presence bit is diagnostic, not proof of reconciled lifecycle/cutover, ownership cleanup or Storage/HMAC readiness. Keep those gates separate. After actual proof, verify generated deploy-preview/3/stage pins and exact release SHA before separately authorized WS deployment. Presence checks or mocks cannot substitute.

## Self-review / fundamental evidence

Existing Python stdlib only; no package/service/framework. Tests use unprivileged temporary paths, fake credentials and mocked HTTP for the JS checker. Cover repeat/rollback, interruption between writes, lock conflict, foreign edits/inputs/corrupt backup, symlink/hardlink/parent permissions, disabled deletion/Stage namespace and redacted read-only live verification. They do not invoke root, real apply, real Redis or WS deployment. CI runs them in the existing WS job.
