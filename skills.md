# skills.md

## 🎯 Purpose
This file maps key parts of the Arcade Platform codebase.

Agents MUST use this to locate logic quickly.

---

## 🕹️ Portal / Arcade Core

### Files
- `/portal/portal.js`
- `/css/portal.css`

### Responsibilities
- Layout (topbar, XP, navigation)
- Game container
- Global UI consistency

---

## 🎮 XP System

### Backend
- `/netlify/functions/xp.mjs`

### Frontend
- `/js/xp.js`

### Shared
- `/netlify/functions/_shared/xp-ledger.mjs`

### Notes
- Ledger-based system
- Idempotent XP grants
- Daily limits enforced server-side

---

## 🃏 Poker (CRITICAL DOMAIN)

### Frontend
- `/poker/poker.js`
- `/poker/poker-realtime.js`
- `/poker/poker.css`

### Responsibilities
- Table rendering
- Player actions
- WS communication
- UI state

---

### Backend (Netlify)
- `/netlify/functions/poker-*.mjs`

### Shared Engine
- `/netlify/functions/_shared/`
  - `poker-engine.mjs`
  - `poker-reducer.mjs`
  - `poker-autoplay.mjs`
  - `poker-table-lifecycle.mjs`

### Responsibilities
- Game rules
- State transitions
- Bot behavior
- Table lifecycle

---

## 🔌 WebSocket Server (AUTHORITATIVE)

### Entry
- `/ws-server/server.mjs`

### Core
- `/ws-server/poker/runtime/`
- `/ws-server/poker/table/table-manager.mjs`

### Responsibilities
- Real-time state
- Table lifecycle
- Reconnect handling
- Cleanup of inactive sessions

### IMPORTANT
- WS state = source of truth
- DB is secondary

---

## 🔁 Reconnect & Sync

### Files
- `/ws-server/poker/reconnect/`
- `resync.behavior.test.mjs`

### Responsibilities
- Restore player state
- Handle stale sessions
- Ensure UI consistency

---

## 🧪 Testing / Tools (REFERENCE ONLY)

### Tests
- `/tests/poker-*.test.mjs`
- `/ws-server/*.test.mjs`
- `/ws-tests/`

### Tools
- `/tools/poker-e2e-*.mjs`

### Rule
- DO NOT add new tests unless asked
- Use existing tests for understanding behavior

---

## 🔐 Security / CSP

### Files
- `netlify.toml`
- CSP headers inside functions

### Rules
- Any new script must be CSP-compliant
- If needed → update CSP whitelist

---

## 🎨 CSS System

### Files
- `/css/*.css`

### Rules
- One-line per selector
- No line breaks inside declarations
- Avoid global regressions

---

## 🪵 Logging

### System
- `klog(...)`

### Rule
- NEVER use console.log
- Logs must be copyable from UI/about page

---

## 🚀 Deployment / Runtime

### Environment
- VPS (Ubuntu)
- systemd services:
  - `ws-server.service`
  - `ws-server-preview.service`

### Logs
- `journalctl`

### Rule
- No Docker assumptions unless explicitly present

---

## ⚡ How to Navigate the Code

When solving a problem:

1. Start from feature (UI / poker / XP)
2. Find entry point (JS or function)
3. Trace flow:
   - UI → WS → runtime → shared logic
4. Verify against repo snapshot
5. Implement minimal fix

---

## ❗ Common Pitfalls

- Using DB instead of WS state
- Breaking global CSS
- Missing reconnect edge cases
- Not re-binding UI after DOM updates