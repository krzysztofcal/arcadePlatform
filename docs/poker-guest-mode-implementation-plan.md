# Poker Guest Mode - implementation plan

Status: analysis only. Initial code verification was done against `origin/main` at `dee7f2563c8e0a1161edd4797df0e039865f3c79`; the PR branch was later rebased onto `origin/main` at `448d662168f6c66cc8319c8e9ff659577f62ff12`.

## Feasibility

Guest Mode is implementable in the current architecture, but it should be implemented as an isolated poker runtime path, not as a fake Supabase user and not through the normal chip ledger flow.

The current main-branch flow is account-first:

- `poker/index.html` hides the lobby behind `pokerAuthMsg` and only shows `pokerLobbyContent` after `SupabaseAuthBridge.getAccessToken()`.
- `poker/poker.js` uses `authedFetch()` for `poker-quick-seat` and `poker-create-table`; both require a Supabase bearer token.
- `netlify/functions/ws-mint-token.mjs` only mints normal user WS tokens after verifying a Supabase JWT, except for admin minting.
- `ws-server/poker/handlers/auth.mjs` binds a WS connection to exactly one `session.userId`.
- `ws-server/poker/handlers/join.mjs` uses authoritative join when DB persistence is enabled.
- `ws-server/poker/persistence/authoritative-join-adapter.mjs` delegates to `shared/poker-domain/join.mjs`, which writes `poker_seats`, applies `TABLE_BUY_IN`, and syncs persisted poker state.
- Bot autoplay already exists in `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs` and can be reused once a guest-only table is materialized in runtime state.

Conclusion: PR1 is not just a UI toggle. A guest cannot reach real poker today because token minting, lobby, quick-seat, and join are all account-bound. The simplest safe path is to add guest WS tokens and guest-only ephemeral tables in `ws-server/`, while leaving existing authenticated DB/ledger tables unchanged.

## Key implementation decision

Guest tables should be in-memory WS tables with IDs prefixed by `guest_`. They must not be inserted into `public.poker_tables`, must not create `poker_seats`, and must not post chip ledger entries. This keeps the Arcade economy isolated and avoids treating the database as source of truth for guest poker.

Registration upgrade must not convert guest chips into persisted currency. If a guest creates an account mid-hand, the current guest table can keep running and the seat can be relabeled/rebound to the real account, but the table remains economy-isolated until it ends. Future tables use the normal authenticated profile and ledger.

To make the conversion feel fair without weakening economy isolation, the Guest -> Account flow should include a one-time welcome bonus for newly registered accounts, for example `500 CH`. The bonus is independent of guest chip winnings: guest chips still expire with the guest session, while the new account starts normal play with a real CH wallet, XP, rankings, achievements, game history, and daily rewards.

Welcome bonus rules:

- Award the bonus only once per newly created account.
- Do not base the bonus on the number of guest chips won or lost.
- Never transfer guest chips into the real account.
- Grant the bonus through the normal CH ledger as a dedicated welcome-bonus transaction type or an equivalent idempotent ledger entry.
- Make the bonus idempotent with a stable key such as `welcome-bonus:<userId>`.

## PR1 - Guest Mode foundation

Goal: anonymous visitors can start a real bot-only poker table in one click.

Backend tasks:

- Add `netlify/functions/poker-guest-session.mjs`.
- Generate `guestId` as `guest_<randomUUID>` and `nickname` as `Guest####`.
- Mint a short-lived HS256 WS token with payload fields such as `sub`, `mode: "guest"`, `nickname`, `iat`, and `exp`.
- Reuse `WS_AUTH_HS256_SECRET` for signing so `ws-server/poker/auth/verify-token.mjs` can validate the token after it is extended to return `mode` and `nickname`.
- Keep the endpoint CORS behavior aligned with `netlify/functions/ws-mint-token.mjs`.

WS tasks:

- Extend `ws-server/poker/auth/verify-token.mjs` to parse and validate token `exp`; current verification checks signature and `sub`, but does not reject expired WS tokens.
- Extend `ws-server/poker/handlers/auth.mjs` and `ws-server/poker/runtime/session.mjs` so `connState.session` carries `identityMode: "user" | "guest"` and `nickname`.
- Add a guest-only command path in `ws-server/server.mjs`, preferably a dedicated handler such as `ws-server/poker/handlers/guest-join.mjs`.
- Guest join must only accept `guest_` table IDs, create/runtime-materialize that table if missing, seat the guest, seed bot seats, bootstrap the hand, and schedule bot autoplay.
- Reject guest attempts to join non-guest/multiplayer tables with a clear `guest_multiplayer_requires_account` reason.

Poker runtime tasks:

- Add a small helper in `ws-server/poker/table/table-manager.mjs` to materialize a guest table with bot seats and stacks, reusing existing core state shape and bot metadata (`seatDetailsByUserId.isBot`).
- Avoid the authoritative join adapter for guest tables.
- Ensure `persistMutatedState()` is not called for guest tables, or make it a no-op for `guest_` table IDs.

UI tasks:

- Update `poker/index.html` and `poker/poker.js` so signed-out users see `Play as Guest` and `Sign in / Create account`.
- `Play as Guest` calls `poker-guest-session`, stores only session-scoped guest metadata, and navigates to `/poker/table-v2.html?tableId=<guestId>&guest=1&autojoin=1`.
- Update `poker/poker-ws-client.js` to support `guestToken` or a `mintToken` override so it does not call `ws-mint-token` with a missing Supabase token.
- Update `poker/poker-v2.js` to start live mode with the guest token when `guest=1`, and to display a `Guest account` badge.

Acceptance mapping:

- One-click guest play is possible from the signed-out lobby.
- Existing authenticated lobby, quick-seat, create-table, and table join continue to use the current Supabase/ledger path.

## PR2 - Guest restrictions and economy isolation

Goal: guests never affect Arcade economy.

Backend tasks:

- Add guard helpers, for example `isGuestTableId(tableId)` and `isGuestSession(connState)`, in a shared WS utility file.
- In `handleJoinCommand`, `handleActCommand`, `handleStartHandCommand`, `handleLeaveCommand`, timeout handling, bot autoplay, and settlement paths, ensure guest tables never call ledger-backed persistence.
- Ensure guest action audit is not written to persistent audit tables.
- Ensure guest tables are omitted from lobby broadcasts and any persisted table listing.

Frontend tasks:

- Hide or disable XP and chip balance UI for guest poker sessions.
- Add a persistent information panel on `poker/table-v2.html` for guest sessions:
  - `Guest account`
  - `Play Poker`
  - `Learn the game`
  - `No saved chips`
  - `No XP`
  - `No achievements`
  - `No rankings`
  - `Multiplayer requires account`

Integration checks:

- `js/topbar.js` already hides chip badge when `html[data-auth="out"]`; keep guest mode aligned with signed-out auth state.
- XP is awarded through `js/xpClient.js`, `js/xp-game-hook.js`, and `netlify/functions/award-xp.mjs`; guest poker must not call those paths.

## PR3 - Registration upgrade flow

Goal: guest can register without leaving the current table or interrupting the hand.

Important constraint:

- Do not convert guest chips into real chips. The current guest table remains economy-isolated after registration. The account is used for identity from that point forward, and future games use the normal account profile.

Backend tasks:

- Add a WS command such as `upgrade_guest`.
- Client sends the real Supabase access token after registration.
- Server verifies it using the same Supabase JWT verification logic used by `netlify/functions/ws-mint-token.mjs`, or calls a small shared verifier module.
- Add a controlled session upgrade path in `ws-server/poker/runtime/session.mjs`; current `bindSessionUser()` rejects changing `session.userId`, so do not reuse it blindly.
- Add `tableManager.upgradeGuestIdentity({ tableId, guestUserId, realUserId, nickname })`.
- The table manager must replace the user ID in:
  - `coreState.members`
  - `coreState.seats`
  - `coreState.publicStacks`
  - `coreState.pokerState.seats`
  - `coreState.pokerState.stacks`
  - action maps such as `foldedByUserId`, `contributionsByUserId`, `lastBettingRoundActionByUserId`, `holeCardsByUserId`, and related per-user maps
  - presence maps and connection/session tracking
- Broadcast a normal state snapshot after upgrade.

UI tasks:

- Add `Create account` action to guest table panel.
- Reuse `/account.html` and existing `SupabaseAuth.onAuthChange`.
- After `SIGNED_IN`, call `upgrade_guest` instead of reloading the table.
- Update current user ID locally after upgrade so action buttons still work.
- Award a one-time welcome bonus after successful account creation, for example `500 CH`, through the existing CH ledger.
- Ensure the welcome bonus is idempotent and account-scoped; it must not depend on the guest session stack or guest hand outcomes.
- Show clear copy before registration, for example: `Create a free account and get 500 CH to start. Guest chips are temporary and disappear after the session. An account gives you a persistent CH wallet, XP, rankings, game history, achievements, and daily rewards.`

Risk:

- This is the highest-risk PR because user ID is a primary key throughout the live poker state. It needs careful state-map replacement. It is feasible, but should not be mixed with PR1/PR2.

## PR4 - Smart conversion prompts

Goal: encourage account creation without modal interruption.

WS/UI event source:

- Use snapshots in `poker/poker-v2.js`; detect transition into showdown/settled state and winning state from existing snapshot payloads.
- Track prompt state in memory/session storage so it is shown at most once per guest session.

Tasks:

- Add a dismissible non-modal banner component to `poker/table-v2.html`.
- Trigger for guest sessions after:
  - first showdown
  - first win
  - five completed hands
  - attempting multiplayer/opening normal lobby action
- The multiplayer trigger should reuse the same banner rather than opening a modal.
- Keep copy short and registration-oriented.
- Include the welcome-bonus value in conversion copy, for example: `Create a free account and get 500 CH to start.`

## PR5 - Dedicated Guest landing experience

Goal: make guest onboarding clear before the first click.

Tasks:

- Update `poker/index.html` signed-out state from a blocked-auth message to a guest/account choice.
- Keep authenticated lobby unchanged.
- Add a comparison section in the signed-out lobby:
  - Guest: poker vs bots only
  - Account: multiplayer, saved chips, XP, achievements, rankings
- Add the welcome-bonus message to the account side of the comparison, making clear that guest chips are temporary and the account bonus is a separate one-time grant.
- Update `poker/poker.css` only with one selector per line and single-line declarations, following the project CSS constraint.
- Avoid inline scripts. If an inline script is unavoidable, update CSP hashes per `docs/csp-implementation.md`.

## PR6 - Guest analytics (optional)

Goal: measure onboarding without collecting personal data.

Tasks:

- Add a small guest analytics helper, preferably client-side first, that follows existing analytics conventions in `js/analytics.js`.
- Events:
  - `guest_session_started`
  - `guest_hand_completed`
  - `guest_conversion_started`
  - `guest_conversion_completed`
  - `guest_session_abandoned`
- Include anonymous fields only: guest session ID hash or random analytics ID, hand count, elapsed bucket, and conversion flag.
- Do not send hole cards, actions, chip stacks, email, Supabase user ID, or IP-derived identifiers.

## Recommended PR boundaries

1. PR1: guest token/session, guest-only WS table path, signed-out one-click entry.
2. PR2: economy isolation guards and guest limitations UI.
3. PR3: guest-to-account upgrade in-place.
4. PR4: non-modal conversion prompts.
5. PR5: polished guest landing/comparison.
6. PR6: optional analytics.

Each PR should start from latest `main` and should not depend on unmerged work outside the earlier guest-mode PRs.

## Breaking impact assessment

No breaking impact is expected if guest logic is gated by `identityMode === "guest"` and `guest_` table IDs. The main regression risks are:

- accidentally routing guest join through `executePokerJoinAuthoritative()` and writing ledger entries;
- accidentally allowing guest tokens into normal multiplayer tables;
- changing `bindSessionUser()` in a way that weakens normal authenticated session locking;
- persisting guest table state through `persistMutatedState()`;
- showing XP/chip UI for guests in a way that implies rewards are saved.

## Test note

The story says not to write tests unless explicitly requested. If tests are requested later, the minimum useful coverage is WS unit/behavior coverage for guest auth, guest join rejection on normal tables, no-op persistence for guest tables, and in-place guest identity upgrade.
