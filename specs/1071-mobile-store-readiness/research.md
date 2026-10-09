# Research decisions — #1071

Date: 2026-10-09. Code: `33d0ceceb6f77503e9dd6d4630a09a02f92a23c1` from live `main`. Source register, observations and compliance matrix: [audit report](../../docs/issue-1071-mobile-store-readiness-audit.md).

## R1 — Reuse browser Poker

**Decision**: Web prerequisites first; free Android TWA is the smallest candidate. A narrow shell spike is the conditional route if near-term Android IAP and iOS outweigh free-only packaging simplicity.
**Rationale**: Existing global/IIFE JS, auth bridge and WS recovery are reusable. No native-only game requirement was found. TWA preserves browser origin; a shell must prove changed origin/session behavior.
**Alternatives considered**: Browser/PWA alone does not provide store distribution; TWA supports billing but adds browser-dependent integration; native rebuild duplicates working presentation and transport.

## R2 — No current release clearance

**Decision**: Audit GO; current free and monetized publication NO-GO until owner-gated evidence.
**Rationale**: Lobby has advertising, deletion is documented as email/manual, packaging/device evidence is missing, and no legal/store classification is obtained. Nonredeemable CH is a constraint, not proof of approval.
**Alternatives considered**: Treat no cash-out or a passing browser session as clearance — rejected because policy/legal/packaged lifecycle evidence is separate.

## R3 — Provider-bound purchase ownership

**Decision**: Separate web, Play and StoreKit verification; server-owned identity/catalogue and once-only fulfillment. CH consumable, cosmetics nonconsumable, VIP recurring with real continuing benefits.
**Rationale**: Client callbacks and game snapshots cannot authorize purchases. Arcade-wide CH presents a title-restriction decision before sale.
**Alternatives considered**: Redirect every surface to web checkout or trust client purchase success — rejected without an applicable program/contract and provider verification.

## R4 — Bound physical acceptance

**Decision**: Three proposed browser sessions; actual package smoke later using appropriate BrowserStack app product or owner hardware.
**Rationale**: Existing #1065 process is available; trial minutes should not be consumed for a documentation plan. Browser and package evidence must remain distinct.
**Alternatives considered**: Broad recurring UI suites — prohibited by repository policy and unnecessary for an audit.

## Resolved scope and remaining gates

No unresolved audit-scope clarification remains: the issue is the available agreement; the owner supplied no additional decisions. Product route choice, markets, paid-CH title boundary, legal signoff and technical acceptance remain intentionally pending future gates, not facts invented by this audit. Policy review used primary Google/Apple/MF/UOKiK/GDPR sources dated above. Apple JS-only server documentation is linked as the future integration boundary, not evidence of an implemented API. No billing SDK versions or store minimum build versions are selected; verify them when implementation/submission is authorized.
