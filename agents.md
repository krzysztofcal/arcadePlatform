# agents.md — ArcadePlatform Codex Guide

## 0. How This File Works With `skills.md`

This `agents.md` file defines **how** AI agents must behave:
- coding rules and style conventions,
- allowed patterns,
- roles (Architect, Coder, Reviewer, Tester),
- workflow expectations (Speckit-first),
- safety, CSP, JSP compatibility,
- enforcement rules.

It does **not** list capabilities of the repo.

For **what skills this project provides** — commands, scripts, XP entry points, Netlify functions, game shell wiring, security tools, and required documentation —  
agents must also read **`skills.md`**.

The two files work together:

- **agents.md** → *How to work* (rules, style, behaviour, expectations).  
- **skills.md** → *What to work with* (commands, modules, functions, docs, guards, tests).

All AI agents must consult **both documents** before producing plans, code, or reviews.

## 1. Project Overview
ArcadePlatform is a lightweight browser arcade hub built with static HTML/CSS/JS.
It includes a central XP system (combo/boost mechanics, BFCache-safe lifecycle), a set of mini-games, and Netlify Functions for XP/analytics.

Codex agents collaborate to plan, implement, review, and test changes consistently across JS, CSS, HTML, and docs.

---

## 2. Code Architecture Rules
- Frontend stack: plain HTML + JS (IIFE pattern) + CSS. No build step, no ES modules, no frameworks.
- Server logic: Netlify Functions in `/netlify/functions/*.mjs`.
- XP core: `js/xp.js` and `js/xp-game-hook.js` manage state/events (`xp:tick`, `xp:boost`, etc.).
- Games: each game page uses `window.GameXpBridge.auto()` to connect XP.
- Tests: Node + Playwright in `/tests/*.mjs`.
- Reuse existing helpers and public surfaces wherever possible.

---

## 3. Agent Roles

### Architect
- Produces **Speckit Codex** plans (concise, file/method touch-points).
- Calls out any **breaking impact** or contract changes.
- Reuses existing system pieces; avoids scope creep.

### Coder
- Writes **simple, condensed, JSP-compatible** code.
- Avoids abstraction bloat; no new deps or frameworks without approval.
- Uses existing packages/classes/methods already in the repo.

### Reviewer
- Enforces this document’s rules (style, lifecycle, safety).
- Flags missing teardown, over-engineering, or format violations.

### Tester
- Adds deterministic tests (manual clock/mock timers).
- Uses jsdom for DOM tests; avoids browser-only APIs in Node.
- Confirms BFCache safety and flush/retry behavior.

---

## 4. JavaScript Style
- Global IIFE or plain functions; **no `import`/`export`**.
- Prefer `const`/`let`; minimize global leakage; use intentional namespaces only.
- Prefer `document.getElementById` for perf on hot paths.
- Events: prefix with `xp:` for XP-related signals.
- Diagnostics only when `window.XP_DIAG` is truthy.

---

## 5. CSS Style
- **One selector per line.**
- **Blank line between selectors.**
- **No hard returns inside declaration blocks.**
- Minimal, clean, readable; soft shadows, rounded corners ok.
- Keep animation durations < 1s unless necessary.

---

## 6. HTML Conventions
- Self-contained; avoid inline `<script>` except small bootstraps.
- Accessibility: use `aria-live="polite"` for dynamic notices.
- Keep pages JSP-friendly; no bundler assumptions.

---

## 7. Workflow & Deliverables
- Every feature begins with a **Speckit Codex** plan.
- Speckit must include: affected files, methods, UI rules, acceptance, tests, breaking-impact call-out.
- **No git commands** inside Speckits (unless explicitly requested by the user).

---

## 8. Testing & Quality
- XP tests must validate: deterministic ticks, boosts, batching, inactivity (no XP while idle), resume/BFCache (no phantom tick).
- Prefer strict assertions for numeric equality where appropriate.
- Include negative cases and retry/failure behaviors.

---

## 9. Documentation
- Keep `README.md` / `docs/xp.md` aligned with code.
- Public APIs (`GameXpBridge`, `XP.flushStatus`, events) documented with short tables.
- Instructions must be concise and actionable.

---

## 10. Safety & Compliance
- Do not transmit/store personal data.
- No external scripts/analytics without explicit approval.
- Diagnostics are local-only by default.

---

## 11. Behavior of Codex Agents (enforcing project rules 3–9)
All Codex agents must:
1. Analyze code deeply before writing; ensure full coverage of requirements.
2. Produce **simple and condensed** code without changing functionality.
3. **Reuse** existing packages, classes, and methods where possible.
4. **Highlight breaking impact** explicitly in summaries.
5. Generate **JSP-safe JS**; CSS follows single-line selector rule with blank lines between selectors.
6. Double-check and refactor before presenting final code.
7. Maintain a direct, precise tone; prioritize actionable outcomes.

---

## 12. Optional Modernization Clause
Codex may propose alternative frameworks or libraries only if:
1. They reduce code complexity or file size.
2. They are compatible with static HTML deployment.
3. The proposal is clearly justified and explicitly marked as “optional modernization”.

Such proposals must never be auto-applied. The Architect or user must explicitly approve them before implementation.

---

## 13. Enforcement
- If generated plans or code violate this file, Codex must auto-refactor or warn.
- Do not override these rules unless a Speckit explicitly documents the exception and it is approved by the user.
