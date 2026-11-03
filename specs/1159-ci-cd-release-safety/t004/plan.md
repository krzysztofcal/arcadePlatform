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
- **Preparation lives in the existing root gate.** `prepare` and `resume` reuse `runGate()` and `evaluateRestartGate()`. There is no second readiness implementation, and the WS runtime is unchanged.
- **The hold silences bot tables.** `set_desired_state` stays an admin tool outside the release flow.

## PR T004-1: gate presence check, `prepare`, `resume` (inert)

The PR does not change the workflow, sudoers or runtime. Installing it changes only `check`/`restart` (extra blockers).

**`infra/vps/ws-restart-gate.mjs`:**
- `PRESENCE_SQL`, `parsePresence()` (shared `parseCounts()`), and `presenceReasons()` in both paths of `evaluateRestartGate({ …, presence })`;
- `queryCounts(dbUrl, sql, parse)` replaces `queryDbQuiet()`;
- `runGate(values)` adds `presence` to both paths;
- `prepareStep(phase, gate)`: pure; `hold` returns wait/drain/stop, `drain` returns wait/ready/stop;
- `prepare({ holdMs = 600000, drainMs = 120000, pollMs = 5000, … })`: atomic hold writes (`writeHold()`), and the previous content is restored on every non-`PREPARED` outcome;
- `resumeIssue({ serviceState, healthz, runningDir, currentDir, gate })` and `resume()`;
- the CLI accepts exactly `check|restart|prepare|resume`.

**`docs/ws-production-restart-gate.md`:** a short "Gate modes" section.

**Tests:** extend `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs`:
- presence blockers and parse;
- the `prepareStep` matrix;
- `prepare` with a fake gate and clock: hold → drain → `PREPARED`; idempotent; human stop, timeouts and gate error restore an absent hold; an operator hold is kept; an unprotected path is refused;
- `resumeIssue` cases.

**Exit:** CI green. The Production install is a separate root GO (`infra/vps/stage-ws-restart-gate.sh`, unchanged), followed by `check`.

## PR T004-2: approved job, release account, sudoers

**`.github/workflows/ws-server-deploy.yml` job `deploy`:**
- `environment: ws-production`;
- `if:`: the existing conditions, with the actor checks replaced by `(github.actor == github.repository_owner || github.actor == vars.WS_RELEASE_AGENT) && (github.triggering_actor == github.repository_owner || github.triggering_actor == vars.WS_RELEASE_AGENT)`;
- the three SSH steps use the environment secrets `WS_PRODUCTION_HOST`, `WS_PRODUCTION_USER` and `WS_PRODUCTION_SSH_KEY` instead of `WS_HOST`, `WS_USER` and `WS_SSH_KEY`. `infra-vps.yml` keeps the repository secrets for Caddy;
- the remote account check `copilot` → `arcade-release`, and `DEPLOY_GROUP` → `arcade-release`;
- a new SSH step after `Pre-stage …` and before `Atomic release switch …`: `sudo -n /usr/local/sbin/arcade-ws-restart-gate prepare`, which must print `PREPARED`, otherwise exit 1 (nothing switched);
- a new last SSH step `if: always() && <prepare step ran>`: `… resume`. `RESUMED*` passes; anything else fails the job with "hold kept; owner decision (C7)";
- the summary gets the gate lines, `readlink -f /opt/ws-server/current` and `MainPID`.

**`infra/vps/arcade-deploy.sudoers`:**
- `arcade-release`: Production env preflight `""`, gate `check`, `restart`, `prepare`, `resume`;
- `copilot`: Preview restart, Caddy reload, Preview env preflight `""`, gate `check`;
- the closed-table status rule stays in its own file.

**`infra/vps/bootstrap.sh`, `infra/vps/stage-ws-restart-gate.sh`:**
- create the `arcade-release` system user and group;
- `/opt/ws-server` and the lock get group `arcade-release`;
- `copilot` is not a member of that group;
- the post-install check runs `check` as both accounts.

**`agents.md`:** the WS Production bullet says: agent dispatch, owner approval in `ws-production`, no manual root steps for a normal release.

**Tests:**
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`: environment, the actor allowlist, environment-only secret names, `prepare` before the switch, `resume` always after, no `copilot` in the Production remote script;
- `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs`: the exact sudoers lines for both accounts.

**Exit:** CI green. WS Preview is unaffected; the Production path does not run in PR CI.

## One-time setup (separate GOs, after T004-2 is merged)

1. **GitHub (owner):**
   - create the agent account and add it as a Write collaborator;
   - set variable `WS_RELEASE_AGENT` to its login;
   - create environment `ws-production` with the settings from R-APPROVE;
   - add the environment secrets `WS_PRODUCTION_HOST` and `WS_PRODUCTION_USER=arcade-release`, plus `WS_PRODUCTION_SSH_KEY` (a new ed25519 key, private part only in the environment).
2. **VPS (root):**
   - stage T004-1 and T004-2 with `stage-ws-restart-gate.sh`;
   - add the public key to `~arcade-release/.ssh/authorized_keys`;
   - `visudo -c`; gate `check` as `copilot` and as `arcade-release`.
3. **Agent token:** replace the VPS `gh` token with the agent account's token and revoke the owner token there.
4. **First run:**
   1. the agent dispatches the current main SHA;
   2. the owner approves;
   3. the agent verifies the release, health, `RESUMED` and the money checks, then reports.

## Risks

- **R1.** Crash/OOM/reboot during a live hand: not addressed (separate engine scope).
- **R2.** `prepare` reads readiness at 5 s intervals. The switch still re-checks under the lock (existing `check`), and `restart` re-checks again.
- **R3.** Netlify and admin functions write the DB outside WS. The drain-time checks catch a money mismatch; the operator rule (no admin operations during a release) stays.
- **R4.** The safe-stop path stays root-only and manual.
- **R5.** The owner's `admin` role can still change environment settings. This is intended for break-glass; it is visible in the audit log.
