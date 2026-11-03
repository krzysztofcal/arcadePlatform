# #1159 T004: Tasks

Each PR is separate and tested only with fundamental deterministic tests. Merge, GitHub settings, secrets, root installs and every Production action need a separate owner GO.

- [x] T4 done: WS Production `d49ce068ff64b11e53cf3480ba6e54dbc8e9bbd0` through the gate, with bots restored and money checks clean. Earlier T004 drain/readiness/orchestrator drafts superseded by #1172–#1175 (see `spec.md`).
- [x] Revised spec and plan: owner approval through environment `ws-production`, separate agent identity, separate VPS release account, `prepare`/`resume` in the existing gate.
- [ ] **T004-1** `ws-restart-gate.mjs`: presence blockers, `prepare`, `resume`; gate test extension; doc section. Root install of the helper is a separate GO.
- [ ] **T004-2** `ws-server-deploy.yml` `environment: ws-production`, actor allowlist, environment secrets, `prepare` before the switch, `resume` always; sudoers for `arcade-release`/`copilot`; bootstrap/stage account and group; guard tests.
- [ ] One-time setup (separate GOs): agent account plus `WS_RELEASE_AGENT`, environment and secrets, VPS account, key and sudoers, agent token swap.
- [ ] First agent-initiated, owner-approved release: report the run, approval, gate lines, health, `RESUMED` and money checks.
- [ ] Later, optional: WWW publish behind the same model; restart without release; rollback input.
