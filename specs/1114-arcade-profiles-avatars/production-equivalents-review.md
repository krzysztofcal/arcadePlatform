# Production equivalents — local preparation / review

2026-10-28. **Preparation/test PASS; subsequently COMMITTED on Production under separate OWNER GO, 67→69. LEGAL OPEN.** See [execution report](production-schema-67-69-execution.md) for actual receipts and postflight. PR #1155 remains Draft at a87e06c4. No push, code rollout or APK. Historical preparation sections below record the evidence available before that separate execution; they are not a request to reapply the pair.

## Files and dependencies

1. `supabase/production-migrations/20261026120000_profile_phase_a.sql`
   SHA-256: `edf83e55891441213695b8c9f04d72b2ffd34151aa58239179fa60056ff6a862`.
   Exact Production history 67, pinned project otbqfijerkieoxwpxjnm/system7575202818581710058, operator postgres, explicit project/confirmation/source-hash settings. Adds revision/suppression, private policy/receipts and identity helper. Terms OFF/a1, catalog OFF/six, normalization marker NULL, no receipts. Replaces provisioning with policy-aware six/16 core while preserving existing rows. Revokes PUBLIC/anon/authenticated EXECUTE on ensure_user_profile and the related signup trigger function; retains service_role and internal owner invocation. Captured definition/owner/ACL pins and a guard for unexpected related SECURITY DEFINER paths fail closed on drift. No BIO or legacy avatar_key removal.
2. `supabase/production-migrations/20261028180000_public_profile_block.sql`
   SHA-256: `87d747891527dbe85fe542af91fe0965a2fb67ebd4222dab5f40bee52fb32eaa`.
   Requires exact history68 and first equivalent's approved SHA receipt, matching provisioning body/ACL and OFF policy. Adds boolean NOT NULL DEFAULT false, invoker guard and BEFORE INSERT/UPDATE trigger; no profile block activated. Checks type/default/nullability, guard owner/config/ACL and trigger.
3. `supabase/production-migrations/manifest.json`: only two appended replacement entries. Historical baseline54/missing57, history_policy/source_main_commit, all prior entries/SHA and forward_only unchanged.
4. `tests/chips/account-deletion-production.fixture.mjs`: historical Stage Phase A workaround removed; existing legacy smoke moved after genuine Production67 and the new equivalents. Earlier deletion/retention security assertions remain.
5. `tests/chips/profile-bio-contract.fixture.mjs`: one exported fundamental Production contract reused by the existing runner; no new runner/framework. Historical pre-contract/Stage BIO tests retained.

## Transaction and provenance

Each file has BEGIN/COMMIT, lock timeout2s, statement15s and idle-in-transaction15s; nonblocking shared Production coordination lock, pinned history, lifecycle→policy→profile order. Full profile row fingerprint/count before/after, excluding only the newly added columns in the after image. No existing profile UPDATE or updated_at/revision increment. New policy insert and metadata receipt are the only intended DML; transaction-counter deltas guard against unrelated table DML without scanning financial archives.

Production has no canonical schema_migration_files table. These files DO NOT create a second history framework or backfill the old67 hashes. Version/name and `statements=['source_sha256=<approved source hash>']` are inserted in the same transaction. Operator must independently calculate/compare exact file bytes with the approved manifest hash and supply `arcade.production_profile_source_sha256`; the SQL validates format and records the trusted operator assertion, not a self-computed hash of its own file. The block migration additionally pins the first receipt to the known first-file SHA. This is not a claim of complete cryptographic provenance for the historical67 entries.

Explicit per-file confirmation values:
- `chips.production_project_ref=otbqfijerkieoxwpxjnm`;
- first: `arcade.production_profile_confirmation=INSTALL PROFILE PHASE A otbqfijerkieoxwpxjnm`;
- second: `arcade.production_profile_confirmation=INSTALL PUBLIC PROFILE BLOCK otbqfijerkieoxwpxjnm`;
- each: source SHA setting exactly matching the approved file.

## Actual local validation

Dedicated disposable PostgreSQL17.11, loopback127.0.0.1:55465, system7701225723289707303, database profile_block_full_review_test. Current Production identity/history/function/ACL inventory was re-read only; no remote mutation. No real Production account data copied. The existing full harness reconstructs all67 Production schema versions with synthetic data (final run347 profiles, stronger N-row preservation coverage than the observed11 live profiles). It also runs and retains historical pre-BIO and Stage post-BIO contracts; Production equivalents themselves never run the BIO contract.

Bare PostgreSQL fixture was aligned with observed Supabase function grant ordering and history `name/statements` columns. The SQL guard was NOT relaxed to accommodate a fake baseline. Function definition SHA pins match actual Production; missing grants/history columns were fixture issues and corrected locally.

PASS:
- identity/confirmation/hash-receipt refusal, extra history version refusal, unknown related SECURITY DEFINER refusal, coordination lock refusal;
- individual late error fully rolls back each equivalent, including DDL, function ACL and history; late error after both operational bodies in one transaction rolls the complete67→69 batch back to67;
- valid67→68→69; all original profile fields/BIO/avatar_key and protected tables identical across each migration;
- nonempty synthetic legacy BIO and attached legacy avatar survive; Terms OFF/a1 and variants false; signup and service-role provisioning use only six variants;
- direct ensure RPC denied42501 to anon/authenticated; related signup function has no client EXECUTE; real Auth INSERT still invokes the signup trigger;
- backend owner GET/PATCH, avatar CAS/stale revision, rejection of extended variants while OFF; visible ranking→blocked absence→unblock; blocked owner access remains available; service-role flag update denied by guard;
- CH accounts/transactions/entries/registry, synthetic Poker table/seat/state/action and zero escrow, deletion release/requests, capability trackers, Storage buckets/objects unchanged by migrations; deletion lifecycle still refuses updates after a synthetic request, tested with rollback;
- actual old source at a63e44b0: provisioning, owner/public reader, owner HTTP GET/PATCH and WS profile repository execute against the new schema. Installed old WS reader matches that Git source; published main0f77574d profile source is identical. Dependencies are injected to the local DB; no old service is started or connected to Production. This proves the relevant old SQL/API reader contracts, not a new full gameplay/financial regression.

Final full `tests/chips/chips.migration.test.mjs`: **PASS**, including existing Production deletion/retention, old avatar pipeline security tests and Stage BIO contracts. Manifest guard **121 Stage migrations /14 Production replacements PASS**. Syntax **234 files PASS**, diff-check PASS. Legal draft hashes and Stage migration bytes unchanged. No CSS/browser JS/inline scripts changed, so no CSP/SRI update required. Hosted CI NOT RUN (no push). Disposable cluster stopped; retained files were not cleaned.

## Recommended next schema-only Production GO

After review, authorize only these two exact files/hashes, Production project/system, and a single controlled operator transaction containing the identical operational bodies, with the two independent confirmation/hash settings and one final COMMIT. Strip only the outer BEGIN/COMMIT when constructing that reviewed batch; never nest transactions or use --single-transaction around files that already COMMIT. This atomic-pair pattern is covered by the late-error regression: a failure in the second operation must not leave the first committed.

Immediately recheck exact67 history and absence of Phase A/block objects, live11-profile inventory/fingerprint and legacy photo/ACL pins, no unexpected dependencies or competing schema operation, safe execution rights and current financial/lifecycle gates. Stop on drift rather than rewriting pins or replaying all pending migrations. Both versions and their two approved-source receipts commit together; independent postflight expects69 versions, two new hash receipts, unchanged old67 metadata, eleven profiles unchanged, all blocksfalse, TermsOFF/a1, catalogOFF/six, legacy key/BIO retained, signup/provisioning ACL correct. Do not label this69/69 historical file hashes.

No code deployment in that GO. If an error occurs before COMMIT, rollback the entire pair and stop, no retry. Unexpected after-COMMIT result: stop rollout and report; never DROP/reconstruct schema automatically.

## Breaking impacts / unresolved gates

Intentional RPC breaking change: anonymous/authenticated direct ensure_user_profile calls fail. Existing WWW/backend code uses server APIs; signup trigger is retained and tested. Server/operator credentials remain trusted; this is not a boundary against a holder of the same privileged DB credentials.

Additive schema keeps BIO/old fields so old reader rollback remains structurally viable. Old anonymous readers cannot be treated as a privacy-safe rollback once #1158 or operator blocks are in force. Preserve new schema/receipts; rollback code only to a reviewed compatible release, or separately approve restriction/roll-forward. No ledger/Storage deletion or profile normalization.

Production rollout remains coordinated with separate #1158 authenticated readers/disclosures; not implemented here. Catalog16/Terms activation, normalization/BIO DROP, #1157 retention and APK remain outside this GO. New Phase A renderer may stop displaying the one historical uploaded photo even though SQL preserves its key/object: that belongs to the separate runtime rollout acceptance. LEGAL remains OPEN; this local SQL PASS is not a merge/deploy/Terms approval.

## Conditional review follow-up — positive atomic pair

The existing fixture now commits the two operational bodies in one transaction with one final COMMIT, after retaining the complete-pair late-error rollback case. Individual block receipt/late-error checks use a rollback-only rehearsal and savepoints; the committed pair is then independently checked for 67→69, both exact source receipts, unchanged historical metadata/protected rows, defaults and OFF flags. Existing RPC/ACL, signup/backend provisioning, owner/CAS, ranking/block and old-reader checks run against this committed pair. SQL bytes and hashes remain unchanged.

### Mandatory operator file-integrity preflight (local, no connection)

Use the approved checkout, not pasted SQL. Independently compare both file SHA-256 values to the reviewed hashes above AND their entries in `replacement_migrations` in the manifest. GUC values and receipts are operator assertions, never proof of the source bytes. Construct the batch only from those verified bytes, removing exactly the single outer `begin;` line and terminal `commit;` from each file. No substitutions, formatting, identity replacements or timeout changes are allowed in the real batch. Retain both comments and every other byte.

The following local-only procedure constructs a candidate, or verifies an already prepared candidate byte-for-byte. It never executes SQL. A second operator/review pass must run it on the exact batch supplied to the SQL client. Any mismatch is STOP. Use a client configured to stop on the first error, with no implicit transaction wrapper and no reconnect/retry; run only the verified candidate.

```python
from pathlib import Path
import hashlib, json
root = Path('supabase/production-migrations')
manifest = json.loads((root / 'manifest.json').read_text())
entries = {e['file']: e['sha256'] for e in manifest['replacement_migrations']}
pins = [
 ('20261026120000_profile_phase_a.sql', 'edf83e55891441213695b8c9f04d72b2ffd34151aa58239179fa60056ff6a862', 'INSTALL PROFILE PHASE A otbqfijerkieoxwpxjnm'),
 ('20261028180000_public_profile_block.sql', '87d747891527dbe85fe542af91fe0965a2fb67ebd4222dab5f40bee52fb32eaa', 'INSTALL PUBLIC PROFILE BLOCK otbqfijerkieoxwpxjnm'),
]
batch = b"begin;\nset local chips.production_project_ref='otbqfijerkieoxwpxjnm';\n"
for name, approved, confirmation in pins:
    raw = (root / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == entries[name] == approved
    assert raw.count(b'\nbegin;\n') == 1 and raw.endswith(b'commit;\n')
    body = raw.replace(b'\nbegin;\n', b'\n', 1)[:-len(b'commit;\n')]
    batch += ("set local arcade.production_profile_confirmation='" + confirmation + "';\n"
              "set local arcade.production_profile_source_sha256='" + approved + "';\n").encode() + body
batch += b'commit;\n'
candidate = Path('/tmp/pr1155-production-profile-pair.sql')
if candidate.exists():
    assert candidate.read_bytes() == batch, 'STOP: batch differs from exact approved bodies/wrapper'
else:
    with candidate.open('xb') as output:
        output.write(batch)
    candidate.chmod(0o600)
assert candidate.read_bytes() == batch
print('LOCAL FILE/BODY INTEGRITY PASS; NOT EXECUTED', hashlib.sha256(batch).hexdigest())
```

The future schema-only GO must name both original file hashes and this verified batch hash, exact Production identity/system, baseline67/11-profile invariants and both operator confirmations. Recheck history/ACL/dependencies/locks immediately before execution. One COMMIT must yield69 and the two exact receipts, profiles/protected data unchanged, Terms OFF/a1, catalog OFF/six and zero blocks; verify independently after COMMIT. Failure before COMMIT means full rollback/STOP without retry. Unexpected postflight means STOP, no schema DROP. No runtime deployment or flag activation is included. LEGAL OPEN.

Follow-up validation: existing full migration runner PASS on isolated PostgreSQL17; positive atomic pair and negative pair rollback PASS. Manifest guard121/14, fixture syntax and diff check PASS. No remote SQL, push or deployment.
