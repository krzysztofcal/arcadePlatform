# #1090 — Poker Lobby Welcome Claim

## Outcome
Signed-in eligible players claim Welcome in `/poker/` through the existing generic campaign POST. The banner amount and campaign code come from the shared Welcome/Daily status payload; the reward amount comes exclusively from a confirmed `claimed === true` POST for the unchanged identity.

## Acceptance
- Warm click sends one POST without a prerequisite GET; stale clicks reuse/join the shared status request before selecting the current campaign.
- Pending disables Claim with `PLEASE WAIT…`; double clicks cannot POST twice.
- Confirmed success hides the banner and shows `WELCOME BONUS`, `+<POST amount> CH`, `REWARD CLAIMED` in the existing Daily golden 1800ms treatment, without opening Daily.
- Persistent live status confirms success for reduced motion and hidden documents; no animation when hidden.
- Identity changes reset pending/status/overlay and discard old responses. Shared status refresh cannot race the pending POST; balance/progression retain existing event refresh.
- Denials, already claimed, malformed/uncertain responses and transport failures never celebrate. Authoritative GET disappearance never proves payment. No automatic retry after transport failure.
- Daily, profile and home claims retain their contracts. Only the lobby Welcome routing contract from #1083/#1069 is superseded.

## Scope and safety
Client-only `poker/poker.js`, `poker/index.html`, `poker/poker.css`; no ledger, campaign economy, endpoints, DB, WS, dependencies, inline scripts or Production changes. Browser success is mocked, never evidence of real CH posting. Real Stage/Production awards require separate approval.

## Verification
Existing chips-client cache and bonus-campaign behavior tests, syntax/CSP/structural controls; temporary browser mocks for success, denial, double-click, stale/in-flight cache, timeout, account switch, hidden document, reduced motion and Daily coexistence. Exact-SHA Netlify Preview at 390×844, 320×568, 844×390, 568×320; keyboard/touch and full viewport/timing. No new UI/glue test suite.
