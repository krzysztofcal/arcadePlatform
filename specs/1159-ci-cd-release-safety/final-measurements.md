# #1159 — after-state measurements (T001 / Addendum A.1)

Collected on 2026-11-06 from ordinary hosted runs only; no run was dispatched to fill this table. The baseline is
`pr2-measurements.md`. Same limits as there: provider build time is not end-to-end feedback time, run times
include dependency waits, and human elapsed time is shown only where GitHub records it (environment approval).
No percentage improvement is claimed: the samples are few and not matched pairs.

## Development feedback

| Path | Baseline (pr2-measurements.md) | After (existing runs) |
| --- | --- | --- |
| Android debug APK, code change | run 40763780479: 118s, Gradle 88s; APK origin pin needed a test branch, config commit and manual build | runs [42213027581](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42213027581) 134s and [42234126142](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42234126142) 149s (Gradle 93s, bounded wait for the matching native Preview 25s); automatic on the PR, no manual retry or branch |
| Android, docs/test-only synchronize | rebuilt the whole APK | runs [42133816858](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42133816858) 12s and [42133785056](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42133785056) 10s: preflight and Preview resolution only, setup/Gradle/upload skipped |
| Stacked Preview #1155 → #1160 | four PR mutations (retarget/close/reopen/restore) plus a temporary PR #1161 | native `netlify/playkcswh/deploy-preview` success on the child's own head `419f1185`; its `build-info.js` names `PR #1160`, commit `419f1185dd47…` and deploy `6aed18f5272eebd58ab6382e`, distinct from the parent (`2f4b608a8e74…`, `6aed18e6d252e3c395f28c2d`); no temporary PR or retarget |
| Tests on `main` push | run 40835901747: 101s | runs [42194092912](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42194092912) 109s (with Playwright), [42190389159](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42190389159) 66s and [42133022440](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42133022440) 74s (impact-scoped, no Playwright) |
| WS Preview deploy | run 40696936884: 52s | runs [41341589239](https://github.com/krzysztofcal/arcadePlatform/actions/runs/41341589239) 48s and [41451806297](https://github.com/krzysztofcal/arcadePlatform/actions/runs/41451806297) 55s (unchanged mechanism) |

## Release and administration (owner interventions)

| Operation | Before #1159 | After (existing runs) |
| --- | --- | --- |
| WS Production release | automatic on a `main` push, no approval | run [41606535297](https://github.com/krzysztofcal/arcadePlatform/actions/runs/41606535297): owner dispatch, `ws-production` approval, restart gate; 219s total, validate 154s, deploy 41s |
| Root operation on the VPS | owner pastes prepared root commands in an interactive session | runs [42223180928](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42223180928), [42225018370](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42225018370), [42226390939](https://github.com/krzysztofcal/arcadePlatform/actions/runs/42226390939): requested by `arcade-code-agent[bot]`, one owner approval each, 2–4s request and 7–11s on the VPS; 157–290s from request to result, almost all of it the owner's approval |
| Stage migration apply | a side effect of Draft → Ready | runs 42109960749, 42111502460, 42114784436, 42116230654, 42116598479 (2026-11-05): explicit main-definition dispatch, job `apply-stage` success |

## Open

- Human elapsed time outside GitHub (reading, local steps) is not recorded anywhere; it is not estimated here.
- Netlify provider deploy times for the after state need the Netlify API, which the agent account no longer
  holds; they are not collected.
