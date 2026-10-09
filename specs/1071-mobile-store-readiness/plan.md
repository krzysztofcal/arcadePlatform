# Implementation Plan: Poker mobile store readiness audit

**Branch**: `docs/1071-mobile-readiness` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

## Summary

Deliver a documentation audit of current browser Poker and dated store/legal requirements. Recommend a browser-preserving free Android TWA pilot after web prerequisites; choose a narrow Capacitor-style shell for a later monetized Android/iOS path only after an auth/billing feasibility spike. No native game rewrite or billing implementation in this issue. Main report: [mobile readiness audit](../../docs/issue-1071-mobile-store-readiness-audit.md).

## Technical Context

**Language/Version**: Existing HTML/CSS and global/IIFE browser JS; Markdown deliverables.
**Primary Dependencies**: Existing Supabase Auth, Netlify HTTP adapters, authoritative WS runtime; no dependency additions.
**Storage**: Existing CH/account/game persistence inspected conceptually; no queries or changes.
**Testing**: Documentation consistency, local links, scoped diff and SpecKit prerequisite scripts. Physical-device and billing scenarios are proposed, not executed.
**Target Platform**: Android first, iOS later; Poland proposed initial release market.
**Project Type**: Documentation-only audit and future release plan.
**Performance Goals**: Record cold-load transferred bytes/time and recovery timing in a future bounded device smoke; no fabricated current benchmarks.
**Constraints**: JSP-compatible scripts; no ads in intended mobile experience; no live money, registration, submission, migrations or environment changes.
**Scale/Scope**: Lobby, table V2 and reachable authentication/legal/profile/navigation surfaces. Wider Arcade excluded only if future navigation actually enforces that boundary.

## Constitution Check

PASS before research and after design: documentation only, existing mechanisms retained, WS remains authoritative, no environment mutations, no new frameworks/configuration/dependencies or broad tests. `.specify/feature.json` selects this documentation feature and is local ignored feature-selection metadata. No migration means no intended shared Stage effect. No WS deploy is required for this diff. Actual future WS/protocol work retains the repository's exact-revision deployment gate. Production and each release remain separately authorized. No Git commands in SpecKit artifacts. No extension hook configuration exists in this revision.

## Project Structure

- `docs/issue-1071-mobile-store-readiness-audit.md`: findings, route and compliance matrix, source register, release gates and product-breaking changes.
- `specs/1071-mobile-store-readiness/{spec,plan,research,data-model,quickstart,tasks}.md`: scope, decisions, conceptual ownership, validation and handoff.
- `specs/1071-mobile-store-readiness/contracts/release-boundaries.md`: proposed purchase/release interface obligations; no new endpoints.
- `specs/1071-mobile-store-readiness/checklists/requirements.md`: audit acceptance evidence.

Inspected existing surfaces: `poker/index.html`, `poker/table-v2.html`, `poker/poker-v2.js` (`rememberSeatForReconnect()`, `rejoinSeatAfterReconnect()`, `resumePendingJoinOperation()`), `poker/poker-ws-client.js` (`createClient()`), `poker/poker-v2.css`, `js/auth/supabaseClient.js` (`getClient()`, `getAccessToken()`, `getAuthRedirectTo()`), `js/account-page.js`, `js/chips/client.js`, `_headers`, `netlify.toml`, `legal/`, `docs/license-audit.md`, `docs/browserstack-real-device-testing.md`.

## Delivery and dependencies

1. Pin live `main`, inspect the above paths, record observations and missing runtime evidence.
2. Verify primary store/legal/packaging sources; distinguish policy from architecture recommendations.
3. Record recommendation, conceptual purchase boundaries, smoke matrix and free/monetized gates.
4. Validate artifact coverage/links/scope; publish documentation Draft PR.
5. Handoff future owner-approved work in this order: product/legal decision → web/mobile prerequisites → packaging spike → bounded device evidence → free release decision. Monetization depends on an additional provider verification/reconciliation design and sandbox acceptance. iOS packaging and review evidence form a separate branch of the release plan.

Do not execute future release tasks as part of this documentation plan. Gate owners and required outputs are named in the report; no future task is a store approval.
