# AGENTS.md — Entrypoint for AI Agents (Antigravity / Codex)

Before starting any task in this repository, you MUST read and comply with:
1. `agents.md` — primary source of detailed development, runtime, logging, and deployment rules.
2. `skills.md` — codebase architecture and directory mapping.
3. `.specify/memory/constitution.md` — binding project constitution and safety gates.

---

## 🔒 Deployment & Administrative Authority

> **Binding Operational Principle**:
> Wszystkie wdrożenia i operacje administracyjne Arcade Hub muszą korzystać wyłącznie z zatwierdzonych dla danego komponentu procedur. Dostęp agenta do GitHub nie stanowi autoryzacji do deploymentu Production. Każde wymagane OWNER GO pozostaje obowiązkowe. Zabronione jest obchodzenie procedur przez ręczne SSH, sudo, root, bezpośredni restart, publikację lub alternatywne skrypty.

- **Agent GitHub access is NOT authorization for Production deployment.**
- Every required **OWNER GO** remains strictly mandatory.
- Never bypass procedures via manual SSH, sudo, root, direct service restart, Netlify publish, or ad-hoc scripts.

### Official Approved Pathways
- **WS Production Deploy**: `.github/workflows/ws-server-deploy.yml` (exact SHA, GitHub App dispatch, OWNER approval in `ws-production`).
- **WWW Production Release**: `node scripts/www-production-release.mjs` (Netlify production procedure).
- **VPS Admin Operations**: `.github/workflows/vps-admin-op.yml` (helper catalog, OWNER approval in `vps-admin`).
- **DB Stage Migrations**: `.github/workflows/db-stage-apply-pr.yml` (Stage migrations on non-draft PRs).
- **Release Record**: `.github/workflows/release-record.yml` (version provenance registry; does NOT deploy).
- **Android / Google Play**: Separate publishing track with independent review and signing.

---

## 🔀 GitHub PR Merge Policy (Always Binding)

- **NEVER merge a pull request yourself.**
- You may create PRs, run checks, and prepare them for review/merge.
- Only merge if the user explicitly commands you to merge in that specific task.
