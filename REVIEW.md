# REVIEW.md: rules for AI code and plan reviews

Read this file in addition to `AGENTS.md`, `skills.md` and the constitution. It sets how review findings are found, rated and fixed. It does not change any GO gate, merge rule or deployment authority, and a review is never a GO.

## 1. Every finding answers five questions

A finding without these answers is speculation and is rejected.

1. **Who sees the effect?** Only the user who acted, other players, or the whole system.
2. **Does it persist?** It self-heals on the next read or page, or it stays in the DB, device storage, ledger or WS state.
3. **Does it cross a trust boundary?** Another account's data, permissions, money (CH) or poker state.
4. **Does it increase load?** More requests, loops, egress or writes.
5. **How realistic is it?** Normal use, or precise timing such as several tabs, sub-second interleaving or fast back-and-forth changes.

Each finding states a concrete scenario (inputs or sequence → wrong result) and cites the exact file and line, or plan section. An answer may be "not applicable" or "cannot be determined from the material", with one line of reason. A violation of a binding rule (§4) needs no impact analysis: cite the rule and the plan or code passage that breaks it.

## 2. Severity follows from the answers

| Severity | When |
|---|---|
| **P0** | Active Production harm now: money/CH loss, data leak, outage. |
| **P1** | Money/CH, poker state or WS authority, security, data visible to **another** user, persistent data loss or corruption, server-load or egress amplification, a Production failure, anything irreversible. **However rare.** |
| **P2** | Wrong behaviour in normal use that does not self-heal, a transient wrong view for other users, or a contradiction that blocks correct implementation. |
| **P3** | Visible only to the acting user and self-healing on the next read or page, needing unusual timing, or a style or wording issue. |

Apply the table top-down: **P0 and P1 criteria take precedence**. A finding that meets a P0/P1 criterion keeps that rating even when it is brief, self-healing or needs unusual timing; rarity and short duration only distinguish P2 from P3. P2 for "a transient wrong view for other users" applies only when no P1 effect (such as another user's data) is involved.

Example: "the owner briefly sees their own previous avatar in a multi-tab race" is P3. The same race showing one player's photo to **another** player is P1.

The reviewer's severity is a proposal. Before accepting a finding, the coordinator derives the severity again from the five answers and this table, and records any change with a one-line reason. If no P0/P1 criterion applies, an effect that only the acting user sees, that self-heals on the next read or page and that needs unusual timing is P3 (it does not block), whatever label the reviewer gave it.

## 3. High-risk areas: races are at least P2

These areas are the `AGENTS.md` High-Risk Areas: WS reconnect, poker state transitions, table lifecycle, UI ↔ WS sync and global CSS. This file adds the chips ledger and balances, and migrations. A race in any of them is at least P2, and P1 when it can affect money or game state.

"Chips ledger and balances" means stored state: ledger entries, balances and transactions, and the requests that write them. It does not cover how a balance is displayed. A display-only race, such as a top-bar badge briefly hidden or stale for the acting user until the next refresh, is rated by §2 alone (normally P3). The same race showing one account's balance to another account is P1.

## 4. Accepted trade-offs are out of scope within their bounds

When the spec records an OWNER-approved decision with stated limits:
- a finding about the **accepted effect, inside** those limits **and within all binding repository rules**, is not reported again;
- a finding that **exceeds** them is reported and rated normally. For example, a decision says "only the owner" and a scenario shows the effect to someone else;
- a recorded decision never exempts a violation of a binding rule in `AGENTS.md`, `skills.md` or the constitution (for example GO gates, the merge policy, deployment authority, the WS Preview Deploy rule or the testing policy). Those are always reported.

Do not reopen approved decisions, the fundamental-tests-only policy or the scope the OWNER set.

## 5. Proportional fixes

- P2 and P3 findings propose the simplest fix. "Accept and document in the spec" is allowed only for a trade-off that complies with all binding rules; a rule violation is fixed in the plan or code.
- New mechanisms (counters, cross-tab sync, locks, retries, extra endpoints) are for P0 or P1. For P2, propose a small mechanism only when existing code cannot fix the problem and it is the simplest effective fix. Say why.
- Never ask to **add** UI rendering, CSS, layout, JSP-view or simple-glue tests (`AGENTS.md` Testing Policy). Asking for targeted verification with the methods that policy allows (existing preview, E2E, manual checks, optional real-device diagnostics) remains fine.

## 6. What to check by task type

- **Docs and legal texts:** they match real code behaviour, promise nothing the code does not do, and are versioned correctly. Immutable published legal versions are never edited.
- **Frontend (WWW and Android WebView):** CSP and SRI pins, `klog` only, ES5 IIFE globals, no regressions on other pages, application dialogs instead of native `alert`/`confirm`/`prompt`.
- **Netlify functions:** authorization, rate limits, fail-closed errors, idempotency, Supabase egress.
- **WS and poker:** WS is authoritative; check reconnect, event ordering and settlement. Races follow §3.
- **Migrations and SQL:** forward-only, Stage before Production, no accidental migrations, no player data in review material.
- **Ops and runbooks:** GO gates, rollback steps, no secrets, approved procedures only.

## 7. Scope

- Do not review generated files (`*.generated.js`, built bundles) line by line. When a change affects a shipped artifact, check that the artifact was regenerated from the changed source and that its SRI pins match. Do not review the immutable `legal/*.html` versions unless the change targets them.
- Report each issue once, with the highest justified severity.
- If nothing reaches P2, say so plainly. P3 alone does not block a handoff.
