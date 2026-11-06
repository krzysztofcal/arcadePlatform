# #1159 T004: Spec. Agent-initiated, owner-approved WS Production operations

Status: revised on main `d49ce068`. Supersedes the earlier T004 drafts (WS release-drain, readiness report and WWW orchestrator); #1172–#1175 already deliver their WS part.

## Goal

An AI agent prepares and starts an approved Production WS operation by itself. The owner gives a single approval of the protected execution. Nobody runs root commands by hand on a normal release.

## Current state (verified in code and on Production)

T4 is complete. WS Production runs `d49ce068ff64b11e53cf3480ba6e54dbc8e9bbd0`, deployed on 2026-11-03 through the gate.
- Run: `WS Server Deploy` 41606535297.
- Gate: `RESTART_SAFE safe_stop_evidence` → `RESTARTED`.
- Afterwards: bot tables restored, 19 settled hands with `integrity=OK`, `DBQ_OK`.

These mechanisms already exist and are reused unchanged:

- **Hold/drain** (`ws-server/poker/runtime/new-hands-hold.mjs`, drop-in `infra/vps/ws-server.service.d/50-new-hands-hold.conf`):
  - an existing root-owned file `/etc/arcadeplatform/ws-hold/new-hands` stops new hands; live hands, settlement, Leave and cash-outs continue;
  - the content `drain` also rejects queued table commands;
  - an unreadable file counts as hold plus drain.
- **Restart preflight in the running process** (`server.mjs::buildNewHandsHoldStatus`, reported by GET `/internal/admin/poker-maintenance` as `newHandsHold`):
  - in-memory and DB hands in progress;
  - queue and state writes in flight;
  - supervisor sweep;
  - version mismatches;
  - money checks (`summarizeRestartFinancials`: state, escrow, amounts, escrow equal to stacks, open requests);
  - `restartSafe`.
- **Root restart gate** (`infra/vps/ws-restart-gate.mjs`, installed as `/usr/local/sbin/arcade-ws-restart-gate`):
  - `check` / `restart`, fail-closed;
  - the stopped-service path needs single-use `safe-stop` evidence;
  - the workflow calls `check` under the deploy lock before the switch and `restart` after it;
  - the automatic rollback goes through the same gate.
- **Exact-SHA WS deploy** (`.github/workflows/ws-server-deploy.yml` job `deploy`):
  - `workflow_dispatch` from `main` only;
  - `releaseSha` must equal main HEAD, and the main HEAD is checked twice;
  - a confirmation phrase is required;
  - steps: env preflight, gate, atomic switch, local and public health, V3-only automatic rollback, smoke.
- **Continuous bot tables:** POST `set_desired_state` on `/internal/admin/poker-maintenance`.
- **Read-only money checks:** `DB_QUIET_SQL` and the gate's counts.

Corrections to the earlier T004 draft:
- WS now has a hold and drain, and the running process reports restart readiness itself.
- A release does not need to retire bot tables (T4 K1). The hold stops new hands on every table, bot tables included. They resume when the hold is lifted.
- A release does not need a stopped service, a firewall block or safe-stop evidence (T4 K2). Those were needed only because the previous release could not report readiness. They stay as a manual root break-glass path.

## Gaps

1. **Authorization does not separate the agent from the owner.**
   - The `deploy` job checks `github.actor == 'krzysztofcal' && github.triggering_actor == 'krzysztofcal'`. The agent's GitHub token on the VPS belongs to the owner account, so an agent dispatch passes this check. The owner's "GO" was only a chat message.
   - There is no GitHub Environment approval.
   - The deploy SSH account is the account the agent itself runs as on the VPS, so Production release operations are possible outside an approved run.
2. **Release preparation is manual root work.** Hold, drain, waiting for a quiet state, checking for seated humans and closed-table escrow, and lifting the hold were root commands in T4. The gate does not check seated humans or closed-table escrow; those were an operator attestation.

## Requirements

- **R-APPROVE.** The `deploy` job runs only in the GitHub Environment `ws-production`:
  - required reviewer: the owner, with "Prevent self-review" enabled;
  - deployment branches: `main` only;
  - administrators cannot bypass the protection.
  Environment secrets reach the job only after approval. One approval covers the whole job: prepare, deploy, health and resume.
- **R-IDENTITY.** The agent dispatches through a GitHub App installed only on this repository. It is not a collaborator and not the owner's token.
  - Dispatch needs only `Actions: write` (+ `Metadata: read`). Code and PR work uses a separate credential without `Actions` write. Because both credentials end up on the agent's account, the agent gets the code credential only after the T004-3 re-run and `main`-only conditions are verified (plan, T004-3).
  - The App never gets `Deployments`, `Environments`, `Administration`, `Secrets` or `Variables`. `Workflows` comes only after the secrets audit.
  - Without `Deployments: write` it cannot approve a pending deployment. Without `Workflows` it cannot change workflow files.
  - The agent mints a short-lived installation token (1 h) on the VPS from the App private key (owned by `copilot`, mode 0600) for each dispatch.
  - A dispatch through the App runs with `github.actor` and `github.triggering_actor` = `<app-slug>[bot]`. The `deploy` job accepts only matching pairs: owner/owner, or `vars.WS_RELEASE_AGENT`/`vars.WS_RELEASE_AGENT` (set to `<app-slug>[bot]`). A mixed pair, such as an agent re-run of an owner run or the other way round, is refused.
  - With prevent self-review, a run started by the App is approved by the owner, and a run started by the owner cannot be self-approved (break-glass is an admin setting change).
  - No other dispatch path exists: there is no new workflow, `repository_dispatch` or alternative job.
  - **What `Actions: write` also allows:** it covers every workflow in the repository, so the App can dispatch, re-run, cancel or delete runs and their logs, and enable or disable workflows.
    - A re-run keeps the original `github.actor`. So every workflow that changes Production must check `github.triggering_actor` too, or sit behind an environment with owner review.
    - A re-run of a `ws-production` job needs a new approval.
    - Approvals stay in the environment deployment history even if run logs are deleted.
  - **The App does not make the owner's GO mandatory while the agent can reach an owner token.** T004-3 therefore removes every owner token from the agent account. The ledger dispatchers move to a dedicated account (`arcade-dispatch`) whose tokens, binaries and processes `copilot` cannot read or modify. Until then the owner token on the VPS must not have `Deployments`, `Environments`, `Administration`, `Secrets` or `Variables` write.
- **R-REPO.** Changes to `main` and to the workflows need the owner. This is verified today:
  - the ruleset `main is protected` requires a pull request with code-owner review (`CODEOWNERS`: `* @krzysztofcal`), the required checks and no force-push or deletion, and has no bypass actors;
  - the `ws-production` branch policy (`main` only) stops a workflow edited on another branch from using the environment.
- **R-SECRETS.** Before the App is installed, every secret that gives Production access sits in an environment restricted to `main`.
  - It needs owner review when it can change Production, unless the environment serves an owner-only automation; that automation's job then checks both `github.actor` and `github.triggering_actor` against the owner.
  - No such secret stays at repository level.
  - The repository keys for `copilot` (`WS_HOST`, `WS_USER`, `WS_SSH_KEY`, used by `infra-vps.yml` for Caddy) reach only `copilot`, which has no Production WS rights after T004-2.
- **R-HOST.** Production release operations run only as a dedicated VPS account, `arcade-release`. Its SSH key exists only as the `ws-production` environment secret.
  - It owns write access to `/opt/ws-server` and the deploy lock, after a reviewed ownership migration (runbook `docs/ws-production-restart-gate.md` section D).
  - Its sudo rights are exactly:
    - the Production env preflight `""`;
    - gate `check` and `restart`;
    - `prepare *`, `switching *`, `resume *` and `abort *`. The helper accepts only `<runId>` digits and a 40-hex `<sha>`; any other arguments give `unexpected_arguments`.
  - The agent account `copilot` keeps only read-only gate `check`, its Preview, Caddy and closed-table status rights, and the journal. It loses Production gate `restart`, the Production env preflight and write access to `/opt/ws-server`.
  - No new privileged command is granted to `copilot`. The agent receives no root, no env file access and no Production secret.
- **R-GATE.** Both restart paths of the gate block on `humanSeatsOpen > 0` (ACTIVE non-bot seats on OPEN tables) and `closedWithEscrow > 0` (CLOSED tables with escrow ≠ 0). The counts are read in a read-only transaction; unreadable counts block.
- **R-OWN.** A release run owns only the hold it created. Ownership is recorded in the root-only marker `/etc/arcadeplatform/ws-hold/release-op` (`op=<runId> pid=<MainPID at prepare> stage=prepared|switching`), written before the hold.
  - No mode ever removes a hold without a matching marker: an operator hold or another run's hold stays untouched.
  - A rerun of the same run may continue its own preparation only while the stage is `prepared` and the prepared process (same MainPID) still runs.
  - A process change while `prepare` waits is STOP with the hold and marker kept.
- **R-SWITCH.** `switching <runId>` marks the point of no return.
  - The workflow calls it under the deploy lock, after the gate `check` and right before the link changes.
  - It needs this run's `prepared` marker, the unchanged prepared process and the hold set to `drain`.
  - Afterwards `prepare` and `abort` refuse. A switch whose link was restored therefore cannot look like "nothing happened", even though MainPID and the link are unchanged.
- **R-PREPARE.** `prepare <runId>`:
  1. refuses an existing hold it does not own;
  2. writes the marker, then the hold;
  3. waits up to 10 min, but only for running hands (at most one pot, `invalidAmounts`, per running hand) and transient work (queued commands, state writes, supervisor sweep);
  4. writes `drain` and waits up to 2 min, only for transient work, until `RESTART_SAFE`;
  5. prints `PREPARED`.
  - Fail-fast: seated humans, closed-table escrow, `balanceMismatches`, `missingState`, `missingEscrow`, extra `invalidAmounts`, `unresolvedRequests`, `dbVersionMismatches`, unverifiable counts or an error stop at once.
  - On every non-`PREPARED` outcome it removes its own hold and marker. It never restarts anything.
- **R-RESUME.** `resume <runId> <sha>` removes this run's hold only when:
  - the marker says `stage=switching`;
  - WS is `active` and was restarted (MainPID differs from the marker);
  - the running process directory and `/opt/ws-server/current` are both `/opt/ws-server/releases/<sha>/ws-server`, and its `release-metadata.json` says `<sha>`;
  - local `/healthz` is `ok`;
  - the gate is `RESTART_SAFE` (money and presence).
  - Otherwise it prints `RESUME_BLOCKED <reason>` and the hold stays. If interrupted after removing the hold, a rerun only clears its own marker.
- **R-ABORT.** `abort <runId>` is for a failure before the switch was marked. It removes this run's hold only while:
  - the marker says `stage=prepared`;
  - the prepared process (same MainPID) is `active`;
  - that process runs from the current link.
  - After `switching`, it always refuses (`switch_started`), and the hold stays (C7).
- **R-FLOW.** The approved `deploy` job, with `<runId>` = `github.run_id`:
  1. authorize the exact SHA (existing);
  2. env preflight (existing);
  3. `prepare <runId>`; anything other than `PREPARED` fails the job before the switch, with `prepare` having removed only its own hold;
  4. existing gate `check` under the lock → `switching <runId>` (must print `SWITCH_MARKED`, otherwise exit before the link changes) → switch → gated `restart` → local and public health → V3-only rollback;
  5. smoke;
  6. `resume <runId> <releaseSha>` with `if: success()`, so only after authorize, `RESTARTED`, health and smoke all succeeded in this run;
  7. `abort <runId>` with `if: failure() && steps.prepare.outcome == 'success'`. It reopens play only when the switch was never marked. Otherwise it refuses, and the hold stays (C7);
  8. a cancelled run runs neither step, and the hold stays;
  9. a summary with the gate lines, the release link and MainPID.
  - Concurrency: the existing workflow concurrency group plus the existing VPS deploy lock for the switch.
  - Audit: environment deployment history (who approved which run and SHA), the run log with the helper lines, the marker and sudo logging.
- **R-STOP.** A STOP never forces a Leave, edits a ledger or hand, bypasses a gate or retries automatically.
  - **Before the switch was marked** (prepare stop, gate refusal, artifact error): the run removes only its own hold (`prepare` itself, or `abort`), and play continues on the unchanged release.
  - **A process change while preparing**, and **everything after the switch was marked**, including a restored link (`RESTART_UNCERTAIN`, `ROLLBACK_BLOCKED`, a rollback `RESTARTED`, health or smoke failure, `RESUME_BLOCKED`, `ABORT_BLOCKED`): the hold stays for the owner (C7 of `docs/ws-production-restart-gate.md`).

## Agent operations

| Operation | Approval | Path |
| --- | --- | --- |
| VPS/WS status, release, health | none | `copilot`: `systemctl show`, `readlink`, `curl /healthz`, journal |
| Money and readiness read | none | `copilot`: `sudo -n arcade-ws-restart-gate check` (counts and flags only) |
| Silence bot tables, hold/drain, wait for a safe state | `ws-production` | `deploy` job → `prepare` |
| Gated restart + exact-SHA deploy, health, rollback | `ws-production` | existing `deploy` job |
| Resume bots and new hands | `ws-production` (same run) | `deploy` job → `resume` after success, `abort` before any restart |
| Report | none | agent reads the run, environment history and the status rows above |

Out of scope:
- WWW publish (a later PR may move `scripts/www-production-release.mjs` behind the same environment model);
- a restart without a release;
- the release manifest;
- a rollback input;
- a SIGTERM handler;
- crash-safe live hands;
- `set_desired_state` automation (not needed by a release).

## Breaking impact

- **Installed gate (T004-1):** `check` and `restart` refuse while a human is seated or a CLOSED table holds escrow, and refuse when those counts cannot be read. Previously this was only an operator rule.
- **Workflow (T004-2):**
  - every WS Production deploy waits for the owner's approval in `ws-production`;
  - an owner-started run cannot be approved by the owner;
  - without the one-time setup (environment, secrets, `arcade-release` account and sudoers), the deploy fails closed before any VPS change.
- **During a release:** no new hand starts for up to about 12 min plus the deploy. A seated human or an integrity issue makes the release stop and restores play. An existing operator hold makes `prepare` refuse.
- **After a failed release past the restart:** play stays held until the owner decides (C7). This is intended.
- **Agent account:** `copilot` can no longer restart Production, run the Production env preflight or change Production release files.
- **Manual runbooks:** the T4 K1/K2 steps are no longer part of a normal release. The safe-stop path stays as root break-glass.
