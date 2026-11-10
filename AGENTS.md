# AGENTS.md — Entrypoint for AI Agents (Antigravity / Codex)

Before starting any task in this repository, you MUST read and comply with:
1. `agents.md` — primary source of detailed development, runtime, logging, and deployment rules.
2. `skills.md` — codebase architecture and directory mapping.
3. `.specify/memory/constitution.md` — binding project constitution and safety gates.

---

## 🔒 Deployment & Administrative Authority

> **Binding Operational Principle**:
> Wszystkie wdrożenia i operacje administracyjne Arcade Hub muszą korzystać wyłącznie z zatwierdzonych dla danego komponentu procedur. Dostęp agenta do GitHub nie stanowi autoryzacji do deploymentu Production. Każde wymagane OWNER GO pozostaje obowiązkowe. Zabronione jest obchodzenie procedur przez agentów przez ręczne SSH, sudo, root, bezpośredni restart, publikację lub alternatywne skrypty (co nie wyklucza istniejącej awaryjnej procedury odzyskiwania przez OWNERA — C7 w `docs/ws-production-restart-gate.md`).

- **Agent GitHub access is NOT authorization for Production deployment.**
- Every required **OWNER GO** remains strictly mandatory.
- Never bypass procedures via manual SSH, sudo, root, direct service restart, Netlify publish, or ad-hoc scripts (does not preclude OWNER emergency recovery C7).

### Official Approved Pathways
- **WS Production Deploy**: `.github/workflows/ws-server-deploy.yml` (exact SHA, GitHub App dispatch, OWNER approval in `ws-production`).
- **WWW Production Release**: `node scripts/www-production-release.mjs` (Netlify production procedure, OWNER-run only).
- **VPS Admin Operations**: `.github/workflows/vps-admin-operation.yml` (helper catalog, OWNER approval in `vps-admin`).
- **DB Stage Migrations**: `.github/workflows/db-stage-apply-pr.yml` (wymaga jawnego `workflow_dispatch` z `main`, operacja `apply` uruchamiana przez OWNERA dla dokładnego zatwierdzonego `sourceSha` i zestawu migracji w środowisku `stage-automation`).
- **Release Record**: `.github/workflows/release-record.yml` (rejestr wersji; `publish=true` wymaga dispatchu przez OWNERA; nie wykonuje deploymentu).
- **Android / Google Play**: Separate publishing track with independent review and signing.

---

## 🔀 GitHub PR Merge Policy (Always Binding)

- **NEVER merge a pull request yourself.**
- You may create PRs, run checks, and prepare them for review/merge.
- Only merge if the user explicitly commands you to merge in that specific task.
