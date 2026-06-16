# agents.md

## 🎯 Purpose
Defines how agents (Codex / AI) should operate in the Arcade Platform repo.

This is a real-time gaming platform (poker + arcade), not a typical CRUD app.

---

## 🧠 Core Rules (CRITICAL)

1. **Repo snapshot is source of truth**
   - ALWAYS analyze `arcadePlatform-repomix*.txt`
   - DO NOT ask user for code if it exists there

2. **Keep solutions simple**
   - No over-engineering
   - No unnecessary abstractions

3. **Do not blindly generate new code**
   - Prefer modifying existing files
   - Follow existing patterns

4. **JSP compatibility required**
   - No browser modules/imports
   - Use global JS or IIFE

5. **Logging**
   - NEVER use `console.log`
   - ALWAYS use `klog(...)`

---

## 🏗️ Architecture Overview

### Frontend
- Plain JS
- JSP-rendered pages
- CSS in `/css/`

### Backend
- Netlify functions (`/netlify/functions`)
- Shared logic in `_shared/`

### Realtime Layer (CRITICAL)
- `ws-server/` is authoritative
- Handles:
  - game state
  - table lifecycle
  - reconnect
- DB is NOT source of truth

---

## 🧩 Agent Roles

### Architect
- Decide correct layer:
  - UI vs Netlify vs WS
- Ensure consistency with WS runtime

### Implementer
- Modify existing code
- Keep changes minimal

### Debugger
- Trace flow:
  UI → WS → runtime → shared logic
- Look for:
  - state mismatch
  - stale UI
  - race conditions

### Reviewer
- Validate:
  - simplicity
  - no regressions
  - consistency with patterns

---

## 🧪 Testing Policy (IMPORTANT)

Testing is REQUIRED, but ONLY for critical logic.

### ✅ When to write tests
- Poker engine logic (reducers, state transitions)
- WebSocket runtime behavior
- Table lifecycle (create / close / cleanup)
- Reconnect / resync logic
- Backend business rules

### ❌ When NOT to write tests
- UI rendering
- CSS / layout
- Simple glue code
- JSP views

### Rules
- Prefer extending existing test files
- Keep tests deterministic
- Focus on edge cases and failure scenarios
- Do NOT introduce heavy test frameworks

---

## 📦 Speckit Mode (for plans)

When writing a plan:
- Use file paths
- Use function names
- Be concise
- DO NOT include git commands
- DO NOT write full code unless trivial

---

## ⚠️ High-Risk Areas

Extra caution required:

- WebSocket reconnect
- Poker state transitions
- Table lifecycle
- UI ↔ WS sync
- Global CSS

---

## 🚫 Anti-Patterns

- Rewriting working code
- Adding frameworks
- Creating duplicate logic paths
- Treating DB as source of truth for poker
- Using console.log

---

## ✅ Definition of Done

Task is complete when:

- Works with existing architecture
- No regressions
- WS state and UI are consistent
- Critical paths are covered with tests
- Code is simple and readable