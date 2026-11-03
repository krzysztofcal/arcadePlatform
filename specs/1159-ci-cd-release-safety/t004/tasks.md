# #1159 T004: Tasks

Each PR is separate and tested only with fundamental deterministic tests. Merge, GitHub settings, secrets, root installs and every Production action need a separate owner GO.

- [x] T4 done: WS Production `d49ce068ff64b11e53cf3480ba6e54dbc8e9bbd0` through the gate, with bots restored and money checks clean. Earlier T004 drain/readiness/orchestrator drafts superseded by #1172–#1175 (see `spec.md`).
- [x] Revised spec and plan: owner approval through environment `ws-production`, separate agent identity, separate VPS release account, `prepare`/`resume` in the existing gate.
- [x] **T004-1** (#1176, merged) `ws-restart-gate.mjs`: presence blockers; run-owned `prepare <runId>` / `switching <runId>` / `resume <runId> <sha>` / `abort <runId>` with the `release-op` marker (stage prepared/switching); process change while preparing keeps the hold; fail-fast `prepareStep`; gate test extension; doc section. Root install of the helper is a separate GO.
- [ ] **T004-2** `ws-server-deploy.yml` `environment: ws-production`, actor allowlist, environment secrets; `prepare` before the switch, `switching` before `ln -sfn`, `resume` only on `success()`, `abort` only on `failure()` after prepare (no `always()`); sudoers for `arcade-release`/`copilot`; bootstrap/stage account (no automatic ownership change); `triggering_actor` checks on owner-gated workflows; guard tests.
- [ ] One-time setup (separate GOs): secrets and environments hardening (R-SECRETS) first; GitHub App (`Actions: write` only) plus `WS_RELEASE_AGENT=<slug>[bot]`, environment and secrets; reviewed `/opt/ws-server` ownership migration with inventory and rollback; VPS account, key and sudoers; owner token permission check.
- [ ] **T004-3** credential separation: `arcade-dispatch` account for the ledger dispatchers (root-owned `gh`, `EnvironmentFile` tokens with `Actions: write` only), no owner token for `copilot`, `scripts/github-app-dispatch.mjs`; timers kept running.
- [ ] Production secrets audit (names/settings only, private owner note).
- [ ] First agent-initiated, owner-approved release: report the run, approval, gate lines, health, `RESUMED` and money checks.
- [ ] Later, optional: WWW publish behind the same model; restart without release; rollback input.
