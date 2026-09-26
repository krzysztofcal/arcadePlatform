# Feature Specification: NORMAL/SLOW per-tier poker pools

**Feature Branch**: `docs/issue-1018-bot-quarantine`

**Created**: 2026-09-26

**Status**: Draft — documentation only; independent approval and separate implementation instruction required.

**Input**: Live [GitHub #1018](https://github.com/krzysztofcal/arcadePlatform/issues/1018), captured in [issue-source.md](issue-source.md). Sole requirements source; supersedes previous #1019 designs. SLOW here is not #869 rolling-12h SLOW.

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

Operations replenish each eligible pool once per three-hour bucket, independently of poker play.

**Why this priority**: Caps each pool's short-term replenishment while maintaining regular availability.

**Independent Test**: Fixed clock, pool balance threshold, retry/concurrency, policy change and missed-bucket scenarios.

**Acceptance Scenarios**:

1. **Given** an enabled pool below threshold, **When** its current UTC 3h bucket runs, **Then** exactly one configured amount is issued; balance equal to or above threshold issues zero.
2. **Given** a committed refill, **When** dispatch retries or policy changes in the same bucket, **Then** that pool receives no second refill; old-revision retries recover the original result.
3. **Given** nine hours of missed dispatches, **When** the scheduler resumes, **Then** only the current bucket is considered, without backlog or refill-until-target.

### User Story 5 - Tune access and economics through Admin (Priority: P2)

An authorized administrator adjusts user override, SLOW threshold and per-tier refill settings without deploys.

**Why this priority**: Existing Admin controls provide operational correction without a moderation product.

**Independent Test**: Authorized/unauthorized backend requests, revision conflicts, cache propagation and override precedence.

**Acceptance Scenarios**:

1. **Given** automatic SLOW, **When** FORCE_NORMAL is active, **Then** effective class is NORMAL; FORCE_SLOW forces SLOW below threshold; AUTO restores durable automatic state. Overrides never erase automatic SLOW or revert SLOW-only tables.
2. **Given** a saved threshold/override revision, **When** the next relevant authoritative check uses it, **Then** the revised effective class is applied without deploy or per-hand database reads.
3. **Given** an unauthorized caller or invalid CH amount, **When** a policy/override mutation is attempted, **Then** reject without mutation. Successful changes record actor/time/revision.

### User Story 6 - Discover compatible play through existing entry points (Priority: P2)

Players use the current live lobby and Quick Seat, with class compatibility and existing resume preference.

**Why this priority**: Avoids incompatible fresh targets while retaining the current discovery architecture.

**Independent Test**: Existing lobby snapshot metadata and DB recommendation behavior, followed by authoritative JOIN with stale information.

**Acceptance Scenarios**:

1. **Given** NORMAL/SLOW, **When** viewing live tables, **Then** incompatible fresh targets are filtered/marked and own financed resume remains available; no per-viewer table queries are introduced.
2. **Given** Quick Seat, **When** choosing a candidate, **Then** valid existing participation is preferred, fresh candidates match class, Create fallback respects pending limits, and final JOIN revalidates stale recommendations.

### Edge Cases

- Threshold−1/equal, threshold revision change, FORCE_NORMAL with above-threshold evidence, return to AUTO, cached state unavailable or invalidated.
- Multiple tables without global wealth summation; disconnected financed seats count active; concurrent Create/JOIN on distinct tables and another user's first JOIN into an owned pending table.
- Empty table with historical bot funding is not a safe promotion target; mixed participation, forced NORMAL on a sticky SLOW-only table and UNKNOWN during legal leave.
- Source exhaustion, unknown COMMIT, policy edit during refill, UTC bucket rollover, clock skew, duplicate dispatch and disabled/unprovisioned tiers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Durable automatic class MUST be NORMAL or sticky SLOW; override MUST be AUTO/FORCE_NORMAL/FORCE_SLOW, separate from automatic state. FORCE_NORMAL suppresses automatic SLOW effect while active; returning AUTO exposes the durable state. Future RESTRICTED is out of scope.
- **FR-002**: Final authoritative JOIN MUST evaluate authoritative wallet; existing settled-hand boundary MUST evaluate each active human's authoritative settled stack. Either value at or above dynamic `slow_threshold_ch` (initially 1,000,000,000 CH) establishes automatic SLOW. No wallet+multi-table wealth aggregation or background account scan.
- **FR-003**: Settled checks MUST use in-memory settled stacks and cached policy/access/override; zero per-hand reads for wallet/policy/account/override/tier policy, zero additional write below threshold without a real transition. Cache refresh/invalidation occurs outside the hand hot path; new admission/funding fails closed on unknown state, lawful payouts do not.
- **FR-004**: `poker_tables.is_slow_only` MUST be false by default and one-way true, surviving leave/restart/close. Effective NORMAL fresh admission is ordinary-only, effective SLOW is SLOW-only; existing financed resume remains legal. Known SLOW can promote a seated table; UNKNOWN cannot.
- **FR-005**: Create MUST retain empty unfunded STANDARD table/state/ESCROW. Only final authoritative JOIN may promote a SLOW user's own empty table with no human/bot seats and no prior bot funding; never another owner's, populated, prefunded or ordinary managed table.
- **FR-006**: Active participation MUST be limited to four distinct tables per user across classes; fresh fifth JOIN rejected before buy-in/bot funding, financed rejoin uses no new slot.
- **FR-007**: Pending empty OPEN STANDARD owned tables with no accepted human participation/bot funding MUST be limited to four; fifth direct/fallback Create rejected before table/state/ESCROW. First accepted JOIN transfers pending to active; closed tables excluded, no historical quota.
- **FR-008**: Create and final JOIN MUST share a user-scoped transaction advisory-lock contract around authoritative count/decision/mutation, race-safe across different tables and requests. Quick Seat/browser prechecks are not authority.
- **FR-009**: Every explicitly bot-enabled tier MUST have provisioned NORMAL+SLOW SYSTEM bankrolls and enabled per-tier policy. 100 NORMAL=`POKER_BOT_BANKROLL_100`, 500 NORMAL=`POKER_BOT_BANKROLL`, SLOW=`POKER_BOT_SLOW_BANKROLL_100`/`POKER_BOT_SLOW_BANKROLL_500`. Catalog presence alone must not enable bots.
- **FR-010**: Runtime seed, replacement and managed top-up MUST consume existing exact tier/class funds only, without runtime MINT or cross-class/cross-tier/TREASURY fallback. Resolve effective seated classes before positive funding; sticky SLOW-only uses SLOW funds. Preserve original source attribution and terminal returns.
- **FR-011**: Per-tier policy MUST expose `buy_in`, `enabled`, `normal_refill_threshold_ch`, `normal_refill_amount_ch`, `slow_refill_threshold_ch`, `slow_refill_amount_ch`, monotonic revision and actor/time metadata. Use threshold terminology consistently.
- **FR-012**: Every 3h, each enabled exact pool below its threshold MAY receive one configured amount; at most one per pool/current UTC bucket, never refill-until-target, multiple chunks or backlog catch-up. Policy changes cannot reopen an already consumed pool bucket.
- **FR-013**: Refill MUST use existing balanced ledger/idempotency, GENESIS→exact bankroll; deterministic identity includes bankroll+policy revision+UTC 3h bucket. Retry/unknown COMMIT must not duplicate issuance. No permanent refill receipt table or table-linked refill-MINT retention machinery; retain normal ledger/audit history.
- **FR-014**: Primary wake-up MUST reuse VPS/systemd→authenticated workflow_dispatch→GitHub-hosted job every 3h. VPS holds no DB credentials or mutation logic; native GitHub cron is not authoritative.
- **FR-015**: Existing WS `activeLobbyTablesById`/`lobby_snapshot` MUST remain live inventory; add only `slowOnly` compatibility and effective self class for filtering, preserving resume and authoritative JOIN revalidation. No personalized WS matchmaking or per-subscriber×table DB queries.
- **FR-016**: Existing DB-backed Quick Seat MUST retain resume preference, add NORMAL/SLOW compatibility and constrained Create fallback; final JOIN rejects stale targets. No WS migration of selection.
- **FR-017**: Admin Users/Ops MUST show automatic/override/effective class, allow authorized override and dynamic access/per-tier policy tuning with audit and cache convergence. No public self-override or generic configuration/moderation framework.
- **FR-018**: `has_human_participant` MUST become true only on accepted human admission/rejoin and never reset. Denied classification does not consume a slot/seat or falsify this marker.
- **FR-019**: CONTINUOUS_BOT MUST retain existing lifecycle, ordinary exact NORMAL funding and denial of fresh SLOW; no separate SLOW lifecycle. Existing seated transition never kicks/aborts; preserve financed actions, rejoin, settlement, leave/cash-out and future SLOW funding without rotation into an ordinary funded target.
- **FR-020**: Only fundamental deterministic backend/runtime/transaction tests are required. Reuse existing packages/methods; JSP/global JS compatibility, `klog` logging, CSS one selector per line, CSP SHA if future inline script is added. No broad UI/CSS/JSP/glue suites.
- **FR-021**: This PR MUST stay docs-only. Future same-repo migrations intentionally apply shared Stage via DB Stage Apply PR, declared before publication, forward-only once applied; exact-SHA WS Preview/runtime verification required for future runtime work. Production migration/seed/refill/scheduler activation require separate authorization. STOP before implementation.

### Key Entities *(include if feature involves data)*

- **User access**: sticky automatic class, override, effective derived class and audit/revision.
- **Access policy**: dynamic positive SLOW threshold and revision/audit.
- **Table participation**: sticky SLOW-only marker, owned pending and financed active membership; limits apply per user, not per class.
- **Tier pools/policy**: two exact SYSTEM bankrolls per enabled tier, thresholds/amounts/revision; historical funding provenance retained.
- **Scheduled refill**: one pool/bucket allowance and revision-specific ledger identity using existing audit/idempotency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All threshold, override, promotion and fresh-admission scenarios produce the expected class; existing financed hands/rejoin/payout complete without a classification-induced loss.
- **SC-002**: Under concurrent requests, one user never exceeds four active or four pending tables; rejected fifth requests transfer zero CH and create zero table artifacts.
- **SC-003**: Every new bot transfer debits its exact tier/class pool; runtime emits zero new CH and all terminal returns preserve provenance.
- **SC-004**: Every pool receives zero or one configured refill amount per UTC 3h bucket, including retry/revision races and missed dispatches; no duplicate issuance.
- **SC-005**: Admin changes become effective without deploy; unauthorized changes produce zero mutations, and below-threshold settled hands add zero classification reads/writes.
- **SC-006**: Both existing discovery paths preserve resume, expose compatible fresh targets and cannot bypass final class/slot validation.

## Assumptions

- Economic containment, not fraud detection: below-threshold farming, Sybil/multiple accounts, split wallet/table wealth, and up to four active tables per account remain accepted residual risks. SLOW can exhaust its current chunk before the next refill.
- FORCE_NORMAL is an intentional operator bypass; automatic SLOW is retained separately. Technical cache/revision/locking choices are documented in plan/contracts, not additional economic policy.
- Issue's 100/500 refill values are initial Stage tuning examples; Production settings/activation require explicit approval. No new tier is enabled merely because progression lists it.
- #869/#1017 and #870 remain separate. Legacy directory/contract filenames identify this existing PR, not a retained farmer-only architecture.
