# #1158 — stacked publication handoff (STOP before push)

Local branch feat/1158-authenticated-profile-reads, based exactly on parent feat/1114-profiles-phase-a SHA810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb. #1155 remains Draft at that remoteSHA; no parent update, child commit, push or new PR performed. Other pre-existing untracked #1114 operational notes are excluded. No environment reads/writes, migration apply, WS dispatch, Terms activation or APK build for this task.

## Minimal next GO

Authorize only committing/pushing the reviewed child patch and creating a Draft stacked PR targeting feat/1114-profiles-phase-a, with standard CI/Netlify Preview and automatic hosted debug APK side effects explicitly accepted. No Production deploy, Ready or parent/child merge. Before that push recheck parent/base SHA and current child diff; review trigger impact for the whole resulting PR rather than only its last commit. This proposal is not present permission to push.

No new migration or workflow change is in the child. Local impact classifier marks all validation domains true (netlify.toml/shared HTTP tests lead to broad validation), **deploy_ws=false**. WS/engine/shared runtime dependencies, SQL, owner handler and block/leaderboard SQL filters are byte-identical to parent. Existing a87 WS Preview release evidence therefore remains applicable; new HTTP login gates do not themselves require another WS Preview deploy. If the eventual diff changes WS/protocol dependencies, STOP and obtain separate exact-SHA protected rollout GO.

DB Stage Apply PR requires non-Draft/basemain; a Draft child on the parent branch does not satisfy either condition. Do not introduce pending migration files or flip Ready. Production WS deployment remains gated to main push/manual dispatch; Netlify play production is tied to main. Existing landing stop_builds=true must remain unchanged. Eventual retarget-to-main restores the whole inherited parent deployment surface (including deploy_ws=true); reclassify then. Avoid an uncoordinated main merge/push that publishes parent anonymous readers before child gates.

## Child Preview prerequisites / STOP

A stacked PR's Preview and branch-scoped config are not automatically the parent's. Read-only verify actual child Netlify context/review_id/sourceSHA, Supabase Stage projectkrydukthwdvccggbyjfw, RedisV3 Stage/namespace, expected public feature flags, CORS and existing reader schemaStage121 before accepting it. Missing branch overrides or secrets are BLOCKED for scoped environment GO, never Production/global fallback. Netlify may not create a child Preview on a non-main base under actual settings; investigate the exact reason and request minimal GO rather than retargeting/merging parent by surprise.

The existing mobile stage-public.json still points to Preview1155; it is intentionally unchanged. An automatic child debug build may succeed while targeting the old API and does not validate #1158. Before phone acceptance, separately authorize pinning the child Stage API origin and its required CORS, then a hosted APK build/receipt and physical test. Keep existing Supabase Stage/WS and OAuth callback unchanged. No JWT transfer or browser SSO.

## Small nonfinancial acceptance after separate GO

- Exact childSHA and served Stage config; anonymous/bad JWT profile and leaderboard401/no-store, legitimate logged-in200, existing operator block404 and independent leaderboard opt-out behavior. Do not mutate a real block flag or account merely to satisfy this smoke; reuse deterministic fixtures or separate explicit operator GO.
- Existing owner Account and public profile page links; login/expired session/logout/account switch/Back clear old identity and rows. OPTIONS/CORS unchanged and noindex on actual `/u/*`, `/profile.html`, `/leaderboard.html` responses without loss of CSP.
- Before claiming Production anonymous gating, wait out any observed legacy public response cache lifetime (previous Production max-age30); no unauthorized cache purge and no promise to retract already delivered data.
- Future authorized APK: app signed-in/browser signed-out → existing HTTPS link → browser login → Back/reopen; browser already signed-in and independent browser account/logout. No new accounts, funds, JOIN, gift or CH/XP writes.

## Release and unresolved issues

[Play/disclosure impact](google-play-impact.md) and updated four unpublished #1114 drafts require OWNER legal/version review before coordinated publication. a1 HTML/receipts and TermsOFF are unchanged. Restricted audience is not LEGAL PASS. #1157 remains separate. Existing old APK/public clients without bearer will receive401 until updated or using browser login.

After a separately authorized squash merge of #1155, reconcile the child with the resulting main ancestry before retargeting; squash can otherwise bring parent commits into the child diff. Any merge/deploy/skip-marker strategy needs its own current audit/GO and privacy-compatible code rollback; do not roll back to anonymous endpoints after restricting access. Schema69 stays in place.

Remote #1154 decision update was explicitly requested and attempted, but GitHub returnedHTTP403 because the current token cannot comment. [Prepared text](issue-1154-decision.md) remains local; no bypass or alternative credential attempt. This is an issue-documentation blocker, not a reason to alter the product or silently claim the issue updated.
