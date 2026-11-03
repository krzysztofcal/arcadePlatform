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
- **R-IDENTITY.** The agent dispatches with its own GitHub identity, never with the owner's token.
  - The `deploy` job accepts a run only when `github.actor` and `github.triggering_actor` are each the repository owner or the repository variable `WS_RELEASE_AGENT`.
  - With prevent self-review, a run started by the agent is approved by the owner; a run started by the owner cannot be self-approved (break-glass is an admin setting change).
  - No other dispatch path exists: there is no new workflow, `repository_dispatch` or alternative job.
- **R-HOST.** Production release operations run only as a dedicated VPS account, `arcade-release`. Its SSH key exists only as the `ws-production` environment secret.
  - It owns write access to `/opt/ws-server` and the deploy lock.
  - Its sudo rights are exactly: the Production env preflight, and the gate modes `check`, `restart`, `prepare` and `resume`.
  - The agent account `copilot` keeps only read-only gate `check`, its Preview, Caddy and closed-table status rights, and the journal. It loses Production gate `restart`, the Production env preflight and write access to `/opt/ws-server`.
  - No new privileged command is granted to `copilot`. The agent receives no root, no env file access and no Production secret.
- **R-GATE.** Both restart paths of the gate block on `humanSeatsOpen > 0` (ACTIVE non-bot seats on OPEN tables) and `closedWithEscrow > 0` (CLOSED tables with escrow ≠ 0). The counts are read in a read-only transaction; unreadable counts block.
- **R-PREPARE.** Gate `prepare`:
  1. writes the hold;
  2. waits (bounded to 10 min) until no hand is in progress;
  3. writes `drain` and waits (bounded to 2 min) until `RESTART_SAFE`;
  4. prints `PREPARED`.
  - It stops at once on seated humans, closed-table escrow, unverifiable state or an error.
  - On every non-`PREPARED` outcome it puts the hold file back exactly as it was before. It never restarts anything.
  - It is idempotent: already drained and safe prints `PREPARED`.
- **R-RESUME.** Gate `resume` removes the hold only when:
  - WS is `active`;
  - local `/healthz` is `ok`;
  - the running process directory equals `/opt/ws-server/current`;
  - the gate is `RESTART_SAFE`.
  - Otherwise it prints `RESUME_BLOCKED <reason>` and the hold stays for the owner. It is idempotent (`RESUMED not_held`).
- **R-FLOW.** The approved `deploy` job:
  1. authorize the exact SHA (existing);
  2. env preflight (existing);
  3. `prepare` (new, before the switch); anything other than `PREPARED` stops before the switch;
  4. existing gate `check` → switch → gated `restart` → health → V3-only rollback;
  5. smoke;
  6. `resume`, which always runs;
  7. a summary with the gate lines, the release link and MainPID.
  - Concurrency: the existing workflow concurrency group plus the existing VPS deploy lock for the switch.
  - Audit: environment deployment history (who approved which run and SHA), the run log with the helper lines, and sudo logging.
- **R-STOP.** STOP leaves the hold in place for the owner (C7 of `docs/ws-production-restart-gate.md`). It applies to:
  - an active human, unsettled escrow or an unknown state;
  - a helper or health error;
  - `RESTART_UNCERTAIN` or `ROLLBACK_BLOCKED`.
  - Never force a Leave, edit a ledger or hand, bypass a gate or retry automatically.

## Agent operations

| Operation | Approval | Path |
| --- | --- | --- |
| VPS/WS status, release, health | none | `copilot`: `systemctl show`, `readlink`, `curl /healthz`, journal |
| Money and readiness read | none | `copilot`: `sudo -n arcade-ws-restart-gate check` (counts and flags only) |
| Silence bot tables, hold/drain, wait for a safe state | `ws-production` | `deploy` job → `prepare` |
| Gated restart + exact-SHA deploy, health, rollback | `ws-production` | existing `deploy` job |
| Resume bots and new hands | `ws-production` (same run) | `deploy` job → `resume` |
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
- **During a release:** no new hand starts for up to about 12 min plus the deploy. A seated human makes the release stop and restores play.
- **Agent account:** `copilot` can no longer restart Production, run the Production env preflight or change Production release files.
- **Manual runbooks:** the T4 K1/K2 steps are no longer part of a normal release. The safe-stop path stays as root break-glass.
