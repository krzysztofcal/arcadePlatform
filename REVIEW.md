# REVIEW.md: rules for AI code and plan reviews

Read this file in addition to `AGENTS.md`, `skills.md` and the constitution. It sets how review findings are found, rated and fixed. It does not change any GO gate, merge rule or deployment authority, and a review is never a GO.

## 1. Every finding answers five questions

A finding without these answers is speculation and is rejected.

1. **Who sees the effect?** Only the user who acted, other players, or the whole system.
2. **Does it persist?** It self-heals on the next read or page, or it stays in the DB, device storage, ledger or WS state.
3. **Does it cross a trust boundary?** Another account's data, permissions, money (CH) or poker state.
4. **Does it increase load?** More requests, loops, egress or writes.
5. **How realistic is it?** Normal use, or precise timing such as several tabs, sub-second interleaving or fast back-and-forth changes.

Each finding states a concrete scenario (inputs or sequence → wrong result) and cites the exact file and line, or plan section.

## 2. Severity follows from the answers

| Severity | When |
|---|---|
| **P0** | Active Production harm now: money/CH loss, data leak, outage. |
| **P1** | Money/CH, poker state or WS authority, security, data visible to **another** user, persistent data loss or corruption, server-load or egress amplification, a Production failure, anything irreversible. **However rare.** |
| **P2** | Wrong behaviour in normal use that does not self-heal, a transient wrong view for other users, or a contradiction that blocks correct implementation. |
| **P3** | Visible only to the acting user and self-healing on the next read or page, needing unusual timing, or a style or wording issue. |

Example: "the owner briefly sees their own previous avatar in a multi-tab race" is P3. The same race showing one player's photo to **another** player is P1.

## 3. High-risk areas: races are at least P2

These areas come from `AGENTS.md` High-Risk Areas: WS reconnect, poker state transitions, table lifecycle, UI ↔ WS sync, chips ledger and balances, migrations. A race here is P1 when it can affect money or game state.

## 4. Accepted trade-offs are out of scope within their bounds

When the spec records an OWNER-approved decision with stated limits:
- a finding **inside** those limits is not reported again;
- a finding that **exceeds** them is reported and rated normally. For example, a decision says "only the owner" and a scenario shows the effect to someone else.

Do not reopen approved decisions, the fundamental-tests-only policy or the scope the OWNER set.

## 5. Proportional fixes

- P2 and P3 findings propose the simplest fix, or "accept and document in the spec".
- New mechanisms (counters, cross-tab sync, locks, retries, extra endpoints) may be proposed only for P0 or P1.
- Never ask for UI rendering, CSS, layout, JSP-view or simple-glue tests (`AGENTS.md` Testing Policy).

## 6. What to check by task type

- **Docs and legal texts:** they match real code behaviour, promise nothing the code does not do, and are versioned correctly. Immutable published legal versions are never edited.
- **Frontend (WWW and Android WebView):** CSP and SRI pins, `klog` only, ES5 IIFE globals, no regressions on other pages, application dialogs instead of native `alert`/`confirm`/`prompt`.
- **Netlify functions:** authorization, rate limits, fail-closed errors, idempotency, Supabase egress.
- **WS and poker:** WS is authoritative; check reconnect, event ordering and settlement. Races follow §3.
- **Migrations and SQL:** forward-only, Stage before Production, no accidental migrations, no player data in review material.
- **Ops and runbooks:** GO gates, rollback steps, no secrets, approved procedures only.

## 7. Scope

- Skip generated files (`*.generated.js`, built bundles) and the immutable `legal/*.html` versions unless the change targets them.
- Report each issue once, with the highest justified severity.
- If nothing reaches P2, say so plainly. P3 alone does not block a handoff.
