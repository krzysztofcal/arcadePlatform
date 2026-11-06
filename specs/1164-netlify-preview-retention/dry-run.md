# Offline dry-run — no deletion authorization

As of **2026-10-29T12:48:46Z**. Existing complete Netlify snapshot2064 records reused; only368 GitHub PR statuses/closedAt read freshly. No new Netlify enumeration or HTTP mint probes.

- **1557 candidate estimates** across350 PRs:1554 closed/merged after grace,3 superseded versions of open PRs.
- **507 retained/excluded**:352 Production/current-publication records,8 branch deploys,65 temporary pinned records,57 within grace,24 nonready records,1 other OPEN PR current alias.
- Initial estimate1566 was narrowed by preserving9 deployments for the known old Android API #1095, which OWNER has not explicitly retired. No new APK inventory audit was performed; known aliases #1095/#1141/#1155/#1161 are conservatively held.
- Actual deletions0; authorized/safe-to-apply now0. Both rotation PASS and explicit cleanup GO absent. Provider locks/current alias and complete APK-pin inventory not freshly verified; counts are snapshot estimates, not promises. Additional dependencies/locks may lower the final count.
- Full IDs/PR/reason/eligibleAt for every candidate and exception: the original local offline report (not a deployed deletion allowlist). Protections: [protected-deployments.json](protected-deployments.json). Pins never expire automatically; #1161 stays protected despite CLOSED, #1160 has no independent deployment in this snapshot.

## Reasons

| Reason | Count |
| --- | --- |
| closed_pr_7d | 1554 |
| not_ready | 24 |
| pin:historical_Android_API_pin_not_explicitly_retired | 9 |
| open_pr_superseded_7d | 3 |
| open_pr_current_alias | 1 |
| grace_period | 57 |
| pin:APK_M0_API_alias_and_rotation_evidence_temporary_PR_wide_hold | 29 |
| pin:active_Stage_API_APK_and_rotation_recovery_temporary_PR_wide_hold | 21 |
| pin:physical_Android_test_APK_API_pin_closed_PR_still_protected | 2 |
| pin:1159_PR1_check_receipts_and_recovery_evidence | 2 |
| pin:1159_PR2_active_Stage_and_rotation_evidence | 2 |
| production_or_published | 352 |
| context_out_of_scope | 8 |

## Example candidate IDs (full list in JSON)

| Deployment ID | PR | Reason | Eligible UTC |
| --- | --- | --- | --- |
| 6a31a90293cc780008ad5812 | #205 | closed_pr_7d | 2026-06-23T21:06:39.000Z |
| 6a31a9949f88b10008bdc20a | #205 | closed_pr_7d | 2026-06-23T21:06:39.000Z |
| 6a31ad23fec6b2000833e021 | #205 | closed_pr_7d | 2026-06-23T21:06:39.000Z |
| 6a31b3b08b30d500081e5664 | #205 | closed_pr_7d | 2026-06-23T21:06:39.000Z |
| 6a31b64afde80200081f5560 | #205 | closed_pr_7d | 2026-06-23T21:06:39.000Z |
| 6a31b98e7311150008ad0aa7 | #205 | closed_pr_7d | 2026-06-23T21:06:39.000Z |
| 69d5408c94f6c10008067979 | #501 | closed_pr_7d | 2026-04-16T13:44:21.000Z |
| 69d545c7391b11000872a2c6 | #501 | closed_pr_7d | 2026-04-16T13:44:21.000Z |

## Verification and limits

Historical planner validation PASS; implementation policy/API tests15 PASS; Node syntax and diff checks PASS. The shared planner remains offline-only; the separate API canary is independently gated and has never been executed against Netlify. Full provider locks and dependency records must be checked before future mutation; unknown state denies execution. Estimator treats all branch-deploy contexts as out of scope. Closed groups oldest-first/latest-last; a retained older version protects latest against alias fallback.

Original dry-run performed no mutation. Under later OWNER GO, issue #1164 was created and a Draft implementation PR is being prepared; no live retention dispatch, schedule activation, secret setup, deletion, retention setting, deployment or merge. Inventory/source inputs remain local /tmp artifacts; result contains deployment metadata only, no private accounts or secrets.
