# CLAUDE.md — Entrypoint for Claude Code

Before starting any work in this repository, read and follow:
- `AGENTS.md` (agent guidelines, deployment authority, operational rules, architecture, logging, JSP compatibility)
- `skills.md` (codebase map and subsystem paths)
- `.specify/memory/constitution.md` (binding project constitution)

## Core Guardrails
- **No Self-Merge**: Never merge a pull request unless the user explicitly commands it in the current prompt.
- **No Unauthorized Deploys**: Agent GitHub access is NOT authorization for Production deployment. Every required OWNER GO is mandatory.
- **Approved Procedures Only**: Deployments and administrative tasks must use only official approved paths (`WS Server Deploy`, `scripts/www-production-release.mjs`, `VPS Admin Operation`, `DB Stage Apply PR`, `Release Record`). Never bypass via manual SSH, sudo, root, or direct restart (does not preclude OWNER emergency recovery C7).
- **Platform Rules**: JSP-compatible JS (no browser modules/imports), CSS 1-line-per-selector, logging strictly via `klog(...)` (never `console.log`), and only fundamental tests.
