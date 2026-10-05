# Tasks

- [x] T001 Implement `infra/vps/ws-production-env-preflight.mjs` with root-owned 0600 file security contract, canonical production project ref (`otbqfijerkieoxwpxjnm`) verification, and read-only DB system identifier (`7575202818581710058`) check.
- [x] T002 Update `infra/vps/arcade-deploy.sudoers` to include `/usr/local/sbin/arcade-ws-production-env-preflight ""`.
- [x] T003 Update `infra/vps/bootstrap.sh` to install `/usr/local/sbin/arcade-ws-production-env-preflight`.
- [x] T004 Integrate preflight into `.github/workflows/ws-server-deploy.yml` before release current switch and service restart.
- [x] T005 Create fundamental deterministic test suite `ws-tests/ws-production-env-preflight.behavior.test.mjs` covering all PASS/FAIL scenarios and workflow ordering.
- [x] T006 Update existing guard tests (`ws-tests/infra-vps-workflow.guard.test.mjs`, `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs`).
- [x] T007 Run targeted test suites and repo checks (`npm run check:all`, `npm run test:quick`, `npm run test:unit`).
- [x] T008 Review whole diff, simplify, and document verification evidence in `specs/1050-ws-production-db-identity-preflight/review.md`.
- [x] T009 Create draft PR linked to #1050 with root cause, fix scope, test evidence, breaking impact, and fail-closed notice.
