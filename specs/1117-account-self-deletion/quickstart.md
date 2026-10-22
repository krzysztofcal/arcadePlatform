> **Current pre-merge gate (21 October 2026):** T07b PASS; #1124 Ready for Review, **merge STOP** pending [Production compatibility plan](production-compatibility.md). Production65 migrations differs from Stage117; P1 local equivalent/tests PASS, PC2 schema apply/PC3 release/PC4 activation still require separate GO. Historical execution instructions below do not authorize another Stage campaign or bypass this gate.

# Minimal Stage rollout / E2E — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. The approved matched Stage Preview rollout is completed below. Activation/destructive E2E/Production deployment/merge still require separate GO.

## 1. Read-only preflight

Pin Stage krydukthwdvccggbyjfw/system7656985631720456337; compare all applied hashes. Current Stage117 applied/hashes verified, zero pending:20261020094224_account_avatar_reconciliation.sql and20261020190000_account_bonus_uuid_policy.sql are ALREADY APPLIED. Do not reapply. Removed20261020094949 was never applied; never restore it. Unexpected drift/data in unused recognition tables -> NO-GO. Do not run migrator as read-only check.

Verify guards v2/v3 ready, tracking1, Netlify/WS deletion0 and DB releasefalse, Stage Redis V3 LIVE/current epoch and no shared Preview conflict. Redis migration is completed; retain protected backup/journal. Current hosted Stage Netlify/WS source is91c329558f90cb8cc525777bc621f56242dfeca0; Production82aee39d is unchanged.

## 2. Matched schema/runtime — completed Stage Preview rollout

The two approved forward migrations are installed with deletion OFF; verify hashes/catalog without reapplying. Owner explicitly allowed existing balanced bot-only activity. The matched rollout below passed; that activity alone is not a financial STOP. Unexpected USER effects, unbalanced transactions, unsafe pending actions or escrow mismatch remain STOP conditions. UUID policy migration preserves already-applied hashes, fails if recognition tables unexpectedly contain data, initializes durable global campaign counts from actual claim/hot/registry receipts without decrementing retained totals, installs PROMO-only quota/replay guard and drops unused HMAC structures. No history_ready/key/version/privacy approval exists or is needed. Global max_total_claims is unchanged; retired claims cannot replenish it.

Approved runtime91c32955 is now deployed to [Netlify Preview](https://deploy-preview-1124--playkcswh.netlify.app), deploy6ad7c906436059f74f296e2c, and [main-defined WS Preview run39488749067](https://github.com/krzysztofcal/arcadePlatform/actions/runs/39488749067), input ref91c329558f90cb8cc525777bc621f56242dfeca0/xpRedisVersion3. CLI alias deploy metadata has commit_ref=null/context branch-deploy; exact detached source plus served BUILD_INFO proves source SHA, and generated Functions context is deploy-preview/3/stage. Do not report a provider commit_ref that does not exist.

Actual WS release metadata matches exact91c32955; both generated contexts deploy-preview/3/stage, protected LIVE Redis PASS (epochPresent1), local/public health200, browser password Auth/profile/XP refresh/WS auth+ping PASS. Tracking1/guardreadytrue, DB releasefalse/Netlify0/protected WS0. No new upload/finalize or bonus payout was executed. Existing avatar-v3 tracking/schema were preserved, not re-proved with a new upload.

Before restart:0human seats/0pending requests/0Preview sockets, five continuous bot tables with handSeed and escrow conservation. No SIGTERM drain handler exists: standard workflow restart uses transactionally persisted state/action/settlement plus bootstrap recovery;55local recovery tests passed. Active-phase liability is stacks+contributionsByUserId; SETTLED stacks already include awards (do not double-count contributions or rely on state.pot). After restart all five bot tables progress, escrow remains consistent, USER fingerprint/claims18/totalCH300 unchanged, hot unbalanced0. Archive commits/background bot turnover may change hot row count; row-count equality is not a financial invariant. Read-only campaign paid totals18 across4campaigns equal18claims. No test payout, BURN or Auth deletion. Production deployment/configuration unchanged.

## 3. Actual Storage / deletion-readiness evidence

Storage authority/inventory/cutover evidence is now PASS on Stage. The two exact historical CLI deployments6acce9e3f95d33f8f0227bcc and6ac2852c2726cf05bba3221c were permanently removed under explicit conditional owner GO, one at a time. Private metadata/function IDs/source hashes/alias references were backed up before DELETE. Each DELETE204 was followed by provider metadata404 and immutable root/avatar GET+POST404; active Production/Preview/main/1039 aliases retained exact build hashes, no split tests or fallback switch. Three other historical Production-context artifacts were NOT removed. Known reviewed legacy families remain fenced by existing SQL v3 INSERT/consume/manifest guards; no1626deployment retirement, secret rotation or new service.

Actual DB checkpoint/cutoff **2026-10-21T05:08:31.517Z**; minimum expiry **2026-10-21T07:08:31.517000+00:00**; longest recorded capability **2026-10-19T22:33:34.694Z**. Actual post-expiry DB observation **2026-10-21T07:08:51.636Z**, elapsed **7220.119s**. No clock/capability/receipt was backdated. Complete bounded provider request window04:50→05:08:31.517 had21site records/0target requests; original C harness confirms signing returned and real output POST succeeded before intentional response loss. Storage objects RLS is enabled with no client policies; ordinary anon/authenticated direct writes are not an alternative issuer.

After the real wait, revalidated both retired deployments/aliases and exact5manifest digests/4object IDs+versions+timestamps/profile links/tracked rows;10authenticated object-info GETs confirm4present/6NoSuchKey absences. Original subject/control/unrelated July object unchanged. Wrote only true Stage private.avatar_tracking_cutover metadata, marker **stage-avatar-authority-20261021**, original observed cutoff, legacy_inventory_verified=true and two evidence-backed reconciliation inventory entries. Provider fields remainNULL; no fake signing/finish/delete receipts, request/lease, Storage DELETE or Auth cleanup. Independent readback verified. REDIS-RELEASE remains PASS with the existing epoch/proof; no reset.

The marker is an evidence-row label, NOT feature activation. It was not added to Netlify/WS environment in this phase. Before any future activation, configure this same marker in both supported runtimes through the approved protected Stage procedure, preserve root preparation-hash verification, and verify flags/dependencies/leases. Current Account Deletion is still OFF everywhere. A runtime config change/restart needs the next explicit GO; do not misuse the deletion0-only Redis preparation tool.

Two retained uncertain manifests still need canonical request/lease cleanup: original disposable subject has4manifests/2existing synthetic outputs, up to7known exact source/output paths (including already absent paths),0CH/no wallet/no active seat and no Welcome receipt. Original control has1manifest/1output and stays untouched; unrelated July profile/output stays untouched. Real original operation acknowledgements and unchanged snapshots support reconciliation inventory; actual DELETE+authenticated absence receipts must be produced by the future canonical worker, not invented now. T05e execution/T07b are not completed by readiness metadata alone.

### Minimal next GO recommendation

Authorize the protected Stage-only test window (matched marker/flags in Netlify+WS, protected backup/preparation hash and controlled Preview restart while no humans/pending actions; DB release enabled only after all checks). The shortest combined E2E can use the retained disposable subject as the funded deleting player: normal eligible Welcome+new XP, two NEW disposable unequal-stack peers, funded JOIN/all-in/showdown/side-pot, UI durable accept/signout and old JWT/WS/write denial, cash-out/exactly one balanced BURN, real canonical reconciliation of its4manifests/2outputs and indexed Redis/profile cleanup, Auth hard-delete LAST, same-email re-registration/newUUID/normal Welcome and same-UUID duplicate denial. Subject is already email-confirmed and has0Welcome receipts; recheck canonical eligibility rather than overriding policy. Preserve the ORIGINAL control and unrelated July owner; retain ledger/idempotency/global campaign counts. Do not inject SQL balances or fake leases/receipts. Use fixture-scoped lost-response/retry; no shared restart/fault after funded play without explicit safe-impact GO. End flags/release OFF once actual requests are terminal; incidents mean STOP/preserve evidence, not manual financial repair. Google only a dedicated authorized test identity, otherwise NOT TESTED.

This combined option requires explicit approval to fund/delete the retained subject. If the owner instead requires a newly created deleting subject with a newly uploaded avatar, create that tracked avatar under the future GO and honor its fresh capability horizon too; the completed global cutoff does not waive per-user capability expiry.

## 4. One conditional destructive Stage E2E GO

After real prerequisites, authorize one disposable subject+two unequal-stack players/control, canonical funding and feature window. UI confirmation→durable accept/signout; old JWT/WS/private writes/JOIN denied, backend independent of browser. Preserve all-in showdown/main+side-pot, normal cash-out, exactly one balanced BURN including winnings. Verify immutable ledger/idempotency/retired USER and unaffected control.

Worker exact-owner Storage DELETE+authenticated absence, indexed Redis/profile cleanup and official Auth hard-delete LAST; retry/lost responses cannot double effects. Re-register same confirmed email→new UUID→normal Welcome payment, zero inherited CH/XP/profile/streak before that new payout; a second Welcome on same UUID denied. DailyUTC/once are independent on new UUID, global campaign lifetime cap still applies. Dedicated Google identity/mailbox or explicitly labelled Admin fixture confirmation must be authorized; no private/ordinary Preview identities. Google absence -> NOT TESTED, not a password-test blocker.

Shared restart/fault needs explicit impact window. Financial mismatch -> incident/STOP, no manual repair. End feature OFF and preserve financial/bonus receipts. Teardown only explicitly scoped fixture resources. No Production deployment/activation/merge included.

## 5. Failure / forward fix

Keep feature OFF on unmet prerequisites; preserve manifests and ledger/counter history. No HMAC fallback, bonus pause, arbitrary timeout, fake completion, guard disable, V2 rollback or global sweep. Correct through reviewed forward code/schema. History/real Stage evidence remains in research.md; old HMAC and pending-reset proposals there are superseded, not executable instructions.

## Stage Account Deletion test window — LOCAL PREPARATION ONLY (21 October 2026)

Supersedes the previous missing-procedure STOP, not the pending operational GO. Current hosted runtime remains91c329558f90cb8cc525777bc621f56242dfeca0; this change is administrative tooling only. No VPS installation, activation, Netlify/DB mutation, restart or E2E was performed. Redis V3 migration and real Storage authority cutoff remain completed; never repeat reset/wait solely for this procedure.

### Protected contract and installation

`infra/vps/stage-deletion-window.py` reuses `SecureFiles`, nonblocking flock, SHA-256, durable backup and atomic replace from `prepare-ws-preview-v3.py`. It has fixed CLI paths and no network/SQL/service commands. Only `.env.preview` may change configuration, and only `ACCOUNT_DELETION_ENABLED` plus `ACCOUNT_DELETION_AVATAR_TRACKING_MARKER=stage-avatar-authority-20261021`. All other bytes/credentials remain unchanged. Baseline must explicitly beOFF, Stage identity/port3001, Redis3/stage namespace. Tracking1 is required in the Netlify issuer configuration; WS cleanup uses the marker, not the issuer-only tracking flag. No extra WS flag is introduced. No CLI path/hash/marker overrides. Foreign settings, unsafe permissions, duplicate assignments, corrupt backup or changed preparation record are NO-GO.

Separate window record: `/var/backups/arcade-stage-deletion-window/` root:root0700, `env.before`, `helper.before`, `manifest.json`, `operation.lock` root:root0600. Original V3 `/var/backups/arcade-ws-preview-v3/manifest.json` stays byte-identical. Window manifest binds its exact hash, full OFF/ON hashes and reviewed helper hash. Helper derives allowed ON bytes from OFF itself, checks against original approval, and rejects arbitrary replacement hashes. States `preparing/activating/restoring` block preflight; same operator resumes deterministic original-or-desired bytes, unknown state stops. Prepare installs only the new protected helper and records; it does NOT activate. Restore restores exact OFF bytes, retaining the new helper and audit records. Neither mode asserts DB terminal completion or automatically rolls back finance/Auth.

New helper pin replaces the old pin in `prepare-ws-preview-v3.py`; do NOT rerun that operator's apply against an old completed transaction. Historical one-time `xp-v3-operator.py` keeps its original pins/evidence and is intentionally not a window installation path. No sudoers changes. Workflow from main invokes the installed fixed helper, so no workflow merge/bypass is required for this installation. Existing protected helper upgrade is necessary before ON can pass LIVE.

After separate GO, stage these THREE public reviewed files at `/tmp/1117-window-reviewed/infra/vps/`. Quiesce configuration writers/deploys. Root validates protected bundle ancestry (no symlinks, root-owned, no group/other write), installed target metadata and existing approval before proceeding; never execute code directly from the staging directory. Install copies first, verify literal approved hashes in the protected directory, then invoke only protected code. A failed hash check means STOP, no prepare/activation. Original helper stays installed until prepare takes its protected backup.

Root installation (public bundle files only; no secret copy, service restart or environment write):

```sh
test ! -L /usr/local/libexec/arcade-ws-preview-v3 && test "$(stat -c '%u:%g:%a' /usr/local/libexec/arcade-ws-preview-v3)" = '0:0:755' && install -o root -g root -m 0644 /tmp/1117-window-reviewed/infra/vps/prepare-ws-preview-v3.py /tmp/1117-window-reviewed/infra/vps/stage-deletion-window.py /tmp/1117-window-reviewed/infra/vps/ws-preview-env-preflight.mjs /usr/local/libexec/arcade-ws-preview-v3/ && printf '%s\n' '63787466ec6e4163f60e09510777df04c38cd2e8d20cb26d6257bcb550173740  /usr/local/libexec/arcade-ws-preview-v3/prepare-ws-preview-v3.py' 'e85a640354a2e4357f772c9104e71c98f6dbfc04faf581341e7380c607a534ec  /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py' '704dc9a8dd59fa96625f63199f3605b888b7eaecabd4a4dcb724a4862d22993e  /usr/local/libexec/arcade-ws-preview-v3/ws-preview-env-preflight.mjs' | sha256sum -c -
```

The command assumes `/usr/local/libexec/arcade-ws-preview-v3` already exists root:root0755 and its ancestors passed the read-only audit. `prepare` rechecks full ancestry/metadata before privileged effects. Do not replace a symlinked bundle/file, alter ACLs, recursively chown or extend sudoers. Existing baseline/helper drift means stop for review, not regenerate an approval hash.

Read-only readiness and prepare (each line is a separate operator step after the relevant GO):

```sh
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py dry-run
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py prepare
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py verify
/usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight
```

`dry-run/preflight/verify` never write configuration or create records; after a crash during prepare, rerun prepare rather than deleting evidence. Root source reads are descriptor/ownership/mode checked. Atomic operations are per-file, NOT an atomic transaction across files/providers. Root must not concurrently edit ignored locks. Failure between helper install and final prepared record remains fail-closed and resumable.

### Netlify scope — read-only verified 21 October

Site `playkcswh`/f7e19a84-28f7-41f7-978a-f3b4552a404d currently has deletion0 in Production and all five existing branch overrides. Tracking1 exists for `deploy-preview-1124`, source branch `feat/1117-account-deletion-v2`, and the older docs branch; marker key is absent. Existing keys have scopes builds/functions/post_processing/runtime. This is actual provider metadata, not an assumption about generic deploy-preview scope.

For the window change ONLY the exact `context=branch, context_parameter=deploy-preview-1124` value of deletion to1 and add the same branch-only marker. Preserve scopes and every other context/value byte-for-byte; no all/deploy-preview-wide value, no source-branch/other Preview/Production update. New marker entry needs functions scope with only that branch value; absent elsewhere must remain absent. Back up exact scoped provider metadata privately; validate pre/post differences. Freeze automatic PR deploys (Draft/skip marker) and concurrent alias publishing for the whole window. If provider cannot scope this override unambiguously, NO-GO.

Env edits alone are NOT runtime proof. Build/package the supported exact runtime SHA using the existing Stage build/Functions procedure, then publish ONLY the manual `deploy-preview-1124` alias. Record actual deploy ID, served build SHA, generated deploy-preview/3/stage context, pinned Supabase Stage, effective branch env and tracking marker. Do not claim provider `commit_ref` if null. With DB releasefalse, a no-token GET to account-delete should change from503 disabled to401 unauthorized; a disposable owner's read-only GET should return404 no request. No POST/acceptance in this gate. Verify marker through scoped deployment configuration plus package/env evidence, never by printing secrets. Failure to prove effective Functions env means NO-GO.

Changing Functions environment requires a new supported deploy; restoring OFF also requires a new OFF deploy. Track the ON deploy's immutable URL: repointing alias alone does not retire it. After terminal completion, OFF alias verification and no active/rollback/split alias references, retire ONLY the newly created ON window deploy under explicit operational GO and verify provider absence/function unreachability. Never bulk-retire historical deployments. If retirement isn't permitted or safe, leave DB releasefalse and block a later window until immutable ON authority is accounted for. Other previews and Production must retain their deploy IDs/config/health throughout.

### Activation sequence — next explicit operational GO required

1. Recheck117/117 hashes, guards v2/v3/ready, Storage marker stage-avatar-authority-20261021, REDIS-RELEASE/epoch, exact91c runtime/both contexts and Stage identity. DB releasefalse and both runtime flags0. Subject/control/July ownership and approved financial/E2E scope must be independently revalidated. No reset, migration, fake marker or additional7200s wait.
2. Install reviewed bundle, dry-run, prepare, verify OFF and LIVE; privately retain approved hashes/backups. Recheck Netlify issuer tracking1 separately; operator may not change any third WS setting.
3. Publish branch-only Netlify ON/marker deployment with DBfalse; verify scope/Functions. Activate WS file through the fixed operator, then verify protected ON/preflight. No arbitrary shell env editor.

```sh
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py activate
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py verify
/usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight
```

4. Before an explicitly authorized Preview restart: zero humans, no unsafe pending actions/settlement, persisted bot state and exact escrow conservation; balanced bot-only activity alone is not STOP. Restart only ws-server-preview.service with the approved fixed systemd command. The operator never does this. Verify actual process config through protected evidence, installed SHA/both contexts, LIVE, health, browser auth/ping and finance after restart.
5. Only after matched ON runtime/marker and all gates, enable the single Stage DB release row using the existing pinned Stage transaction mechanism; never operate on Production. This is LAST. Execute only the separately scoped fixture E2E; no global cleanup.

### Closure / incident handling

First set only Stage DB releasefalse through the pinned transaction mechanism; this blocks NEW POST requests. Existing WS tick scans durable requests independently of the release row and continues while WS flag1. Check ALL accepted requests (including leased, RETRY and INCIDENT), not just due scan results. Require actual terminal completion and no outstanding settlement/effect before stopping recovery. An INCIDENT is NOT terminal cleanup success. Preserve enabled worker and receipts on partial failure; no BURN/Auth rollback, fake receipts or manual financial repair.

After actual terminal completion, deploy branch-only Netlify OFF, restore its prior marker presence/value and verify effective OFF Functions/unchanged other contexts; retire the exact ON deploy as above. Restore WS baseline byte-for-byte, verify OFF and LIVE, and only then perform an authorized safe Preview restart so process config also becomesOFF. No restart while recovery remains outstanding.

```sh
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py restore
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py verify
/usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight
```

`deactivate` aliases restore; it cannot prove application termination, so the operator must enforce that prerequisite from DB/ledger evidence. Interrupted activate/restore: stop new requests via DBfalse, inspect protected phase, rerun SAME operation or restore only when recovery is safe. Unknown bytes/permissions/hash = STOP. Do not remove the window directory or overwrite preparation manifest to get a PASS. Final evidence: DBfalse, OFF active Netlify and actual WS process, exact unchanged Redis/Stage config, accepted requests terminal, protected baseline restored, no remaining ON immutable authority. Backups remain private0600, no expiry/deletion invented.

Breaking impact: helper config-only now authenticates full V3 approval too; transient window phases intentionally prevent deployment. Old Redis operators cannot reinstall over the new window helper using stale pins. No app/finance/bonus/Storage/Redis behavior changes, no browser script/CSS/CSP changes, no Production effect. New operational GO must cover protected installation/prepare, alias-only Functions ON/OFF deployments, fixed WS config activation/restoration and safe restarts, DB release last/first, specific fixture E2E and newly created ON deploy retirement after safe alias checks. None has been executed here.

### Current operational checkpoint — E2E stopped before funding (21 October)

Protected window was installed/activated and actual Preview restart/smoke passed on91c. Original subject email is reserved example.invalid and real Auth mailer_autoconfirm=false; verified ordinary same-email re-registration cannot be completed through email delivery. STOP: no release activation/deletion request, funding or destructive action. Full details and read-only preservation proof are in research.md. Owner must separately authorize a declared test-fixture confirmation exception or a deliverable identity procedure before repeating E2E. Do not silently substitute admin-confirmed signup for end-to-end email delivery.

Netlify branch restoredOFF with marker absent and verified OFF deploy6ad88b82d4dc63d285f15c0f; DB releasefalse and requests0 throughout. WS is stillON until owner root performs restore and agent safely restarts/verifies actual processOFF; only then retire exact ON deploy6ad889618f2adbfbd14859db under existing GO after safe alias/fallback checks. No other deployment or fixture may be deleted. Root restore command remains the previously reviewed one-line command above. No repeat migration/reset/wait needed.

### Accepted fixture confirmation exception / next prepared window

The reserved-address blocker now has explicit owner approval for test setup: after actual old Auth hard-delete/COMPLETED, use public ordinary same-email signUp, verify a real stored NEW UUID and exact same address, then official Auth Admin email confirmation ONLY for that new disposable UUID. No confirmation change for old subject/other existing users, no Admin createUser or SQL fallback for re-registration. If public signUp rejects example.invalid or fails, STOP and preserve evidence. Email delivery and confirmation link remain NOT TESTED. After confirmation, ordinary password login/zero-inherited-state/normal Welcome exactly once; never edit CH/XP/receipts/eligibility. Temporary validation harness is fixture-scoped, not new application infrastructure.

Previous window fully closed: actual fresh WS OFF process/health/Auth+WS/finance verified after owner restore; exact ON6ad889618f2adbfbd14859db deleted204 and root/functions404 with aliases unchanged. Only after that, next branch-only ON6ad8913597cbf65ecb017f0a was prepared/verified with served91c and exact marker; DBfalse/WSOFF pending owner root activate/verify/LIVE using the unchanged approved operator. No migration/reset/re-wait or new runtime SHA needed. Fresh safety gates precede the next restart and release activation LAST; all original fixture/control/financial/terminal closure constraints still apply.

### Current authoritative checkpoint — accepted request blocked in Poker

The next window WAS activated and safely restarted on91c; branch-only ON deploy is `6ad8913597cbf65ecb017f0a`. A real confirmed UI request now exists and is in poker/RETRY (`stack_ambiguous`), not a pre-request setup blocker. DB releasefalse; WS/Netlify remainON intentionally for recovery. **Do not run restore, stop the worker, or retire this ON deployment now.** Subject Auth/profile/four manifests/two outputs remain; BURN0 and deletion Storage DELETE0. The previous window/ON retirement evidence remains historical and valid.

Local fix recognizes only proven terminal CLOSED/INACTIVE0/ESCROW0 seat history without a state stack key. Requires a NEW exact-SHA WS Preview Deploy; green PR CI does not install it. Before deployment: recheck pending requests/incidents, exact Stage/Redis/guards/marker, no unsafe humans/actions/settlement and unchanged financial proof. This recovery deployment requires separate GO after the financial STOP; no manual seat/balance/request edits or new deletion request. Keep DBfalse and use automatic recovery of the existing request. Verify one BURN/registry, exact Storage cleanup with real lease, Auth-last and then the approved normal-signUp/new-UUID/Welcome checks. Do not claim deletion during active all-in from this campaign: the acceptance snapshot had already reached SETTLED.

Only after all accepted requests actually finish may the existing DBfalse → terminal verification → NetlifyOFF → protected root restore → safe WS restart/processOFF → detached ON retirement sequence finish. Do not issue a root restore instruction while this request remains unfinished.

### Current checkpoint — COMPLETED, waiting ONLY for protected WS restore to close window

Actual recovery run39597072168 installed503be776; existing request completed2026-10-21T12:10:22.640Z with incidenttrue preserved, leaseNULL, one balanced400CH BURN and Auth-last. ALL requests terminal, DB releasefalse, Netlify aliasOFF verified on6ad8ac5e86ce1c2d1e5c96ee (served91c), Functions503, marker absent. Owner may NOW execute the reviewed protected restore below. Agent then checks protected OFF/LIVE, safe Preview restart and actual fresh processOFF. Do not call current WS OFF before those steps.

```sh
/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py restore && /usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py verify && /usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight
```

After processOFF proof, verify no active alias/publish/fallback/split references to ONLY current ON6ad8913597cbf65ecb017f0a; retire it under the existing specific GO and verify metadata/immutable endpoints unavailable plus active aliases/Production unchanged. Do not retire the new OFF deployment or any other historical deploy.

Same-email public signupHTTP400: no new UUID, no Admin confirmation/Welcome; do not rerun or create via Admin fallback. Full E2E remains partial pending fixture/re-registration review and historical Poker-row disposition. Status API actually reports completedtrue/retryablefalse/requiresInterventiontrue; preserve historical incident and review presentation before merge. Google/email delivery NOT TESTED.

### Window CLOSED —21 October12:23:13UTC

The root restore above has now been performed and verified; do NOT rerun activation/closure. Fresh actual WS processPID20592 started12:21:29UTC on503be776, protected OFF baseline/LIVE/health/browser Auth+WSPASS, DBfalse, ALL requests terminal. NetlifyOFF6ad8ac5e86ce1c2d1e5c96ee remains ready. ONLY ON6ad8913597cbf65ecb017f0a was retired204 after alias/fallback checks; metadata/immutable root/functions404, active aliases/Production unchanged. All layersOFF; no recovery is outstanding. Retain private proofs/backups. Next work is review of signup fixture and retained historical Poker rows/API presentation, not another migration/reset/deploy/activation.

### Next review gates (no new activation authorized)

Stage remainsOFF/closed. Signup400 is now attributed by actual provider log to email_address_invalid; do not retry the reserved fixture or create via Admin fallback. Before another real E2E, agree a deliverable dedicated fixture and prove normal public signup via existing client/redirect. Poker cleanup is NOT implemented: see exact per-owner projection/CAS, lock/cache rules and completed-request repair scope in plan.md; separate GO mandatory. Full E2E must assert no deleted UUID in operational seats/state/table.creator while retaining accounting/immutable audit evidence under existing policy. Local API fix preserves historical incident but reports no active intervention once COMPLETED; current deployed runtime still has the older presentation until separately deployed.


### Current final minimal T07b plan — separate activation GO required

Supersedes the old reserved-email and unimplemented-Poker follow-up instructions above: Poker repair is accepted CLOSED; do not revisit its tables/manifest/all-in. A new deliverable disposable identity already passed real public signup, delivered confirmation link, password login and ordinary Welcome500 exactly once (retry denied), with XP0/no avatar. No Admin confirmation was needed. Protected private fixture evidence identifies the exact subject; never publish credentials/email/UUID.

Current WS runtime a6e8e4dda45e2908b385d3242691bf3f6cc0ba4b is OFF. Netlify OFF deployment6ad8ac5e86ce1c2d1e5c96ee serves91c329558f90cb8cc525777bc621f56242dfeca0; the next approved window must build supported Functions from exacta6e8e4dd, with branch-only deploy-preview-1124 flag/marker and no Production/global changes. Documentation-only commits do not require WS redeployment. Reviewed protected operator files already match their approved hashes; no reinstall or Redis operator is needed.

Before activation, operator may perform this read-only root check (not yet executed for this preparation):

`/usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py dry-run && /usr/bin/python3 -I -B /usr/local/libexec/arcade-ws-preview-v3/stage-deletion-window.py verify && /usr/bin/node /usr/local/sbin/arcade-ws-preview-env-preflight`

After separate owner GO only: revalidate exact subject/balance, guards117/117, LIVE/OFF and no unsafe active operations; prepare branch-only Netlify ON immutable build, then protected root activate/verify and safe WS Preview restart. Verify exact runtime/configuration/LIVE/health before enabling DB release LAST. Existing flags are Stage-wide, not UUID-scoped; submit ONLY this subject's UI request and close DB admission immediately after durable acceptance. Do not create another request after lost response: recover through existing status/idempotent retry. Keep worker enabled through terminal completion. No Poker scenario, avatar upload, migration, Redis reset or old-fixture operation belongs to this test.

Verify one balanced BURN of the actual remaining wallet (currently500 CH), zero avatar objects expected, Redis/profile cleanup and official Auth hard-delete LAST; assert no operational Poker references without re-running historical repair. Ordinary signup with the exact same deliverable address, real confirmation link, password login, distinct UUID, zero inherited CH/XP/profile before ordinary Welcome500 once; retry must not pay again. Preserve control accounts and global campaign counters.

Closure: DB releasefalse first; all accepted requests terminal; Netlify OFF; operator exact WS restore; safe restart and actual processOFF verification; retire ONLY the newly created ON immutable deployment after alias/publish/fallback/split checks. Any uncertain financial/Storage/Auth effect is STOP with recovery preserved. No Production operation. Full T07b is not PASS before this separate campaign.


### Owner-selected final alias supersedes earlier fixture selection

The exact dedicated alias subsequently specified by the owner is now the ONLY intended final T07b deletion/re-registration subject. Its full address, UUID and credentials remain in the protected private owner-alias campaign record, never in public artifacts. Read-only Stage lookup first proved it unused. Ordinary browser public signUp returned200/new UUID; the actual Gmail confirmation message was delivered and its signup link followed (provider303). Normal password login PASS; ordinary Welcome500 CH paid exactly once, retry denied with the same receipt. No Admin API confirmation/createUser or validation bypass. The previously prepared alternate-alias account and the base-address account are outside deletion scope and remain untouched.

The same exact owner-selected alias must be reused after the separately authorized deletion; do not substitute the base address or any other alias. No activation/deployment/deletion occurred in this prerequisite campaign; existing separate-GO Stage-window plan is unchanged.


## Final owner-alias T07b campaign — deletion PASS; re-registration STOP429

Fresh Stage117/117 hashes/guards/Redis V3/financial readiness passed; approved subject had500 CH, no avatar or Poker participation. Branch-only Netlify ON6ad8f8addfc234640dcb686e served exacta6e8e4dda45e2908b385d3242691bf3f6cc0ba4b; protected owner activation and safe Preview restart installed the same WS runtime, LIVE/health/browser Auth+WS PASS. DB admission enabled last, one ordinary authorized POST returned202 and durable request; DB admission immediately returnedfalse. No new Poker scenario/history repair was performed.

Automatic worker progressed preparing→poker→burn→cleanup→auth→COMPLETED with incidentfalse, no operator retry. Exactly one500 CH balanced BURN/two entries/one idempotency receipt; retired USER0. Auth remained present before auth phase, official Admin lookup404 at terminal completion; prerequisites/receipts confirm Auth-last. Profile/Redis absent, sticky lifecycle fenceBLOCKED, zero operational Poker references. Avatar objects/manifests0, so actual Storage DELETE count0 (not a repeated nonzero Storage test). Other USER wallets/profiles and global campaign counters equal the protected pre-window snapshot. Old JWT profile access401. All accepted requests terminal.

Ordinary public same-alias signUp was attempted exactly once after COMPLETED and returned429/over_email_send_rate_limit. Read-only lookup confirms no replacement Auth account exists. No Admin workaround/config change/retry; newUUID/login/Welcome after re-registration NOT TESTED. Earlier successful registration/mail/Welcome remains prerequisite evidence, not proof of re-registration. Full T07b remains OPEN, not merge-ready. STOP triggers safe window closure because no request/recovery is unfinished: DBfalse, branch Netlify OFF restoration/deployment in progress, protected WS restore and actual processOFF verification still required before ON retirement. Runtime/Production untouched outside approved Stage operations; retain protected evidence.


### Owner-alias campaign CLOSED — 21 October 2026,18:13 UTC

Root operator restored/verified exact OFF baseline and LIVE. After fresh terminal-request/financial/no-active-human/no-pending-Poker checks, WS Preview safely restarted at18:12:30UTC, processPID43714, exactruntimea6e8e4dda45e2908b385d3242691bf3f6cc0ba4b; systemd uses the protected restored EnvironmentFile. Local/public health, LIVE and ordinary control Auth/profile/browser↔WS PASS. No direct process-environ read is claimed. DB releasefalse; all requestsCOMPLETED; other USER balances/profiles/campaign counters unchanged. Netlify OFF immutable6ad8fce33ac6254e49494b9f serves the same runtimeSHA, account-delete503. Only campaign ON6ad8f8addfc234640dcb686e retired204; metadata/root/GET+POST Functions404, aliases/published Production and unrelated preview fingerprints unchanged. No recovery outstanding. Do not rerun activation/restore/deletion or retire any other deployment.

Remaining final T07b step ONLY: after provider email-send quota permits, separately approve one ordinary same-owner-alias public signUp, delivered link confirmation, password login/new UUID/no inherited CH/XP/profile and ordinary Welcome500 once plus denied retry. No deletion window/Poker/Storage operation is needed for that remaining check. Previous429 created no account; no administrative bypass or quota/config change was performed. Full T07b and merge-readiness remain OPEN; Google NOT TESTED. PR staysDraft.


## Final T07b same-email re-registration PASS — 21 October 2026

Supersedes the429 blocker above. Read-only Management API confirmed Stage built-in email provider, rate_limit_email_sent2/hour, smtp_max_frequency60s, confirmation required. Selected Auth logs showed confirmation sends17:06:18/17:17:00UTC and the prior signup429 at17:56:18, no later sends through18:30. The owner-authorized ONE retry was therefore made after the documented one-hour quota window, not on an arbitrary timer. Official rate-limit reference: https://supabase.com/docs/guides/auth/rate-limits . Previous429 headers were not captured; available logs have no Retry-After. The new attempt captured selected Date/Retry-After/status privately. No SMTP/rate-limit settings changed.

Actual ordinary browser public signUp200 for EXACT same owner-selected alias produced a distinct UUID. Real Gmail signup message arrived, actual provider confirmation link303 and normal password login PASS, no Admin create/confirm/bypass. Before ordinary Welcome, new wallet absent/zero and no Welcome receipt; new profile default/no avatar and XP0. Welcome500 once, second POST denied/alreadyClaimed with same receipt. SQL verifies one balanced transaction/two entries/one idempotency receipt for the NEW UUID. Old Auth UUID remains absent; old lifecycle fence and completed deletion history remain separate, with no inherited CH/XP/profile ownership. Sensitive alias/UUID/password/token/mail link remain outside public artifacts.

Final read-only checks:117/117 hashes/guards, Redis V3 LIVE, DB releasefalse, no unfinished requests, active humans0/pending Poker0, unbalanced transactions0; all other USER balances/profiles and campaign totals unchanged. Netlify flag values all0/temporary marker absent/published Production unchanged; WS process43714 still the restored OFF process, health/LIVE PASS. No new deletion request/BURN/deploy/migration/reset/root operation was made in this final registration step.

- [x] Final minimal password/email T07b: actual deletion/Auth-last plus same-email public re-registration/newUUID/real email confirmation/login/Welcome-once PASS across the documented controlled campaign. Accepted earlier Poker/privacy evidence is not rerun.
- [x] All layers OFF and no recovery outstanding; only this campaign ON deploy already retired.
- [ ] Google OAuth remains NOT TESTED without a separately authorized dedicated identity; do not infer Google PASS from password evidence.

Ready for owner review after final CI; this is not authorization to merge, deploy Production or activate Account Deletion. Prior Draft/OPEN/429 checkpoints above are historical and superseded only for the completed minimal email/password T07b. Accepted MVP late-upload risk remains separately tracked in#1128; cross-account anti-farming remains#1131, Welcome remains per UUID.


### Production P2 result —21October2026

Exact approved equivalent20261021191104 applied once at19:50:36UTC, reviewedSHA5036a5977b8c9572556830fa08dc8cc87589ff232270a6cb6d58064a7b429b3e; actual history65→66. Schema/ACL/retention/campaign counters and read-only old-runtime smoke PASS. Protected backup/evidence retained; normal bot-only financial deltas fully reconciled, USER/history unchanged. Deletion/tracking remainOFF,avatar-v3DISABLED; Netlify/WS remain82aee39d without restart/deploy. See [P2 evidence](production-compatibility.md). Do NOT repeat apply or run a migration directory. P3 standard merge/deploy and P4 activation require separate owner GO; no push/merge/deploy/Stage change authorized in P2. T07b remainsPASS.


### Production activation policy update (2026-10-22)

Owner accepts unobserved previously issued avatar capabilities. A truthful, privileged cutover acceptance may waive only the fixed global 7200-second delay; every known `capability_until`, uncertain operation, ownership, receipt and lease guard remains mandatory. Existing markers without acceptance retain the original wait. See `research.md`, section “Production activation: owner-accepted unobserved capability risk”.

Local implementation: `20261022091126_account_avatar_known_capability_policy.sql` and `private.account_avatar_safe_after(marker)`. No remote apply, acceptance marker or activation has occurred. Production-equivalent SQL after history 66 and a reviewed protected Production ON/OFF procedure are still prerequisites. Current protected Production preflight refuses ON; do not bypass it. New changes must be reviewed separately because #1124 is already merged. Default behavior remains OFF.


### P4 prepared Production release (review #1132)

See [production-activation.md](production-activation.md) for actual Production66 authority evidence, exact Production-equivalent SQL/hash, isolated PostgreSQL verification, minimal protected ON/OFF proposal, ordered release and forward-fix. Production migration is now prepared locally, not applied. The protected Production operator is a proposal requiring implementation/review and root installation, not an existing tested activation path. No remote changes or readiness metadata are made. Historical P2/P3 before-merge instructions are superseded by their accepted PASS and merged #1124; T07b remains closed PASS.


### P4 protected Production window — implemented locally, not installed

Owner accepted the existing postgres backend trust boundary; acceptance remains an operational action with no new HTTP/RPC setter. `infra/vps/production-deletion-window.py` now reuses SecureFiles and anchors OFF to the committed root Redis-cutover receipt, deriving only deletion flag + Production marker ON. Updated Production preflight accepts ON only with the protected manifest/whole-file derivation and existing exact DB/LIVE Redis checks. Existing Stage/Redis operators and sudoers are unchanged. Python20/Node20 local tests cover interruption/restore/drift; no protected VPS or environment mutation occurred. Exact reviewed hashes, one-line FUTURE-GO installation/activation/restore and release order are in [production-activation.md](production-activation.md).

Production SQL67 (unchanged hash) must be applied and verified before deploying runtime using `private.account_avatar_safe_after`. OFF-only protected helper preparation may occur earlier; migration67, merge/deploy, tracking/guard/readiness and activation each retain their explicit GO gates. Do not infer activation from successful installation or CI.
