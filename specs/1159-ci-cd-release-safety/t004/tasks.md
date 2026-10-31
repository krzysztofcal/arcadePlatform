# #1159 T004 — Tasks

Each PR is separate, needs its own OWNER GO, and is tested only with fundamental deterministic tests. Merge, settings, root install, migrations and every Production action stay outside implementation.

- [x] Analysis: deploy workflow, runtime persistence boundary, restart verdict (STOP mid-hand), design; see `spec.md` and `plan.md`.
- [ ] **BLOCKER** Private prerequisite released first (separate track, OWNER GO).
- [ ] **T004-1** `release-drain.mjs`, `pendingCount()`, `server.mjs` gates plus `/internal/admin/release-drain`; tests; exact-SHA WS Preview acceptance (stop at boundary, frozen does not expire, cancel, restart resume, human seat kept).
- [ ] **T004-2** `release-readiness.mjs` (read-only transaction: humans, pending requests, escrow vs claims, external writes, ledger watermark, schema fingerprint); tests; Preview readout.
- [ ] **T004-3** `infra/vps/ws-production-release-gate.mjs`, sudoers/bootstrap, `production-schema-fingerprint.mjs`, workflow gate before `ln -sfn` with cancel only before the switch, gated rollback restart, chips-ledger run guard, artifact SHA-256; guard and behavior tests. Admin GO: root install plus `status` check.
- [ ] **T004-4** `scripts/production-release.mjs` plan/execute (checks, selection, WS dispatch, WWW hook plus the existing publish/discard, combined receipt); `www-production-release.mjs` reduced to a library; `agents.md`. GO: OWNER build hook (from T003).
- [ ] **T004-5** GitHub Release manifest (`--record`), no-release-trigger guard. Settings GO: tag ruleset / immutable releases.
- [ ] First real release under the entrypoint (separate GO), recording restore/lock behavior and the gate output.
- [ ] Later: compatible rollback mode; OPEN: crash-safe live hands, `ws-production` Environment, `/healthz` release SHA.
