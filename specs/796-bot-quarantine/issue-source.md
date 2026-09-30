# Issue source: #1018

**Authoritative requirements**: https://github.com/krzysztofcal/arcadePlatform/issues/1018

**Live updated_at**: 2026-09-29T20:57:47Z

**Snapshot captured**: 2026-09-30. Exact live issue body below. Live #1018 is the sole feature requirements source. #869/#1017 remain separate.

# Poker: simplified anti-farming alternative — periodic per-tier bot bankroll refill + SLOW pool

## Status / relation

This is an **alternative to #869**, not an extension of it.

The goal is to keep anti-farming materially simpler than the full FAST/SLOW / per-user exposure design while still:

- protecting ordinary-player bot availability;
- slowing extreme farmers without removing bot play;
- isolating bot liquidity by tier and by NORMAL/SLOW class;
- allowing operator overrides and live policy tuning without deploys;
- reusing the existing authoritative WS runtime, live lobby, Quick Seat, ledger, Admin and VPS scheduler patterns.

Implementation T001–T029 is now present in PR #1019 and the first #1018 migration is already applied to shared Stage. Before merge, this issue is amended to add the final manual **RESTRICTED** operator state described below.

This amendment authorizes implementation of the RESTRICTED extension in PR #1019, including one new ordinary forward-only Stage migration through the repository's existing automatic DB Stage Apply PR flow and a new exact-SHA WS Preview verification. It does **not** authorize Stage refill/MINT, bot-pool funding, live-VPS scheduler activation, Production migration/cutover/refill, or merge. Those remain separate explicit gates.

#869/#1017 remain separate and unchanged.

> Terminology note: **SLOW in #1018 is NOT the rolling-12h SLOW allowance/class from #869.** Here SLOW is only a simple durable access class whose bot play uses a smaller, separately replenished bankroll.

---

## Core idea

Do **not** mint chips during JOIN, bot seed, replacement or top-up.

Instead:

1. automatically classify users only as NORMAL or SLOW, with an additional manual-only RESTRICTED override;
2. give every bot-enabled tier its own NORMAL bankroll and its own SLOW bankroll;
3. let poker runtime consume those bankrolls through the existing TABLE_BUY_IN flow;
4. every 3 hours, check each enabled bankroll;
5. if a bankroll is below its configured refill threshold, post one configured refill amount for that bucket;
6. use the existing WS live lobby and existing DB-backed Quick Seat with NORMAL/SLOW/RESTRICTED compatibility added;
7. keep all values operator-tunable through small purpose-specific Admin policy controls, not a generic configuration framework.

RESTRICTED is deliberately **not** an automatic class and has no bankroll/refill pool. It is an administrator-only effective state meaning human-only poker: fresh admission must not place the user at a table with bots and the user's presence must not authorize any new bot seed, replacement or managed top-up.

There is no per-user bot budget, no per-funding MINT and no personalized matchmaking engine.

---

## 1. Automatic NORMAL / SLOW classification

Keep two durable automatic poker access states:

- `NORMAL`
- `SLOW`

Initial automatic threshold:

- `slow_threshold_ch = 1_000_000_000`

Automatic SLOW is sticky: once the automatic state becomes SLOW, falling below the threshold does not automatically return it to NORMAL.

Do not add:

- FAST allowance;
- rolling-12h allowance;
- EXPOSURE accounting;
- global wealth scanner;
- ML/fraud framework;
- background sweep of all accounts.

### Classification evidence

Automatic classification must not depend only on leave/rejoin.

Evaluate the threshold at these authoritative control points:

1. **final WS JOIN** — compare authoritative USER wallet balance with `slow_threshold_ch`;
2. **settled-hand boundary** — after a hand is authoritatively settled, compare each active human's settled authoritative table stack with `slow_threshold_ch`;
3. **before new positive bot funding on a human table** — resolve the current effective class before allowing new funding.

If either authoritative USER wallet balance or an authoritative settled table stack is >= `slow_threshold_ch`, persist automatic SLOW.

This closes the case where a player stays at one table indefinitely: they do not need to leave or rejoin to become SLOW. A player who keeps winning at the same table is re-evaluated after settled hands.

Reuse the existing settled rollover boundary around:

- `ws-server/server.mjs::runSettledRolloverCommand`;
- existing `prepareSettledHandRollover` / `commitSettledHandRollover` flow.

Do not create a second hand-settlement path.

### Deliberately accepted limitation

V1 does **not** compute global wealth as:

`wallet + stacks across every concurrent table`.

For example, 600m in USER wallet plus 500m split across other tables may remain below the detector if no single authoritative checked value reaches the threshold.

That residual gap is accepted to keep #1018 materially simpler than #869.

---

## 2. Dynamic SLOW threshold

`slow_threshold_ch` must be changeable by an authorized administrator **without a deploy**.

Use one small purpose-specific backend policy record for poker access, including at minimum:

- `slow_threshold_ch`;
- monotonic `revision`;
- `updated_at`;
- `updated_by`.

Do not create a generic settings/configuration framework.

Admin Ops exposes a minimal control such as:

- **SLOW threshold**
- current value;
- new positive safe-integer CH value;
- Save.

The next authoritative classification reads/uses the current policy revision/value.

Changing the threshold does not automatically scan every account and does not automatically un-SLOW existing sticky users. Existing users are re-evaluated at the normal authoritative control points.

### Supabase / WS performance guardrails

The classification path must not add query-per-hand behavior.

- cache the current poker access policy (`slow_threshold_ch` + revision) in WS memory outside the hand-settlement hot path;
- cache the connected player's durable/override access snapshot needed for settled-hand evaluation; refresh/invalidate it on the smallest existing admin/runtime boundary or by a bounded low-frequency safety refresh, never by a DB read for every hand;
- settled-hand SLOW evaluation must use the authoritative settled human stack already produced by the existing rollover/state path;
- comparing settled stacks with the cached threshold is an in-memory operation bounded to the active humans at that table;
- do not read USER wallet, access policy, override or tier-refill policy from Supabase once per hand merely to repeat information that is already authoritative/cached;
- persist only an actual durable transition (for example automatic NORMAL→SLOW), required table-marker change, or another existing persistence mutation; a normal below-threshold hand adds no classification DB write;
- no global account scan, no all-table wealth aggregation, and no per-hand scan of other tables;
- lobby compatibility must reuse the existing `activeLobbyTablesById` / `lobby_snapshot` path. Do not add per-subscriber × per-table server-side personalized matching work for #1018.

Admin policy/override writes must make the WS cache converge promptly enough for the next relevant control point, but the implementation must choose the smallest existing invalidation/refresh mechanism rather than introduce a generic config-distribution service.

---

## 3. Manual administrator override

Keep the automatic durable state separate from a manual override.

Automatic durable values remain only:

- `NORMAL`
- `SLOW`

Allowed override values:

- `AUTO`
- `FORCE_NORMAL`
- `FORCE_SLOW`
- `FORCE_RESTRICTED`

Effective state:

- FORCE_NORMAL => NORMAL;
- FORCE_SLOW => SLOW;
- FORCE_RESTRICTED => RESTRICTED;
- AUTO => durable automatic NORMAL/SLOW state.

Rules:

- RESTRICTED is **manual-only**. No wallet threshold, settled stack, background job or other automatic classifier may set it.
- FORCE_NORMAL suppresses automatic SLOW while active, even if wallet/stack remains above threshold.
- FORCE_SLOW can slow any user regardless of balance.
- FORCE_RESTRICTED makes fresh poker participation human-only: no fresh join to a bot-populated table and no new bot seed/replacement/top-up while the restricted participant is active.
- Return to AUTO restores the durable automatic NORMAL/SLOW state; RESTRICTED is not persisted as automatic evidence.
- public/browser callers cannot set their own override;
- record minimal audit metadata using existing Admin patterns: who changed it and when.

An override changes future authoritative admission/funding behavior. It does not abort a hand, invalidate lawful settlement/cash-out, or rewrite historical bot funding.

If FORCE_RESTRICTED is applied while a user is already seated with already-financed bots, do **not** unwind escrow, kick seats mid-hand or invent a second settlement path. The current legal hand/financed participation may resolve normally, but no new bot seed, replacement or managed top-up may be created while RESTRICTED remains effective. Existing bot seats may age out through the existing lifecycle without replenishment.

Reuse the existing authenticated Admin Users / `admin-*` patterns. Do not create a generic moderation system or third automatic classifier.

---

## 4. Persistent SLOW-only table marker

Add one minimal one-way field:

- `poker_tables.is_slow_only boolean NOT NULL DEFAULT false`

Rules:

- false→true allowed;
- true→false forbidden;
- survives leave/restart/close;
- independent of existing `STANDARD` / `CONTINUOUS_BOT` lifecycle;
- no generalized table-class framework.

Fresh admission:

- effective NORMAL → ordinary table only;
- effective SLOW → SLOW-only table only;
- effective RESTRICTED → ordinary, bot-free STANDARD table only; never SLOW-only or CONTINUOUS_BOT.

RESTRICTED is a user state, not a persistent table class: do not add `is_restricted_only` or another table marker.

Existing financed rejoin remains legal, including lawful recovery/leave/cash-out of participation that predates an override change.

FORCE_NORMAL does not turn an existing SLOW-only table back into an ordinary table.

---

## 5. First SLOW player: reuse existing Create → final JOIN

Keep Netlify Create simple.

`createPokerTableWithState` continues to create the current empty STANDARD table/state/ESCROW without bot funding.

At final authoritative WS JOIN:

- resolve effective NORMAL/SLOW/RESTRICTED;
- NORMAL follows ordinary admission;
- RESTRICTED may join only an ordinary bot-free STANDARD table; the user's own empty Create→JOIN table is valid and must seed zero bots;
- SLOW may promote the table to `is_slow_only=true` only when it is:
  - created by that user;
  - empty;
  - has no human/bot seats;
  - has no prior bot funding;
- then admit the player and use the tier's SLOW bankroll for bot seed.

An effective SLOW user must not claim/relabel:

- another user's ordinary table;
- an ordinary populated table;
- a prefunded bot-only table;
- a normal CONTINUOUS_BOT table.

An effective RESTRICTED user must not freshly join:

- any table with an active bot seat;
- any table with bot funding already materialized for current participation;
- any SLOW-only table;
- any CONTINUOUS_BOT table.

A RESTRICTED fresh JOIN must set bot target funding to zero and must not create TABLE_BUY_IN entries from any bot bankroll/TREASURY source.

---

## 6. Per-user table fan-out limits

Add two hard V1 anti-abuse limits:

- `max_active_tables_per_user = 4`;
- `max_pending_tables_per_user = 4`.

These limits apply to NORMAL, SLOW and RESTRICTED equally.

### Active-table limit

A user may have at most **4 distinct active poker tables** at once.

Count a table as active for the user when the user has a current active human seat / financed participation on that table.

Rules:

- rejoin/resume to one of the user's already-active tables is always allowed and consumes no new slot;
- a fresh JOIN that would create a fifth active table is rejected before user buy-in or bot funding;
- Quick Seat must prefer/reuse valid existing participation and must not bypass the same authoritative fresh-JOIN limit;
- NORMAL/SLOW class does not change the count; all active tables for that user share the same limit.

The final authoritative WS JOIN remains the enforcement point for the active-table limit.

### Pending-table limit

A user may own at most **4 pending empty OPEN tables** at once.

For #1018, a pending table means an OPEN STANDARD table created by that user that has not yet become active human participation and remains safe/unfunded for the Create→JOIN path, including no accepted human seat and no bot funding.

Rules:

- direct Create and Quick Seat Create fallback must enforce the same pending-table limit;
- a fifth pending Create is rejected rather than creating another table/state/ESCROW;
- when a pending table receives its first accepted human JOIN, it stops counting as pending and begins counting toward the active-table limit;
- closed/terminal tables do not count;
- do not use table creation count/history as a permanent quota.

### Concurrency safety

The limit must be race-safe across different table IDs.

Reuse a small PostgreSQL user-scoped transaction advisory lock around the authoritative count + Create/JOIN decision, for example a stable lock namespace derived from the poker table-limit policy and user ID.

Both:

- `poker-create-table.mjs` / Create fallback;
- `executePokerJoinAuthoritative()`;

must participate in the same user-scoped lock contract before consuming a new pending or active slot.

Do not rely on browser state, lobby state, or an application-only precheck. Parallel Create/JOIN requests must not allow 5+ pending or 5+ active tables.

Do not build a generic quota service.

---

## 7. Bankroll isolation is per bot-enabled tier

Every tier for which bots are actually enabled must have:

1. one NORMAL SYSTEM bankroll;
2. one SLOW SYSTEM bankroll.

This prevents a high tier from consuming liquidity intended for a low tier.

### Current tiers

For 100 CH:

- NORMAL: `POKER_BOT_BANKROLL_100`
- SLOW: `POKER_BOT_SLOW_BANKROLL_100`

For 500 CH:

- NORMAL: keep existing `POKER_BOT_BANKROLL` to preserve existing naming/provenance;
- SLOW: `POKER_BOT_SLOW_BANKROLL_500`

Historical bots funded from TREASURY or the existing 500 bankroll retain their original funding provenance. Do not rewrite old history.

### Future tiers

The current poker progression catalog already supports future tiers such as 1k, 5k, 10k and higher.

When bot play is explicitly enabled for a new tier, provision that tier's NORMAL and SLOW bankrolls and its refill policy first.

Do **not** automatically enable bot funding for every tier present in `POKER_BUY_IN_TIERS_JSON`.

A tier with no explicitly enabled bot funding policy remains human-only / no new bot funding according to existing capability rules.

---

## 8. Per-tier refill policy — dynamically tunable

Each bot-enabled tier gets one purpose-specific policy row containing at minimum:

- `buy_in`;
- `enabled`;
- `normal_refill_threshold_ch`;
- `normal_refill_amount_ch`;
- `slow_refill_threshold_ch`;
- `slow_refill_amount_ch`;
- monotonic `revision`;
- `updated_at`;
- `updated_by`.

Use **threshold** consistently in schema/docs/Admin terminology.

Meaning:

- `*_refill_threshold_ch` = bankroll balance below which the refill is eligible;
- `*_refill_amount_ch` = fixed amount added by one eligible scheduler bucket.

Example for 100 CH:

- NORMAL threshold 2,000; amount +5,000;
- SLOW threshold 1,000; amount +2,000.

Example for 500 CH:

- NORMAL threshold 5,000; amount +10,000;
- SLOW threshold 2,000; amount +5,000.

These are initial Stage-tuning values, not hard-coded economic constants.

Admin Ops must allow authorized tuning of refill threshold and refill amount per enabled tier without a code deploy.

Do not add per-user funding settings.

---

## 9. Frequent small refill every 3 hours

Refill is a separate operational action, not part of game runtime funding.

The refill scheduler wakes **every 3 hours**.

For every enabled tier, independently evaluate:

1. NORMAL bankroll;
2. SLOW bankroll.

For each pool:

1. read current balance;
2. read current policy revision/settings;
3. if balance < that pool's `refill_threshold_ch`, post one `refill_amount_ch`;
4. otherwise do nothing.

Rules:

- at most one refill amount per pool per 3-hour bucket;
- no refill-until-target loop;
- no multiple chunks in one run;
- no backlog catch-up;
- missed buckets are not minted later.

If the scheduler misses 9 hours, the next successful run may post only the current bucket's one eligible refill per pool.

This spreads liquidity throughout the day instead of allowing one large weekly allocation to be consumed immediately.

---

## 10. Refill idempotency and ledger

Use the existing append-only balanced ledger and idempotency mechanisms.

A refill is:

`GENESIS → exact tier/class SYSTEM bankroll`

Deterministic identity includes at minimum:

- exact bankroll system key;
- policy revision;
- 3-hour UTC bucket.

Retrying the same bucket/policy cannot mint twice.

Do not create a new permanent refill receipt table.

There is **no runtime MINT** in:

- JOIN;
- initial bot seed;
- replacement;
- managed top-up.

Poker runtime only moves existing funds:

`SYSTEM bankroll → table ESCROW`.

Because scheduled refill MINTs are low-volume system operations rather than one MINT per table funding, do not add the previous table-linked typed-MINT 7d/30d retention machinery solely for #1018.

Keep normal ledger/audit history.

---

## 11. Funding-source selection

Funding source selection is class + tier aware.

Conceptually:

- NORMAL + tier T → NORMAL bankroll for T;
- SLOW + tier T → SLOW bankroll for T;
- RESTRICTED → no bot funding source.

Do not create RESTRICTED bankrolls or refill policy rows.

No fallback:

- SLOW → NORMAL bankroll;
- SLOW → TREASURY;
- one tier → another tier.

If an exact required bankroll is empty, the affected bot funding follows the existing safe no-funding behavior until a later refill.

Reuse existing source attribution so terminal bot cash-out returns remaining bot funds according to the actual source that funded that bot.

---

## 12. Lobby — keep current WS live-table inventory

#1018 requires a small lobby compatibility change, not a new lobby architecture.

Live main already uses:

`tableManager → activeLobbyTablesById → buildLobbySnapshotPayload() → lobby_snapshot → poker.js`

Keep that WS live registry as the ordinary visible live-table inventory.

Minimum changes:

- project `isSlowOnly` into WS runtime/table metadata;
- add `slowOnly` to lobby table entries;
- resolve the logged-in user's effective NORMAL/SLOW/RESTRICTED state;
- expose/reuse the smallest existing lobby bot-occupancy fact needed for filtering (for example `botCount`/equivalent), without a second lobby architecture;
- `poker.js::canViewLobbyTable()` filters/marks incompatible fresh JOIN targets:
  - NORMAL → ordinary tables;
  - SLOW → SLOW-only tables;
  - RESTRICTED → ordinary bot-free tables only;
  - own existing RESUME/rejoin remains available;
- final `executePokerJoinAuthoritative()` always revalidates.

Browser filtering is UX only, never admission authority.

A transitional mixed table that became SLOW-only while existing NORMAL participation is still resolving must not accept new NORMAL admissions.

Do not add:

- a second lobby engine;
- SQL replacement for the WS live list;
- per-viewer×table DB queries;
- #869 personalized WS offers/proofs.

---

## 13. Quick Seat — keep current DB flow, add class filter

Current `Graj teraz` / `poker-quick-seat.mjs` remains DB-backed.

Add only access compatibility:

- effective NORMAL fresh candidate → ordinary table;
- effective SLOW fresh candidate → SLOW-only table;
- effective RESTRICTED fresh candidate → ordinary bot-free STANDARD table only;
- preserve existing valid rejoin/resume preference;
- Create fallback may create the existing empty STANDARD table; for RESTRICTED this is the normal human-only fallback and final JOIN seeds zero bots;
- final WS JOIN may promote the SLOW user's own safe empty/unfunded table to SLOW-only;
- stale/incompatible recommendation is rejected by final JOIN.

Do not move Quick Seat selection into WS solely for #1018.

Therefore #1018 consciously keeps:

- visible live lobby inventory = WS;
- Quick Seat selection = existing Netlify/DB path;
- final admission/security = authoritative WS/DB JOIN.

This is intentionally simpler than #869 matchmaking.

---

## 14. If a seated player becomes SLOW

A seated player can become effective SLOW because:

- JOIN/funding sees automatic threshold;
- settled-hand stack crosses the threshold;
- administrator sets FORCE_SLOW.

Do not kick or abort a hand.

When SLOW is established at the authoritative control point:

- persist automatic SLOW when applicable;
- set current table `is_slow_only=true`;
- stop future NORMAL-bankroll bot funding at that table;
- future new bot funding uses the exact tier's SLOW bankroll;
- deny new NORMAL admissions;
- preserve current legal hand progression, settlement, financed rejoin, leave and cash-out.

Existing NORMAL players already seated may resolve their current financed participation naturally.

If admin later uses FORCE_NORMAL, the already SLOW-only table remains SLOW-only. Future fresh NORMAL participation uses ordinary tables.

UNKNOWN classification must not permanently set the table SLOW-only and must not block lawful payout. UNKNOWN fails closed for new admission/funding.

---

## 15. has_human_participant retention marker

Preserve existing bot-only retention semantics.

A JOIN that resolves/classifies SLOW but is denied must not falsely set:

- `poker_tables.has_human_participant=true`.

Set it only for an actually accepted human admission/rejoin.

Do not reset an existing true value.

---

## 16. CONTINUOUS_BOT

Keep the current managed/non-stop lifecycle.

Ordinary CONTINUOUS_BOT tables:

- remain ordinary/NORMAL;
- use the exact tier's NORMAL bankroll;
- deny fresh SLOW humans;
- deny fresh RESTRICTED humans.

Do not create a separate SLOW or RESTRICTED CONTINUOUS_BOT lifecycle in V1.

SLOW bot play uses the normal Create→final JOIN path. RESTRICTED play is human-only and uses ordinary bot-free STANDARD tables.

---

## 17. Admin scope

Reuse existing Admin Users / Admin Ops and authorization patterns.

### Per-user control

Show:

- durable automatic class;
- override: AUTO / FORCE_NORMAL / FORCE_SLOW / FORCE_RESTRICTED;
- effective state.

Actions:

- Force NORMAL;
- Force SLOW;
- Force RESTRICTED;
- Return to AUTO.

### Global access policy

Show/edit:

- `slow_threshold_ch`.

### Per-tier funding policy

For each explicitly bot-enabled tier show/edit:

- enabled status;
- NORMAL refill threshold;
- NORMAL refill amount;
- SLOW refill threshold;
- SLOW refill amount;
- current NORMAL/SLOW bankroll balances for operational visibility if available through the existing Admin data path.

Do not create a generic moderation/configuration product.

Admin writes must be backend-authorized and auditable.

Only fundamental backend behavior requires automated coverage; no broad Admin UI rendering suite.

Any browser JS must remain JSP/global-script compatible, use `klog`, and any added inline script requires CSP SHA. Prefer extending existing external `js/admin-page.js`.

---

## 18. Scheduler — VPS/systemd is the primary wake-up mechanism

Do **not** rely on native GitHub Actions `schedule` / cron as the authoritative trigger.

Reuse the already deployed Arcade pattern documented for chips-ledger automation:

`VPS systemd timer → authenticated GitHub Actions workflow_dispatch → GitHub-hosted workflow job`

The VPS is only the scheduler/wake-up service:

- no database credentials on VPS;
- no refill SQL/ledger mutation on VPS;
- it only dispatches the reviewed workflow on the intended ref/mode.

Run the refill dispatch every 3 hours.

A self-hosted runner is not required merely to solve GitHub scheduler reliability; the existing external systemd dispatcher pattern is sufficient unless later operational evidence requires otherwise.

Idempotent 3-hour bucket keys make duplicate dispatch safe.

---

## 19. What #1018 deliberately does NOT build

No:

- FAST allowance;
- #869 rolling-12h SLOW;
- per-user bot allowance;
- EXPOSURE accounting;
- SLOW_SHARED allowance semantics;
- 90/10 reserve;
- global drain;
- full wealth aggregation across all concurrent tables;
- per-funding MINT;
- MINT+TABLE_BUY_IN composite operation;
- refill receipt table;
- table-linked refill-MINT retention extension;
- personalized WS matchmaking engine;
- new lobby engine;
- generic policy/config framework;
- generic fraud/moderation framework.

---

## 20. Accepted residual risks

This simplified V1 intentionally accepts:

- multi-account farming below the threshold;
- NORMAL users farming below the threshold;
- combined wealth across wallet + multiple tables not being globally summed;
- a SLOW player temporarily draining their exact tier's current SLOW refill chunk before the next 3-hour refill;
- stale Quick Seat recommendations being rejected at final JOIN;
- operator FORCE_NORMAL intentionally bypassing automatic SLOW while active;
- one account can still farm on up to 4 active tables by design, but cannot fan out without bound;
- multi-account farming can multiply that 4-table allowance across accounts.

Per-tier SLOW pools prevent high-tier SLOW play from starving low-tier SLOW bot liquidity. The 4-active / 4-pending limits cap one account's parallel table fan-out but are not identity-level Sybil protection.

---

## 21. Fundamental tests only

Plan only deterministic critical tests.

At minimum:

- wallet threshold−1 => automatic NORMAL; threshold => sticky SLOW;
- no automatic path can produce RESTRICTED;
- FORCE_RESTRICTED => effective RESTRICTED while durable automatic NORMAL/SLOW remains unchanged;
- Return to AUTO from FORCE_RESTRICTED restores the stored automatic NORMAL/SLOW state;
- RESTRICTED fresh own empty Create→JOIN succeeds with zero bot seed/funding;
- RESTRICTED fresh JOIN to a bot-populated, SLOW-only or CONTINUOUS_BOT table is rejected before buy-in/bot funding;
- RESTRICTED Quick Seat returns only valid bot-free ordinary candidate or existing legal rejoin/Create fallback;
- while a RESTRICTED participant is active, settled replacement/top-up creates zero new bot funding while legal settlement/cash-out remains valid;
- lobby compatibility excludes bot-populated/SLOW-only fresh targets for RESTRICTED while preserving legal RESUME/rejoin;
- settled human stack threshold−1 => unchanged; threshold => sticky automatic SLOW without leave/rejoin;
- changed `slow_threshold_ch` revision is used by subsequent authoritative checks without deploy;
- FORCE_NORMAL overrides automatic SLOW;
- FORCE_SLOW slows a below-threshold player;
- Return to AUTO restores durable automatic state;
- unauthorized caller cannot mutate user override/global policy/tier refill policy;
- four distinct active tables are allowed, while a fresh fifth JOIN is rejected before buy-in/bot funding;
- rejoin/resume to any of the user's four existing active tables remains allowed;
- four pending empty owned tables are allowed, while a fifth Create/Create fallback is rejected;
- parallel Create/JOIN attempts under the same user cannot exceed either limit;
- first accepted JOIN moves an owned table from pending count to active count without double-counting;
- SLOW may promote only own empty/unfunded table to SLOW-only;
- NORMAL cannot freshly join SLOW-only; SLOW cannot freshly join ordinary/prefunded/CONTINUOUS_BOT;
- lobby snapshot carries class compatibility and final JOIN revalidates;
- Quick Seat fresh candidate is class-compatible and stale recommendation is rejected;
- NORMAL and SLOW funding resolve to the exact tier/class bankroll;
- no cross-class, cross-tier or TREASURY fallback;
- empty pool causes no on-demand MINT;
- one eligible 3-hour bucket => exactly one configured refill amount;
- same policy revision + pool + bucket retry => no duplicate MINT;
- balance >= refill threshold => zero MINT;
- missed buckets are not caught up;
- policy change creates the intended new revision semantics without duplicating an already committed old-revision refill;
- settled transition NORMAL→SLOW does not interrupt legal settlement/cash-out;
- denied JOIN does not falsely set `has_human_participant`.

No broad UI/CSS/JSP or speculative matchmaking suites.

---

## 22. Breaking / operational impacts

- 100 CH NORMAL bot funding moves away from shared TREASURY after cutover.
- Every bot-enabled tier gains isolated NORMAL and SLOW bankroll semantics.
- Existing 500 NORMAL bankroll naming/provenance remains intact.
- SLOW users cannot freshly enter ordinary/prefunded/CONTINUOUS_BOT tables but still play with bots on SLOW-only tables.
- Admin can FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED and dynamically change SLOW threshold and per-tier refill settings.
- RESTRICTED is manual-only, has no dedicated bankroll/refill pool/table marker, and blocks new bot participation/funding for fresh human-only play.
- SLOW-only is sticky and not reverted by FORCE_NORMAL or FORCE_RESTRICTED.
- settled-hand processing gains a minimal SLOW-threshold evaluation hook; it must reuse existing authoritative settlement/rollover flow and must not create a second settlement path.
- Lobby rows gain SLOW compatibility metadata/filtering; current WS live registry remains the live-list authority.
- Quick Seat remains DB-backed but becomes class-aware and subject to the same authoritative per-user table limits.
- A single account is limited to 4 active poker tables and 4 pending empty owned tables; direct Create, Quick Seat fallback and final JOIN cannot bypass these limits.
- Production refill depends on VPS/systemd dispatch rather than native GitHub cron.
- Existing legal hands and payouts remain unaffected.

Future same-repo `supabase/migrations/**` intentionally mutate shared Stage through DB Stage Apply PR; the Spec Kit/PR must declare that effect before implementation. Applied Stage migrations are forward-only.

WS-affecting implementation requires exact-SHA `WS Preview Deploy` and runtime verification before merge-ready.

Production migration, bankroll seed, refill scheduler activation and MINT require separate explicit authorization.

---

## 23. Implementation / validation gate

PR #1019 already contains the reviewed NORMAL/SLOW implementation and completed T001–T029 evidence. This issue amendment adds one final pre-merge RESTRICTED extension. The existing applied Stage migration `20260927100000_poker_bot_quarantine_policy.sql` is immutable; RESTRICTED schema support must use a **new forward-only migration**.

The revised Spec Kit/implementation must:

- use live GitHub as source of truth and read `agents.md` / `skills.md`;
- keep automatic classes strictly NORMAL/SLOW and add manual-only AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED override semantics;
- clearly distinguish #1018 SLOW from #869 SLOW and RESTRICTED from automatic classification;
- include JOIN + settled-hand classification;
- keep settled-hand classification in-memory on authoritative rollover data with cached policy/access state and no per-hand Supabase reads;
- make `slow_threshold_ch` Admin-tunable without deploy;
- use NORMAL+SLOW bankrolls per explicitly bot-enabled tier;
- use `refill_threshold_ch` and `refill_amount_ch` terminology;
- make per-tier refill policy Admin-tunable without deploy;
- reuse the existing ledger, source attribution, Admin, WS live lobby, Quick Seat and VPS/systemd dispatcher patterns;
- preserve DB-backed Quick Seat rather than adding #869 matchmaking;
- make RESTRICTED fresh admission human-only across final JOIN, lobby and Quick Seat, with zero new bot seed/replacement/top-up and no new bankroll/refill/table-class abstraction;
- preserve existing legal hand/settlement/rejoin/leave/cash-out when an override changes;
- enforce max 4 active + max 4 pending tables per user with one shared concurrency-safe user lock contract across Create and authoritative JOIN;
- use VPS/systemd → workflow_dispatch as primary 3-hour scheduler;
- include only fundamental tests;
- explicitly declare the new forward-only Stage migration effect before publication; automatic DB Stage Apply PR is expected to mutate shared Stage;
- require a **new exact-SHA WS Preview Deploy/runtime smoke** after the RESTRICTED runtime change; the previous T029 runtime SHA remains historical evidence but is no longer the final merge gate;
- include only fundamental deterministic RESTRICTED tests by extending existing suites;
- STOP after green CI + new Preview evidence for independent review before merge.

No Stage refill/MINT, bot-pool funding activation, Production refill/mint/migration/cutover, VPS timer activation or merge without separate authorization.

---

## Related

- #869 — full FAST/SLOW per-user protected-budget + personalized WS matchmaking design; separate.
- #1019 — draft Spec Kit; must be rewritten for this simplified per-tier periodic-pool + SLOW design.
- #870 — future higher-tier bot liquidity; any tier must receive explicit per-tier bankroll/policy before bots are enabled.


---

## 24. Final pre-merge amendment — manual RESTRICTED

This section is authoritative where older wording above says access is only NORMAL/SLOW.

### Goal

Add one operator-controlled human-only poker state without expanding automatic anti-farming classification.

- durable automatic class remains only NORMAL/SLOW;
- add override `FORCE_RESTRICTED`;
- effective state may therefore be NORMAL, SLOW or RESTRICTED;
- no automatic condition may set RESTRICTED;
- no RESTRICTED bankroll, refill policy or table class is created.

### Runtime contract

For a fresh RESTRICTED user:

1. Create remains the existing empty STANDARD table path and still obeys 4 pending.
2. Final JOIN still obeys the same user advisory lock and 4 active limit.
3. JOIN is allowed only when the target is ordinary and bot-free; own empty table is valid.
4. Bot target count is zero and no new bot TABLE_BUY_IN/funding is allowed.
5. Quick Seat selects an existing legal rejoin first, otherwise only an ordinary bot-free fresh candidate, otherwise the existing empty Create fallback.
6. Lobby hides bot-populated, SLOW-only and CONTINUOUS_BOT tables as fresh targets while preserving legal resume/rejoin.
7. While a RESTRICTED participant is active, settled rollover may complete legal settlement but must not create replacement/top-up/new seed funding.
8. FORCE_RESTRICTED never turns a table SLOW-only and introduces no new persistent table marker.
9. Applying RESTRICTED to an already-financed live table does not abort/unwind the current hand or historical funding; it only blocks future bot funding/replenishment while active.
10. Return to AUTO restores the stored automatic NORMAL/SLOW state.

### Minimal implementation shape

Prefer the existing mechanisms and files:

- new forward-only migration under `supabase/migrations/**`: extend only the override CHECK to include `FORCE_RESTRICTED`; do not edit the already-applied migration;
- `shared/poker-domain/bot-access.mjs`: extend override/effective-state normalization while leaving automatic class and threshold logic NORMAL/SLOW only;
- `shared/poker-domain/join.mjs`: enforce bot-free RESTRICTED fresh admission and zero bot seed/funding;
- existing settled funding/cache path (`ws-server/server.mjs`, `ws-server/poker/runtime/settled-bot-funding.mjs`, `table-manager.mjs` only where needed): zero new bot funding while RESTRICTED is active, without per-hand DB reads;
- `netlify/functions/poker-quick-seat.mjs`: bot-free ordinary candidate filter;
- existing WS lobby payload + `poker/poker.js`: expose/reuse minimal bot occupancy and filter RESTRICTED fresh targets;
- `netlify/functions/admin-user-poker-access.mjs` + `js/admin-page.js`: add Force RESTRICTED using the existing revision/audit flow;
- WS access payload/cache normalization: accept RESTRICTED effective state while automatic class remains NORMAL/SLOW.

Do not create a generic restriction/moderation framework.

### Fundamental verification

Extend existing focused suites only. Prove:

- RESTRICTED cannot arise automatically;
- Admin-only FORCE_RESTRICTED + AUTO round-trip preserves durable automatic SLOW/NORMAL;
- fresh restricted own Create→JOIN has zero bots and zero new bot funding;
- bot-populated/SLOW-only/CONTINUOUS_BOT fresh JOIN is denied;
- Quick Seat/lobby respect bot-free human-only compatibility;
- 4+4 limits still apply;
- legal rejoin/settlement/cash-out are preserved;
- no new bot replacement/top-up while restricted is active;
- pre-migration Production compatibility remains intact;
- migration is forward-only and Stage apply is expected.

After runtime changes, perform a new exact-SHA WS Preview Deploy and manual smoke with FORCE_RESTRICTED before calling PR #1019 merge-ready.


---

## 25. Corrective pre-merge amendment — single-owner deterministic Admin access mutation

This section is authoritative for the Admin poker-access mutation path and supersedes the earlier multi-phase invalidate → Netlify DB write → refresh/confirm implementation shape.

### Problem found by owner T036

The authenticated Stage smoke exposed two correctness/operability failures:

1. poker_access_mutation_pending can survive after the request that created it is no longer making progress, so a later legal AUTO ↔ FORCE_* save may be blocked before any DB write.
2. Admin Save currently performs up to three WS confirmation attempts with an individual 4s timeout, so an ordinary override change can take roughly 12s plus DB/HTTP overhead. The 25s periodic access refresh and 30s cache TTL must not participate in the success semantics of Admin Save.

Stage read-only evidence after the failure showed the attempted override was not committed; the user remained AUTO / NORMAL at the previous revision while WS still held an in-memory pending barrier. This is a merge blocker.

### Correct ownership model

Replace the split protocol with one authoritative WS-owned mutation:

Admin UI → Netlify Admin auth → one internal WS mutation request → WS fail-close → one DB transaction → WS cache/socket refresh → release fail-close → exact ACK

The Netlify function remains the public Admin-auth boundary. WS becomes the sole owner of the access mutation transaction and its runtime synchronization.

There must be no durable/eventual pendingPokerAccessMutations recovery protocol for Admin Save.

### T038 — WS-owned mutation

Primary files/methods:

- ws-server/server.mjs
  - replace Admin use of beginPokerAccessMutation();
  - replace Admin use of refreshPokerAccessForUser();
  - add one bounded function such as mutatePokerAccessForUser({ userId, override, expectedRevision, actorId });
  - update handleInternalPokerAccessRefresh() to expose one explicit mutation action/phase through the existing Caddy-routed endpoint.
- reuse ws-server/poker/runtime/poker-access-propagation.mjs::persistAuthoritativeSlowOnlyForUser();
- reuse tableManager.setPokerAccessMutationFailClosed(), cachePokerAccessForUser(), markSlowOnlyTables().

Required behavior:

1. Use a minimal per-user in-memory active-mutation guard whose lifetime is exactly one WS request.
2. The guard and fail-closed marker are created at the start of the WS mutation and removed unconditionally in finally.
3. A genuinely concurrent second request receives a fast 409 poker_access_mutation_in_progress before any DB write.
4. The guard must never survive completion/failure of the request and must not depend on a periodic sweep.
5. If the WS process dies, the in-memory guard dies with it; any unfinished PostgreSQL transaction must roll back normally.

### T039 — one DB transaction inside WS

Inside the WS mutation, reuse the existing WS DB transaction loader and poker access helpers.

Transaction requirements:

1. Verify poker access schema capability.
2. Lock the exact USER account row with SELECT ... FOR UPDATE.
3. Compare exact expectedRevision; stale revision returns 409 stale_revision with zero update.
4. Perform exactly one UPDATE of poker_access_override, poker_access_revision + 1, poker_access_updated_at and poker_access_updated_by = actorId.
5. Read/derive the authoritative committed access snapshot and current policy.
6. If the resulting effective state is SLOW, persist required one-way poker_tables.is_slow_only=true evidence before transaction completion by reusing persistAuthoritativeSlowOnlyForUser().
7. Do not create another persistence path for settlement, table markers or access policy.

No retry may repeat the DB mutation.

### T040 — runtime update and ACK

After successful DB commit and before HTTP success:

1. apply returned SLOW-only table IDs to runtime metadata;
2. update tableManager.cachePokerAccessForUser() with the exact committed access/policy;
3. update connected user's state.pokerAccess;
4. emit existing poker-access frames best-effort to connected sockets;
5. release the fail-closed marker;
6. return one exact ACK containing at minimum revision, override, automaticClass, effectiveClass and failClosed:false.

A single socket-send failure must not turn an already committed DB mutation into a failed mutation result. The authoritative runtime cache must be updated before the positive ACK.

### T041 — simplify Netlify Admin endpoint

File:

- netlify/functions/admin-user-poker-access.mjs
  - createAdminUserPokerAccessHandler();
  - remove Admin PATCH ownership from updatePokerAccess() after repo-wide usage verification;
  - remove isConfirmedAccess() and the 3-attempt confirmation loop.

PATCH/POST requirements:

1. keep requireAdminUser();
2. parse/validate userId, override, expectedRevision;
3. send exactly one authenticated internal WS mutation request with userId, requested override, expected revision and authenticated Admin actorId;
4. return WS result without a second invalidate/refresh call;
5. never retry the mutation request automatically after an unknown network outcome.

GET may continue using the existing read-only DB path.

If updatePokerAccess() has no remaining caller after the change, remove it instead of retaining dead duplicate mutation logic.

### T042 — simplify internal notify helper

File:

- netlify/functions/_shared/poker-ws-runtime-notify.mjs
  - simplify notifyWsPokerAccessMutation() to a single request/response contract.

Rules:

- one internal round-trip;
- one bounded fail-fast timeout; keep the current 4s cap unless implementation evidence shows a smaller existing safe value;
- zero sleep;
- zero confirmation retry;
- zero background-wait semantics.

If the response is lost after commit, do not replay the mutation automatically. A later Admin reload/save must use the new authoritative revision and optimistic concurrency.

### T043 — remove obsolete pending recovery

After repo-wide reference verification, remove Admin-mutation-only machinery that is no longer needed:

- pendingPokerAccessMutations;
- Admin use of beginPokerAccessMutation();
- Admin use of refreshPokerAccessForUser();
- pending-only branches used solely by the old two-phase Admin protocol;
- pending candidate recovery from refreshActivePokerAccess();
- retry/confirmation tests that prove the removed protocol instead of the new contract.

Keep:

- tableManager.setPokerAccessMutationFailClosed() / isPokerAccessMutationFailClosed() as short-lived runtime protection during the single WS-owned mutation;
- normal bounded refreshActivePokerAccess() for policy/access/funding cache freshness.

The existing 25s refresh interval and 30s access cache TTL may remain for ordinary cache freshness but are explicitly not part of Admin Save correctness, completion or recovery.

### T044 — Admin UX

File:

- js/admin-page.js::submitPokerAccessForm().

Requirements:

- reuse existing beginPendingAction() to block duplicate local submits;
- show Saving… only while the single request is active;
- HTTP 200 shows Saved revision N · active in WS;
- stale_revision reloads the current user access and asks the Admin to review before saving again;
- true simultaneous mutation shows a controlled Another access save is currently in progress. This save was not applied.;
- timeout/503 must say the outcome was not confirmed and reload current state before another user action;
- remove/replace the misleading static wording Save confirms the committed revision with WS before reporting success.

Do not add UI rendering/CSS tests.

### T045 — fundamental deterministic tests only

Extend existing suites only:

- ws-server/server.behavior.test.mjs;
- tests/admin-endpoints.behavior.test.mjs;
- existing poker access/settlement tests only where required.

Required critical scenarios:

1. AUTO rev N → FORCE_RESTRICTED rev N+1 → immediately AUTO rev N+2; both succeed without periodic refresh.
2. Exactly one DB update per accepted Admin request.
3. Stale revision performs zero DB update and releases fail-closed before returning.
4. Transaction failure after acquiring the runtime guard rolls back, releases the guard/fail-closed state, and an immediate following request succeeds.
5. Two genuinely concurrent same-user mutations: second gets fast 409; after first completes, a third starts immediately without waiting.
6. Runtime cache contains the committed revision/override before success ACK.
7. FORCE_SLOW / Return AUTO preserves existing sticky is_slow_only semantics.
8. Netlify PATCH performs one WS mutation call and no local DB mutation/retry.
9. Internal timeout/network failure does not generate a second mutation request.

Do not add broad UI/CSS/JSP/simple-glue suites.

### T046 — Stage/runtime validation gate

T036 remains:

FAIL/BLOCKED — owner found orphan pending + slow multi-confirm Admin Save protocol

After implementation:

1. run focused deterministic tests;
2. run existing required CI;
3. because ws-server/** changes, perform a new exact-SHA WS Preview Deploy;
4. verify RELEASE_SHA == DEPLOY_REF == latest runtime-affecting SHA and Preview health;
5. do not reapply Caddy if the route/config diff remains zero;
6. perform read-only Stage preflight;
7. repeat owner T036 with no waiting:
   - AUTO → FORCE_RESTRICTED must return exact rev N+1;
   - immediately FORCE_RESTRICTED → AUTO must return exact rev N+2;
   - neither save may rely on the 25s refresh sweep or 30s cache TTL;
8. only after T036 PASS, rerun the final exact-SHA Stage NORMAL refill canary if the reviewed HEAD changed;
9. then continue owner manual acceptance: AUTO / effective NORMAL → 500 CH → Play Now → ordinary STANDARD table; record table ID for read-only DB/ledger verification.

### Breaking / operational impact

Intentional internal contract change:

- Netlify stops being the writer of chips_accounts.poker_access_* for Admin override mutations;
- authoritative WS becomes the single mutation owner.

The public Admin UI/function surface remains unchanged.

No new migration, Caddy route, CSS, CSP, bankroll, Production operation or VPS scheduler change is required by this corrective amendment.

### Implementation notes

- Use live GitHub as source of truth and re-read agents.md / skills.md.
- Keep the solution minimal; this amendment is intended to remove complexity, not add another recovery framework.
- Prefer existing transaction, access snapshot, policy, cache, fail-closed and klog helpers.
- Review the complete diff for breaking impact outside the internal Admin→WS mutation contract and call out any discovered impact.
- Browser JS must remain JSP-compatible.
- No CSS change is expected; if any CSS is unavoidable, keep one selector per line with no hard returns inside declarations.
- Double-check/refactor before finalizing and remove obsolete protocol code rather than leaving parallel paths.
- No new inline script is expected; if one is introduced, add its SHA to the CSP whitelist.
- Use klog, never console.log.
- Only fundamental deterministic tests.
- Merge, Production migration/refill/deploy/cutover and VPS timer activation remain NOT AUTHORIZED.


---

## 26. Corrective pre-merge amendment — truthful Admin mutation vs refresh outcomes

This amendment fixes a UI correctness bug found during the final Stage acceptance work. It does not change poker economics, WS runtime, database schema or the refill protocol.

### Problem

Several Admin mutation handlers currently keep the mutation request and the subsequent read-only refresh in the same `try/catch`. A mutation can therefore commit successfully, then a later `load*` refresh can fail and the UI reports the whole operation as “Could not save/update”.

Observed Stage evidence while enabling tier 100:
- the operator saw the first Save as failed and repeated it;
- `poker_bot_tier_policy.buy_in=100` advanced from revision 1 to revision 3;
- the final persisted state is correct, proving both saves were committed;
- the misleading UI can therefore cause duplicate operator actions after an already successful mutation.

The contract must be: **mutation outcome and refresh outcome are separate facts**.

### T053 — post-mutation refresh contract

Primary file:
- `js/admin-page.js`

Reuse the existing loaders and pending-action patterns. Add the smallest shared/silent post-mutation refresh behavior needed so that:
1. a confirmed POST/PATCH success remains a confirmed mutation success;
2. a later GET/refresh failure never rewrites that success as mutation failure;
3. post-mutation refresh does not overwrite the success message with generic `Loading...` / empty status;
4. refresh failure is logged with `klog` and reported as a refresh problem, for example: `Saved. Refresh failed — reload current state before another action.`;
5. no mutation is automatically retried after an unknown or failed refresh.

Do not create a generic state-management framework.

### T054 — apply the contract across Admin mutation handlers

Audit and correct only handlers that combine a successful mutation with a later refresh, including:
- `submitPokerAccessForm()`;
- `submitPokerAccessPolicyForm()`;
- `submitPokerTierPolicyForm()`;
- `saveBonusCampaignDraft()`;
- `setBonusCampaignStatus()`;
- `submitAdjustForm()`;
- `runTableAction()`;
- `executeBotRecovery()`;
- `runOpsAction()`;
- `runPokerMaintenance()`.

For each handler use the same logical sequence:

`mutation → confirm mutation result → best-effort refresh → final UI message`

Do not change mutation endpoints or backend ownership merely to implement this amendment.

Handlers that already consume the mutation response directly and do not have the problematic post-mutation refresh pattern should remain unchanged, including the poker DEBUG and bot-reaction controls unless the audit finds the same concrete bug there.

### T055 — poker policy UI semantics

For:
- `submitPokerAccessPolicyForm()`;
- `submitPokerTierPolicyForm()`;

the success state must survive `renderOps()` / `loadOps()`, which rebuilds the policy forms.

Required behavior:
- successful save + successful refresh → show a clear saved/current-state confirmation;
- successful save + failed refresh → show saved-but-refresh-failed;
- `stale_revision` → reload current authoritative state and require operator review before another Save;
- never encourage a blind retry of an operation that may already have committed.

### T056 — maintenance and unknown outcomes

For `runPokerMaintenance()` distinguish:
1. mutation confirmed, refresh confirmed;
2. mutation confirmed, refresh failed;
3. mutation outcome itself unconfirmed, such as timeout/transport failure.

Case 2 must not be displayed as mutation failure.

Case 3 must reload/read current state before suggesting another action. Do not automatically replay the mutation.

### T057 — validation

This is browser glue/UI correctness, so follow `agents.md` and do **not** add broad UI rendering tests.

Required validation:
- existing syntax/CI checks pass;
- manual PR-deploy smoke: one Tier 100 Save requires one click, advances the policy revision exactly once and reports a truthful result;
- confirm an intentionally failed/unavailable refresh cannot turn an already confirmed mutation into `Could not save`;
- existing Admin override/maintenance behavior remains functional.

No new WS Preview Deploy is required if the final diff remains limited to `js/admin-page.js` and docs/tests that do not affect WS runtime. No new migration, CSP change, Production operation or VPS action is authorized by this amendment.

### T058 — implementation boundary / handoff

Expected implementation scope:
- `js/admin-page.js` only, unless repo review proves a concrete backend defect is required to satisfy the contract.

If implementation requires changing Netlify endpoints, WS runtime, database schema or mutation semantics, STOP and report the finding for independent review before expanding scope.

After green CI + manual PR-deploy verification, return to the paused Stage acceptance state:
- `CONTINUOUS_BOT_DEFAULT`: `enabled=false`, `desired_table_count=0`;
- tier 100: `enabled=true`;
- no refill/MINT or further Stage economic mutation until the owner continues the test.

### Implementation notes

- Use live GitHub as source of truth and re-read `agents.md` / `skills.md`.
- Keep the fix simple and remove duplicated error semantics rather than introducing another abstraction layer.
- Reuse existing loaders, `beginPendingAction()`, `handleApiError()` and `klog` where appropriate.
- Browser JS must remain JSP-compatible.
- No CSS change is expected; if unavoidable, preserve one selector per line.
- No new inline script is expected; if one is introduced, add its SHA to the CSP whitelist.
- Use `klog`, never `console.log`.
- Only fundamental tests; no broad UI/CSS/JSP/simple-glue tests.
- Review the complete diff and call out any breaking impact.
- Merge, Production operations, VPS timer activation and further Stage refill/MINT remain NOT AUTHORIZED.


## Final owner Stage acceptance — PASS (2026-09-29)

Final pre-merge acceptance for #1019 is complete. The latest runtime-affecting SHA remains `7340b270312b26dc51e0471f3e0afc758cf8a9de`; the current PR HEAD `4d00c5efb1a386ec448bfe6d44192d7ea913d03f` adds only Stage refill canary/workflow ops support and fundamental tests.

- Exact-SHA WS Preview Deploy: run 36614397595 — validate/deploy PASS, local + public health PASS.
- T071 depleted SLOW pool smoke: table `3f9b3854-db10-4217-bcb5-7247cbc1998f`; policy 2000 / 5% / 1900; owner AUTO/SLOW; `POKER_BOT_SLOW_BANKROLL_500=0`; human 500 CH JOIN committed; `is_slow_only=true`; zero bots; no partial bot seat or bot TABLE_BUY_IN survived.
- T072/T074 deterministic regression covers second effective SLOW human joining the human-only SLOW table with no bot funding, plus fresh NORMAL rejection via `normal_table_required`, with no fallback pool and no JOIN-time MINT/refill.
- T065–T070 hysteresis continuation smoke: policy 4000 / 5% / 3800; owner wallet 3375 CH; fresh JOIN recovered persisted class SLOW → NORMAL (revision 19); table `26cf627f-5523-4a50-836c-edbd73dc6969` is NORMAL-compatible and seeded five NORMAL bots.
- Current HEAD checks: 22 completed; 15 success; remaining results are expected skipped/neutral; no failures/pending.
- No unresolved PR review threads.
- Final positive SLOW funding-source smoke: PASS. Owner-gated Stage refill canary run `36623047587` funded only `POKER_BOT_SLOW_BANKROLL_500` from 0 to 5000 CH. Fresh 500 CH SLOW JOIN created table `4b26cfd8-3786-4c6b-8590-31f2e42c1bbc`; four bot TABLE_BUY_IN transactions each debited exactly `POKER_BOT_SLOW_BANKROLL_500 -500` and credited table ESCROW +500. The SLOW pool moved 5000 → 3000 CH; `POKER_BOT_BANKROLL` stayed 984430 CH; no table-related debit used NORMAL bankroll, TREASURY, GENESIS or another tier.

No Production change or VPS refill timer activation is authorized by this acceptance record. The Stage refill used for the final owner-gated smoke was separately authorized and completed. Merge still requires an explicit owner request.

## §27 Pre-merge Production rollout preparation — AUTHORIZED / Production execution still forbidden

The owner explicitly wants the Production rollout artifacts prepared **before merging PR #1019**, so that post-merge work is an operator cutover rather than new design/implementation. This amendment authorizes repository-only implementation on the existing #1019 branch. It does **not** authorize any Production DDL/DML, MINT/refill, tier enablement, VPS installation/activation, managed-table activation, Production environment/secret mutation, or merge.

### Authoritative read-only Production baseline — 2026-09-29

- Production project: `otbqfijerkieoxwpxjnm`.
- PostgreSQL system identifier: `7575202818581710058`.
- Applied Production-equivalent retention versions include `20260914090000` (E1) and `20260914091000` (E2); retention E3 `20260914092000` is not applied.
- #1018 capability is absent: `public.poker_access_policy` and `public.poker_bot_tier_policy` do not exist.
- Existing `SYSTEM/POKER_BOT_BANKROLL` is active with balance `1,000,490 CH`; this account ID, balance, status and historical provenance must be preserved.
- `POKER_BOT_BANKROLL_100`, `POKER_BOT_SLOW_BANKROLL_100`, and `POKER_BOT_SLOW_BANKROLL_500` are not yet provisioned.
- `CONTINUOUS_BOT_DEFAULT` is already `enabled=false`, `desired_table_count=0`, canonical `1/2` stakes, `min_bot_count=2`, `target_bot_count=3`.
- Production has zero OPEN `CONTINUOUS_BOT` tables.
- Therefore no extra managed-inventory shutdown is required before the #1018 cutover; keep it disabled until exact 100 CH bankroll funding is verified.

### T075 — Author the dark/off Production-equivalent #1018 schema contract

Add `supabase/production-migrations/20260929201500_poker_bot_quarantine_production_contract.sql` as a new, forward-only Production migration. It consolidates the **final required effects** of these four Stage source migrations instead of replaying/marking their old versions as applied:

- `20260927100000_poker_bot_quarantine_policy.sql`
- `20260927110000_poker_force_restricted.sql`
- `20260929130000_poker_access_policy_recovery_threshold.sql`
- `20260929163000_poker_access_policy_hysteresis_bps.sql`

Requirements:

1. One atomic transaction with the existing Production operator pattern.
2. Fail closed unless session `chips.production_project_ref='otbqfijerkieoxwpxjnm'` and `pg_control_system().system_identifier='7575202818581710058'`.
3. Require the known Production prerequisite contract (E1/E2 present) and reject unexpected partial/drifted #1018 schema rather than silently normalizing unknown Production state.
4. Install the final #1018 schema only:
   - `chips_accounts.poker_auto_class`, `poker_access_override`, `poker_access_revision`, `poker_auto_slow_at`, `poker_access_updated_at`, `poker_access_updated_by`;
   - final override CHECK including `AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED`;
   - `poker_tables.is_slow_only` and the one-way sticky trigger/function;
   - final `poker_access_policy` shape with entry threshold + persisted hysteresis bps + derived recovery threshold;
   - final `poker_bot_tier_policy` shape;
   - final #1018 indexes and RLS/API denial contract.
5. Preserve the conservative dark/off access singleton produced by the accepted source migrations: entry threshold `1,000,000,000 CH`, hysteresis `500 bps`, derived recovery `950,000,000 CH`; do not copy the Stage smoke value `2000`.
6. Provision policy rows for buy-ins 100 and 500 **disabled**. Preserve their reviewed initial refill threshold/amount values only as disabled configuration; do not activate either tier.
7. Provision only missing exact SYSTEM accounts at balance 0:
   - `POKER_BOT_BANKROLL_100`
   - `POKER_BOT_SLOW_BANKROLL_100`
   - `POKER_BOT_SLOW_BANKROLL_500`
   Existing `POKER_BOT_BANKROLL` must remain byte-for-byte economically unchanged: same account identity, balance, status and ledger provenance.
8. Migration must create **zero** `chips_transactions` / `chips_entries`, perform no MINT, enable no tier, modify no managed profile, create no poker table and reclassify no existing user away from the new-column defaults `NORMAL/AUTO`.
9. Record only the new Production version. Never mark the four Stage source versions applied and never use migration history repair.
10. Do not implement retention E3 `20260914092000...` as part of #1018; that is a separate feature/authorization.

Expected state immediately after a future authorized P1 apply: #1018 schema exists but remains economically dark — access defaults are conservative, both bot tiers are disabled, new exact pools are zero, existing 500 NORMAL bankroll is preserved, managed inventory remains disabled.

### T076 — Make the Production migration inventory/guard recognize P1

Update:

- `supabase/production-migrations/manifest.json`
- `scripts/check-db-migrations.mjs`
- `specs/004-production-retention/migration-inventory.md`

Requirements:

1. Map the four #1018 source migrations above to `20260929201500_poker_bot_quarantine_production_contract.sql` as their reviewed Production equivalent.
2. Keep them classified `needs-production-equivalent`, but change their disposition/status from “equivalent missing” to **prepared / awaiting Production GO**; preparation is not application.
3. Add the exact P1 SHA256 and prerequisites to `replacement_migrations`.
4. Preserve E1/E2 and the future retention-E3 contract. P1 is a separate poker replacement, not retention E3.
5. Refactor the existing guard only as far as necessary so the Production directory is validated against the manifest rather than assuming it can contain exactly two files. It must still fail on an unlisted Production SQL file, stale replacement hash, missing E1/E2/P1, duplicate version/name, CRLF/empty SQL, wrong canonical identity or unclassified source migration.
6. Do not change `scripts/stage-db-migrate.mjs`; Production replacements stay outside automatic DB Stage Apply.

### T077 — Fundamental disposable PostgreSQL proof for P1

Extend only `tests/chips/chips.migration.test.mjs` (reuse its existing Production-baseline fixture; no new test framework).

The test must exercise the real P1 SQL with test-local identity substitution only and prove:

- wrong project/system identity fails before DDL;
- missing E1/E2 prerequisite or intentionally malformed partial #1018 schema fails closed;
- baseline + E1 + E2 + P1 reaches the expected final #1018 catalog/constraint/index/RLS shape;
- a pre-existing nonzero `POKER_BOT_BANKROLL` fixture retains the same account ID, balance, status and provenance;
- the three missing exact accounts are created active at 0;
- 100/500 tier policies exist disabled;
- access policy has conservative `1,000,000,000 / 500 bps / 950,000,000` final values and valid revision semantics;
- existing USER rows receive `NORMAL/AUTO` defaults without a financial write;
- `FORCE_RESTRICTED` satisfies the final override CHECK;
- sticky `is_slow_only` cannot revert true→false;
- no MINT, TABLE transaction, ledger entry, managed-profile mutation or poker-table creation is produced by P1;
- only the P1 Production version is newly recorded; the four Stage source versions remain intentional gaps.

Only fundamental deterministic tests. Do not add broad UI/JSP/CSS/glue coverage.

### T078 — Check in the exact post-merge cutover runbook now

Synchronize the live #1018 amendment into:

- `specs/796-bot-quarantine/issue-source.md`
- `specs/796-bot-quarantine/plan.md`
- `specs/796-bot-quarantine/tasks.md`
- `specs/796-bot-quarantine/quickstart.md`
- `specs/796-bot-quarantine/contracts/bot-quarantine.md`

Document this exact future Production order:

1. Merge #1019 only after this pre-merge preparation is reviewed and green.
2. Wait for Production Netlify + `WS Server Deploy` from `main`; verify the same merged release SHA and Production health before DB cutover. Pre-migration Production must still follow the tested legacy capability path.
3. Read-only Production preflight: canonical identity, E1/E2 present, P1 absent, no unexpected #1018 schema, `POKER_BOT_BANKROLL` unchanged, managed profile still disabled/0 and zero OPEN continuous tables. Verify live Caddy already contains the reviewed `/internal/admin/poker-access-refresh` route; reapply Caddy only if a real diff exists.
4. Apply **only P1** through the existing reviewed Production psql/operator route with `ON_ERROR_STOP` and exact identity setting. No generic db push/reset/repair.
5. Read-only verify the complete P1 post-state before any economic activation.
6. Keep the access threshold at the conservative P1 default until the owner explicitly approves the final Production SLOW entry threshold. Do not infer `2000` from Stage smoke.
7. Review the disabled 100/500 tier refill values. Enable a tier only when its exact NORMAL and SLOW accounts are provisioned and the owner has approved the Production policy values.
8. Perform one explicitly authorized Production refill through `.github/workflows/poker-bot-pool-refill.yml` / dedicated dispatcher authority. Never seed balances by SQL. Verify ledger-balanced `GENESIS → exact SYSTEM bankroll` MINTs, or a legitimate no-op when a pool is already above threshold. Existing `POKER_BOT_BANKROLL` is expected to remain preserved and may no-op.
9. Verify positive balances for both 100 CH pools before restoring managed inventory.
10. Install the already-reviewed VPS dispatcher/service/timer on the existing VPS through a targeted owner-approved install (never `bootstrap.sh`), initially disabled. VPS receives only GitHub dispatch credentials/config, never DB credentials.
11. Prove one controlled Production dispatcher invocation with target `production`, mode `mutate`, workflow ref `main`, the dedicated `arcade-poker-refill-dispatch` actor and Production environment gates. Only after that evidence separately enable the 3-hour timer.
12. Restore `CONTINUOUS_BOT_DEFAULT` only after exact 100 CH pools are funded: `enabled=true`, `desired_table_count=2` for Production, canonical 100 CH / 1/2 stakes, target three bots. Never copy Stage/Preview desired count 5.
13. Let the supervisor converge naturally; never INSERT managed tables directly. Require exactly two OPEN Production `CONTINUOUS_BOT` tables, each funded from NORMAL `POKER_BOT_BANKROLL_100`, with no use of SLOW pool/TREASURY fallback.
14. Run narrow Production smoke: NORMAL standard funding, approved-threshold SLOW standard funding from the exact SLOW pool, two managed 100 CH tables, replacement/top-up source isolation, Admin policy read/write, no supervisor seed/churn errors.
15. If any post-P1 funding/config check fails: keep affected tier disabled, keep managed inventory disabled, do not restore TREASURY fallback, do not force balances/tables with SQL, do not down-migrate P1, and do not enable the timer.

### T079 — Existing-VPS scheduler readiness documentation only

The dispatcher code already exists in #1019:

- `infra/vps/arcade-poker-pool-dispatch.sh`
- `infra/vps/arcade-poker-pool-dispatch.service`
- `infra/vps/arcade-poker-pool-dispatch.timer`

Before merge, review these against the Production runbook and update only `infra/vps/README.md` if clarification is needed. Do not add a second scheduler implementation.

The checked-in existing-host procedure must state:

- never run `infra/vps/bootstrap.sh` on the live VPS;
- targeted install copies only the reviewed three poker-dispatch artifacts with their existing ownership/modes;
- install and activation are separate;
- initial units remain disabled and must not dispatch during installation;
- Production config selects `target=production`, `mode=mutate`, workflow/main, dedicated actor and Production environment gates;
- no Supabase/DB secret or SQL exists on VPS;
- timer activation remains a separate explicit owner GO after one controlled invocation.

No live VPS mutation is authorized in T079.

### T080 — Production continuous-table restoration contract

Record and test only existing invariants needed for the future cutover:

- Production target is **2**, not Stage/Preview 5.
- `CONTINUOUS_BOT_DEFAULT`: buy-in 100 CH, blinds 1/2, target 3 bots.
- Managed tables are always NORMAL-funded from `POKER_BOT_BANKROLL_100`.
- `POKER_BOT_SLOW_BANKROLL_100` is for SLOW STANDARD play and must never fund `CONTINUOUS_BOT`.
- Both 100 pools must be active and positively funded before managed inventory is re-enabled.
- Supervisor convergence is authoritative; no direct table inserts.
- Failure path is disable tier/profile + graceful retirement, never TREASURY fallback or direct ledger/table repair.

Reuse existing fundamental managed-table/refill tests only if a missing invariant is not already covered.

### T081 — Caddy / runtime boundary

No new Caddy or WS/runtime change is expected from T075–T080. The route `/internal/admin/poker-access-refresh` was already applied during #1019 acceptance and should be verified read-only in the future Production preflight.

If implementation stays limited to Production SQL, manifest/guard, fundamental migration tests and SpecKit/docs, the accepted runtime SHA `7340b270312b26dc51e0471f3e0afc758cf8a9de` remains the latest runtime-affecting SHA and no new WS Preview Deploy is required.

If Agy discovers that a runtime/deployable/Caddy change is actually required, STOP and report the blocker instead of expanding scope silently; that would invalidate the current runtime evidence and require a new exact-SHA Preview gate.

### T082 — Validation before returning #1019 to merge-ready

Run the existing fundamental checks affected by this preparation, including:

- migration filename/hash/exhaustiveness guard;
- disposable `tests/chips/chips.migration.test.mjs` Production contract fixture;
- existing #1018 migration/policy/refill/managed-table guards needed by the touched contract;
- syntax/diff checks already required by the repo.

Require normal CI green. Do not run Production mutation, Production refill, VPS install/activation, or another Stage economic smoke merely for these repository-only additions.

### T083 — Handoff

Report:

- exact new P1 filename/hash and PR HEAD;
- exact files changed;
- disposable PostgreSQL evidence;
- manifest/guard evidence;
- confirmation that no `ws-server/**`, `shared/**`, Netlify poker runtime, Caddy, browser protocol, CSS/CSP, live VPS, Stage economics or Production state changed;
- confirmation that Production baseline remains read-only/unmodified;
- remaining post-merge operations exactly as T078.

After T083 PASS the PR may again be described as **READY FOR MERGE**, but merge itself still requires the owner's explicit request.

### T084 — Restore Stage continuous/non-stop inventory before merge

This is an explicitly owner-authorized Stage operational cleanup after T075–T083 implementation/CI and before #1019 is returned to merge-ready.

Current read-only Stage baseline:

- tier 100: `enabled=true`, revision 4;
- `POKER_BOT_BANKROLL_100 = 5000 CH`, active;
- `POKER_BOT_SLOW_BANKROLL_100 = 0 CH`, active;
- `CONTINUOUS_BOT_DEFAULT = enabled=false / desired_table_count=0`, canonical `1/2`, min bots 2, target bots 3;
- zero OPEN `CONTINUOUS_BOT` tables.

Required sequence:

1. Do **not** enable managed inventory while SLOW 100 remains empty.
2. On the final reviewed PR HEAD after T075–T083, use the existing owner-gated Stage refill canary to fund **only** `SLOW / buy_in=100` through the approved bounded ledger path. Use exact reviewed SHA and confirmation. No direct/manual SQL balance update and no NORMAL/500 refill.
3. Read-only verify the resulting refill MINT:
   - `GENESIS → POKER_BOT_SLOW_BANKROLL_100`;
   - exact configured amount `2000 CH` for current tier-100 policy;
   - balanced entries and one pool/bucket identity;
   - `POKER_BOT_BANKROLL_100` remains unchanged at its pre-restore balance;
   - no other bankroll is changed.
4. Only after **both** 100 CH pools are active and positive, restore `CONTINUOUS_BOT_DEFAULT` through the existing authorized Admin/maintenance path:
   - `enabled=true`;
   - `desired_table_count=5`;
   - retain canonical `small_blind=1`, `big_blind=2`, `min_bot_count=2`, `target_bot_count=3`.
   Do not INSERT/update poker tables directly merely to reach the target.
5. Let the WS supervisor converge naturally (at most its existing bounded create rate). Require exactly **5 OPEN Stage `CONTINUOUS_BOT` tables**, each with buy-in 100 CH, stakes 1/2 and three funded bots.
6. Read-only ledger verification must prove every initial managed bot `TABLE_BUY_IN` uses NORMAL `POKER_BOT_BANKROLL_100`; `POKER_BOT_SLOW_BANKROLL_100`, TREASURY and other tier/class pools must not fund `CONTINUOUS_BOT`.
7. Verify no `ws_continuous_bot_table_supervisor_failed`, seed-failure churn or repeated create→rollback loop.
8. If SLOW refill or managed creation fails, leave `CONTINUOUS_BOT_DEFAULT` disabled/0 and report the blocker. Do not use direct SQL balance repair, table inserts or TREASURY fallback.
9. Record exact refill run/SHA, before/after 100-pool balances, restored profile revision/state, five table IDs and funding-source evidence in #1018/#1019.

T084 authorizes only the above Stage refill and managed-profile restoration. It does not authorize any Production mutation, Production refill, VPS activation or merge.

### Breaking-impact notes

- Future P1 application is a Production schema cutover: after it commits, new transactions use #1018 schema-backed NORMAL/SLOW/RESTRICTED semantics rather than the pre-migration legacy capability path.
- Future enabling of tier 100 intentionally moves new 100 CH bot funding away from TREASURY to `POKER_BOT_BANKROLL_100`.
- Future SLOW activation changes admission compatibility and routes new SLOW bot funding to exact SLOW pools.
- Future refill timer activation creates bounded scheduled MINTs every three hours when a pool is below threshold.
- Future managed-profile restoration creates up to two Production continuous tables.
- None of those breaking/runtime/economic effects are authorized by this pre-merge preparation.

### Implementation notes

- Use live GitHub as source of truth and re-read `agents.md` / `skills.md`.
- This is complex work: deeply review the final effective Production schema rather than mechanically concatenating Stage SQL.
- Keep the implementation as small and condensed as possible; consolidate final required state and omit superseded/intermediate Stage transitions.
- Reuse the existing Production migration identity/operator pattern, manifest, migration test fixture, refill workflow and VPS dispatcher; do not introduce parallel frameworks.
- Only fundamental deterministic tests.
- Do not add JavaScript unless a concrete blocker proves it necessary; any browser JS must remain JSP-compatible.
- If CSS is unexpectedly required, keep one selector per line.
- Use `klog`, never `console.log`.
- Any new inline script requires CSP SHA allowlisting.
- Double-check/refactor the final diff and explicitly report breaking impacts.
- No Production mutation, live-VPS mutation, merge or hidden scope expansion.
