# Źródło #1018

Wiążąca korekta review użytkownika po HEAD a6a21074644126a6cf01b3bbab8ec42a4d429dba: RESTRICTED nowe admission wyłącznie farmer-only; ordinary/prefunded/CONTINUOUS_BOT denied; trwały table marker blokuje funding także po leave. Pierwszy farmer przez existing Create bez funding. Ta korekta zastępuje poniższy starszy zapis o przyjęciu pierwszej dowolnej klasy na pusty/bot-only table. Pełny kontrakt: contracts/bot-quarantine.md.

https://github.com/krzysztofcal/arcadePlatform/issues/1018

Updated: 2026-09-26T08:58:10Z
Live main: `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`. Wiążąca korekta: autorefill NORMAL, bez lifetime cap. #869/#1017 nietknięte.

# Simplified anti-farming alternative — protected bot autorefill + farmer quarantine

## Status / relation

This is an **alternative to #869**, not an extension of it. The purpose is to evaluate whether a much smaller design can protect ordinary players and the CH economy while deliberately accepting that some bot farming may still happen.

**Planning only.** This issue does not authorize implementation, migrations, Stage/Production writes, WS deploy, mint/refill, or Production activation. Prepare a separate Spec Kit and compare its complexity/risk against #869 before choosing which design to implement.

## Motivation

The full #869 design prevents repeated bot-funded exposure with FAST/SLOW allowances, per-user exposure accounting, shared SLOW tables, global drain propagation and proof-based refill. That is comprehensive but high-risk and large.

This alternative intentionally relaxes the goal:

- farming itself is not automatically prevented;
- ordinary players should keep normal bot availability through safe automatic refill;
- once a farmer is detected, tables involving that RESTRICTED player must stop receiving any new bot funding so the farmer cannot consume refill intended to keep ordinary play available;
- detected farmers are economically quarantined from ordinary players;
- existing legal hands, winnings and cash-out remain valid;
- keep the implementation local to existing poker JOIN/funding/ledger paths.

## Simplified policy

### 1. Accept limited farming

Do **not** implement the #869 FAST/SLOW allowance model in this alternative. A NORMAL account may continue to play against bots without per-stack EXPOSURE quotas and should retain normal access to safely auto-refilled bot funding; the protection boundary starts when the account becomes RESTRICTED.

No 7-day FAST counter, no rolling 12 h SLOW counter, no SLOW_SHARED requirement, no global FAST_EXHAUSTED fanout and no per-human bot exposure journal are required by this design.

### 2. Automatic refill protects NORMAL play; RESTRICTED tables get zero new bot funding

The purpose of automatic refill in this alternative is **availability for ordinary NORMAL players**, not a global lifetime budget that eventually disables bots for everybody.

- Use the existing ledger and existing bot-funding sources; do not create a second ledger.
- Add the smallest safe automatic refill needed to keep eligible NORMAL-only bot play funded.
- Do **not** use a lifetime 100k/500k ceiling whose exhaustion would eventually deny ordinary players new bot funding. The Spec Kit may use narrow technical bounds per operation/cycle only to prevent runaway retries or accidental over-minting.
- Refill must be demand-driven and idempotent: mint only the amount actually required by an authorized bot funding operation, or the smallest equivalent safe unit proven by the existing flow; no speculative large pre-mint.
- **A table with any RESTRICTED seated human is never eligible for new bot funding or for a refill caused by that table.** Seed, replacement, managed top-up and equivalent positive bot-funding paths remain blocked there.
- NORMAL-only tables remain eligible for normal bot funding/refill even if other RESTRICTED tables exist elsewhere.
- Retry/restart/unknown commit must not duplicate issuance. Client metadata or environment input cannot bypass the RESTRICTED gate.
- Existing hands, settlement and lawful human cash-out remain independent of refill success.

Goal: detected farmers cannot consume the replenishment used to keep bot play available to ordinary players, while NORMAL players are not globally starved by a finite lifetime refill cap.

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

Do not remove already funded bot stacks and do not interrupt a committed hand. Once existing bot money is lost/used, a restricted table simply stops receiving new bot CH; refill activity elsewhere for NORMAL-only play continues normally.

Prefer one shared server-side predicate/helper reused by all funding paths instead of duplicated checks.

### 5. NORMAL and RESTRICTED players must not mix on new admissions

Final authoritative JOIN enforces segregation:

- RESTRICTED user may join a table only when all currently seated humans are RESTRICTED, or when there are no human players yet;
- NORMAL user may join a table only when all currently seated humans are NORMAL, or when there are no human players yet;
- a bot-only/empty table is claimed by whichever class wins the first authoritative human admission;
- concurrent NORMAL/RESTRICTED joins must not create a mixed table: re-check under the existing authoritative table/admission lock/transaction;
- if classification is committed but the new JOIN is denied, that denial must **not** falsely persist `poker_tables.has_human_participant=true` for a bot-only table. The one-way human-participation marker must reflect an actually accepted human admission/rejoin, preserving existing bot-only retention semantics.

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
- automatic refill for NORMAL-only play survives retry/restart/concurrency without duplicate issuance, while RESTRICTED tables can never cause or consume new bot funding/refill;
- denied JOIN that commits RESTRICTED classification does not falsely mark a bot-only table as having had a human participant;
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
- no Production mint/refill/deploy authorization in this issue;
- no global lifetime refill cap whose exhaustion intentionally disables bot availability for NORMAL players.

## Breaking/behavioral impacts to call out

- Once RESTRICTED, a user can no longer newly mix with NORMAL humans at poker tables.
- A table containing a RESTRICTED human receives no new bot funding, even if NORMAL users are already present there.
- NORMAL-only bot availability should be maintained by safe automatic refill; a RESTRICTED table receives no new bot funding even if that makes bots there eventually run out.
- Existing legal hands and human payouts must remain unaffected.
- Any new `supabase/migrations/**` PR intentionally mutates shared Stage through DB Stage Apply PR and must declare that before the PR; applied Stage migrations are forward-only. Production remains separate explicit GO.

## Acceptance criteria

- A NORMAL player can use the existing poker/bot flow without FAST/SLOW quota accounting.
- A configurable authoritative anomaly threshold can durably classify a user as RESTRICTED.
- Any table with a RESTRICTED seated human receives zero **new** bot funding through seed, replacement and managed top-up paths.
- Final authoritative JOIN prevents new NORMAL↔RESTRICTED mixing, including concurrent admission to an initially empty/bot-only table.
- A newly restricted player already in a mixed live hand is not kicked; the hand and lawful cash-out settle, while new bot funding is blocked.
- Automatic refill for eligible NORMAL-only play is idempotent and transactionally safe; retry/restart/concurrency cannot duplicate issuance.
- A RESTRICTED table cannot trigger or consume new bot refill/funding; NORMAL-only tables elsewhere remain eligible for refill.
- Refill failure pauses only the affected new bot funding attempt and must not block settlement/cash-out.
- Only fundamental deterministic tests; WS-affecting implementation later requires exact-SHA WS Preview Deploy and runtime verification. Production changes always require separate explicit approval.

## Spec Kit request

Create a new **docs-only Spec Kit** for this issue using the repository's existing Spec Kit workflow. Compare this simplified design against live code and explicitly identify which #869 mechanisms become unnecessary. The Spec Kit must treat automatic refill as an availability mechanism for eligible NORMAL-only play and must not reintroduce a global lifetime cap that eventually starves ordinary players.

The Spec Kit must remain minimal, name exact existing files/functions/properties to change, include only fundamental tests, account for intentional Stage migration effects, list breaking impacts, and STOP before implementation for independent review.

## Related

- Alternative/comparison target: #869 — full protected dual-rate bot budget design.
- #870 — higher-tier bot liquidity remains separate and is not authorized here.
