# PR #1155 — local publication handoff / #1158 dependency

2026-10-28. Preparation only; **NO PUSH**. Remote/local HEAD a87e06c4335e7c8170d523b4f8d9497c4372c3cc, branch feat/1114-profiles-phase-a, Draft OPEN. Live main0f77574d74945aa3b64b4e5e81494e621d7b2794 verified through GitHub. No branch creation, commit, new PR, environment change or automatic workflow dispatch performed here. LEGAL OPEN.

## Immutable schema and evidence

Production pair is OWNER-ACCEPTED COMMITTED67→69; original67 metadata unchanged, two approved-source receipts, eleven protected profiles unchanged. PhaseA hash edf83e55891441213695b8c9f04d72b2ffd34151aa58239179fa60056ff6a862; block hash87d747891527dbe85fe542af91fe0965a2fb67ebd4222dab5f40bee52fb32eaa. Batch hash5495db1114eeb0a6c31816d602905ddff5d3b230de4885e8d17607e15272abd6. No source SQL byte changed after application. Manifest has14 replacement_migrations; historical54 baseline/57 missing, source_main_commit/history_policy/forward_only and all earlier entries/hashes remain unchanged. No Stage SQL modification. Retain the existing Production67 reconstruction and positive atomic-pair COMMIT, full-pair rollback and old-runtime compatibility tests.

The public execution report contains environment/release identities, aggregate counts and a profile fingerprint only; no account UUID, handle, email, credentials, JWT, private snapshots or credential file contents. Full operator evidence stays outside the repository.

## Exact publication allowlist (13 paths)

- supabase/production-migrations/20261026120000_profile_phase_a.sql
- supabase/production-migrations/20261028180000_public_profile_block.sql
- supabase/production-migrations/manifest.json
- tests/chips/account-deletion-production.fixture.mjs
- tests/chips/profile-bio-contract.fixture.mjs
- .github/workflows/tests.yml
- specs/1114-arcade-profiles-avatars/spec.md
- specs/1114-arcade-profiles-avatars/plan.md
- specs/1114-arcade-profiles-avatars/tasks.md
- specs/1114-arcade-profiles-avatars/stage-block-unblock-smoke.md
- specs/1114-arcade-profiles-avatars/production-equivalents-review.md
- specs/1114-arcade-profiles-avatars/production-schema-67-69-execution.md
- specs/1114-arcade-profiles-avatars/publication-handoff.md

Other pre-existing local operational notes remain untouched/unpublished. Newly prepared specs/1158-authenticated-profile-reads/** belong to the future independent stack, not this #1155 publication. Nothing changes WWW/WS/Android runtime, workflow triggers, active legal documents or flags in the proposed increment. The only workflow-definition change is fetch-depth:0 on the chips-retention-integration checkout; other checkouts remain unchanged. The old deployed a87 runtime/Stage smoke remains relevant; no new WS Preview deploy is needed for this increment alone. No AdSense/CSP removal is reverted.

## Actual automation on a future push

Classification against current main for the whole existing PR:204 paths, all validation domains true, **deploy_ws=true**. The previous12-path increment classified chips_db=true/deploy_ws=false; with the single CI workflow path all validation domains now classify true, still deploy_ws=false. Never substitute the latter for the PR classification.

| Automation | Effect of synchronize on this Draft PR | Safety boundary |
| --- | --- | --- |
| CI, Tests, DB Migration Check, actionlint, WS PR Checks | Standard checks rerun using whole PR diff; disposable database tests are not Stage migration execution | Require green checks for the new SHA; do not skip or cancel required checks |
| DB Stage Apply PR | Path filter matches existing supabase/migrations changes in whole PR; apply-stage job SKIPPED because draft=true | Keep Draft. No Stage runner allocation/APPLY. On later matching event after Ready, migrator can apply all pending; separate preflight/GO needed, not just a filename filter |
| DB Stage Prepare / WS Preview Deploy / Production retention automation | Manual workflows; no dispatch from this push | No manual invocation authorized |
| WS Server Deploy | PR validation may run; Production deploy job requires push-to-main or workflow_dispatch plus deploy_ws | Branch synchronize cannot restart/deploy Production; later main push can deploy the entire accumulated runtime diff |
| Netlify playkcswh | Existing PR auto Deploy Preview rebuild expected for exact new SHA | Site production branchmain, allowed branchmain; never merge/main-push/manual-prod. Verify resulting context/review_id/SHA before smoke |
| Netlify landing-kcswh | stop_builds=true remains unchanged | No manual deploy in this scope |
| Android Poker M0 APK | **Will match** existing mobile/account/js/poker paths in whole PR, even if last commit is docs/SQL only; Draft same-repo job is enabled | OWNER explicitly accepts automatic debug APK build/upload on GitHub-hosted runner after a later authorized push. No installation, distribution or Google Play publication is authorized; Android triggers remain unchanged |

Live Netlify read: play production deployment6ae19488f50eb5ff7e60f7e6 at main0f77574d, stop_builds=false; landing6ae194d817674a2d5690830b, stop_builds=true. No configuration modified. Only main is configured as the branch deployment target; PR Preview is distinct from Production.

**Publication recommendation:** local code/evidence ready after checkout compatibility validation; STOP before push until separate explicit GO. OWNER accepts the automatic hosted debug-APK build/upload caused by the whole PR diff; no installation, distribution or Play publication. That side effect is no longer an unresolved permission blocker. No Android trigger change, cancellation race, skip marker or check bypass is introduced. The next GO may authorize only this13-path #1155 push plus normal CI/Preview and its accepted hosted debug build. Keep Draft; no WS dispatch, Stage APPLY or Production deployment.

Before any future push, verify remote HEAD/base, unchanged allowlist/hashes, Draft, and shared Stage121/121/pending0 through a newly authorized read-only preflight. After push require exact new HEAD checks/Preview, DB Stage Apply SKIPPED and no environment drift. No Ready/merge/Production/Terms permission follows from publication readiness. Future Production release must be coordinated with #1158, retain additive schema and use a reviewed privacy-compatible code rollback; a later ordinary main deploy may publish previously merged changes.

## Next independent scope

[Spec](../1158-authenticated-profile-reads/spec.md), [plan](../1158-authenticated-profile-reads/plan.md), [tasks](../1158-authenticated-profile-reads/tasks.md) are local proposals only. Future stacked PR base feat/1114-profiles-phase-a; no duplicate parent patch. Recommended first #1154 resolution is existing external-browser login fallback, not SSO or token transfer. OWNER acceptance of that UX and a separate implementation GO are still required. #1157, Terms activation, legal publication and Play release remain separate gates.

## Validation for this preparation

Applied-file SHA checks and exact manifest comparison PASS:14 replacements, only the two approved appended entries compared with remoteHEAD; all earlier fields/entries unchanged. Static migration guard121/14 PASS, syntax234 files PASS, diff whitespace check PASS. No Stage/runtime/mobile/active legal source changed in this increment; all four draft legal file hashes remain valid. Existing full isolated PostgreSQL17 contract log confirms positive67→69 atomic COMMIT and full-pair rollback, ACL/provisioning/owner/old-runtime assertions PASS (347 synthetic profiles). That unchanged SQL/test result was retained; no duplicate heavy database run or remote SQL executed for documentation-only follow-up.

Current remoteHEADa87 checks read through GitHub: actionlint, migration-guard, CI verify, WS harness, integration tests and netlify/playkcswh/deploy-preview SUCCESS; apply-stage and Production deploy SKIPPED. debug-apk CANCELLED from the previously authorized stop, not a new successful APK. New local changes have no hosted results until a separately authorized push. No broad regression, layout suite, APK or environment operation run here.

## P1 CI checkout compatibility review

Only .github/workflows/tests.yml::chips-retention-integration/Checkout gains with.fetch-depth:0. The workflow triggers, other checkouts, service images and tests remain unchanged. The five historical sources in assertProductionProfileEquivalents() still execute; no SKIP/fallback/pass substitution added. GitHub compare confirms main0f77574d is ahead of a63e44b0 by one commit with merge-base=a63e44b0, and the local PR HEAD also has that ancestor. All five exact source paths were independently checked through GitHub's contents API at a63e44b0; their blob SHA values equal the fixture's local objects. A full checkout of the ordinary PR merge/head history therefore includes the required historical commit; no unpushed local-only commit is required.

The existing nonfinancial isolated PostgreSQL17 runner is rerun for this review, retaining positive atomic67→69 and full-pair rollback assertions. Actionlint1.7.12 validates the changed workflow. Required hosted checks still need a later push; local PASS is not a claim that new GitHub runs already passed. The additional .github workflow path broadens validation classification to all domains but does not match a Production deployment path; whole PR deploy_ws=true still matters at any later main merge/push. DB Stage Apply stays skipped while Draft. #1158 specs remain outside this patch, with no new work on that feature here.

P1 final local result: isolated PostgreSQL17 full existing runner PASS, including actual historical reader execution, positive67→69 single COMMIT and full-pair rollback (375 synthetic protected profiles). Actionlint1.7.12 PASS, syntax234 PASS, migration guard121/14 PASS, diff-check PASS. Disposable cluster stopped; no Stage/Production connection or mutation, push or APK build. Applied SQL and manifest bytes, fixtures and the other original publication files are unchanged; only the handoff and the one two-line workflow addition differ from the reviewed12-file patch.
