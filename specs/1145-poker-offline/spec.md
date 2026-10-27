# Current scope: T001–T008 implemented; review-ready, physical Android acceptance pending

The T002 boundary below is historical. The approved continuation at the end supersedes its stop/non-goals.

# #1145 — T001/T002 bounded Offline spike

Baseline: origin/main 6ecbc8a3; read agents.md, skills.md and full issue including owner amendments on 2026-10-24.

Deliver one browser hand: human + two bots, accepted rules, legal V2 controls, showdown and payout. Reuse V2 DOM/theme/renderer and WS strategy source. Independent generated entrypoint; no WS/Auth/Supabase/API bootstrap, telemetry or storage. Disconnect after asset load and prove no attempted remote transport during play and after reconnect. No wallet, persistence, lobby, reactions, audio, Android release, PWA/service worker, migration, WS or Production deployment. Stop for owner review after T002.

Acceptance: real reducer accepts each action; at least one hand reaches five-card showdown and settlement; chips conserved; one focused deterministic shared-strategy test; browser network evidence and Draft PR/Deploy Preview. A fold ending is legal but insufficient for showdown evidence.

## Architecture preflight
- `ws-server/server.mjs::loadAcceptedBotAutoplayExecutor` loads `runtime/accepted-bot-autoplay-adapter.mjs::createAcceptedBotStepExecutor (Autoplay alias)`. Human `handleActCommand` → `table/table-manager.mjs::applyAction` uses `engine/poker-engine.mjs::applyCoreStateAction` → `shared/poker-action-reducer.mjs::applyAction`; accepted bot adapter also calls that reducer. Legacy snapshot-runtime remains a conditional compatibility path; do not use it as Offline rules.
- `engine/poker-engine.mjs::buildBootstrappedPokerState` supplies deal/blinds. `shared/poker-primitives.mjs::deriveDeck` uses synchronous node:crypto SHA-256 then xorshift shuffle; `computeSharedLegalActions` is canonical legality.
- Reducer settlement calls `shared/settlement/poker-materialize-showdown.mjs::materializeShowdownAndPayout`, `poker-showdown.mjs::computeShowdown`, `poker-payout.mjs::awardPotsAtShowdown`, evaluator and side pots. Pure modules, no DB needed.
- Actual accepted bot strategy: adapter's `chooseBotActionProfiled`, `enrichBotLegalActions`, strength thresholds TIGHT/NORMAL/LOOSE. `netlify/functions/_shared/poker-bots.mjs` is related legacy logic, not the chosen WS strategy dependency. Move existing pure block without algorithm changes; WS imports same exported functions as browser.
- Node boundary: primitives crypto hash; engine has createHash/Buffer for other operations. Bundle only bootstrap and reducer; browser crypto adapter precomputes the exact hand-seed digest with Web Crypto before synchronous deal. No replacement poker logic or changed WS shuffle. No embedded WS runtime or persistence/admission code.
- V2 `mergeSnapshot(payload, frame)` consumes table/seats/stacks, hand status/id/dealer, turn, pot, board, private hole cards, legal actions/constraints, showdown/handSettlement. `render()` draws existing table. `handleAction` → `sendCommand` is transport seam; `init` normally initializes auth/live clients. Reuse `read-model/room-core-snapshot.mjs::projectRoomCoreSnapshot` for the real WS projection, including revealed compared hands; add only table/version envelope. Generate isolated renderer from same source with explicit PoC seams, leaving Online source untouched.
- `poker/index.html`/`poker.js` are online lobby/routing: no changes in this slice. `mobile/poker/package-web.mjs` (#1139) packages online pages and recursively poker/assets; no packaging changes now. Themes: fresh local UUID, existing resolveTableThemeId/applyTableTheme; no persistence until separately authorized T003.

## Risk / stop criterion
Moderate WS regression risk from moving strategy functions (import/source-sensitive tests); rules and protocol unchanged. Netlify green is not WS runtime evidence. Exact latest runtime SHA requires manual WS Preview Deploy using workflow definition main and application ref SHA plus relevant Online/Single Player smoke before merge readiness. No WS deploy in T001/T002. Stop if this needs a major Online engine rewrite; current pure imports permit bounded extraction.

## Approved continuation — T003–T008 (2026-10-25)

Owner authorizes completing the existing PR, superseding the T002 stop/non-goals above. Merge current main without rewriting history; preserve #1149 one-step FIFO fairness, #1151 authoritative Leave/recovery, #1153 system-owner guard and common strategy. No World Tour/Seasons/PWA/service worker, migrations, remote financial operations, Production or PR merge.

Local session uses canonical bootstrap/rollover/reducer/settlement/legality and shared NORMAL strategy. Start5000 PC, fixed100/500/1000 PC buy-ins, free refill to at least5000. One versioned localStorage record `arcade.poker.offline.v1` atomically stores wallet/session/revision; synchronous read-modify-write and revision check across asynchronous deal prevent stale writes. Storage errors fail closed, no online fallback. Reset explicitly discards only local practice. Bots replenish only when broke between hands; this is explicit local play funding, never CH. Human Leave folds/resolves current hand canonically before refunding stack once. Reload resumes each committed action; next-hand button advances dealer via canonical rollover. No automatic human timeout fold in Offline.

Existing lobby is shared; its independent Offline card needs neither login nor successful online bootstrap. Isolated generated play.html excludes all online/auth/log/analytics scripts and blocks connections/frames/forms with CSP. Reuse V2 renderer source/controls/themes/animations/social catalog, hide paid gifts and online wallet. Fresh local tableId for New Game; persisted ID/theme for Resume. Practice never enters shared profile, CH cache, telemetry or sync, even after reconnect. Audio remains separate #1146; no new audio engine.

Acceptance: deterministic fundamental sessions, legality/conservation, atomic failure/concurrency, Resume/idempotent Leave, output privacy; relevant existing WS tests/parity. Netlify disconnected after load through real controls and restored-network silence. Package same assets for Android cold airplane launch. Physical device acceptance pending if no device; implementation review-ready does not imply merge-ready without required exact-SHA WS evidence and device acceptance.

## Review clarification — Back versus Leave

Normal Back to lobby, including native Android Back, parks the committed local session unchanged for Resume; it does not invoke Leave or cashout. Only explicit Leave settles/refunds/closes it. Reuse V2 bindMenu/settings through the generator; no Online menu/transport changes.

## Physical owner review — T009–T012 (2026-10-25)

Galaxy S24+ owner PASS: airplane-mode play, several complete hands, human actions, Resume and Leave. Rebuy/Refill were NOT VERIFIED on the physical device. Geometry cropped Hero cards in portrait/landscape; this owner finding supersedes browser-only presentation acceptance.

T009: remove the extra row before the full-height V2 scene. Local balance uses existing account HUD; local rebuy/refill live in existing menu and existing bust panel. Original V2 source/layout/theme catalog remains single-source and Online CSS untouched. Android Offline uses the existing native table-mode inset owner, same safe-area substitutions and mobile stylesheet; packaging rehashes transformed renderer SRI/CSP.

T010: persist a three-second result budget; canonical next-hand rollover automatically starts once, stops if human stack<2. Explicit local rebuy/refill/Leave offered; no automatic PC purchase. No Next Hand button.

T011: stamp canonical turn deadlines, Hero20s and canonical timeout CHECK/FOLD; each bot action delayed randomly1000–2000ms. Reuse V2 avatar clock rendering and clock interval. All callbacks/action mutations use Web Locks and matching table/hand/actor/revision tokens; manual actions use last published snapshot token. Back/background park clocks and persist remaining budget (minimum1s); Resume excludes elapsed closed-app time, including unclean process death (last committed remaining budget restored). Repeated lifecycle events do not repeatedly restart active clocks. v1 key/schema unchanged: absent clock lazily initialized on Resume, IDs/stacks/PC preserved.

T012: replace system confirm with local dialog using existing Poker modal patterns. New Game/Reset require explicit confirmation; Cancel/Escape/Android Back cancel without mutation. Explicit Leave keeps existing confirmation and same cancellation behavior. Dialog/clock operations remain local; no Auth/WS/CH/telemetry.

## T013–T014 physical follow-up

Owner Galaxy S24+ PASS retained: airplane mode, portrait/landscape framing, Hero cards, auto-next, dialogs, Back/Resume and other exercised scenarios. T013 corrects the bot clock: every live turn is20s, while independent bot decision is scheduled1000–2000ms after start. At/after20s canonical CHECK/FOLD takes priority over strategy. Both budgets pause/resume and remain durable/token-guarded; settlement remains3s.

T014 samples only at New Game with existing computeTargetBotCount(maxPlayers6,humanCount1,minBots2,maxBots5), matching first-human Online JOIN selection without importing admission/funding. Persist3–6 members including Hero, stable IDs/seats/stacks/theme through session/Resume. Only Hero debits PC wallet; every bot starts at the selected buy-in. v1 without members infers its original2bots, and old short bot clocks lazily upgrade on Resume without moving wallet/stacks/cards/hand/table. No spontaneous membership changes or replacement implementation.

## T015–T016 current owner decision

T013–T014 physical S24+ PASS retained. One Poker V2 UX: restore original four off-turn checkbox wrappers from table-v2.html and invoke existing queued preaction execution after snapshot merge. Use canonical projectedLegalActions and existing build/resolve/sync/maybeExecute functions; do not fork rules or authenticate a local player. Queue is volatile renderer state, never wallet/session JSON. Selection waits for Hero; legal execution shares Web Locks and rendered revision/hand/actor guards with manual actions/timers. Invalid intent/changed hand cancels; park/Leave clears queue and lifecycle epoch fences any already queued callback so Resume cannot revive it.

Visible currency is **Offline Chips**, superseding every earlier Practice Chips UI requirement; PC identifiers/key/schema unchanged. Mode is Poker Offline/OFFLINE, same lobby quick-tier/tile-action/Resume and secondary button components, same V2 typography/action slider/checkboxes/menu/modals/animations. No native radio controls or custom Practice skin. Discreet local/independent-online-CH disclosure. Free Refill/Rebuy/Reset Offline Progress remain; paid gifts/Auth/WS/Supabase/remote XP/CH sync remain absent. Existing issue #1145 updated to this authoritative decision.

## T017 — confirmed Back navigation

Owner S24+ physical PASS for T015–T016 retained. Both menu Back and native Android Back use existing local styled dialog: title `Return to lobby?`, message `Your Offline game will be saved. You can continue later using Resume.`, buttons `Keep playing` / `Return to lobby`. Park clocks and clear volatile preactions before showing it. Cancel/Escape/repeat Back resume exact saved budgets, Confirm stays parked and navigates without cashout. Foreground events must not start timers behind an open confirmation. Single-flight covers pending pause, visible modal and confirmed navigation. Explicit Leave remains separate and settles/refunds only after its existing confirmation. Earlier immediate Back behavior is superseded; wallet key/schema and all game data unchanged.

## T018–T019 — Android launch and Offline key art

Owner physical acceptance T001–T017 retained. Stage Android starts with a branded dark native splash followed by an immediately styled local loading screen. No white default page, raw hyperlink or unstyled lobby. Reveal lobby only after bundled styles, fonts, main tile images and layout frames are ready; no dependency on authentication or network. Native cold-start appearance requires physical owner confirmation. Poker Offline gets its own portable-table teal/gold artwork; Single Player retains the robot. No engine, WS, wallet, data schema or Online behavior changes.

## T020–T021 — packaged navigation and production-quality status UX

All local Offline exits (confirmed Back, explicit Leave, Reset, no-session fallback, rebuy exit/link) use canonical `/poker/index.html` supported by both Android assets and Netlify. Do not depend on directory-index hosting. Loader must redirect legacy extensionless paths to real lobby instead of hiding over the entry document. Preserve paused session/remaining time/Resume and idempotent cashout. No restart workaround. Normal mobile startup/connectivity changes must not create Stage PoC/SHA/status banners; keep auth feedback and actionable failures in Account status or contextual error UI, engineering details in klog. No WS, PC ledger/schema or Online changes. Physical Android re-test pending owner.

## T022 — Automatic Offline Chips Refill (authoritative replacement)

Supersedes earlier manual/conditional Free Refill UI requirements. Wallet below100 is replenished to5000 atomically with local mutation or at startup under existing Web Lock/revision guard. Wallet100orabove unchanged. read() remains pure. Never replenish Hero stack or trigger Rebuy automatically; canonical buy-ins/rules/settlement unaffected. Low-wallet valid v1 records recover without migration. Buy-in100 remains possible, including a debit that triggers refill in the same commit.

Lobby retains Offline balance,100/500/1000tiers, Play/New Game and Resume only; remove local/online disclosure, refill/reset buttons and clearing-data copy there. Table settings contain Reset Offline Progress with existing confirmation plus device-local/independent-online-CH and data-clearing disclosure. No visible manual refill anywhere, no extra modal/control near Join. Reset semantics, canonical lobby exits and current splash/artwork retained. No WS/CH/XP/network/sync/schema changes.

## T023 — recovery for invalid Offline storage

Lobby has an emergency Reset Offline Progress button hidden by default beside offlineError. Only errors tagged from invalid/corrupt/unsupported Offline read validation reveal it; healthy records and action/quota/lock errors do not. Existing custom Reset confirmation and one shared handler serve lobby recovery and Table settings. Handler uses existing STORAGE_KEY Web Lock directly, without run()/game.read(), removes only that key after Confirm and navigates /poker/index.html. Cancel never removes storage. Normal startup after reset reads default5000 and can play. Preserve other app data/online CH and auto-refill T022. No automatic deletion/migration or new normal-lobby control.

## T024 — table readiness without theme flash

Owner physical T023 PASS retained. Reuse existing Loading table splash/hidden table for New Game and Resume. First paused snapshot, actual theme/common image decode, rendered avatars/cards/HUD and layout frames must precede markBootReady. Resume actor clocks only after reveal; saved budget unchanged by graphics wait. New Game pauses before navigation. No artificial readiness sleep, Auth/WS/remote wait, new loader/framework or Online behavior change. Existing15s image-failure bound resolves stable Classic fallback without late theme activation. markBootReady stays once per document init. Canonical Back/Reset/Resume,20s actor/1–2s bot/3s rollover unchanged.


## T025 — accepted Offline / pending WS integration gate

Owner confirmed T024 physical Galaxy S24+ PASS on source 8c05fc11b00586e8944480dec76bfd6b4cd3882c; all reported Offline issues accepted. No further cosmetics. Final read-only preflight retains Draft and issue #1145 open. Current main 892661f44f4e9fdbe3df24f0553fa1191bf1752e is an ancestor. Required remaining work is a separately authorized bounded exact-SHA WS Preview Online/Single Player/reconnect smoke, not another Offline campaign. Production merge/deployment remain unauthorized; see review.md and ws-verification.md for gates and independently verified deployment controls. No runtime changes in T025.


T025 execution2026-10-26: separate owner GO exercised once. Exact8c05fc11 WS Preview deployment40307557291 and bounded authenticated Online/Single Player/reconnect/settlement/Leave PASS. Leave ACK NOT OBSERVED under existing immediate-navigation contract; durable result/cashout verified. Final wallet442CH, test tables CLOSED/escrow0/no seats. Owner physical Offline PASS remains valid. WS gate closed; technically MERGE-READY, Draft retained pending explicit owner decision and safe Production deployment policy. No runtime changes. Current execution details supersede earlier pending-gate status; historical failures retained in review.md/ws-verification.md.

## Owner GO — local confirmed profile avatar (PR1155)

Owner reports Account/Online/Single Player avatars PASS on25c523b8, Offline avatar FAIL. Confirmed cause is generator replacements.init hardcoding comet-blue. Permit only one-way local visual reuse of the last confirmed catalog variant. Existing UserUiState/profile:updated writes a variant-only record in the per-user cache and a current variant-only projection; hydrate/logout/account change binds or clears it. The isolated Offline page reads only the projection and validates against its generated ArcadeAvatars catalog, never Auth/session/token/profile-cache data or URLs. Missing/invalid/logged-out projection falls back to comet-blue. Per-user variant retention allows offline visual recovery independently of the ordinary profile cache TTL; no extra API/policy fetcher.

Both New Game and Resume use the latest projected variant when rendering. No change to Offline Chips, session/schema/revision/hand/clock data or upload/sync of progress. This narrow incoming visual exception supersedes earlier wording prohibiting any profile reuse; all network/Auth/WS isolation, connect-src none and financial guards remain. Scope excludes Online/Single Player/backend/Stage DB/Production, catalog/Terms activation, funded smoke, Ready and merge. New physical APK acceptance is pending.
