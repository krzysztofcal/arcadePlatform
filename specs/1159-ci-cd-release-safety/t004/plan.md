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
  - Dispatch needs only `Actions: write`. Code and PR work uses a separate credential, given only after the T004-3 conditions hold. The owner token leaves `copilot` in T004-3.
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
- `if:`: the existing conditions, with the actor checks replaced by matching pairs only: `((github.actor == github.repository_owner && github.triggering_actor == github.repository_owner) || (vars.WS_RELEASE_AGENT != '' && github.actor == vars.WS_RELEASE_AGENT && github.triggering_actor == vars.WS_RELEASE_AGENT))`. A test evaluates the expression for every actor combination;
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
- No ownership change of `/opt/ws-server` is done here. It is the reviewed runbook section D, which also installs the VPS maintenance script and unit (now `arcade-release`) without running them.

**Re-run hardening:** `chips-ledger-production-scheduled-automation.yml` also checks `github.triggering_actor == github.repository_owner`, so a re-run by the App cannot reuse the owner's privileges. `ws-server-deploy.yml` checks both actors, and any re-run needs a new `ws-production` approval. The Stage workflows gated only on `github.actor` are hardened in T004-3, before any App exists.

**`agents.md`:** the WS Production bullet says: agent dispatch, owner approval in `ws-production`, no manual root steps for a normal release.

**Tests:**
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`:
  - environment, the actor allowlist, environment-only secret names;
  - `prepare` before the switch, `switching` after the gate check and before `ln -sfn`, `resume` only under `success()`, `abort` only under `failure()` after `prepare`;
  - every owner-gated workflow also checks `github.triggering_actor`;
  - no `always()` on them; no `copilot` in the Production remote script;
- `ws-tests/ws-server-deploy.sudo-preflight.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs`: the exact sudoers lines for both accounts.

**Exit:** CI green. WS Preview is unaffected; the Production path does not run in PR CI.

## T004-3: credential separation and re-run hardening (small PR, then setup)

The GitHub App only makes the owner's approval mandatory if the agent cannot reach any owner token. Today the agent account also hosts the owner-token automation. Minimal separation, keeping the timers running:

- **`arcade-dispatch` system account:** no login shell, own home `0700`, not in any group shared with `copilot`.
  - `arcade-chips-ledger-dispatch.service` and `arcade-chips-ledger-production-dispatch.service` get `User=arcade-dispatch`.
  - `gh` comes from a root-owned path (`/usr/local/bin/gh`, root `0755`) through `GH_BIN`. No binary, config or runtime directory of these units is writable by `copilot`.
  - Tokens come only from root-owned `0600` `EnvironmentFile`s read by systemd (`GH_TOKEN`). Each is a fine-grained owner token for this repository, limited to `Actions: write` (dispatch and run reads).
  - The Stage dispatcher gets its own token file instead of `copilot`'s `GH_CONFIG_DIR`.
- **Stage re-run audit and fix:** a re-run keeps the original `github.actor`. A Stage job gated only on `github.actor == owner` therefore runs with the owner's privileges and its Stage secrets when anyone with `Actions: write` re-runs an owner run. These jobs get `github.triggering_actor == github.repository_owner` as well:
  - `chips-ledger-stage-scheduled-automation.yml`;
  - `stage-bonus-campaigns.yml`;
  - `stage-supabase-resource-health.yml`.
  The Stage dispatcher dispatches as the owner, so the automatic runs keep working. A guard test asserts the clause in each owner-gated job.
- **Dispatchable workflows on other refs:** every `workflow_dispatch` workflow that receives secrets either runs its secret-using jobs only for `github.ref == 'refs/heads/main'`, or is shown in the audit to hold only non-sensitive values. The inventory and decisions per workflow go into the private audit note; the PR adds only the guard clauses and their tests.
- **Agent credentials: dispatch and code write are not combined until this is done.**
  - Release dispatch: the GitHub App with `Actions: write` and `Metadata: read` only, used solely to dispatch `WS Server Deploy` and read runs.
  - Code and PR work: a separate credential with `Contents`, `Pull requests` and `Issues` write and no `Actions` write.
  - Never `Deployments`, `Environments`, `Administration`, `Secrets`, `Variables` or `Workflows`.
  - Both credentials end up on the same VPS account, so the agent effectively holds both. With both, it can put code on a branch and dispatch or re-run a workflow on that branch, which runs the code with that workflow's secrets.
  - So the agent receives the code-write credential only after:
    - the re-run checks above;
    - the `main`-only clauses on secret-using dispatchable workflows;
    - the audit's confirmation that no Production secret reaches a PR- or push-triggered workflow.
  - Until then, code and PR work stays with the current owner token, which the agent loses at the end of this step, and dispatch has to wait for it.
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
2. Map every secret name to the workflow jobs that reference it (from `.github/workflows`), to their triggers (PR, push, dispatch, re-run) and refs, and to the VPS env files that hold owner tokens. Classify each as Production, Stage, test or unused.
3. Production secrets live only in environments limited to `main`. An environment that can change Production needs owner review, unless it serves an owner-only scheduled automation whose job checks `github.actor` and `github.triggering_actor`. Unused secrets and environments are removed.
4. Rotate any Production credential that was reachable by the agent account. Rotate the VPS dispatcher tokens when they move to `arcade-dispatch`.
5. Record the result as names, classes and settings in a private owner note. Not in an issue, PR or CI log.

## Activation order (each step a separate owner GO; stop at the first unexpected result)

1. **Protect the environment first (owner, before merging T004-2).** Create `ws-production` with no secrets:
   - required reviewer: the owner;
   - "Prevent self-review" on;
   - deployment branches: selected, `main` only;
   - "Allow administrators to bypass" off.
   The agent verifies by reading only (`GET /repos/krzysztofcal/arcadePlatform/environments/ws-production`):
   - `required_reviewers` lists the owner, with `prevent_self_review: true`;
   - `deployment_branch_policy` is custom branches, and the branch policy list is exactly `main`;
   - `can_admins_bypass: false`.
   Any mismatch: STOP.
2. **Merge T004-2 (owner).** Nothing changes on the VPS. A dispatch now waits for approval and, without `WS_PRODUCTION_*` secrets and the `arcade-release` account, fails at its first SSH step before any VPS change.
3. **Production secrets audit and environment hardening** (above), including `production-ledger`, `production-poker-refill` and the repository secrets.
4. **T004-3 merged.** `arcade-dispatch` installed, timers verified on the next slots, owner token removed from `copilot`.
5. **Create the release dispatch App** (`Actions: write`, `Metadata: read`, this repository only) and set `WS_RELEASE_AGENT=<app-slug>[bot]`. Give the separate code credential only once T004-3's conditions are verified.
6. **Release account migration on the VPS** (runbook `docs/ws-production-restart-gate.md` section D): preconditions, inventory and backup, account, ownership, the maintenance script and unit installed but not run, verification, rollback.
7. **Add the `ws-production` secrets** `WS_PRODUCTION_HOST`, `WS_PRODUCTION_USER=arcade-release` and `WS_PRODUCTION_SSH_KEY` (a new ed25519 key whose private part lives only in the environment), and put the public key into `~arcade-release/.ssh/authorized_keys`.
8. **Stage the gate** with `stage-ws-restart-gate.sh` from the merged `main`: helper, drop-in and sudoers. It runs `check` as both accounts and confirms `copilot` cannot restart Production. From here `copilot` loses `restart` and the Production preflight.
9. **First agent-initiated release:**
   1. the agent dispatches through the App;
   2. the owner approves `ws-production`;
   3. the agent verifies `PREPARED`, `SWITCH_MARKED`, `RESTARTED`, health, smoke and `RESUMED`, then the money checks, and reports.

Until step 8 is complete no WS Production deploy is possible. That is the intended fail-closed window.

## Risks

- **R1.** Crash/OOM/reboot during a live hand: not addressed (separate engine scope).
- **R2.** `prepare` reads readiness at 5 s intervals. The switch still re-checks under the lock (existing `check`), and `restart` re-checks again.
- **R3.** Netlify and admin functions write the DB outside WS. The drain-time checks catch a money mismatch; the operator rule (no admin operations during a release) stays.
- **R4.** The safe-stop path stays root-only and manual.
- **R5.** The owner's `admin` role can still change environment settings. This is intended for break-glass; it is visible in the audit log.
- **R6.** A stray pot on an idle table can be hidden for the duration of a running hand (allowance of one pot per running hand). Once no hand runs it stops `prepare`, and the drain phase allows no pot.
- **R7.** `copilot`'s existing SSH keys and the repository keys stay valid for Preview and Caddy. They give no Production rights once T004-2 and runbook section D are done.
- **R8.** `Actions: write` lets the App dispatch other ungated workflows, cancel runs and delete run logs. These are Stage, Preview, tests and the Caddy reload from `main`. The agent can already do the same today. Environment deployment history keeps the approvals.
- **R9.** A process change between `switching` and the gated restart, or a failure in that window, always ends in C7 (hold kept). This is intended.
