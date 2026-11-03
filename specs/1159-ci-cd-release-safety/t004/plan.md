# #1159 T004: Plan

Reuse first: the existing restart gate, hold/drain, the `WS Server Deploy` job and its secrets model. There is no new service, workflow, framework or dependency. The work is two PRs, then a one-time setup under separate GOs.

## Design decisions

- **Approval is a GitHub Environment, not an actor check.**
  - `ws-production` has the owner as required reviewer, prevent self-review, branch `main` only and no admin bypass.
  - Environment secrets are released only after approval, so the job's VPS access exists only in an approved run.
  - The actor check remains as a narrow allowlist: the owner or `vars.WS_RELEASE_AGENT`.
- **The agent dispatches through a GitHub App, not as a collaborator.**
  - The App is installed on this repository only, with `Actions: write` and `Metadata: read`. Its installation tokens last 1 h and are minted on the VPS from the App private key.
  - `github.actor` and `github.triggering_actor` are `<app-slug>[bot]`.
  - The App cannot push code or workflows (no `Contents`), cannot approve deployments (no `Deployments`), and is not a reviewer.
  - Rejected: a separate Write collaborator account. `Contents: write` lets it push a branch workflow that runs with repository secrets and with any environment not limited to `main`.
  - Rejected: keeping the owner's token for dispatch with self-review allowed. Whether that token can approve its own run would depend on its permissions, which the agent cannot prove.
  - Dispatch needs only `Actions: write`. In T004-3 the same App takes over code and PR work (`Contents`, `Pull requests`, `Issues`) and the owner token leaves `copilot`.
  - Until then, the owner token on the VPS must not have `Deployments`, `Environments`, `Administration`, `Secrets` or `Variables` write.
  - `Contents: write` lets the agent change scripts run by PR-triggered workflows, which is the same as today. This is why the secrets audit comes first: no Production secret may be reachable by such a workflow.
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
- **Resume depends on the workflow result.** `resume` runs only on `success()` and re-proves the exact release itself. `abort` covers only failures before the switch.
- **An explicit point of no return.** After a switch whose link was restored, the MainPID and the link look exactly as before the operation. So the workflow marks `stage=switching` through the gate before it touches the link, and from then on only the owner decides (C7).
- **The hold silences bot tables.** `set_desired_state` stays an admin tool outside the release flow.

## PR T004-1: gate presence check, run-owned `prepare`/`switching`/`resume`/`abort` (inert)

The PR does not change the workflow, sudoers or runtime. Installing it changes only `check`/`restart` (extra blockers). The CLI keeps `check`/`restart` without arguments.

**`infra/vps/ws-restart-gate.mjs`:**
- `PRESENCE_SQL`, `parsePresence()` (shared `parseCounts()`), and `presenceReasons()` in both paths of `evaluateRestartGate({ …, presence })`;
- `queryCounts(dbUrl, sql, parse)` replaces `queryDbQuiet()`; `runGate(values)` adds `presence`;
- `prepareStep(phase, gate)`: pure and fail-fast.
  - `hold` waits only for `loadedHandsInProgress`/`dbHandsInProgress` (with `invalidAmounts` ≤ running hands) and `TRANSIENT` (commands, writes, sweep).
  - `drain` waits only for `TRANSIENT`.
  - Anything else returns `stop`.
- `readOperation(holdFile)`, `writeOperation()` and `clearOperation(holdFile)`: the marker `release-op` (`op`, `pid`, `stage`) is written atomically;
- `prepare(opId, host)`: re-checks MainPID on every poll; a change is STOP with the hold kept;
- `markSwitching(opId, host)`, `resume(opId, sha, host)` (requires `stage=switching`), `resumeIssue({…})` and `abort(opId, host)` (requires `stage=prepared`). The `HOST` defaults hold the systemd, `/proc`, link, metadata, healthz and clock access, overridable in tests;
- `main(mode, args)`: exact arity per mode, otherwise `unexpected_arguments`.

**`docs/ws-production-restart-gate.md`:** the "Gate modes" section.

**Tests:** extend `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs`:
- presence blockers;
- the fail-fast `prepareStep` matrix;
- `prepare`:
  - own hold → `PREPARED`;
  - rerun of the same run; another run refused; a changed process refused; a process change while waiting is STOP with the hold kept;
  - an operator hold (empty or `drain`) is never taken over or removed;
  - integrity stop, timeouts and gate error remove only the run's own hold;
- `resume` refusals: not restarted, wrong release, link mismatch, metadata mismatch, healthz, service, presence, foreign run, bad arguments. Then success, and the interrupted rerun;
- `markSwitching`: not drained, foreign run, process changed; then marked and idempotent; afterwards `prepare` refuses;
- `abort` refusals: process changed, link changed, `switch_started` with an unchanged PID and link (a restored link). Then success, and `not_held`.

**Exit:** CI green. The Production install is a separate root GO (`infra/vps/stage-ws-restart-gate.sh`, unchanged), followed by `check`.

## PR T004-2: approved job, release account, sudoers

**`.github/workflows/ws-server-deploy.yml` job `deploy`:**
- `environment: ws-production`;
- `if:`: the existing conditions, with the actor checks replaced by `(github.actor == github.repository_owner || github.actor == vars.WS_RELEASE_AGENT) && (github.triggering_actor == github.repository_owner || github.triggering_actor == vars.WS_RELEASE_AGENT)`;
- the three SSH steps use the environment secrets `WS_PRODUCTION_HOST`, `WS_PRODUCTION_USER` and `WS_PRODUCTION_SSH_KEY`. `infra-vps.yml` keeps the repository secrets for Caddy;
- the remote account check `copilot` → `arcade-release`, and `DEPLOY_GROUP` → `arcade-release`;
- in `Atomic release switch …`, after the existing gate `check` under the lock and before `ln -sfn`: `… switching "$GITHUB_RUN_ID"`. It must print `SWITCH_MARKED`, otherwise exit 1 before the link changes;
- a new SSH step `id: prepare` after `Pre-stage …` and before `Atomic release switch …`: `sudo -n /usr/local/sbin/arcade-ws-restart-gate prepare "$GITHUB_RUN_ID"`, which must print `PREPARED`, otherwise exit 1;
- `Resume new hands`, `if: success()`, placed after the WS smoke: `… resume "$GITHUB_RUN_ID" "$RELEASE_SHA"`. It must print `RESUMED`, otherwise the job fails with "hold kept; owner decision (C7)";
- `Abort before restart`, `if: failure() && steps.prepare.outcome == 'success'`: `… abort "$GITHUB_RUN_ID"`. `ABORTED*` passes; `ABORT_BLOCKED` means the hold is kept (C7). The job stays failed either way;
- no `always()` and no `continue-on-error` on these steps;
- the summary gets the gate lines, `readlink -f /opt/ws-server/current` and `MainPID`.

**`infra/vps/arcade-deploy.sudoers`:**
- `arcade-release`: Production env preflight `""`, gate `check`, `restart`, `prepare *`, `switching *`, `resume *`, `abort *`;
- `copilot`: Preview restart, Caddy reload, Preview env preflight `""`, gate `check`.

**`infra/vps/bootstrap.sh`, `infra/vps/stage-ws-restart-gate.sh`:**
- create the `arcade-release` system user and group, with no password;
- the post-install check runs `check` as both accounts.
- No ownership change of `/opt/ws-server` is done here; it is a reviewed manual setup step.

**Re-run hardening:** `chips-ledger-production-scheduled-automation.yml` also checks `github.triggering_actor == github.repository_owner`, so a re-run by the App cannot reuse the owner's privileges. `ws-server-deploy.yml` checks both actors, and any re-run needs a new `ws-production` approval. The Stage workflows gated on `github.actor` are left as they are (Stage only).

**`agents.md`:** the WS Production bullet says: agent dispatch, owner approval in `ws-production`, no manual root steps for a normal release.

**Tests:**
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`:
  - environment, the actor allowlist, environment-only secret names;
  - `prepare` before the switch, `switching` after the gate check and before `ln -sfn`, `resume` only under `success()`, `abort` only under `failure()` after `prepare`;
  - every owner-gated workflow also checks `github.triggering_actor`;
  - no `always()` on them; no `copilot` in the Production remote script;
- `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs`: the exact sudoers lines for both accounts.

**Exit:** CI green. WS Preview is unaffected; the Production path does not run in PR CI.

## T004-3: credential separation on the VPS (small PR, then setup)

The GitHub App only makes the owner's approval mandatory if the agent cannot reach any owner token. Today the agent account also hosts the owner-token automation. Minimal separation, keeping the timers running:

- **`arcade-dispatch` system account:** no login shell, own home `0700`, not in any group shared with `copilot`.
  - `arcade-chips-ledger-dispatch.service` and `arcade-chips-ledger-production-dispatch.service` get `User=arcade-dispatch`.
  - `gh` comes from a root-owned path (`/usr/local/bin/gh`, root `0755`) through `GH_BIN`. No binary, config or runtime directory of these units is writable by `copilot`.
  - Tokens come only from root-owned `0600` `EnvironmentFile`s read by systemd (`GH_TOKEN`). Each is a fine-grained owner token for this repository, limited to `Actions: write` (dispatch and run reads).
  - The Stage dispatcher gets its own token file instead of `copilot`'s `GH_CONFIG_DIR`.
- **Agent:** `copilot` holds no owner token. For code and PR work, and for dispatch, it uses the App installation token only.
  - App permissions: `Actions: write`, `Contents: write`, `Pull requests: write`, `Issues: write`, `Metadata: read`.
  - `Workflows: write` is granted only after the secrets audit is verified. Until then the owner applies workflow-file changes.
  - Never `Deployments`, `Environments`, `Administration`, `Secrets` or `Variables`.
- **`scripts/github-app-dispatch.mjs`:**
  - mints a 1 h installation token in-process from the App key (`~copilot/.config/arcade-release-app.pem`, `0600`);
  - dispatches `WS Server Deploy` with the current main SHA and the confirmation phrase;
  - never prints the token.
  - Tests: argument validation and the JWT claims (pure functions).
- **Timer continuity:**
  1. install the token files and the root-owned `gh` first;
  2. switch `User=` and `daemon-reload` between two timer slots;
  3. confirm the next slot's dispatch in `journalctl` and the run list;
  4. only then remove the owner token from `copilot` (`gh auth logout`).
  - Rollback: restore the previous unit files and `daemon-reload`.

## Production secrets audit (owner; names and settings only, never values)

1. List the repository secrets and variables, the environments with their secrets, reviewers, branch policy and admin bypass, and the fine-grained tokens and Apps with access to this repository.
2. Map every secret name to the workflow jobs that reference it (from `.github/workflows`) and to the VPS env files that hold owner tokens. Classify each as Production, Stage, test or unused.
3. Production secrets live only in environments limited to `main`. An environment that can change Production needs owner review, unless it serves an owner-only scheduled automation whose job checks `github.actor` and `github.triggering_actor`. Unused secrets and environments are removed.
4. Rotate any Production credential that was reachable by the agent account. Rotate the VPS dispatcher tokens when they move to `arcade-dispatch`.
5. Record the result as names, classes and settings in a private owner note. Not in an issue, PR or CI log.

## One-time setup (separate GOs, after T004-2 is merged)

1. **Secrets and environments hardening (owner, before the App is installed; values are never printed):**
   1. Inventory names only (Settings → Secrets and variables → Actions; Environments). Map each name to the workflows that use it (`grep -rn "secrets\." .github/workflows`) and classify it Production / Stage / test.
   2. For every environment holding Production secrets:
      - set deployment branches to `main` only;
      - add owner review unless it serves an owner-only automation whose job checks `github.actor` and `github.triggering_actor`;
      - disallow admin bypass.
      - An environment no workflow references is emptied and deleted.
   3. A repository-level secret that gives Production access moves into such an environment; the workflow job gets `environment:`. Stage and test secrets stay.
   4. Verify by reading settings only: each Production environment shows the branch policy (and a reviewer where required); no Production name is left at repository level.
2. **GitHub (owner):**
   - create the GitHub App (repository-only install; `Actions: write`, `Metadata: read`; no webhook);
   - put its private key on the VPS as `~copilot/.config/arcade-release-app.pem` (0600);
   - set variable `WS_RELEASE_AGENT=<app-slug>[bot]`;
   - create environment `ws-production` with the R-APPROVE settings;
   - add the secrets `WS_PRODUCTION_HOST`, `WS_PRODUCTION_USER=arcade-release` and `WS_PRODUCTION_SSH_KEY` (a new ed25519 key, private part only in the environment);
   - check that the owner token on the VPS has no `Deployments`, `Environments`, `Administration`, `Secrets` or `Variables` write.
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
5. **Agent dispatch:** after T004-3 the agent mints an installation token from the App key for each dispatch (`scripts/github-app-dispatch.mjs`) and holds no owner token.
6. **First run:**
   1. the agent dispatches the current main SHA;
   2. the owner approves;
   3. the agent verifies the release, health, `RESUMED` and the money checks, then reports.

## Activation order (each step a separate owner GO; stop at the first unexpected result)

1. Merge T004-2, then create and protect `ws-production` before anyone dispatches (step 4 settings).
   - Nothing changes on the VPS.
   - A dispatch before that would auto-create an unprotected, empty environment. With no `WS_PRODUCTION_*` secrets and no `arcade-release` account, its first SSH step fails before any VPS change.
2. Production secrets audit and environment hardening (above).
3. T004-3 merged; `arcade-dispatch` installed; timers verified on the next slots; owner token removed from `copilot`.
4. Create the GitHub App, set `WS_RELEASE_AGENT`, create `ws-production` with its secrets, and verify the owner token permissions.
5. VPS ownership migration of `/opt/ws-server` (setup step 3).
6. Stage the gate with `stage-ws-restart-gate.sh`:
   - creates `arcade-release`;
   - installs the T004 helper, drop-in and sudoers;
   - `copilot` loses `restart` and the Production preflight here.
   Then add the release public key and run `check` as both accounts.
7. First agent-initiated release: the agent dispatches, the owner approves `ws-production`, the agent verifies `PREPARED`, `SWITCH_MARKED`, `RESTARTED`, health, smoke and `RESUMED`, then the money checks, and reports.

Until step 6 is complete no WS Production deploy is possible. That is the intended fail-closed window.

## Risks

- **R1.** Crash/OOM/reboot during a live hand: not addressed (separate engine scope).
- **R2.** `prepare` reads readiness at 5 s intervals. The switch still re-checks under the lock (existing `check`), and `restart` re-checks again.
- **R3.** Netlify and admin functions write the DB outside WS. The drain-time checks catch a money mismatch; the operator rule (no admin operations during a release) stays.
- **R4.** The safe-stop path stays root-only and manual.
- **R5.** The owner's `admin` role can still change environment settings. This is intended for break-glass; it is visible in the audit log.
- **R6.** A stray pot on an idle table can be hidden for the duration of a running hand (allowance of one pot per running hand). Once no hand runs it stops `prepare`, and the drain phase allows no pot.
- **R7.** `copilot`'s existing SSH keys and the repository keys stay valid for Preview and Caddy. They give no Production rights once T004-2 and setup step 3 are done.
- **R8.** `Actions: write` lets the App dispatch other ungated workflows, cancel runs and delete run logs. These are Stage, Preview, tests and the Caddy reload from `main`. The agent can already do the same today. Environment deployment history keeps the approvals.
- **R9.** A process change between `switching` and the gated restart, or a failure in that window, always ends in C7 (hold kept). This is intended.
