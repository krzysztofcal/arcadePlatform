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

Only fundamental, deterministic tests for critical logic are required, and test
work MUST remain proportional. Critical coverage includes poker engine reducers
and state transitions, WebSocket runtime behavior, table create/close/cleanup
lifecycle, reconnect and resynchronization, and backend business rules.
Authors MUST prefer extending existing test files. Broad or speculative suites,
including UI rendering, CSS/layout, JSP views, or simple glue code, are
prohibited. Heavy test frameworks are prohibited.

Before $speckit-implement, the Constitution Check MUST inspect planned test
tasks. Specifications, plans, and tasks MUST NOT require prohibited tests.
TDD/test-first does not override fundamental-tests-only policy. A generated
Spec Kit task is not authorization to add UI rendering, CSS/layout, JSP-view,
or simple-glue tests. Conflicting tasks MUST be corrected before implementation.
Presentation SHOULD be verified through existing preview/E2E or manual preview
when appropriate.

Plans and specifications MUST name concrete file paths, function names, and
properties, and MUST stay concise enough to review. Spec Kit plans MUST include
a Constitution Check, MUST NOT include Git commands, and MUST NOT include full
implementation code unless the code is trivial. When a repository snapshot
matching arcadePlatform-repomix*.txt is needed, agents MAY use it as historical
or offline fallback context. The live GitHub repository MUST remain the primary
source of truth for current code; a conflicting snapshot MUST NOT override it.

## Deployment and Safety Gates

### Authorized Deployment and Administrative Procedures

Wszystkie wdrożenia i operacje administracyjne Arcade Hub muszą korzystać wyłącznie z zatwierdzonych dla danego komponentu procedur. Dostęp agenta do GitHub nie stanowi autoryzacji do deploymentu Production. Każde wymagane OWNER GO pozostaje obowiązkowe. Zabronione jest obchodzenie procedur przez ręczne SSH, sudo, root, bezpośredni restart, publikację lub alternatywne skrypty.

All Arcade Hub deployments and administrative operations must strictly use the approved procedures for the respective component. Agent access to GitHub does not constitute authorization for Production deployment. Every required OWNER GO remains strictly mandatory. Bypassing procedures via manual SSH, sudo, root, direct restart, publication, or alternative scripts is prohibited.

Official approved operational paths:
- **WS Server Deploy**: Exact-SHA deployment workflow (`.github/workflows/ws-server-deploy.yml`) dispatched via GitHub App (`arcade-code-agent[bot]`), with human seat/financial preflight gates, restart gate, rollback receipts, and requiring explicit OWNER approval in the `ws-production` GitHub Environment.
- **WWW Production Release**: Netlify production release procedure executed strictly via `scripts/www-production-release.mjs`.
- **VPS Admin Operation**: Root-on-demand administrative helper catalog (`.github/workflows/vps-admin-op.yml`), requiring explicit OWNER approval in the `vps-admin` GitHub Environment.
- **DB Stage Apply PR**: Automated shared Stage database schema migrations triggered only by eligible non-draft PRs (`.github/workflows/db-stage-apply-pr.yml`).
- **Release Record**: Audited immutable version provenance registry (`.github/workflows/release-record.yml`), documenting component SHAs and manifests. Release Record is an audited version registry and does NOT perform deployment or mutate environments.
- **Android / Google Play**: Separate publishing track with independent review, signing, and explicit release gates.

Stage/WS Preview accepts hard-kick deployment restarts, including occupied tables; no manual Leave,
empty-table requirement, Preview presence counters or safe-stop receipt is required. This is not a
chip-settlement guarantee: interrupted hands may need existing Stage recovery and OWNER intervention.
Provisioning completes read-only preflight, stops only Preview and proves its process group empty
before changing files/accounts; rollback requires stopped Preview and never starts it. Production
restart gate, HOLD/DRAIN, escrow/recovery and OWNER approvals remain unchanged. A deployment or DRAIN
change always needs its own GO; health alone does not prove playable status.


Pull request creation, Draft/Ready and synchronize events never apply
supabase/migrations/** to the shared Stage database. Shared Stage SQL is
applied only by an explicitly authorized DB Stage Apply PR workflow_dispatch
from main, in the stage-automation environment, for the exact approved source
SHA, file and hash set; apply is owner-dispatched (see agents.md "Explicit
Stage migrations" and docs/operations.md "Stage DB migrations"). This is a
shared-environment mutation, NOT a read-only CI check, and needs its own
explicit scope. The specification, plan, and tasks MUST record which
migrations need a Stage apply and that the apply is a separate owner step.
Once applied to shared Stage, corrections MUST be forward-only in new
migrations; applied migrations MUST NOT be edited.

Definition of Done is target-aware. Green CI, mocks, and unit tests do not prove
runtime configuration or integration. For WS-affecting changes, Codex MUST
prepare the relevant Deploy Preview and execute the manual WS Preview Deploy
for the latest runtime-affecting commit, using the exact application SHA; the
workflow must be verified successful for that SHA. Deploy Preview
frontend/Netlify calls to WS Preview remain the relevant integration boundary.
Codex is NOT required to run a full browser/authenticated smoke for every PR.
The agent may run automated or manual smoke when the user explicitly requests
it, when it is needed to diagnose a concrete issue, or when the root cause
cannot otherwise be established. The user may perform the required real-runtime
smoke manually. When that verification is still outstanding, the handoff MUST
say "implementation ready, awaiting manual runtime verification" and the PR
MUST NOT be called READY/merge-ready.

After a successful exact-SHA WS Preview Deploy and confirmed smoke, later
commits that change only docs, Spec Kit artifacts, tests, or non-runtime
comments/metadata do not invalidate that runtime evidence. Before reusing the
evidence, the agent MUST prove by diff that no deployable runtime artifact or
environment configuration changed. Any later runtime/deployable/configuration
change requires a new exact-SHA WS Preview Deploy and the relevant manual
scenario again. Stage smoke may likewise be performed by the user; agents MUST
NOT run broad or redundant Stage smoke unless the user requests it or it is
needed for diagnosis. This does not authorize Production, whose rules are
unchanged. A PR MUST NOT be marked READY/merge-ready while required runtime
verification is missing or a manual smoke demonstrates a failure.

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

The $speckit-implement workflow MUST execute only setup or implementation
changes explicitly required by the current specification, plan, and tasks. It
MUST NOT create or modify .gitignore, .npmignore, other ignore files,
tooling/configuration files, dependencies, or perform generic setup cleanup
because a repository or tool happens to suggest them. Each such change requires
an explicit requirement in all applicable current feature artifacts. No
feature artifacts means no generic setup changes.

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

**Version**: 1.2.0 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-11-10
