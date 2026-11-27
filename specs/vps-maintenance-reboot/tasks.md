# Tasks: gated automatic VPS reboot

Blocked until the OWNER decides D1–D7 in `spec.md` and gives a GO for implementation.

- [ ] T001 `infra/vps/maintenance-reboot.mjs`: pure functions (`parseConfig`, `decideStart`, `decideSwitch`, `reconcile`, `resumeOutcome`, `nextOpId`, `skipSeries`) and `main(run|resume)` per `plan.md`.
- [ ] T002 `ws-tests/maintenance-reboot.behavior.test.mjs`: the fundamental cases in `plan.md` → Tests.
- [ ] T003 Systemd units and `maintenance-reboot.conf.example` under `infra/vps/` (disabled by default).
- [ ] T004 `infra/vps/vps-admin.mjs` and `docs/vps-admin-operations.md`: `maintenance-reboot-install`, `-enable`, `-disable`, `-clear`, `-status`.
- [ ] T005 `docs/vps-maintenance-reboot.md`: runbook (status, disable, `FAILED` and C7).
- [ ] T006 Alerts per D3 (with D3(a): the VPS issue comment and `.github/workflows/maintenance-reboot-watch.yml`); no new secret without a separate GO.
- [ ] T007 Codex review per `REVIEW.md` (max 3 rounds) and CI.
- [ ] T008 After OWNER GO: executor update (OWNER, `stage-vps-admin.sh`), install (disabled), D7 approval, first watched run, then the D1/D2 window and evidence.
