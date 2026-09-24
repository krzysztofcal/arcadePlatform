# Źródło wymagań #869

URL: https://github.com/krzysztofcal/arcadePlatform/issues/869

Pobrano 2026-09-24; updatedAt: 2026-09-24T19:57:31Z; komentarze: 0.
Aktualny main: `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`.
Lokalny HEAD: `fc3187187adcab47ff11808d95afe6b90ea9c2c9`. Kluczowe pliki domeny i zasad identyczne.

---

# Poker — protected dual-rate bot budget, matchmaking and bounded bankroll refill

## Status and scope

**Product decisions approved 2026-09-24; implementation NOT started.** This issue replaces the earlier broad anti-farming proposal with a concrete protection model. Goal: a single player who consumes their bot allowance must not be able to drain funding meant for everybody else or make an ordinary player's table wait for bot funding. An exhausted allowance is a funding state, not proof of cheating. Human-vs-human play, legal winnings and lawful cash-out remain unaffected.

Current V1: 100 CH bot funding uses legacy SYSTEM (default TREASURY), 500 CH uses one-time funded POKER_BOT_BANKROLL, higher tiers human-only. Do not expand bot tiers before #869 controls are verified (#870). This issue approves **planning/policy only**, not a Production mint, configuration change, migration or deployment.

## A. Agreed policy: two independently bounded resources, not two charges to a player

1. **Per-user access allowance**: durable server-authoritative entitlement to NEW bot-funded exposure, with fast and slow rates. It is NOT a USER chip account, a cap on the player's CH balance or a second currency; renewing it does not transfer or mint CH. A single user cannot reset it by table/tier switch, reconnect, reload, multiple tabs or duplicate requests.
2. **Real SYSTEM bankroll + issuance ceiling**: separate attributable bot funding per tier, independent of USER balances and of general TREASURY. Real money for seed/replacement/top-up comes from these SYSTEM pools. Their bounded refill must be an actual balanced, auditable ledger transaction with an absolute weekly cap. A user's renewed allowance cannot create bot liquidity if the real pool or its global issuance budget is empty.

**No unlimited refill, no unbounded mint, no silent TREASURY or cross-tier fallback.** One player's cap cannot guarantee infinite availability against an unbounded number of separate accounts; the global ceiling limits their combined economic impact. Do not describe the per-user budget as a second deduction from their CH.

## B. Initial dual-rate numbers (approved pilot policy; configurable, verify on Stage)

| Buy-in tier | Fast allowance per player per 7-day period | Slow allowance after fast exhaustion |
| --- | ---: | --- |
| 100 CH | 10,000 CH-equivalent = 100 full bot buy-ins | 100 CH-equivalent = 1 full bot buy-in / 12 h |
| 500 CH | 50,000 CH-equivalent = 100 full bot buy-ins | 500 CH-equivalent = 1 full bot buy-in / 12 h |
| 1,000 CH | 100,000 CH-equivalent = 100 full bot buy-ins | 1,000 CH-equivalent = 1 full bot buy-in / 12 h |
| 5,000 CH | 500,000 CH-equivalent = 100 full bot buy-ins | 5,000 CH-equivalent = 1 full bot buy-in / 12 h |
| 10,000 CH | 1,000,000 CH-equivalent = 100 full bot buy-ins | 10,000 CH-equivalent = 1 full bot buy-in / 12 h |

- Tiers above 500 CH are **configuration/design targets for #870 only**; do not activate their bots as part of #869. No automatic scaling above 10,000 CH: explicitly approve any higher-tier rates and global issuance pool before #870 enables it.
- Give each player ONE shared fast allowance of **100 full-bot-buy-in exposure units** per 7-day period across ALL enabled tiers; a bot buy-in of tier T uses one unit (partial funding uses funding delta / T), while actual CH exposure is separately recorded. Do not grant 100 units separately per tier. During the initially planned <=10,000 CH range, fast exposure is also bounded by **1,000,000 CH per player per period**; tier moves cannot reset the counters. Reconcile fractional units deterministically without rounding away tiny replacement funding.
- Start one fixed, persistent, per-account 7-day period on first eligible use; repeat on that persisted cadence. Fast allowance resets to 100 units at each period boundary, with no rollover/catch-up of unused units. Do not use a continuously refilling fast token bucket that immediately exits slow mode after a short time.
- Slow allowance is shared across all tiers: at most **one full buy-in exposure unit per 12 hours**, maximum stored/burst **one unit**, no back-accumulation across idle periods, no parallel allowance across tiers/tables. Enter slow mode when the fast allowance cannot cover the next required bot exposure; when a fresh fast period starts, newly selected tables can use fast access again. Replenishing a slow entitlement does not refill a SYSTEM account or re-open an already draining table.
- These are access/exposure caps, NOT a prediction of winnings or a direct cap on payouts. Bot decision speed, hand timers, settled winnings and human-vs-human play never slow down.

## C. Chargeable exposure — required authoritative contract before implementation

- Account for **bot stacks newly made available for play against the player**, including bots already pre-funded at a CONTINUOUS_BOT/bot-only table when the human first joins. A new visitor must not repeatedly join previously funded bot-only tables and receive free unmetered bot exposure.
- Pure bot-vs-bot play **before any human admission charges no per-user allowance**. Count a bot exposure to a particular user only once for the same authoritative funding/admission identity; no extra charge on reconnect, reload, duplicate join, retry or simply replaying another hand against the same already-accounted funded bot stack.
- New bot seed, replacement and managed top-up for a human-eligible table must pass budget authorization before becoming visible; charge only NEW incremental funding/exposure, not the whole replacement buy-in again when old residual stack is retained. Existing funded bot chips are never charged as newly minted CH.
- Multiple standard humans may sit together: independently authorize each player's exposure to bots on admission and on genuinely new funding; do not divide or attribute fungible escrow winnings by guessing which player's chips came from a bot. If full conservative per-user accounting harms ordinary multiplayer access, resolve and document a smaller *authoritatively provable* attribution before implementation rather than silently bypassing the cap.
- Reserve/consume budget and persist the authoritative join/rollover/funding decision atomically or by idempotent fail-closed reconciliation; a partial write must not issue chips, reset allowance or leave an invalid seat. Do not refund allowance merely because a bot loses or a player wins. Define any genuine reversal/refund only for rolled-back funding/admission that never became available.
- Distinguish **accessed new bot-funded exposure** (quota accounting) from **realized net bot-to-human subsidy** (reporting/refill). Record identity/version/source and preserve auditable proof through existing ledger retention/archives when needed.

## D. Server-enforced matchmaking: standard vs constrained

- Standard players (sufficient fast allowance for the required exposure) may share a suitable standard bot-funded table, including available managed bot-only tables. Constrained players (fast exhausted/insufficient) MUST NOT be seated with standard players in any NEW bot-funded table and MUST NOT join already-funded bot-only / CONTINUOUS_BOT tables.
- A constrained player may choose a **private slow-mode table: one human + that human's authorized slow-funded bots**, or human-only tables with other humans (including standard players, as no one consumes bot funding there). Constrained players cannot share another player's funded bots. Existing ordinary multiplayer preference remains available for standard players.
- Matchmaking/eligibility is authoritative on the server for lobby discovery, Quick Seat, Create Table, manual join, direct URL, reconnection and WS bootstrap; UI filtering alone does not protect funding. Prevent bypass by selecting a table directly, duplicating requests or switching tabs. Reject an inadmissible NEW join with a clear non-punitive explanation and compatible table alternatives.
- Existing bot-only managed tables are standard-class when eligible humans are admitted; pure bot-vs-bot background lifecycle may continue, but slow-mode users may never access their pre-funded stacks.
- A slow table may finance bots at most within its single player's slow entitlement AND actual protected slow SYSTEM liquidity. No human can occupy another player's slow bot table. If no bot funding is available, do not start or promise a bot-funded hand; offer human-only play/wait for the next entitlement without halting valid settlements.

## E. Player exhausts fast budget while already seated — 30-minute draining, not a kick

- Current live hand and legitimate payouts must finish unchanged. Do **not** remove the user, auto-transfer their stack, change their hand rules or force instant cash-out.
- Once an existing standard bot table has a human whose fast entitlement cannot cover further exposure, set a **durable, sticky DRAINING flag and deadline = first such exhaustion + 30 minutes**. Do not reset or postpone this deadline because a human is present, because a new 7-day window starts or because of reconnect. Existing human participants may stay during the grace period (this is the unavoidable temporary exception to separating newly matched groups).
- While DRAINING: **no new human admissions and NO NEW SYSTEM funding of any bot** at that table (no seed/replacement/managed top-up); existing already-funded bots may finish normal hands from remaining stacks. Other humans may leave voluntarily and use new compatible tables without forfeiting cash-out. Do not hold another player's existing live hand or payout hostage to the exhausted user's allowance.
- When deadline is reached, block starting the **next** hand; if a hand is live, settle it first. Then close using existing terminal accounting/zero-escrow protections, cash out humans and return bots' residuals to exactly proven SYSTEM sources. If all humans leave earlier, permit existing safe lifecycle close. Never start a new bot-funded hand beyond the deadline; don't forcibly terminate a live hand at the 30-minute mark.
- Existing CONTINUOUS_BOT tables have rotation_due_at, but handleContinuousBotRotationAtSettled currently POSTPONES when a human remains. Draining deadline must be a separate non-postponable bound/override; ordinary managed rotation and unrelated standard table TTL need not be rewritten. Any other standard table carrying the fast-vs-slow hazard must also honor DRAINING. 30 minutes is a **maximum admission/next-hand grace** after exhaustion, not a universal TTL for all poker tables.
- Resolve failures/restarts, absent players and retry idempotency deterministically. A funding failure at either 100 or 500 CH must not create an infinite settled-rollover retry while a valid hand/exit could progress; reuse existing controlled no-new-bot-funding path where safe.

## F. Real tier bankrolls and automatic bounded refill (approved initial 100/500 policy)

| Bot buy-in | Target real tier bankroll | Maximum NEW CH issued to that tier per 7 days | Initial slow-class reservation of available bot liquidity/refill |
| --- | ---: | ---: | ---: |
| 100 CH | 1,000,000 CH | 100,000 CH | 10% (10,000 CH of weekly issuance ceiling) |
| 500 CH | 1,000,000 CH | 500,000 CH | 10% (50,000 CH of weekly issuance ceiling) |
| Total current tiers | 2,000,000 CH target | **600,000 CH / 7 days global ceiling** | **60,000 CH / 7 days reserved for slow-class issuance** |

- Real bankroll for 100 CH MUST be isolated from general TREASURY. Keep existing POKER_BOT_BANKROLL for 500 CH and preserve immutable provenance of already-financed bots. Provision/seed the 100 CH dedicated bankroll **once**, with explicit Stage evidence and separate Production approval, recognizing that a new 1,000,000 CH SYSTEM seed is a one-time economy/supply change. Choose and document its exact balanced funding transfer/source in the implementation preflight; no accidental duplicate allocation, no retroactive change to funding for already-active tables. The one-time initial allocation is separate from weekly refill quotas; require owner GO before Production issuance.
- At any trigger, refill only actual settled net loss to humans, not the temporary lower liquid balance caused by bot funds sitting in an OPEN table's ESCROW. Determine durable attributable *realized* shortfall from committed bot funding minus proven terminal returns on safely closed/reconciled tables, accounting for already refilled amounts, ledger retention/archives and any still-live exposure. Do not infer emission from total table turnover, raw live balance, or generic TABLE_CASH_OUT metadata alone.
- Allowed refill amount is the smallest of: (i) verified uncompensated realized loss, (ii) headroom to that tier's target real capitalization without counting active committed stacks as lost, and (iii) remaining per-tier AND total global weekly issuance ceilings. Zero if any condition is not provably satisfied. Never pre-mint full weekly maximum just because a new week starts.
- Refill uses the existing append-only double-entry ledger as a bounded, idempotent, auditable **MINT/GENESIS -> exact tier SYSTEM account** transaction, only after explicitly approved funding policy/controls. Persist the weekly counter, per-source purpose, funding identity, and idempotency key in one locked/serializable transaction with the ledger credit. An error, race, retry or restart cannot issue a second credit or exceed a ceiling. A SYSTEM-to-SYSTEM internal rebalance is not new emission and must not be counted as newly minted CH.
- Actually reserve **10% of available tier bot funding AND of its permitted weekly refill for slow mode**, with **90% reserved for standard mode**. Preserve the allocation against simultaneous requests with transactional enforcement, whether by the smallest safe existing-ledger-compatible class-specific SYSTEM subaccounts or equivalent truly enforced reserved accounting. A soft matching preference or an unprotected one-account balance check is NOT an actual reserve. No cross-class or cross-tier fallback when a protected quota is empty; unused slow quota may remain unused, not be silently diverted to standard users.
- A slow player may use their protected portion only within their own slow allowance. Fast/standard players use the standard portion. Neither portion's entitlement is a direct payment to USER; actual chips move to bots' table escrow on a permitted seed/replacement/top-up.
- If global issuance cap or protected real capital runs out, new bot funding pauses safely in the affected class/tier; an ordinary player may temporarily find no bot seat. **Finite issuance and guaranteed unlimited bot availability for an arbitrarily large number of accounts are incompatible**; never promise both. Existing hands/legitimate payout remain operational.
- Initial values are approved **pilot caps**, not validated inflation/supply predictions. Stage must measure realized outflow, ordinary human access and consumption; any Production activation/refill requires a separate explicit GO. For #870, set tier-specific capitalization and global issuance ceilings for each higher tier, with an updated cross-tier global CH cap BEFORE enabling its bots; no automatic extrapolation from 100/500.

## G. Speckit/Codex implementation workstreams — minimum existing architecture

**T1 — evidence & invariant contract (read-only).** Review agents.md and skills.md; use current GitHub source, not historical repomix by default. In shared/poker-domain/table-economy.mjs, shared/poker-domain/bots.mjs (seedBotsForJoin), shared/poker-domain/join.mjs (executePokerJoinAuthoritative), ws-server/poker/table/table-manager.mjs (prepareSettledHandRollover, commitSettledHandRollover), ws-server/poker/persistence/persisted-state-writer.mjs (writeReplacementFundings/writeManagedBotTopUps/writeMutation), shared/poker-domain/terminal-close.mjs (resolveBotFundingSource, executeTerminalPokerCloseInTx), and ws-server/server.mjs map existing source, cash-out, funded seats, retry and settlement. Validate 30-min drain semantics and closed-table net-loss measurements on Stage. Record the unavoidable existing-human transition exception and explicit breaking change to standard/slow admissions. Do not invent escrow ownership.

**T2 — persistent budget + atomic admission.** Add the smallest forward-only Supabase migration under supabase/migrations/ for per-user 7-day fast usage, 12-hour slow entitlement, idempotent exposure identity and table class/drain state ONLY where existing tables cannot safely hold them. Keep durable user identity and table identity server-side. Extend shared/poker-domain/join.mjs executePokerJoinAuthoritative and shared/poker-domain/bots.mjs seedBotsForJoin so pre-funded bot-only admission and new seed are charged correctly in the same authoritative funding/admission transaction. Integrate per-user checks into ws-server/server.mjs and ws-server/poker/persistence/persisted-state-writer.mjs funding rollover; no second poker engine or generic fraud service. Any Stage migration PR automatically mutates shared Stage via DB Stage Apply PR: explicitly declare/review migration effect before PR; applied Stage migrations are immutable; Production remains separate GO.

**T3 — class-safe table selection.** Extend netlify/functions/poker-quick-seat.mjs selectCandidate/handler, the existing Create Table flow found in repo, ws-server/server.mjs and shared/poker-domain/join.mjs to enforce STANDARD, SLOW_PRIVATE and HUMAN_ONLY admission and deny bypass by direct join. Reuse existing lobby and table lifecycle, do not build a generic load balancer. STANDARD allows multiple eligible humans; SLOW_PRIVATE one human + exclusively authorized slow bots; HUMAN_ONLY normal human multiplayer. Ensure an existing incompatible table is never silently relabeled or joined after deployment.

**T4 — drain without interrupting hand.** Reuse ws-server/poker/runtime/continuous-bot-table-rotation.mjs handleContinuousBotRotationAtSettled, ws-server/poker/persistence/continuous-bot-table-repository.mjs, ws-server/poker/table/table-manager.mjs prepareSettledHandRollover/commitSettledHandRollover, ws-server/server.mjs runSettledRolloverCommand, ws-server/poker/runtime/table-janitor.mjs and shared/poker-domain/terminal-close.mjs. Add a durable non-postponable table draining deadline, prevent NEW funding/admissions, allow funded stacks/live hands until safe 30-minute deadline close and preserve all payouts. Keep ordinary managed table rotation and unrelated standard tables unchanged.

**T5 — real tier pool, protection and refill.** Reuse shared/poker-domain/table-economy.mjs getBotFundingSystemKeyForBuyIn with class-aware selection as required, shared/poker-domain/bots.mjs, persisted-state-writer.mjs and terminal-close.mjs funding provenance, and netlify/functions/_shared/chips-ledger.mjs postTransaction; use a new forward-only Supabase migration for necessary tier/class funding accounts and persistent issuance counters. Derive approved net realized shortfall from ledger-authoritative closed-table accounting, not OPEN escrow, and protect 90/10 allocations transactionally. Implement idempotent bounded refill and one-time protected 100 CH seed. Preserve 500 CH source provenance for pre-existing bots and do not alter existing seed migration. Runtime must remain fail-closed if recap/archived proof is missing.

**T6 — fundamental deterministic tests + release gates.** Extend existing shared/poker-domain/*.behavior.test.mjs, ws-server/server.behavior.test.mjs and ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs (or the nearest EXISTING contract tests) only for key rules: standard vs slow/private/manual/direct/bot-only join, pre-funded bot exposure, multi-user budget, cross-tier/session/retry, exhaustion mid-hand then 30-minute safe close, no bot funding while draining, terminal cash-out provenance, concurrent refill/idempotency/global ceiling and live-escrow-not-loss. No broad speculative/UI/CSS tests. Exact runtime SHA WS Preview Deploy + Stage/Preview manual smoke for both classes/TTL, and explicit separate Production approval. Existing bot-only Stage churn must not consume a human budget or trigger inflation.

## Notes / guardrails

- Use deep reasoning but produce the smallest condensed code, refactor before review; prefer existing packages/classes/methods; do not write entire implementation into the plan. Avoid git commands.
- Explicitly highlight breaking changes to lobby/Quick Seat, direct URL admission, mid-table lifecycle, 100 CH TREASURY sourcing, immutable provenance and financial supply/issuance. Keep gameplay hand rules unchanged.
- All added browser JS must operate on JSP; each CSS selector gets exactly one line, with no line breaks inside declarations.
- If adding any inline script, add its correct SHA to the CSP allowlist; prefer not to add scripts or CSS unless truly required.
- Use klog, never console.log. Only fundamental deterministic critical backend/runtime tests. Validate all states and error paths; Production changes only on explicit approval.
- #870 currently documents NO automatic refill for higher tiers. Before #870 implementation, reconcile that text explicitly with this APPROVED bounded-refill policy; it is NOT permission to enable higher tiers, mint arbitrary CH, or change existing Production behavior.

## Acceptance criteria

- Ordinary users can share STANDARD bot tables; constrained users cannot enter them or pre-funded bot-only tables, and can access HUMAN_ONLY or their isolated slow-bot table when both allowance and real slow liquidity permit. All server join paths enforce this.
- Persisted 100-units/7d fast and 1-unit/12h slow (burst one) function across all tiers and sessions. Exhaustion is not a punitive classification. Legal winnings, existing hands and cash-outs always settle.
- A currently seated user exhausting fast allowance remains for at most the 30-minute draining grace with no newly funded bots or new joiners; live hands settle before close and cash-out is invariant-safe. Ordinary users elsewhere remain unaffected by that user's depleted allowance.
- 100 CH bots no longer drain general TREASURY after a verified migration; 100/500 SYSTEM capitalization and true 90/10 class protection are maintained, with **at most 100k+500k CH of NEW issuance per 7 days across current tiers**, independent of transient live escrow. Refills are audited, idempotent and bounded; missing evidence means no refill.
- No claim of guaranteed infinite availability when global budget is exhausted; bot funding suspends gracefully without stalling existing hand or legal payout.
- Only fundamental deterministic tests and verified exact-SHA WS Preview/Stage smoke before any separately approved Production rollout.

## Related

#788 progression; PR #868 current bankroll model; #783 continuous bot tables; #870 higher-tier bot liquidity after #869.
