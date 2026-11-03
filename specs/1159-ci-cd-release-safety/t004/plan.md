# #1159 T004: Plan

Reuse first: the existing restart gate, hold/drain, the `WS Server Deploy` job and its secrets model. There is no new service, workflow, framework or dependency. The work is two PRs, then a one-time setup under separate GOs.

## Design decisions

- **Approval is a GitHub Environment, not an actor check.**
  - `ws-production` has the owner as required reviewer, prevent self-review, branch `main` only and no admin bypass.
  - Environment secrets are released only after approval, so the job's VPS access exists only in an approved run.
  - The actor check remains as a narrow allowlist: the owner or `vars.WS_RELEASE_AGENT`.
- **A separate agent identity.**
  - The VPS token used by the agent is replaced by one belonging to a dedicated GitHub account. That account has repository Write; its fine-grained token has Actions read/write, Contents read/write and Pull requests read/write, and no Administration, Environments, Secrets or Deployments write.
  - Rejected: keeping the owner's token with self-review allowed. Whether that token can approve its own run would depend on its permissions, which the agent cannot prove.
- **A separate VPS account (`arcade-release`) for Production.**
  - The approved job reaches the VPS only through that account's key, held as an environment secret.
  - The agent account `copilot` loses Production write and restart rights.
  - Rejected: new sudo rules for `copilot`, because the agent runs as `copilot` and could use them without approval.
  - Rejected: a forced-command key for `copilot`, because it still shares `copilot`'s sudo and files.
- **Preparation lives in the existing root gate.** `prepare`, `resume` and `abort` reuse `runGate()` and `evaluateRestartGate()`. There is no second readiness implementation, and the WS runtime is unchanged.
- **Hold ownership is a root-only marker next to the hold file.**
  - The marker records the run id and the MainPID at prepare time. The run id ties the hold to one approved run; the MainPID proves whether a restart happened.
  - The WS runtime still reads only `new-hands`.
  - Rejected: putting the owner into the hold file content, because the runtime and `readHoldDrain()` require exactly `drain`.
- **Resume depends on the workflow result.** `resume` runs only on `success()` and re-proves the exact release itself. `abort` covers only failures before any restart.
- **The hold silences bot tables.** `set_desired_state` stays an admin tool outside the release flow.

## PR T004-1: gate presence check, run-owned `prepare`/`resume`/`abort` (inert)

The PR does not change the workflow, sudoers or runtime. Installing it changes only `check`/`restart` (extra blockers). The CLI keeps `check`/`restart` without arguments.

**`infra/vps/ws-restart-gate.mjs`:**
- `PRESENCE_SQL`, `parsePresence()` (shared `parseCounts()`), and `presenceReasons()` in both paths of `evaluateRestartGate({ …, presence })`;
- `queryCounts(dbUrl, sql, parse)` replaces `queryDbQuiet()`; `runGate(values)` adds `presence`;
- `prepareStep(phase, gate)`: pure and fail-fast.
  - `hold` waits only for `loadedHandsInProgress`/`dbHandsInProgress` (with `invalidAmounts` ≤ running hands) and `TRANSIENT` (commands, writes, sweep).
  - `drain` waits only for `TRANSIENT`.
  - Anything else returns `stop`.
- `readOperation(holdFile)` and `clearOperation(holdFile)`; the marker `release-op` is written atomically with `writeAtomic()`;
- `prepare(opId, host)`, `resume(opId, sha, host)`, `resumeIssue({…})` and `abort(opId, host)`. The `HOST` defaults hold the systemd, `/proc`, link, metadata, healthz and clock access, overridable in tests;
- `main(mode, args)`: exact arity per mode, otherwise `unexpected_arguments`.

**`docs/ws-production-restart-gate.md`:** the "Gate modes" section.

**Tests:** extend `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs`:
- presence blockers;
- the fail-fast `prepareStep` matrix;
- `prepare`:
  - own hold → `PREPARED`;
  - rerun of the same run; another run refused; a changed process refused;
  - an operator hold (empty or `drain`) is never taken over or removed;
  - integrity stop, timeouts and gate error remove only the run's own hold;
- `resume` refusals: not restarted, wrong release, link mismatch, metadata mismatch, healthz, service, presence, foreign run, bad arguments. Then success, and the interrupted rerun;
- `abort` refusals: process changed, link changed. Then success, and `not_held`.

**Exit:** CI green. The Production install is a separate root GO (`infra/vps/stage-ws-restart-gate.sh`, unchanged), followed by `check`.

## PR T004-2: approved job, release account, sudoers

**`.github/workflows/ws-server-deploy.yml` job `deploy`:**
- `environment: ws-production`;
- `if:`: the existing conditions, with the actor checks replaced by `(github.actor == github.repository_owner || github.actor == vars.WS_RELEASE_AGENT) && (github.triggering_actor == github.repository_owner || github.triggering_actor == vars.WS_RELEASE_AGENT)`;
- the three SSH steps use the environment secrets `WS_PRODUCTION_HOST`, `WS_PRODUCTION_USER` and `WS_PRODUCTION_SSH_KEY`. `infra-vps.yml` keeps the repository secrets for Caddy;
- the remote account check `copilot` → `arcade-release`, and `DEPLOY_GROUP` → `arcade-release`;
- a new SSH step `id: prepare` after `Pre-stage …` and before `Atomic release switch …`: `sudo -n /usr/local/sbin/arcade-ws-restart-gate prepare "$GITHUB_RUN_ID"`, which must print `PREPARED`, otherwise exit 1;
- `Resume new hands`, `if: success()`, placed after the WS smoke: `… resume "$GITHUB_RUN_ID" "$RELEASE_SHA"`. It must print `RESUMED`, otherwise the job fails with "hold kept; owner decision (C7)";
- `Abort before restart`, `if: failure() && steps.prepare.outcome == 'success'`: `… abort "$GITHUB_RUN_ID"`. `ABORTED*` passes; `ABORT_BLOCKED` means the hold is kept (C7). The job stays failed either way;
- no `always()` and no `continue-on-error` on these steps;
- the summary gets the gate lines, `readlink -f /opt/ws-server/current` and `MainPID`.

**`infra/vps/arcade-deploy.sudoers`:**
- `arcade-release`: Production env preflight `""`, gate `check`, `restart`, `prepare *`, `resume *`, `abort *`;
- `copilot`: Preview restart, Caddy reload, Preview env preflight `""`, gate `check`.

**`infra/vps/bootstrap.sh`, `infra/vps/stage-ws-restart-gate.sh`:**
- create the `arcade-release` system user and group, with no password;
- the post-install check runs `check` as both accounts.
- No ownership change of `/opt/ws-server` is done here; it is a reviewed manual setup step.

**`agents.md`:** the WS Production bullet says: agent dispatch, owner approval in `ws-production`, no manual root steps for a normal release.

**Tests:**
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`:
  - environment, the actor allowlist, environment-only secret names;
  - `prepare` before the switch, `resume` only under `success()`, `abort` only under `failure()` after `prepare`;
  - no `always()` on them; no `copilot` in the Production remote script;
- `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs`: the exact sudoers lines for both accounts.

**Exit:** CI green. WS Preview is unaffected; the Production path does not run in PR CI.

## One-time setup (separate GOs, after T004-2 is merged)

1. **GitHub secrets review (owner, before anything else):**
   - list the repository secrets and every environment, with its secrets, reviewers and branch policy;
   - move every Production-capable secret into an environment restricted to `main`, with owner review where it can change Production;
   - remove what is unused (R-SECRETS).
2. **GitHub (owner):**
   - create the agent account, add it as a Write collaborator, and set variable `WS_RELEASE_AGENT`;
   - create environment `ws-production` with the R-APPROVE settings;
   - add the secrets `WS_PRODUCTION_HOST`, `WS_PRODUCTION_USER=arcade-release` and `WS_PRODUCTION_SSH_KEY` (a new ed25519 key, private part only in the environment).
3. **VPS ownership migration of `/opt/ws-server` (root, one shell, nothing else running):**
   1. **Preconditions:**
      - no queued or in-progress `WS Server Deploy` run;
      - `flock -n /opt/ws-server/.deploy-maintenance.lock true` succeeds;
      - `ws-server.service` is `active`; record its MainPID.
   2. **Inventory and backup:** `find /opt/ws-server -xdev -printf '%u:%g %m %y %p\n'` to `/root/t4-backup/opt-ws-server-owners.txt`.
   3. **Review the inventory:**
      - owners are only `root` and `copilot`, the group is `arcade-deploy`, and there are no world-writable entries;
      - `arcade` (the service user) can read every release file through its other permissions.
      - Anything else: STOP.
   4. **Change:**
      - `chown -h arcade-release:arcade-release /opt/ws-server/current /opt/ws-server/.deploy-maintenance.lock`;
      - `chgrp arcade-release /opt/ws-server /opt/ws-server/releases` (root stays the owner, setgid is kept);
      - `chown -R arcade-release:arcade-release /opt/ws-server/releases/*`.
      - No mode change.
   5. **Verify:**
      - `sudo -u arcade test -r /opt/ws-server/current/server.mjs`;
      - `sudo -u copilot test -w /opt/ws-server/releases` fails;
      - `sudo -u arcade-release test -w /opt/ws-server/releases` succeeds;
      - MainPID unchanged, `/healthz` `ok`.
   6. **Rollback:** restore owner and group per line from the inventory (`chown -h`), then repeat step 5's read check. No restart is needed: the running process keeps its open files.
4. **VPS (root):**
   - stage T004-1 and T004-2 with `stage-ws-restart-gate.sh`;
   - add the public key to `~arcade-release/.ssh/authorized_keys`;
   - `visudo -c`; gate `check` as `copilot` and as `arcade-release`.
5. **Agent token:** replace the VPS `gh` token with the agent account's token and revoke the owner token there.
6. **First run:**
   1. the agent dispatches the current main SHA;
   2. the owner approves;
   3. the agent verifies the release, health, `RESUMED` and the money checks, then reports.

## Risks

- **R1.** Crash/OOM/reboot during a live hand: not addressed (separate engine scope).
- **R2.** `prepare` reads readiness at 5 s intervals. The switch still re-checks under the lock (existing `check`), and `restart` re-checks again.
- **R3.** Netlify and admin functions write the DB outside WS. The drain-time checks catch a money mismatch; the operator rule (no admin operations during a release) stays.
- **R4.** The safe-stop path stays root-only and manual.
- **R5.** The owner's `admin` role can still change environment settings. This is intended for break-glass; it is visible in the audit log.
- **R6.** A stray pot on an idle table can be hidden for the duration of a running hand (allowance of one pot per running hand). Once no hand runs it stops `prepare`, and the drain phase allows no pot.
- **R7.** `copilot`'s existing SSH keys and the repository keys stay valid for Preview and Caddy. They give no Production rights once T004-2 and setup step 3 are done.
