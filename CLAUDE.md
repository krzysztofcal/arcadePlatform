# CLAUDE.md — Entrypoint for Claude Code

Before starting any work in this repository, read and follow:
- `AGENTS.md` (agent guidelines, deployment authority, operational rules, architecture, logging, JSP compatibility)
- `skills.md` (codebase map and subsystem paths)
- `.specify/memory/constitution.md` (binding project constitution)

## Core Guardrails
- **VPS Checkout Placement**: Claude Code, Codex and Antigravity MUST create every new VPS checkout/worktree on the host's verified workspace filesystem (current Hetzner Volume or separately OWNER-provisioned UUID mount), following `AGENTS.md` → Task workspace lifecycle. Before each creation, run `node scripts/ops/agent-workdir-preflight.mjs <unique-task-name>` and use its successful stdout as the explicit Git destination. Any failure means STOP with no root-disk fallback. Reuse existing task checkouts at their original location; see `docs/agent-work-directories.md` for launcher limitations.
- **No Self-Merge**: Never merge a pull request unless the user explicitly commands it in the current prompt.
- **No Unauthorized Deploys**: Agent GitHub access is NOT authorization for Production deployment. Every required OWNER GO is mandatory.
- **Approved Procedures Only**: Deployments and administrative tasks must use only official approved paths (`WS Server Deploy`, `scripts/www-production-release.mjs`, `VPS Admin Operation`, `DB Stage Apply PR`, `Release Record`). Never bypass via manual SSH, sudo, root, or direct restart (does not preclude OWNER emergency recovery C7).
- **Platform Rules**: JSP-compatible JS (no browser modules/imports), CSS 1-line-per-selector, logging strictly via `klog(...)` (never `console.log`), and only fundamental tests.

## Application dialogs

Claude Code MUST follow `AGENTS.md` → Application dialogs (mandatory), including the ban on `window.alert()`, `window.confirm()` and `window.prompt()` for new or modified application UX. Reuse the dialog pattern mapped in `skills.md`; native browser/OS security and permission prompts are exempt.

## WWW Candidate (T007)

Follow AGENTS.md's Agent Candidate operating rule and the WWW SOP. After separate activation and explicit OWNER GO
in conversation, use only `ghx`/`arcade-code-agent[bot]` to dispatch Candidate once for exact current main, wait and
verify all receipts/current metadata, then return the ready immutable permalink with PASS/STOP evidence. Only the separately audited and enabled agent
Environment runs without manual Candidate approval. No merge/CI auto-trigger,
OWNER credentials, duplicate/ambiguous candidate, retry or guessed URL. Publish and its approval stay OWNER-only.

## Antigravity delegation

Follow the single `ANTIGRAVITY_DELEGATION` switch and rules in `AGENTS.md` (Core Rules); it governs Antigravity delegation for both Claude Code and Codex, so do not keep a separate switch here. While it is enabled there is no use-count cap. Claude Code logs its own attempts in `docs/antigravity-evaluation.md`, including verified results, overhead and available token usage; unavailable usage is `unknown`, not zero. Later OWNER stop or disable instructions take effect immediately.
