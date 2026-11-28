# Feature specification — OWNER approval for Stage migrations

**Issue** [#1357](https://github.com/krzysztofcal/arcadePlatform/issues/1357)
**Status** Draft for independent review

## User scenarios

### US1 — Request and approve an exact Stage apply (P1)

The approved GitHub App requests an exact Stage migration from main. The OWNER sees a pending approval in GitHub, can inspect the request, and approves or rejects it. The OWNER can also dispatch a request using the same protected flow.

**Acceptance**

1. Given an authorized first dispatch and a valid approval bundle, the apply job waits for OWNER review.
2. Given OWNER approval for that run and environment, the existing executor may apply the exact bundle only after rechecking the PR, SHA, SQL hashes, target and history.
3. Given rejection, cancellation, substituted input, lost or missing approval, or policy mismatch, no migration is executed and the result cannot be mistaken for a successful apply.

### US2 — Inspect Stage without approval (P2)

An authorized operator inspects Stage history and pending migrations through the existing read-only route. The result remains compatible with current tooling and does not initialize migration metadata.

### US3 — Diagnose blocked execution (P2)

The operator can distinguish pending approval, a refused preflight, a rejected apply, a verified no-op and an applied migration. A failed run requires a new request and new approval.

## Requirements

- **FR-001** Permit only the pinned GitHub App and OWNER to request apply from trusted main of the canonical repository. Require matching original and triggering identities and first attempt.
- **FR-002** Require GitHub Environment protection with one OWNER reviewer, main-only and administrator bypass disabled. Independently verify the protection and the actual approval before the step that receives apply credentials.
- **FR-003** Use the current immutable approval contract, atomic SQL/receipts, Stage identity pins, shared concurrency and read-only inspection. No alternate apply path.
- **FR-004** Give the reviewer the exact PR/source SHA and approval digest plus a readable migration manifest before approval. Keep secrets out of inputs, manifests and logs.
- **FR-005** Keep the protected apply eligibility distinct from inspect, which runs trusted code under a read-only transaction. No Production, shared schema mutation or credential rotation is authorized by this plan.
- **FR-006** The first real apply following rollout requires separate scope approval for an exact set.

## Success criteria

- **SC-001** Approved App request waits for exactly the OWNER in GitHub. Unapproved and negative cases cannot reach the apply step.
- **SC-002** A separately authorized protected no-op proves the path, with identical independent before/after Stage history.
- **SC-003** Existing inspect and migration runner tests pass, plus fundamental tests for identity and missing or incorrect protection and approval.
