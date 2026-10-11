# Tasks: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), [plan.md](plan.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)  
**Baseline:** `main` (`97f8b8e5`)  
**State:** Architecture Preflight T001–T003 completed. Stop gate active at T002/T003: waiting for owner review and decision on SQL migration design. No migrations created or deployed.

---

## Phase 0 — Preflight & Architecture Stop Gate

- [x] **T001 / Research:** Inspect `agents.md`, `skills.md`, issue #1077, PR #1084; map create/join/bootstrap/bot/retention paths, DB constraints, and existing test coverage.
- [x] **T002 / Mandatory stop gate:** Document safe durable mode identity, ownership, and compatibility proof; identify that DB check constraints require a minimal additive migration; **stop and seek owner GO for SQL migration proposal before creating any files in `supabase/migrations/**`**.
- [x] **T003 / SpecKit:** Author `specs/1077-single-player/{spec,plan,tasks}.md` documenting requirements SP-001–SP-006, the two mandatory product changes (dedicated tables + fail-fast, max buy-in 1000 CH), and the minimal migration design.

---

## Phase 1 — Server & Domain Implementation (Blocked on Owner GO)

- [ ] **T004 / Dedicated create:** In `netlify/functions/poker-quick-seat.mjs::handler()` add mode-specific create fresh table (never select another human's table), while allowing only same-owner same-mode Resume. Reuse `poker-table-init.mjs::createPokerTableWithState()`, current table caps/locks, and bot-funding path. Validate enabled/unlocked `buyIn <= 1000 CH` before creation. Existing Poker Online quick-seat remains unchanged.
- [ ] **T005 / Critical fail-fast gate:** Enforce trusted sole-owner mode, absence of any other human, and `buyIn <= 1000 CH` in `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()` under the locked table, prior to seat/buy-in/bot side effects; validate inconsistent existing-seat rejoin too. Propagate explicit stable rejection via `authoritative-join-adapter.mjs` and `handlers/join.mjs`. No conversion, eviction, silent table switch, or second debit.
- [ ] **T006 / Isolation:** Ensure normal `poker-quick-seat.mjs::selectCandidate()` and `ws-server/server.mjs::buildLobbyTableEntry()` cannot recommend or surface Single Player tables to other users. A Single Player new-play request must never invoke shared-table selection.

---

## Phase 2 — Client & UI Activation (Blocked on Owner GO)

- [ ] **T007 / UI:** Activate `poker/index.html` Single Player CTA and `poker/poker.js::initLobby()` using existing authenticated new dedicated Play / same-mode Resume / navigation patterns; show configured unlocked tiers `<= 1000 CH` and explicit errors when bot pool unavailable or account RESTRICTED. Preserve Poker Online tiers/matchmaking, guests, Daily Bonus, and other Coming Soon cards.

---

## Phase 3 — Fundamental Tests & Local Verification (Blocked on Owner GO)

- [ ] **T008 / Fundamental tests only:** Extend existing authoritative-join/Quick Seat/WS behavior tests:
  - Two distinct authenticated users create distinct dedicated table IDs.
  - Direct/concurrent cross-human admission fails fast with zero seat or financial side effects.
  - Polluted-table owner reconnect fails fast.
  - Legitimate owner Resume has zero second debit.
  - Normal Quick Seat never selects Single Player.
  - Tier <= 1000 CH succeeds; tier > 1000 CH rejected in server create and authoritative join, while Poker Online retains higher tiers.
  - RESTRICTED denied, NORMAL/SLOW bot pool/cap and human retention preserved.
- [ ] **T009 / Verification:** Syntax, CSP guard, focused tests and CI; Netlify Deploy Preview for browser commit with exact SHA, static/portrait/short-landscape smoke.

---

## Phase 4 — Deployment Gates & Handoff (Blocked on Owner GO)

- [ ] **T010 / WS deployment gate:** If WS/shared/protocol changed, report exact runtime SHA and seek owner GO for manual `WS Preview Deploy`; verify exact-SHA WS Preview and approved Stage smoke. No shared WS Preview deploy, Stage writes, or Production deployment without separate GO.
- [ ] **T011 / Handoff:** Self-review, regressions/compatibility/stale-client analysis, and explicit breaking impacts. Submit **Draft PR only**, mark implementation ready but **not merge-ready** until required WS Preview and authenticated smoke are successful. No agent merge.
