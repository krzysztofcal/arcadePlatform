# Feature Specification: NORMAL/SLOW per-tier poker pools with manual RESTRICTED

> Current contract: issue #1018 [§32](https://github.com/krzysztofcal/arcadePlatform/issues/1018#issuecomment-5939585868) supersedes historical §29/§31 scheduler economics below. See the §32 implementation section at the end of this document. Final state is demand-only; temporary Cron uses the same DB allowance until accepted Stage smoke and separate removal GO.


**Feature Branch**: `docs/issue-1018-bot-quarantine`

**Created**: 2026-09-26

**Status**: Accepted implementation with §29 hourly database-refill amendment in progress. T001–T092 are historical implementation/evidence; §29 supersedes the recurring VPS/GitHub refill design and is tracked in T093–T099.

**Input**: Live [GitHub #1018](https://github.com/krzysztofcal/arcadePlatform/issues/1018), captured at `2026-09-27T17:10:33Z` in [issue-source.md](issue-source.md). Sole requirements source; supersedes previous #1019 designs and the earlier pre-amendment wording. SLOW here is not #869 rolling-12h SLOW.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep playing in the appropriate pool (Priority: P1)

Players retain poker and bot play, while accounts reaching the threshold move to the smaller SLOW pool without interrupting a hand.

**Why this priority**: Economic containment protects NORMAL liquidity without banning SLOW bot play.

**Independent Test**: With provisioned test pools, exercise wallet/settled-stack threshold, admission, owned-table promotion and legal rejoin/payout.

**Acceptance Scenarios**:

1. **Given** AUTO/NORMAL, **When** authoritative wallet at final JOIN or settled stack reaches 1,000,000,000 CH, **Then** automatic state becomes sticky SLOW; threshold−1 does not transition, and later balance decrease/restart does not reset it.
2. **Given** SLOW and an owned empty unfunded STANDARD table, **When** final JOIN accepts the player, **Then** the table becomes SLOW-only and bots use its tier's SLOW funds. Another owner's, populated, prefunded or ordinary CONTINUOUS_BOT table cannot be claimed.
3. **Given** a seated player becomes SLOW, **When** the current hand settles, **Then** existing participation remains legal, the marker becomes sticky and future funding uses SLOW funds; UNKNOWN never falsely promotes or blocks lawful payout.
4. **Given** a denied fresh JOIN after classification, **When** it completes, **Then** no seat/buy-in/bot funding or false human-participation marker is created. Already financed rejoin remains available.

### User Story 2 - Bound one account's table fan-out (Priority: P1)

NORMAL and SLOW users may play on four active tables and prepare four pending empty owned tables.

**Why this priority**: Bounds one-account parallel consumption without a quota framework.

**Independent Test**: Concurrent Create/JOIN at the fourth-slot boundary, plus rejoin and pending-to-active transfer.

**Acceptance Scenarios**:

1. **Given** four active tables, **When** a fifth fresh JOIN is attempted by any path, **Then** reject before buy-in/bot funding; resume on any existing active table succeeds without a new slot.
2. **Given** four pending tables, **When** direct Create or Quick Seat fallback requests another, **Then** reject before table/state/ESCROW creation.
3. **Given** concurrent requests for one user, **When** Create/JOIN consume slots, **Then** neither count exceeds four; first accepted JOIN removes that table from pending and adds active participation atomically. Closed tables do not count.

### User Story 3 - Fund bots from isolated existing balances (Priority: P1)

Each enabled tier has separate NORMAL/SLOW liquidity, with historical returns going to the actual original source.

**Why this priority**: Prevents cross-tier/class subsidy and preserves financial provenance.

**Independent Test**: All seed/replacement/top-up paths against four current pools, an empty exact pool and a disabled future tier.

**Acceptance Scenarios**:

1. **Given** tier 100/500 and ordinary/SLOW-only table, **When** new bot funding occurs, **Then** only its exact tier/class bankroll is debited; no runtime issuance or fallback occurs.
2. **Given** an empty/unknown/disabled pool, **When** funding is requested, **Then** existing safe no-funding behavior applies while settlement/cash-out remain legal.
3. **Given** bots funded historically from TREASURY or the existing 500 pool, **When** they cash out, **Then** residual CH returns to its actual funding source; history is not relabelled.

### User Story 4 - Refill small amounts periodically (Priority: P1)

After separately authorized activation, Supabase Cron invokes the database refill function hourly; each eligible pool can refill at most once per UTC-hour bucket, independently of poker play.

**Why this priority**: Caps each pool's short-term replenishment while maintaining regular availability.

**Independent Test**: Fixed clock, pool balance threshold, retry/concurrency, policy change and missed-bucket scenarios.

**Acceptance Scenarios**:

1. **Given** an enabled pool below threshold, **When** its current UTC-hour bucket runs, **Then** exactly one configured amount is issued; balance equal to or above threshold issues zero.
2. **Given** a committed refill, **When** dispatch retries or policy changes in the same bucket, **Then** that pool receives no second refill; old-revision retries recover the original result.
3. **Given** missed hourly runs, **When** the scheduler resumes, **Then** only the current hour is considered, without backlog or refill-until-target.

### User Story 5 - Tune access and economics through Admin (Priority: P2)

An authorized administrator adjusts user override, SLOW threshold and per-tier refill settings without deploys.

**Why this priority**: Existing Admin controls provide operational correction without a moderation product.

**Independent Test**: Authorized/unauthorized backend requests, revision conflicts, cache propagation and override precedence.

**Acceptance Scenarios**:

1. **Given** automatic SLOW, **When** FORCE_NORMAL is active, **Then** effective class is NORMAL; FORCE_SLOW forces SLOW below threshold; AUTO restores durable automatic state. Overrides never erase or block automatic SLOW or revert SLOW-only tables. Starting AUTO/NORMAL, set FORCE_NORMAL, cross the threshold in wallet or settled stack: automatic becomes SLOW while effective stays NORMAL; Return to AUTO immediately derives effective SLOW from stored state, without another threshold check.
2. **Given** a saved threshold/override revision, **When** the next relevant authoritative check uses it, **Then** the revised effective class is applied without deploy or per-hand database reads.
3. **Given** an unauthorized caller or invalid CH amount, **When** a policy/override mutation is attempted, **Then** reject without mutation. Successful changes record actor/time/revision.

### User Story 6 - Discover compatible play through existing entry points (Priority: P2)

Players use the current live lobby and Quick Seat, with class compatibility and existing resume preference.

**Why this priority**: Avoids incompatible fresh targets while retaining the current discovery architecture.

**Independent Test**: Existing lobby snapshot metadata and DB recommendation behavior, followed by authoritative JOIN with stale information.

**Acceptance Scenarios**:

1. **Given** NORMAL/SLOW, **When** viewing live tables, **Then** incompatible fresh targets are filtered/marked and own financed resume remains available; no per-viewer table queries are introduced.
2. **Given** Quick Seat, **When** choosing a candidate, **Then** valid existing participation is preferred, fresh candidates match class, Create fallback respects pending limits, and final JOIN revalidates stale recommendations.

### User Story 7 - Apply a manual human-only restriction (Priority: P1)

An administrator can make a user effective RESTRICTED without creating a third automatic class or a new table lifecycle.

**Why this priority**: Manual restriction contains bot participation while preserving existing financed poker and settlement rights.

**Independent Test**: FORCE_RESTRICTED/AUTO round-trip, bot-free fresh admission, lobby/Quick Seat filtering and settled no-new-funding behavior.

**Acceptance Scenarios**:

1. **Given** automatic NORMAL or SLOW, **When** an authorized Admin sets FORCE_RESTRICTED, **Then** effective state is RESTRICTED while automatic state remains NORMAL/SLOW; threshold evidence may still persist automatic NORMAL→SLOW, but no automatic path can produce RESTRICTED.
2. **Given** FORCE_RESTRICTED and a fresh admission, **When** the target is an ordinary bot-free STANDARD table or the user's own empty STANDARD Create fallback, **Then** final JOIN accepts with targetBotCount zero and no new bot funding; SLOW-only, bot-populated and CONTINUOUS_BOT targets reject before buy-in.
3. **Given** an existing financed seat or a hand with a RESTRICTED human, **When** rejoin, settlement, leave or cash-out occurs, **Then** the legal existing participation completes and no replacement/top-up/seed funding is created.
4. **Given** FORCE_RESTRICTED, **When** Return to AUTO is accepted, **Then** effective state immediately derives from the stored automatic NORMAL/SLOW state without another threshold check.

### Edge Cases

- Threshold−1/equal, threshold revision change, FORCE_NORMAL/FORCE_RESTRICTED with above-threshold evidence, return to AUTO, cached state unavailable or invalidated.
- Multiple tables without global wealth summation; disconnected financed seats count active; concurrent Create/JOIN on distinct tables and another user's first JOIN into an owned pending table.
- Empty table with historical bot funding is not a safe promotion target; mixed participation, forced NORMAL on a sticky SLOW-only table and UNKNOWN during legal leave.
- Source exhaustion, unknown COMMIT, policy edit during refill, UTC bucket rollover, clock skew, duplicate dispatch and disabled/unprovisioned tiers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Durable automatic class MUST remain only NORMAL or sticky SLOW; override MUST be AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED, separate from automatic state. Effective state may be NORMAL, SLOW or manual-only RESTRICTED. FORCE_NORMAL and FORCE_RESTRICTED affect only effective state: threshold evidence still persists automatic NORMAL→SLOW while either override is active, and no automatic mechanism may set RESTRICTED. Override cannot block or clear durable automatic SLOW; Return to AUTO immediately derives the stored automatic NORMAL/SLOW state without another threshold check. FORCE_NORMAL/FORCE_RESTRICTED never revert sticky `is_slow_only`.
- **FR-002**: Final authoritative JOIN MUST evaluate authoritative wallet; existing settled-hand boundary MUST evaluate each active human's authoritative settled stack. Either value at or above dynamic `slow_threshold_ch` (initially 1,000,000,000 CH) establishes automatic SLOW independently of override, including FORCE_NORMAL. No wallet+multi-table wealth aggregation or background account scan.
- **FR-003**: Settled checks MUST use in-memory settled stacks and cached policy/access/override; zero per-hand reads for wallet/policy/account/override/tier policy, zero additional write below threshold without a real transition. Cache refresh/invalidation occurs outside the hand hot path; new admission/funding fails closed on unknown state or effective RESTRICTED, while lawful payouts, settlement and leave do not.
- **FR-004**: `poker_tables.is_slow_only` MUST be false by default and one-way true, surviving leave/restart/close. Effective NORMAL fresh admission is ordinary-only, effective SLOW is SLOW-only, and effective RESTRICTED fresh admission is ordinary bot-free STANDARD-only; existing financed resume remains legal. Known effective SLOW can promote a seated table; RESTRICTED never creates a table marker and UNKNOWN cannot promote.
- **FR-005**: Create MUST retain empty unfunded STANDARD table/state/ESCROW. Only final authoritative JOIN may promote a SLOW user's own empty table with no human/bot seats and no prior bot funding; never another owner's, populated, prefunded or ordinary managed table.
- **FR-006**: Active participation MUST be limited to four distinct tables per user across classes; fresh fifth JOIN rejected before buy-in/bot funding, financed rejoin uses no new slot.
- **FR-007**: Pending empty OPEN STANDARD owned tables with no accepted human participation/bot funding MUST be limited to four; fifth direct/fallback Create rejected before table/state/ESCROW. First accepted JOIN transfers pending to active; closed tables excluded, no historical quota.
- **FR-008**: Create and final JOIN MUST share a user-scoped transaction advisory-lock contract around authoritative count/decision/mutation, race-safe across different tables and requests. Quick Seat/browser prechecks are not authority. Both counts require narrow user-leading active and creator-leading pending access paths matched to final predicates, bounded to five qualifying tables; fresh JOIN/Create must not scan global seats/tables. T027 must prove query shape/access paths locally; an existing sufficient index needs evidence, not a duplicate.
- **FR-009**: Every explicitly bot-enabled tier MUST have provisioned NORMAL+SLOW SYSTEM bankrolls and enabled per-tier policy. 100 NORMAL=`POKER_BOT_BANKROLL_100`, 500 NORMAL=`POKER_BOT_BANKROLL`, SLOW=`POKER_BOT_SLOW_BANKROLL_100`/`POKER_BOT_SLOW_BANKROLL_500`. Catalog presence alone must not enable bots.
- **FR-010**: Runtime seed, replacement and managed top-up MUST consume existing exact tier/class funds only, without runtime MINT or cross-class/cross-tier/TREASURY fallback. Resolve effective seated classes before positive funding; sticky SLOW-only uses SLOW funds. An effective RESTRICTED human allows legal settlement but authorizes no new bot seed, replacement or managed top-up. Preserve original source attribution and terminal returns.
- **FR-011**: Admin per-tier NORMAL/SLOW policy MUST expose independent threshold, refill chunk, hourly liquidity cap and explicit Unlimited toggle. SQL NULL means Unlimited; finite positive safe bigint means fresh refill MINT allowance per exact UTC hour. Omitted cap fields preserve locked existing values; explicit NULL sets Unlimited. Existing revision and actor/timestamp audit remain.
- **FR-012**: On real authoritative positive bot-funding demand, DB MUST read current exact tier/class policy and balance. Below threshold OR insufficient legal debit may trigger at most one chunk bounded by remaining hourly cap. If that chunk cannot make the legal debit possible, do not MINT a useless partial amount. No refill loop or catch-up. Existing carried balance does not consume cap; lowering cap never claws back issued funds.
- **FR-013**: Refill MUST use balanced GENESIS -> exact SYSTEM pool ledger, existing registry/sequence triggers, DB UTC time, pool/hour serialization and exact entries-to-accounts aggregation. Same funding identity/bucket retries cannot double-MINT, including policy edits. Distinct demands may MINT multiple chunks while allowance remains. Replace one-per-pool/hour uniqueness with a non-unique bounded lookup. Next hour supplies fresh allowance without reset job.
- **FR-014**: Final refill authority MUST be funding demand only, with no recurring scheduler. During rollout the existing hourly Cron wrapper uses the same DB cap core and ledger allowance as demand. Retain global refill control and fail-closed database identity. Remove exact poker Cron and scheduled wrapper only after accepted Stage smoke and separate GO; inspect other jobs before optional pg_cron cleanup.
- **FR-015**: Existing WS `activeLobbyTablesById`/`lobby_snapshot` MUST remain live inventory; add only `slowOnly`, minimal `botCount`/lifecycle compatibility and effective self class for filtering, preserving resume and authoritative JOIN revalidation. RESTRICTED fresh targets require ordinary bot-free occupancy. No personalized WS matchmaking or per-subscriber×table DB queries.
- **FR-016**: Existing DB-backed Quick Seat MUST retain resume preference, add NORMAL/SLOW/RESTRICTED compatibility and constrained Create fallback; RESTRICTED selects only ordinary bot-free targets and final JOIN rejects stale targets. No WS migration of selection.
- **FR-017**: Admin Users/Ops MUST show automatic/override/effective state, allow an authorized FORCE_RESTRICTED override in the existing flow, and retain dynamic access/per-tier policy tuning with audit and cache convergence. No public self-override or generic configuration/moderation framework.
- **FR-018**: `has_human_participant` MUST become true only on accepted human admission/rejoin and never reset. Denied classification does not consume a slot/seat or falsify this marker.
- **FR-019**: CONTINUOUS_BOT MUST retain existing lifecycle, ordinary exact NORMAL funding and denial of fresh SLOW or RESTRICTED; no separate SLOW/RESTRICTED lifecycle. Existing seated transition never kicks/aborts; preserve financed actions, rejoin, settlement, leave/cash-out and future SLOW funding without rotation into an ordinary funded target.
- **FR-020**: Only fundamental deterministic backend/runtime/transaction tests are required. Reuse existing packages/methods; JSP/global JS compatibility, `klog` logging, CSS one selector per line, CSP SHA if future inline script is added. No broad UI/CSS/JSP/glue suites.
- **FR-021**: Normal DB Stage Apply PR intentionally applies two forward-only §32 migrations (104 -> 106): nullable caps/defaults, non-unique pool/hour lookup, trusted demand core and shared-cap replacement for the active Cron wrapper. Existing enabled control and Cron state are preserved. Migrations invoke no refill/MINT and do not change balances/pools/tables/profiles. Exact-SHA WS Preview and relevant smoke required; Stage Cron removal after acceptance and all Production mutations require separate GO. No automatic merge.

### Key Entities *(include if feature involves data)*

- **User access**: sticky automatic class, override, effective derived class and audit/revision.
- **Access policy**: dynamic positive SLOW threshold and revision/audit.
- **Manual restriction**: FORCE_RESTRICTED override with effective RESTRICTED, no automatic classifier, bankroll, refill policy or table marker.
- **Table participation**: sticky SLOW-only marker, owned pending and financed active membership; limits apply per user, not per class.
- **Tier pools/policy**: two exact SYSTEM bankrolls per enabled tier, thresholds/amounts/revision; historical funding provenance retained.
- **Scheduled refill**: one pool/bucket allowance and revision-specific ledger identity using existing audit/idempotency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All threshold, override, promotion and fresh-admission scenarios produce the expected class; existing financed hands/rejoin/payout complete without a classification-induced loss.
- **SC-002**: Under concurrent requests, one user never exceeds four active or four pending tables; rejected fifth requests transfer zero CH and create zero table artifacts.
- **SC-003**: Every new bot transfer debits its exact tier/class pool; runtime emits zero new CH and all terminal returns preserve provenance.
- **SC-004**: Every pool receives zero or one configured refill amount per UTC-hour bucket, including retry/revision races and missed runs; no duplicate issuance.
- **SC-005**: Admin changes become effective without deploy; unauthorized changes produce zero mutations, and below-threshold settled hands add zero classification reads/writes.
- **SC-006**: Both existing discovery paths preserve resume, expose compatible fresh targets and cannot bypass final class/slot validation.
- **SC-007**: FORCE_RESTRICTED is Admin-only and manual-only; fresh restricted admission is ordinary bot-free with zero new bot funding, while financed rejoin, settlement, leave and cash-out remain legal.

## Assumptions

- Economic containment, not fraud detection: below-threshold farming, Sybil/multiple accounts, split wallet/table wealth, and up to four active tables per account remain accepted residual risks. SLOW can exhaust its current chunk before the next refill.
- FORCE_NORMAL and FORCE_RESTRICTED are intentional effective-state overrides; automatic SLOW detection and persistence continue independently. Return to AUTO needs no new threshold check; Admin access Save succeeds only after synchronous exact-revision/override WS confirmation; periodic refresh is a safety backstop. RESTRICTED is manual-only and never receives a bankroll/refill policy or `is_restricted_only` table marker. Technical cache/revision/locking choices are documented in plan/contracts, not additional economic policy.
- Issue's 100/500 refill values are initial Stage tuning examples; Production settings/activation require explicit approval. No new tier is enabled merely because progression lists it.
- #869/#1017 and #870 remain separate. Legacy directory/contract filenames identify this existing PR, not a retained farmer-only architecture.

## §32 current requirements

Authoritative positive funding demand is the sole final refill authority. Exact NORMAL/SLOW tier policy has independent threshold, chunk and nullable hourly cap (NULL Unlimited). Aggregate current UTC-hour fresh MINTs count; carried balance does not. At most one useful chunk per demand, capped by remaining allowance; no reset job or catch-up loop. Replay never double-MINTs; concurrent demands serialize. RESTRICTED/cross-tier/cross-class/TREASURY fallback is forbidden. Admin changes apply on the next DB decision, with explicit Unlimited toggles; omitted fields preserve existing caps. Existing control and database identity remain fail-closed. During rollout Cron uses the same allowance; removal requires accepted Stage smoke and separate GO.

### Intended automatic shared Stage effect before push

Read-only Stage baseline: 104 applied migrations; neither §32 migration applied; canonical identity `7656985631720456337`; control enabled; one active Cron `poker-bot-pool-refill-hourly` (`0 * * * *`).

Normal `DB Stage Apply PR` intentionally applies `20261001200000_poker_demand_refill_caps.sql` and `20261003183317_poker_demand_refill_core.sql`: add nullable caps/constraints; initialize NORMAL Unlimited and SLOW from existing chunk; drop old one-per-hour unique index; install non-unique pool/bucket lookup; install restricted-access demand DB core; replace active Cron wrapper with shared-cap accounting. Expected inventory 104 -> 106. Existing enabled control and active Cron remain enabled; subsequent scheduled calls use the new shared allowance, and exact-SHA WS Preview deployment activates demand calls against Stage. The migration itself creates no MINT/ledger entries, balances, pools, tables, profiles or jobs and does not invoke refill. No already-applied migration changes. Production equivalent is prepared in `supabase/production-migrations/20261003183626_poker_demand_refill_production_contract.sql` with Production project/system identity guards; it is never auto-applied.


See [plan.md](plan.md) and [quickstart.md](quickstart.md) for implementation and pending evidence.
