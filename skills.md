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
- Only fundamental, deterministic tests for critical logic
- Prefer extending existing test files
- No broad or speculative test suites
- No UI rendering, CSS/layout, JSP-view, or simple-glue test suites
- Use existing tests for understanding behavior

---

## Real-device browser validation

- See [BrowserStack real-device testing](docs/browserstack-real-device-testing.md) for the proven physical-mobile workflow, MCP limitations, security and quota guidance.
- BrowserStack Automate + Selenium/WebDriver is the available path for automated real-device mobile browser verification; Live supports manual validation.
- Use it for targeted optional diagnostics, preserving the fundamental-tests-only policy and the exact-SHA WS Preview Deploy gate.

---

## ✉️ Supabase Auth / Email Testing (MANDATORY)

### Files
- `/js/auth/supabaseClient.js`
- `/js/account-page.js`
- `/tests/account-auth.contract.test.mjs`

### Rules
- CI/unit/fundamental tests must mock email delivery or use isolated local fixtures; never send real transactional emails by default.
- Real Stage Auth email E2E requires an explicit, narrowly scoped test approval and a verified, operator-controlled receiving inbox (or an approved mail-testing sink); do not run it automatically on every PR.
- Never invent recipients under `kcswh.pl` or other real domains without confirming the exact mailbox/alias or a functioning catch-all. Reserved domains (e.g. `example.invalid`) are only for tests that cannot trigger real delivery.
- Test signup, recovery, magic link and reauthentication without delivery whenever delivery itself is not the behavior under test. Bound real sends and retries to the provider quota and cooldown.
- Treat `mail.send` as an attempt, not proof of delivery; distinguish provider rate limits (HTTP 429) and invalid-address rejection (HTTP 400) from confirmed delivery bounces.
- On bounce warnings, inspect project identity, Auth logs, sending recipients and provider delivery metrics before changing SMTP/production settings; if bounce details are unavailable, mark the root cause unconfirmed.
- Keep credentials, OTPs, confirmation URLs and private recipient details out of source control and logs.

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
- Production WS logs:
  - `journalctl -u ws-server.service`
- Preview WS logs:
  - `journalctl -u ws-server-preview.service`
- For live debugging, add `-f`; for recent bounded output, add `--no-pager -n 200`.

### Rule
- No Docker assumptions unless explicitly present
- When investigating WS preview or production behavior, check the relevant journald service before inferring from code alone.

---

## ⚡ How to Navigate the Code

When solving a problem:

1. Start from feature (UI / poker / XP)
2. Find entry point (JS or function)
3. Trace flow:
   - UI → WS → runtime → shared logic
4. Verify against the live GitHub repository; use a repo snapshot only as a
   historical/offline fallback
5. Implement minimal fix

---

## 🧹 YAGNI / Removing unused code (MANDATORY)

- Start with existing working mechanisms (especially Stage counterparts); justify and explicitly review any new Production-specific infrastructure or identity.
- When replacing a mechanism, remove the unused code paths, configuration, scripts, tests, documentation and deployment artifacts in the same change. Do not keep unused fallback or compatibility code "just in case".
- Check actual references and runtime/CI usage before deletion; preserve required financial/security guards, immutable migrations and audit/recovery evidence.
- Prefer one supported operational path, minimal dependencies and only fundamental tests for functionality that remains. Document breaking impacts and any cleanup requiring separate operator approval.

---

## ❗ Common Pitfalls

- Using DB instead of WS state
- Breaking global CSS
- Missing reconnect edge cases
- Not re-binding UI after DOM updates
