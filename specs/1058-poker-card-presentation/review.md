# #1058 review

Baseline main: 6c8ab3fad1570f7906a04dd09a05cf05c0fa36d2, merged #1049.

Implementation T001–T010 complete; owner animation acceptance pending. One browser runtime, unchanged authoritative state/privacy and accepted geometry. Owner visual animation smoke is final gate; Draft, never merge.

## Self-review and focused evidence

Eight scoped files only. Existing evaluator/reveal/participation/mergeSnapshot authority retained. Best-five sync runs after persistent Hero render even when same deal returns early. Compact pair uses the existing card anchor, enlarged to36×30 scene px without moving its center. Final authoritative faces render before FX. One bounded current table/viewer/seat/hand claim model suppresses initial/recovery/reduced-motion replay and duplicate fold/reveal. Cosmetic nodes/timers are scene-owned and cleared on transport/identity/hand/visibility teardown; none mutates game state. Hero fold stays dimmed with its owned deal retained.

Correction to fixture: reveal is supplied via existing public.showdown.revealedShowdownParticipants, never a new field. Fundamental lifecycle/privacy cases RED against unchanged main (missing claim model), GREEN129/129 after implementation including existing static HTML/card/chip/reaction/settlement tests. No pixel/layout tests added. Syntax and repo guards/CSP PASS; no inline scripts, new dependencies or WS changes.

Breaking impact: Hero/board best-five outline, larger readable opponent pair with authoritative public faces, cosmetic deal/flip/muck motion. Existing geometry, cards/shadows/status/actions/CH authority unchanged. Owner animation quality acceptance pending; Draft/not merge-ready.

## Exact runtime Preview / T010

Runtime SHA: `b35857372225099ab8495b7d8f734fedd3bfccf1`, Draft PR #1059. Real Netlify Preview: https://deploy-preview-1059--playkcswh.netlify.app/poker/table-v2.html . BUILD_INFO commitHash and served JS/CSS match this SHA. Browser-only; no WS deployment or Production action.

External controlled snapshots delivered through existing processSnapshotFrame at390×844,320×640 and844×390 (six occupied seats), plus reduced-motion390×844. One new hand produces12 cosmetic cards/two rounds from actual rendered room-dealer element; all computed animation names are poker-card-deal. Duplicate frame preserves the same FX copies. Initial bootstrap starts none. Flop/turn/river highlight equals existing evaluator output, updates to five board cards on the river and preserves the same Hero card nodes. Opponent faces show only authoritative public.showdown.revealedShowdownParticipants via getSeatRevealCards; others remain two backs. One hidden→revealed transition produces one flip, duplicate does not. Authoritative Hero/opponent folds produce two muck copies without clearing Hero state; static folded state stays dimmed. Resync/reconnect render correct final state with no replay; reduced motion produces zero motion nodes while preserving final faces/cards/highlights. Closed-table lifecycle cancels all copies/claims (fundamental regression). No page scroll; status, action controls, reaction/chat and Wallet/Poker chrome remain intact. Screenshots visually reviewed externally; no evidence binaries/JSON or broad probes committed.

Focused129/129 and syntax/check:all/ci:guards/CSP/diff PASS. Initial complete tests RED against baseline, GREEN after implementation. Exact runtime CI guards/CodeQL/catalog/validation PASS; full Tests/WS job state stays recorded live in #1059. Later documentation-only changes do not alter the verified runtime artifacts. Owner physical animation-quality smoke remains final gate; controlled public-state fixture does not assert authenticated Stage gameplay acceptance. Draft/not merge-ready, never merge.
