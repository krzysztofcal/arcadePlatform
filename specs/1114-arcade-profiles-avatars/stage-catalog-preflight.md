# Stage A / catalog activation preflight — 2026-10-27

## Owner acceptance and exact artifacts

Owner confirms physical Android PASS: avatar save without HTTP500; current avatar in Account, Online and Single Player; last confirmed local avatar in Offline; gallery UX and explicit Set avatar accepted. This accepts backend c2404ea6c37808ac416e49bb10620e89e689bda2 with the previously installed APK e370e4611c65e60a2b4f6964cbc042c14c14d395. No new APK or repeat of these accepted scenarios is required.

Read-only evidence at preflight:
- Stage project krydukthwdvccggbyjfw / PostgreSQL system7656985631720456337. History119 and hash records119 match all119 checkout migrations, zero mismatches. Additive Phase A schema already applied under its separate GO.
- WWW/API Preview1155 serves c2404ea6, deploy6ae0acac06af56bbe0afed3c; existing required checks green, DB Stage Apply skipped. Earlier authorized actual API/OPTIONS and owner save smoke remain valid.
- WS Preview health `ok`, active PID442909, started2026-10-27 11:36:33UTC; release ea178bb3fba8fa896fee671ee129326bd3caf0c1. Generated identity ws-preview / deploy-preview / null origin / Redis3 Stage. No subsequent shared/WS source diff. Verified rollout/recovery run40497329798 remains applicable; no redeploy/restart.
- Accepted APK e370e461 contains16 local WebP assets,6 legal documents, Preview1155 API, Stage Supabase, WS Preview, verified receipt/signature/CSP/SRI; checksum5632c4685090873e3535af825ddf1e438a591aae212c383cf1ecedf85b26ac84. P1 c240 changes server serialization only, no APK asset/config changes.
- Policy version2026-10-26-a1, active=false, variants_enabled=false, identity_normalized_at=null; receipts0. Missing policy still fails closed. Upload closure and server Terms/UGC boundaries remain implemented, not bypassed by OFF. OFF deliberately does not require receipt. B moderation/C photo import/D digest are not implemented or activated.

## T033: PASS evidence / OPEN operations

PASS: additive schema; compatible WWW/API and local assets; exact-SHA WS rollout with executable backup/recovery, health and nonfinancial hello/auth; current phone acceptance; existing six assignments; fundamental OFF/ON/version/receipt/replay admission tests and upload rejection.

OPEN: actual catalog flag/provisioning activation and postactivation read-only smoke; legal approval and separately authorized Terms activation/current-receipt/UGC denied/accepted integration; live funded JOIN/reconnect remains unperformed and requires separate GO if requested. Local JOIN/replay fixtures and existing phone gameplay are not relabelled a live Terms-ON or funded reconnect test. T033 stays open as a composite task; these separate gates do not make catalog-only activation technically depend on Terms ON, cleanup or B/C/D.

## Can catalog16 be enabled with Terms OFF?

Yes, for the approved current Stage WWW/APK/WS readers. `enable-catalog.sql` atomically replaces only ensure_user_profile(uuid), keeps service-role-only invocation and enables variants_enabled. It does not set active, write receipts or update existing profiles. Existing profile returns before identity/random choice; new profiles use the existing private identity helper and choose among16 when ON (six when OFF). No second signup trigger. Current six identifiers/assignments and revision values are preserved. Backend picker validation independently enforces the policy; readTermsStatus gates acceptance only when active=true, independently of variantsEnabled. Existing profile/row/lifecycle locks and CAS remain mandatory.

Script SHA256: 4dfd05dd55438a61dbb01aa65cf4b00f247d476b398763c238785407e5c8f5d9.

Old Stage clients are not upgraded by the flag: six-only renderers may show their default for a new identifier and cannot select the extra ten. Old upload/manual-profile APIs are already rejected by Phase A. This is a known older-client presentation limitation, not CH/game-state corruption; the accepted current APK/WWW/WS recognize all16. Cached OFF policy may continue showing six until refresh; it does not grant extra permissions. Do not claim arbitrary historical APKs have full16 support.

## One minimal separate GO / execution plan (NOT executed)

Authorize only Stage krydukthwdvccggbyjfw: pinned enable-catalog.sql above, replacement of its existing provisioning function and variants_enabled=false→true, keeping active=false/version unchanged; no normalization, Terms receipt, schema contract/drop, Storage, CH/XP or WS mutation.

Immediately before apply: verify project/system,119/119 hashes, exact SQL hash/current function definition+owner+ACL, singleton/version/OFF flags, private identity helper, compatible release metadata and no concurrent policy/DDL operation. Capture existing function definition/owner/ACL and aggregate profile/variant/revision fingerprints in restricted operator evidence, not personal content in PR. Use a short bounded lock/statement timeout and one transaction with explicit singleton row lock and asserted preconditions; execute the exact script body in that same transaction (do not nest BEGIN/COMMIT). Assert function/ACL, variants=true, active=false, version unchanged and unchanged profile fingerprints before commit; any error rolls back all DDL/flag effects. Do not use an all-pending migration workflow.

After: read back function/flags/119 history; authenticated onboarding GET for the already provisioned dedicated account (confirm existence first) must return required=false, variantsEnabled=true, same version and exactly16 catalog keys. Read-only Account smoke shows16 loaded local images with no PATCH/Terms acceptance; existing assigned avatar remains unchanged. No new real signup/profile creation is needed: provisioning SQL is exercised in the existing isolated fundamental fixture. Explicit owner save of a new variant is optional separate manual acceptance, not an automated mutation in this GO.

Recovery: before commit any failure rolls back. After commit, stop on unexpected results. With explicit recovery authorization, setting only variants_enabled=false disables new7–16 assignments/selections; leave compatible readers and existing assignments intact. Do not reset newly assigned variants. Restoring the captured function/ACL is a separately controlled operation and does not undo profiles created after activation. Do not claim flag OFF erases16 assignments or safely supports a runtime downgrade to six-only readers.

## T012 read-only inventory (aggregates only)

51 profiles; customized-handle marker1; nonempty BIO1; attached avatar_key1; display name differing from generated handle label1; handle outside generator pattern1. These counters may overlap, and pattern matching is not proof of provenance. No names/handles/UUIDs/object paths disclosed.

Variants: comet-blue9, falcon-orange4, fox-blue11, nova-purple9, orbit-green8, panda-pink10 (total51); extra/unknown variants0. Pending deletions0; profiles linked to deletion records0. profile-avatars Storage objects2; tracked avatar objects3; both2 present objects match tracking. Different counts do not by themselves authorize deletion or imply orphan safety.

Constraints inspected: UUID primary key/auth FK; lower-case/format/reserved handle constraints; display-name/BIO lengths; avatar revision bounds. No DB six-only avatar CHECK prevents16. Normalization scope/risk remains separate: the current script visits all non-deletion profiles, rewrites generated display name, clears BIO/avatar_key, sets suppression and increments revision even on otherwise automatic profiles. It retains trusted generated handles and replaces customized/uncertain ones; changed public URLs can become not-found. Review provenance/writer history before approving normalization; do not infer it from one pattern count. UUID/avatar_variant/privacy/CH/XP/game data must remain untouched, concurrent editors may get stale revision, and Storage purge is separately gated. T012 inventory is done; normalization/retention approval/execution and contract/drop remain OPEN.

No Stage mutation, live PATCH, Terms acceptance, funded operation, Production query/change, cleanup, APK rebuild, WS deployment, Ready or merge performed. Only existing fundamental tests reused; initial direct invocation lacked the test runner's XP/CORS environment and was corrected rather than changing code or guards.
