# Źródło #1018

https://github.com/krzysztofcal/arcadePlatform/issues/1018

Updated: 2026-09-26T08:27:40Z
Live main: `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`. Odrębna alternatywa; #869/#1017 nietknięte.

# Simplified anti-farming alternative — bounded bot economy + farmer quarantine

## Status / relation

This is an **alternative to #869**, not an extension of it. The purpose is to evaluate whether a much smaller design can protect ordinary players and the CH economy while deliberately accepting that some bot farming may still happen.

**Planning only.** This issue does not authorize implementation, migrations, Stage/Production writes, WS deploy, mint/refill, or Production activation. Prepare a separate Spec Kit and compare its complexity/risk against #869 before choosing which design to implement.

## Motivation

The full #869 design prevents repeated bot-funded exposure with FAST/SLOW allowances, per-user exposure accounting, shared SLOW tables, global drain propagation and proof-based refill. That is comprehensive but high-risk and large.

This alternative intentionally relaxes the goal:

- farming itself is not automatically prevented;
- ordinary players must not lose bot availability because one detected farmer keeps consuming infinitely refilled bot bankroll;
- detected farmers are economically quarantined from ordinary players;
- existing legal hands, winnings and cash-out remain valid;
- keep the implementation local to existing poker JOIN/funding/ledger paths.

## Simplified policy

### 1. Accept limited farming

Do **not** implement the #869 FAST/SLOW allowance model in this alternative. A normal account may continue to play against bots without per-stack EXPOSURE quotas until it is classified as restricted or the finite bot bankroll/refill budget is exhausted.

No 7-day FAST counter, no rolling 12 h SLOW counter, no SLOW_SHARED requirement, no global FAST_EXHAUSTED fanout and no per-human bot exposure journal are required by this design.

### 2. Bot bankroll/refill must be finite

Automatic bot funding/refill must never be unlimited.

- Use the existing ledger and existing bot-funding sources; do not create a second ledger.
- Introduce the smallest durable hard refill ceiling needed for the active bot tiers/sources, enforced server-side and transactionally.
- Refill cap must survive retry/restart and must not be bypassable by metadata/client input.
- When the cap or source liquidity is exhausted, **new bot funding stops**. Existing hands, settlement and lawful human cash-out must continue.
- The exact cap/window values are a Spec Kit decision after inspecting current 100/500 funding and existing refill behavior. Do not silently inherit #869's more complex realized-loss/90:10 model unless evidence shows it is necessary for a ledger invariant.

Goal: a farmer cannot force an infinite stream of new CH into bots.

### 3. Simple anomaly detection

Add the smallest durable poker bot-access classification for an account:

- `NORMAL`
- `RESTRICTED` (internal reason can identify suspected farming/anomaly)

Initial simple detector proposal: authoritative USER wallet balance **>= 1,000,000,000 CH** marks the account RESTRICTED. The threshold must be server-controlled/configurable and not trusted from the browser.

The Spec Kit must decide the smallest safe evaluation point using existing balance reads (for example poker progression/admission and/or post-cash-out if that is already a natural authoritative hook). Detection may be lazy on the next relevant poker decision; a platform-wide continuous fraud scanner is **not** required for V1.

Restriction is durable once detected; dropping below the threshold must not silently unrestrict the account. Prefer an existing admin/backend mechanism for explicit review/override if one already fits; do not build a new admin product unless necessary.

### 4. Dynamic bot-funding quarantine

If **any currently seated human at a table is RESTRICTED**, all **new bot funding at that table is denied**.

This gate must cover the existing funding paths that can add fresh bot CH, including at minimum:

- join-time bot seed in `shared/poker-domain/bots.mjs::seedBotsForJoin`;
- replacement funding in `ws-server/poker/persistence/persisted-state-writer.mjs::writeReplacementFundings`;
- managed/non-stop bot top-up in `writeManagedBotTopUps`;
- any equivalent rollover path discovered during current-repo review.

Do not remove already funded bot stacks and do not interrupt a committed hand. Once existing bot money is lost/used, a restricted table simply stops receiving new bot CH.

Prefer one shared server-side predicate/helper reused by all funding paths instead of duplicated checks.

### 5. NORMAL and RESTRICTED players must not mix on new admissions

Final authoritative JOIN enforces segregation:

- RESTRICTED user may join a table only when all currently seated humans are RESTRICTED, or when there are no human players yet;
- NORMAL user may join a table only when all currently seated humans are NORMAL, or when there are no human players yet;
- a bot-only/empty table is claimed by whichever class wins the first authoritative human admission;
- concurrent NORMAL/RESTRICTED joins must not create a mixed table: re-check under the existing authoritative table/admission lock/transaction.

This rule applies regardless of lobby/direct URL/quick-seat path. Candidate discovery may be best-effort, but final WS/server JOIN is authoritative.

### 6. Account becomes RESTRICTED while already at a mixed table

Do **not** kick players or abort a hand.

From the moment the restriction is authoritative:

- new bot funding/top-up/replacement at that table is blocked;
- new admissions must not make the mixed state worse;
- current committed hand and lawful cash-out continue;
- existing humans may finish/leave naturally.

The alternative intentionally avoids a new 30-minute global drain/fanout system unless the Spec Kit proves a smaller safe hand-boundary action is required.

**Known trade-off:** if a user is newly classified RESTRICTED while sitting with NORMAL users, bot funding for that whole table pauses until the situation naturally separates. This is intentional protection against the farmer consuming shared bot liquidity.

### 7. Matchmaking/lobby scope stays minimal

Do not automatically inherit #869's complete WS-first personalized-lobby rewrite, max-32 contract, FAST/SLOW table classes, or removal of ordinary Create UI.

Use the current architecture and change only what is necessary so restricted users do not successfully join normal-player tables. WS/runtime remains authoritative for live poker state; a stale lobby suggestion must never bypass the final authoritative JOIN restriction.

If current Quick Seat can select an incompatible table, prefer the smallest bounded retry/neutral denial rather than building a second matchmaking engine.

### 8. Existing CONTINUOUS_BOT / managed tables

Keep existing managed/non-stop bot tables and their lifecycle. They do not need a new STANDARD/SLOW_SHARED/HUMAN_ONLY classification solely for this alternative.

If a RESTRICTED player is seated there, the same funding quarantine applies: no new seed/replacement/top-up while that restricted human remains relevant to the table.

### 9. Fundamental tests only

Plan only the smallest deterministic critical tests, preferably extending existing files:

- crossing the configured balance threshold creates one durable RESTRICTED state and retry does not duplicate it;
- RESTRICTED at table => join seed/replacement/managed top-up cannot add new bot CH;
- NORMAL cannot newly join RESTRICTED humans and RESTRICTED cannot newly join NORMAL humans;
- concurrent NORMAL vs RESTRICTED first admission to an empty/bot-only table produces one class outcome, never mixed admission;
- classification during an active mixed hand does not interrupt settlement/cash-out but blocks subsequent new bot funding;
- hard refill ceiling survives retry/restart/concurrency and exceeding it produces zero new issuance;
- failure/unknown classification or funding proof fails closed for **new bot funding/admission** without corrupting existing settlement.

No UI/CSS/JSP rendering tests and no broad speculative suite.

## Existing code to inspect first

Current GitHub is authoritative. At minimum trace:

- `shared/poker-domain/poker-progression.mjs` — existing authoritative USER balance read/progression;
- `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` — final admission;
- `shared/poker-domain/bots.mjs::seedBotsForJoin` — join-time bot seed;
- `ws-server/poker/persistence/persisted-state-writer.mjs::writeReplacementFundings`;
- `ws-server/poker/persistence/persisted-state-writer.mjs::writeManagedBotTopUps`;
- `shared/poker-domain/table-economy.mjs` — bot funding source selection;
- `ws-server/poker/persistence/chips-ledger.mjs` and `netlify/functions/_shared/chips-ledger.mjs`;
- terminal close/cash-out paths to confirm restriction never blocks lawful payout;
- current managed `CONTINUOUS_BOT` lifecycle.

Reuse existing locks, transactions, ledger helpers, account reads and table membership. Do not introduce a generic fraud service, new framework, second ledger or parallel poker state source.

## Non-goals

- no FAST 7-day allowance;
- no SLOW rolling-12h allowance;
- no per-user EXPOSURE accounting for every bot stack;
- no SLOW_SHARED class required by this alternative;
- no global FAST exhaustion fanout/drain;
- no 90/10 STANDARD/SLOW reserve unless separately proven necessary;
- no ML/anomaly platform or generalized anti-cheat service;
- no forced mid-hand kick;
- no higher-tier bot expansion (#870 remains separate);
- no Production mint/refill/deploy authorization in this issue.

## Breaking/behavioral impacts to call out

- Once RESTRICTED, a user can no longer newly mix with NORMAL humans at poker tables.
- A table containing a RESTRICTED human receives no new bot funding, even if NORMAL users are already present there.
- Bot availability can temporarily run out when the hard refill ceiling is reached; this is preferred to unlimited issuance.
- Existing legal hands and human payouts must remain unaffected.
- Any new `supabase/migrations/**` PR intentionally mutates shared Stage through DB Stage Apply PR and must declare that before the PR; applied Stage migrations are forward-only. Production remains separate explicit GO.

## Acceptance criteria

- A NORMAL player can use the existing poker/bot flow without FAST/SLOW quota accounting.
- A configurable authoritative anomaly threshold can durably classify a user as RESTRICTED.
- Any table with a RESTRICTED seated human receives zero **new** bot funding through seed, replacement and managed top-up paths.
- Final authoritative JOIN prevents new NORMAL↔RESTRICTED mixing, including concurrent admission to an initially empty/bot-only table.
- A newly restricted player already in a mixed live hand is not kicked; the hand and lawful cash-out settle, while new bot funding is blocked.
- Automatic bot refill/issuance is persistently and transactionally bounded; retry/restart/concurrency cannot exceed the cap.
- Reaching bot liquidity/refill limits degrades by pausing new bot funding, not by blocking settlement/cash-out or minting without limit.
- Only fundamental deterministic tests; WS-affecting implementation later requires exact-SHA WS Preview Deploy and runtime verification. Production changes always require separate explicit approval.

## Spec Kit request

Create a new **docs-only Spec Kit** for this issue using the repository's existing Spec Kit workflow. Compare this simplified design against live code and explicitly identify which #869 mechanisms become unnecessary.

The Spec Kit must remain minimal, name exact existing files/functions/properties to change, include only fundamental tests, account for intentional Stage migration effects, list breaking impacts, and STOP before implementation for independent review.

## Related

- Alternative/comparison target: #869 — full protected dual-rate bot budget design.
- #870 — higher-tier bot liquidity remains separate and is not authorized here.
