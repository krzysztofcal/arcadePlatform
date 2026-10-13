# WS Preview handoff — #1098

Status: implementation ready, awaiting manual runtime verification. Owner has NOT authorized deployment or funded Stage smoke. No deployment was executed. Netlify Deploy Preview/WS PR validation alone does not deploy WS.

## Next deployment step (only after separate owner GO)
Use workflow WS Preview Deploy from main, with the full reviewed PR head SHA as application ref:

```sh
gh workflow run ws-preview-deploy.yml --repo krzysztofcal/arcadePlatform --ref main -f ref=<full-reviewed-PR-head-SHA>
```

Verify the workflow succeeded, its Resolve selected ref SHA output exactly matches that SHA, and ws-preview.kcswh.pl/healthz is healthy. Open the matching Netlify Deploy Preview configured for WS Preview. Do not target Production. Preview host is shared; coordinate this explicit deployment with other PRs.

## Narrow manual smoke checklist (financial writes require separate GO)
- Online: two deliberately missed human decisions across actual hands; first miss preserves next hand and full normal turn. Check both CHECK and FOLD defaults. Verify only affected user receives “Removed for inactivity”, then existing accessible 5s lobby countdown.
- During financial settlement pending: clear non-actionable pending notice, no fresh enrollment/blind; owned avatar stays until confirmed settlement. Remaining people continue.
- Confirm authoritative seat/runtime membership removed after cash-out; another user can JOIN the free Online seat through normal next-hand waiting. Do not auto-close with another active human. Last human STANDARD closes; CONTINUOUS_BOT stays supervisor-owned.
- Single Player: first/second miss preserve next decision; third triggers “Game ended due to inactivity”. Keep socket/tab connected throughout. Before disconnect or redirect completion, dedicated table must become CLOSED, bots refund original bankroll sources, escrow=0, no next human blind/bot-only rollover.
- Check accepted manual action/preaction between misses resets penalty; transport events and automatic CHECK do not. Late action after committed threshold cannot reverse exit.
- Reload/reconnect during pending and after removal, including an Online table that remains OPEN: recover authoritative reason, no auto-JOIN/Resume, no second buy-in. Stale snapshots do not restore own avatar/actions or cancel/reset countdown. This same table is terminal for that user; another table requires an explicit new participation.
- Simulate interrupted Leave response/retry and timeout/action race in isolated authorized test conditions. Inspect targeted WS frames and bounded klog; capture actual second/third turn frame and deadline on the reported mobile browser. Server audit does not prove browser display.
- Audit table-scoped timeout action/request IDs, leave/deferred cash-out transactions and resulting authoritative stacks/seats/table status. Exactly one cash-out per human; payouts conserved; Single Player escrow=0. If evidence is ambiguous, retain pending and investigate.

Record exact WS SHA, Netlify URL, browser/device, table IDs/hand IDs, timeout deadlines, payout transaction IDs and escrow before/after. Do not include credentials. Issue #1098 stays open until authorized Production smoke.
