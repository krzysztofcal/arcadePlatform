# Arcade Platform Constitution

## Core Principles

### I. Simplicity and Existing Mechanisms

Arcade changes MUST follow YAGNI and use the smallest solution that satisfies the
requested behavior. Before adding a file, class, function, dependency, framework,
abstraction, or parallel logic path, the author MUST check whether an existing
file, class, function, or mechanism can be extended. Unrequested cleanup,
speculative features, broad refactors, and overengineering are prohibited.
Changes MUST follow the patterns already present in the repository.

### II. Authoritative Runtime Boundaries

The WebSocket server is the authoritative source of poker state. The ownership
boundary is ws-server/server.mjs, ws-server/poker/runtime/, and
ws-server/poker/table/table-manager.mjs; poker/poker.js and
poker/poker-realtime.js render and communicate with that authority. Netlify
functions and the database are secondary adapters or persistence and MUST NOT
become a competing source of truth for table state, lifecycle, reconnect, or
resynchronization. Changes MUST preserve a single authoritative runtime path.

### III. Fail-Closed Safety and Environment Separation

Financial, destructive, cleanup, migration, maintenance, and deletion operations
MUST fail closed when validation, authorization, target identity, dependency
state, or result is missing, ambiguous, or erroneous. A failed or uncertain
operation MUST deny the action and MUST NOT continue with a partial mutation.
Stage and Production are separate environments with separate targets and
evidence. No change may target Production without the user's explicit
authorization. An agent MUST NEVER merge a pull request unless the user
explicitly commands that merge.

### IV. Platform Compatibility, Logging, and Style

JavaScript used by JSP-rendered pages MUST remain JSP-compatible: browser modules
and imports are prohibited, and shared behavior MUST use the existing global
pattern or an IIFE. Application logging MUST use klog(...) and MUST NEVER use
console.log; logs MUST remain copyable through the existing UI or about-page
surfaces. CSS in css/ MUST use one line per selector with declarations kept on
that line. New scripts MUST remain compatible with the repository CSP and
existing page loading conventions. Any new script MUST be CSP-compliant; when
the change requires an allowlist entry, netlify.toml or the relevant function
CSP headers MUST be updated in the same change.

### V. Fundamental Tests and Concrete Plans

Testing is required for critical logic and MUST remain fundamental, deterministic,
and proportional. Critical coverage includes poker engine reducers and state
transitions, WebSocket runtime behavior, table create/close/cleanup lifecycle,
reconnect and resynchronization, and backend business rules. Critical logic
changes MUST be validated with the existing tests where applicable. New tests
MUST NOT be added unless the user explicitly requests them; when tests are
requested, authors MUST prefer extending existing test files. Tests for UI
rendering, CSS layout, JSP views, or simple glue code remain out of scope unless
the user explicitly requests them. Heavy test frameworks and speculative test
suites are prohibited.

Plans and specifications MUST name concrete file paths, function names, and
properties, and MUST stay concise enough to review. Spec Kit plans MUST include
a Constitution Check, MUST NOT include Git commands, and MUST NOT include full
implementation code unless the code is trivial. When a repository snapshot matching
arcadePlatform-repomix*.txt exists, agents MUST analyze it before requesting
code context and MUST use it as the source of truth for the captured repository
state.

## Deployment and Safety Gates

A pull request that changes ws-server/**, WebSocket runtime dependencies under
shared/**, or browser/WebSocket protocol behavior MUST use the manual WS Preview
Deploy workflow before end-to-end preview verification. The workflow definition
MUST be selected from main with --ref main, while the application revision MUST
be supplied with -f ref=<the-pull-request-branch-or-sha>. After dispatch, the
agent MUST verify that the workflow succeeded for that exact application
revision before asking the user to retest.

Netlify deploy previews update the browser application only. WS PR Checks and
WS Server Deploy validate the WebSocket package but do not deploy the WebSocket
server for pull-request events. A green check MUST NOT be described as a fully
deployed WebSocket preview. The shared preview host MUST be deployed explicitly;
pull requests MUST NOT auto-deploy to it because concurrent previews would
overwrite one another.

The deployment environment is VPS/Ubuntu with systemd services
ws-server.service and ws-server-preview.service. Agents investigating WS
preview behavior MUST inspect the relevant journald service, such as
sudo journalctl -u ws-server-preview -f or journalctl -u
ws-server-preview.service, before inferring behavior from code alone. Agents
investigating Production WebSocket behavior MUST inspect journalctl -u
ws-server.service first. Bounded log inspection MUST use --no-pager -n 200;
-f is reserved for live following. When debugging a specific poker table,
logs MUST be filtered by tableId and correlated with ws_state_persist_*,
ws_settled_rollover_*, ws_bot_autoplay_*, ws_table_janitor_*, and cleanup logs
with poker_state, poker_actions, poker_seats, and poker_tables. Agents MUST
NOT assume Docker or add Docker-dependent steps unless Docker is explicitly
present in the requested environment.

## Development and Review Workflow

Every change MUST identify its affected layer, authoritative source, relevant
constitution gates, and validation command. Reviewers MUST check simplicity,
existing-mechanism reuse, fail-closed behavior, environment targeting, logging,
compatibility, and critical test coverage where applicable. A change that
violates a MUST rule requires changing the specification, plan, or
implementation before review can approve it.

Production work requires an explicit user instruction in the current task.
Deployment or preview work MUST use the target-specific workflow and evidence
for that target. A bootstrap or documentation change MUST NOT be used as a
reason to alter runtime code, migrations, cleanup workflows, or Production.

## Governance

This constitution formalizes the project rules in agents.md and skills.md and
governs all Arcade Platform changes, including documentation, configuration,
automation, frontend, backend, database, and WebSocket work. Where guidance
conflicts, the stricter safety rule applies. Each feature specification, plan,
pull request, and review MUST check compliance with this constitution.

Amendments require a pull request containing the rationale, the affected
principles or sections, and the required version update. An agent may prepare
an amendment and its pull request but may not merge it without the user's
explicit command. Versioning follows semantic governance rules: MAJOR denotes
backward-incompatible governance or principle removal or redefinition, MINOR
denotes a new principle, section, or materially expanded guidance, and PATCH
denotes clarification, wording, or other non-semantic refinement.

The constitution is reviewed whenever agents.md, skills.md, deployment policy,
runtime ownership, or safety boundaries change. Compliance findings MUST be
resolved by changing the affected artifact or obtaining the explicit approval
required by the relevant rule; weakening a principle to hide a violation is
not an allowed resolution.

**Version**: 1.1.0 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-09-11
