# Implementation plan — GitHub approval for Stage DB apply

**Baseline** `f5d1fb6ee4777d1d7180ec18786b58ba167e5ce8`
**Scope** #1357. Code and operational configuration require separate GO.

## Summary

Split the existing workflow into read-only inspect and protected apply. Reuse the WS Preview GitHub Environment and approval verification pattern with a dedicated `stage-db-apply` environment. Keep one SQL executor.

## Technical context

- GitHub Actions, GitHub-hosted metadata preflight, existing self-hosted Stage IPv6 runner, Node.js and psql.
- Edit `.github/workflows/db-stage-apply-pr.yml`, `scripts/stage-db-migrate.mjs`, `tests/db-stage-workflows.guard.test.mjs`, existing executor tests and `docs/ai-agent-db-migration-checklist.md`. Add no runtime dependency.
- No database migrations, Production features, application changes or credential rotation in this issue.

## Constitution check

Uses existing CI, authorization and transaction patterns. The approved job may access Stage only. It never trusts PR runner code. Outputs omit credentials and raw errors. Tests extend fundamental guard and executor coverage. Review precedes implementation and the agent cannot merge. Post-design review retains these checks. No complexity exception requested.

## Phase 0 — Decisions and preconditions

See [research](research.md). Read identity rules from current AGENTS.md and compare current main before implementation. Verify installation actor identity and dispatch capability with an authorized zero-write test. Do not widen GitHub App rights without OWNER decision.

## Phase 1 — Design

1. Keep workflow-level serialization `db-stage` with cancellation disabled. Preserve inspect input/output compatibility, current environment, read-only transaction and trusted checkout. Keep its DB credentials accessible only to the inspect step. Inspect still uses the existing Stage connection and never executes PR SQL. This change adds no confidentiality boundary between functions of trusted main.
2. Run apply metadata preflight on a GitHub-hosted runner without Stage credentials. Limit to canonical repo, main, supported actor and first attempt. Validate canonical bundle, exact confirmation, expected source PR/head and byte hashes; publish pinned identifiers and sanitized file manifest for review. Retrieve the exact environment and main-only branch policy from GitHub and deny missing, malformed or weakened settings. The apply job depends on success.
3. Protect apply with the dedicated GitHub Environment. Mirror WS Preview by checking CURRENT environment policy and the current run approval record before the only step mapped to the database secrets. Require the OWNER identity and exact environment in an approved record. No reruns. Ensure the GitHub Environment is configured and verified before operational handover. A missing environment may be auto-created by GitHub, so runtime checks remain necessary even if deployment protection does not block queueing.
4. Rebuild the bundle from the immutable sources in the apply job without passing artifacts. Pin checkout to the trusted workflow SHA. Have `authorizeApply()` mirror repo/ref/event/actor/attempt restrictions while the workflow independently verifies environment and approval. Preserve `verifySource()`, `validateBundle()`, `applyBundle()` and existing Stage identity and transactional SQL checks. Never execute changed main or displaced PR head after waiting. Report refusal, verified no-op or applied count, and check history independently after uncertain outcomes.
5. Stage rollout uses [quickstart](quickstart.md), [contracts](contracts/approval.md) and [data model](data-model.md).

## Compatibility and rollout

OWNER can still dispatch but must also click Approve, mirroring the WS Preview reviewer policy that allows self-review on OWNER-originated runs. Agent cannot review. Old apply reruns no longer work and must be replaced by a new request. Existing inspect and peers on `stage-automation` stay compatible. Newly protected apply is unavailable until its environment, credentials and Stage proof are in place. A code revert requires OWNER review and restores the existing OWNER-only workflow with existing Stage settings, without schema rollback.
