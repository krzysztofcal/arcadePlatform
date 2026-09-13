# Feature Specification: Production ledger retention rollout (#891)

**Feature**: `004-production-retention` · **Branch**: `agent/891-production-retention-plan`
**Created**: 2026-09-13 · **Status**: Planning complete; implementation and all Production mutations pending.
**Source**: https://github.com/krzysztofcal/arcadePlatform/issues/891
**Baseline main**: `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`

## User Scenarios & Testing

### US1 — Correct Production schema without importing Stage authorization (P1)

The owner receives an exhaustive migration inventory and an independently verifiable Production equivalent of the required current schema. Production automation remains dark.

**Independent test**: On disposable PostgreSQL, start at the 54-migration Production baseline and apply PR A's equivalent. Verify columns, constraints, function bodies, owners, ACLs, triggers, RLS and final indexes; assert no Stage policies, receipts or allowlists and no data deletion. Repeat migration-history inspection without writing history.

1. Given the 43 missing versions, every version has one category and explicit final-contract disposition.
2. Given canonical Production and separately authorized application, catch-up installs missing lifecycle columns, TABLE binding protection and retention procedures with fence and automation initially OFF; it preserves balances, historical registry and archive batch 1.
3. Given Stage, an unknown server, mismatched project/system pair or incomplete inventory, the Production migration aborts before DDL.
4. Given the Production history afterwards, skipped Stage versions remain absent. New equivalent versions prove the contract; no fictitious “applied” entries are inserted for skipped files.

### US2 — Fresh, bounded Production canaries with recoverable effects (P1)

After explicit owner authorization of runtime-compatible TABLE fence activation, the operator prepares fresh Production evidence through the existing export/store/proof/prune mechanism. A separately approved execute is bound to exact batch, IDs and hashes.

**Independent test**: Existing boundary suites run the Production profile against the Production equivalent schema: valid 2-transaction canary succeeds; 3 transactions, Stage evidence, bad identity, incomplete recovery, changed IDs, missing lock or uncertain result fail closed.

1. Installation does not activate cleanup. Production fence activation is a separate operation after runtime compatibility evidence; automation stays OFF.
2. Each fresh canary archive contains at most 2 transactions. Whole-table selectors never truncate a table to fit. No candidate is a non-destructive no-op, not a canary PASS.
3. Primary gzip archive, second full archive copy and recovery manifest are private, immutable and byte/SHA/MIME verified before deletion. Escrow deletion additionally requires an exact account recovery snapshot.
4. Retry after a lost response re-verifies the same batch and receipt; it never creates a replacement batch or replays a blind DELETE.
5. Old Production batch 1 and Stage canaries 15/334 cannot authorize new Production activation.

### US3 — Owner-activated, bounded scheduled retention (P2)

After per-class Production canaries PASS, PR B enables the four existing retention classes using Production credentials, lock, policies and scheduler ownership.

**Independent test**: Existing workflow/automation guards prove dark-by-default gating, Production-only credentials, one policy invocation/one batch per scheduled run, global Production single-flight, cap transition and no mutation when disabled.

1. PR B activation migration re-verifies fresh Production receipts before setting policy enablement/cap 5000; workflow kill switch remains a separate owner-controlled gate.
2. Scheduled existing-30d, bot-only-7d and closed-human-30d invocations each process at most one archive batch, at most 5000 transactions. Escrow invocation processes one already-cleaned batch and at most 2 accounts. No backlog loop or Stage six-batch setting is inherited.
3. A VPS timer is the only Production scheduling owner. GitHub runs the workflow; no parallel native cron is introduced.
4. Each enabled class must have a normal scheduled invocation observed. No-candidate proves scheduling only; a destructive path still needs its canary PASS.
5. Turning the workflow switch off prevents subsequent cycles; a DB gate rechecked under lock prevents subsequent destructive transactions. Already-committed effects are preserved, never automatically reversed.

## Functional Requirements

- **FR-001** Audit live main, both exact DB identities, histories, schema and aggregate health; retain dated evidence and all 43 inventory rows.
- **FR-002** Keep historical migrations immutable. Install only reviewed forward-only Production equivalents. Do not import Stage rollout state or misrepresent skipped history.
- **FR-003** Preserve current Stage behavior and credentials. Production files must not enter automatic Stage apply, nor cause automatic Production apply on merge.
- **FR-004** Enforce canonical Production project `otbqfijerkieoxwpxjnm` and system `7575202818581710058` independently of env labels, before export, Storage writes, proof, dry-run and execute.
- **FR-005** Require compatible deployed WS/Netlify writers before activating TABLE fence. Historical/uncertain tables remain bot-ineligible; no inferred backfill from missing registry fields.
- **FR-006** Reuse existing archive formats, selectors and export/store/prune functions; four Production policy IDs distinguish ownership. No generic archival expansion from #889 is included.
- **FR-007** Production workflow, policy activation and per-class execution default OFF. Fresh canaries remain capped at 2; scheduled activated policy cap becomes 5000 only in PR B. Manual unscoped export/prune remains capped at 2.
- **FR-008** Use isolated credentials, private Storage and recovery paths; deny Stage legacy allowlists and repairs in Production.
- **FR-009** Require global Production advisory lock and workflow concurrency across all cleanup classes, manual canaries, recovery and activation; uncertain resume/retry blocks the cycle.
- **FR-010** Prove exact deleted IDs/counts, unchanged retained balances/entry sequences, conservation, provenance, immutable receipts and replay denial. No direct balance edits.
- **FR-011** Keep historical USER history outside the proven closed-human >30d contract hot; closed-human USER detail intentionally leaves live history after retention. Durable audit remains available privately; no new account UI/archive read path is included.
- **FR-012** Production mutation always requires separate explicit owner authorization identifying operation, target, revision and bounded evidence; neither these artifacts nor PR merge imply authority to execute migrations/canaries.

## Edge Cases

Empty/young/oversized table; historical NULL registry table_id; missing table; nonzero escrow; incomplete terminal state; active requests; partial/mismatched recovery; Storage outage; ambiguous pending batch; historical manual batch; lost advisory-lock session; unknown commit outcome; duplicate scheduler delivery; policy disabled between dry-run and execute; Stage credentials in Production; future migration omitted from inventory. Each blocks relevant mutation or is an explicitly reported no-candidate no-op.

## Success Criteria

- **SC-001** All 97 main versions reconciled: 54 existing Production, 43 individually classified, no unexplained history drift.
- **SC-002** Disposable Production-equivalent contract passes and deployed WS no longer reports the missing lifecycle-column error after separately authorized catch-up.
- **SC-003** All four classes have independent fresh Production canary evidence, with at most 2 transactions per archive and at most 2 escrow accounts; complete recovery verification and accounting invariants PASS.
- **SC-004** PR B independently gates cap 5000 and scheduled activation; one normal scheduled invocation for each class is evidenced with exact SHA and target, with no concurrent destructive cycle.
- **SC-005** Only fundamental existing suites extended; no UI tests or broad browser smoke required of agent. User runtime verification may fulfill Constitution 1.1.1.

## Breaking / operational impact

Production DDL installs write triggers and lifecycle gates. TABLE fence can reject malformed TABLE transactions and replays against closed/missing tables; it must not activate before compatible producers are verified. Cleanup permanently removes proven hot rows and eligible empty ESCROW accounts, shortens closed-human hot history and increases automation's bounded destructive cap. Archive recovery is not a live restore mechanism. Existing WS already depends on absent columns, so catch-up repairs a real runtime/schema mismatch. Every apply/activation step needs its own explicit owner authorization. No WS authority, ledger economics, token, badge or UI changes are planned.
