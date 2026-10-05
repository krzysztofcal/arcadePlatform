# Review and evidence

Status: implementation ready, awaiting authenticated Stage verification. Draft [#1049](https://github.com/krzysztofcal/arcadePlatform/pull/1049), never merged.

## Baseline and self-review
Independent branch from main `4f798bdd56dba0e11b34e8982895650920ec6944`; #1047 is not the base. Live #786/#1042 integration requirements reconciled: payment, no-self and Quick Gift behavior remain owned by #1042.

Browser presentation only. No WS/shared runtime/protocol/config, ledger, purchase, settlement calculation, bot bankroll or XP system changes. Existing authoritative `resolveStack`, private-card visibility, reveal timing and reaction occupant/lifecycle checks retained. Chips become bounded numeric stack/bet presentation; existing fly animations use measured DOM anchors. Material visual change: grid seats plus header/controls in flow; narrow/short viewports scroll vertically. Existing Preview FX control moves into header flow. No new inline scripts, dependencies, frameworks or balance cache.

Account refresh uses only existing ChipsClient reads, safe-integer validation, current-table exclusion and auth/table identity plus request generation to suppress stale responses. Missing/error projection yields unavailable, not zero. No local subtraction or gift-specific refresh path.

## Required verification
Passed syntax, check:all, ci:guards, check:csp-inline, migration validation (read-only), diff whitespace review. Existing Poker V2 suite including fundamental Other tables calculation plus static HTML checks: **123/123**. Required GitHub core, Playwright, WS harness, CodeQL and structural validation passed on `2a9e075`.

Existing tests were adapted to new semantic containers and browser DOM move semantics; stale offset/chip-art/XP navigation assertions removed. Exact-path XP checker exemption is limited to Poker Table. No new UI/CSS/JSP tests. Existing lifecycle waiver warnings unchanged.

## Real Deploy Preview
[Preview](https://deploy-preview-1049--playkcswh.netlify.app/poker/table-v2.html), browser SHA **`2a9e07525a81efc9a2b6820efba1d0c7b1b09556`**. Generated BUILD_INFO confirmed SHA; served JS/CSS bytes match this checkout. Evidence: [preview-evidence.json](preview-evidence.json).

20/20 scenarios passed at 1440×1000, 390×844, 320×640 and 844×390: maxSeats=2 with two occupants, six slots with two occupants, all six occupied, dealer at hero/top/side, visible/revealed/folded/next-hand hidden cards, action/best-hand/settlement and reaction/context social presentation. Three populated gift placeholders and quick-action placeholders exercised anchors only, with no purchase behavior. Measured zero overlapping semantic areas, avatars/dealer/quick anchors, seats/board/header/controls; no horizontal overflow. Repeated containment check: all semantic areas remain inside their seat articles. Screenshots visually reviewed. The full matrix uses reduced motion; normal-motion desktop/mobile checks also passed with reaction lifecycle animation enabled. Held wallet/projection responses resolved after sign-out cannot restore values or authenticated HUD. Existing decorative scale and superseded landscape header offsets found by smoke were removed; no z-index/overflow patch.

Four real guest sessions joined the preview WS, receiving helloAck/authOk/commandResult/table_state/stateSnapshot, with no authenticated account values and no JS errors. Controlled signed-in visual checks show Wallet 420 CH · Other tables 100 CH, excluding the current 1235 stack. The earlier refresh probe dispatched on window, so its refetch/error evidence did not validate the canonical document contract. That account evidence is superseded by the P1/P2 review below; layout/guest evidence remains valid. Controlled fixtures do **not** verify real authenticated Stage account reads. Netlify collaboration toolbar excluded from screenshots; preview probes exist only outside the repo.

Actual authenticated Stage balance/projection and tx refresh remain an owner/manual gate; draft/not merge-ready. No WS Preview Deploy needed; no Production mutation or owner GO requested.

## #1047 T012D/T012E contract
- Article: `.poker-seat[data-seat-no][data-user-id]`, authoritative occupant identity.
- Received gifts: `[data-poker-gift-slots]` contains exactly three `[data-poker-gift-slot="0"]`, `"1"`, `"2"`; outside `.poker-seat-avatar` and its overflow:hidden.
- Quick action: exactly one `[data-poker-quick-action-slot]`, outside avatar; 44px reserved area, dedicated full-width row on narrow seats.
- Containers are recreated by renderSeats. #1047 must repopulate/reconcile after render and match seatNo + userId; owner replacement/removal invalidates its target/retry as already specified there.
- #1047 mounts received state/badges and the other-occupied-seat Quick Gift button/picker. It retains one existing purchase/retry/cooldown/sendGift path and no-self enforcement. It dispatches existing chips:tx-complete; #1048 refreshes both account reads through one path.
- Integrate #1047 only after owner integration of #1048 into main. #1042 T012D/E2 remain blocked until those anchors are on main; T013 and Production T014 gates are unaffected.

## Review P1/P2 — canonical event and authoritative wallet pulse

Browser SHA **`696b92fe0dcba4d1820dc1aabcea0f47467e7173`**, confirmed via generated BUILD_INFO and exact served JS/CSS bytes on real Deploy Preview. [wallet-review-evidence.json](wallet-review-evidence.json) supersedes earlier window-dispatch account probes.

P1: existing ChipsClient/topbar/account/poker contract dispatches chips:tx-complete on document, without bubbling. HUD now subscribes directly on document; no second event or window bridge. Controlled browser document.dispatchEvent calls both fetchBalance and fetchPokerProjection again (one initial call each, two after first transaction event). Other tables stays authoritative 100, excluding current stack.

P2: nullable lastRenderedWallet is presentation history for the current identity, never a balance source/cache/service. Only guarded valid fetchBalance results update it. Changed authoritative value adds a 700ms account highlight, cleaned on refresh, identity reset and animationend. First value/error/unchanged/reduced motion do not animate. Identity/sign-out clear history/class. Existing generation/identity guards remain unchanged and execute before any render/history/animation update.

Real preview controlled checks passed at desktop 1440×1000, mobile 390×844 and reduced-motion mobile: initial 500 without pulse; canonical document event refetches 475 and pulses only with normal motion; animation ends/clears; unchanged 475 has no pulse; failed wallet read renders — without pulse; new identity initial 900 has no cross-user pulse; sign-out hides/clears HUD and held stale reads cannot restore balances/animation. Zero JS errors. Pulse screenshots visually reviewed.

Required syntax/check:all/ci:guards/CSP and 123/123 existing/fundamental checks passed; self-review confirms JSP/CSS rules, no new UI tests/inline scripts/dependencies, no endpoint/cache/service, and no local subtraction. No WS/shared runtime/protocol/config changes, no WS Preview Deploy. Authenticated Stage verification still pending; draft/not merge-ready, no merge/Production mutation.
