# Tasks: gated automatic VPS reboot

Blocked until the OWNER decides D1–D4 in `spec.md` and gives a GO for implementation.

- [ ] T001 `infra/vps/maintenance-reboot.mjs`: `parseConfig`, `decideReboot`, `resumeOutcome` (pure) and `main(run|resume)` per `plan.md`.
- [ ] T002 `ws-tests/maintenance-reboot.behavior.test.mjs`: the fundamental cases listed in `plan.md` → Tests.
- [ ] T003 Systemd units and `maintenance-reboot.conf.example` under `infra/vps/` (feature disabled by default).
- [ ] T004 Executor and `docs/vps-admin-operations.md`: `maintenance-reboot-install`, `-enable`, `-disable`, `-status`, reusing the `ws-restart-gate-install` checks.
- [ ] T005 `docs/vps-maintenance-reboot.md`: runbook (status, disable, what to do on `FAILED`).
- [ ] T006 D3 alert channel, as decided by the OWNER (no new secret without a separate GO).
- [ ] T007 Codex review per `REVIEW.md` (max 3 rounds) and CI.
- [ ] T008 After OWNER GO: install (disabled), first reboot watched by the OWNER, then enable the window and report the evidence.
