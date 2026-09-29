# Issue source: #1018

**Authoritative requirements**: https://github.com/krzysztofcal/arcadePlatform/issues/1018

**Live updated_at**: 2026-09-27T17:10:33Z

**Snapshot captured**: 2026-09-27. Exact live issue body below. Live #1018 is the sole feature requirements source; this snapshot is refreshed before the RESTRICTED implementation extension. #869/#1017 remain separate.

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

## 25. Corrective pre-merge amendment — single-owner deterministic WS mutation

Admin override mutation is implemented as a single WS-owned operation:
`Admin UI → Netlify Admin auth → one internal WS request → WS fail-close → one DB transaction → WS cache/socket update → release fail-close → exact ACK`.

Netlify authenticates the admin and forwards the actor ID with zero local DB write, zero pre-invalidation, zero confirmation retries, and zero recovery polling. WS owns the runtime guard (`activePokerAccessMutations`), short-lived fail-close lifecycle, single DB transaction with optimistic revision check, authoritative SLOW persistence, cache/socket broadcast, and fail-close cleanup.

---

## 26. Corrective pre-merge amendments — runtime stability & hysteresis derivation

1. **Settled rollover retry & continuous bot table controlled inactivity**:
   - Unknown access or bot funding snapshot triggers `scheduleSettledRolloverRetry()` without advancing state or bypassing funding.
   - Disabled/unprovisioned tier 100 sets continuous bot supervisor to controlled inactive (`desiredCount = 0`, zero table creation, zero seed, graceful retirement of open continuous tables) without rollback or sweep churn.
2. **Reversible AUTO with percentage-based hysteresis**:
   - SLOW recovery threshold is derived deterministically: `floor(slow_threshold_ch * (10000 - slow_hysteresis_bps) / 10000)`.
   - Stored in `poker_access_policy` as `slow_hysteresis_bps` (range 100–5000 bps, default 500 bps = 5%).
   - While override is `AUTO`, automatic classification transitions reversibly (`NORMAL -> SLOW` when evidence >= entry, `SLOW -> NORMAL` when authoritative evidence < derived recovery).
   - Any `FORCE_*` override suppresses durable automatic mutations.
3. **Depleted SLOW pool human join isolation**:
   - An empty or depleted SLOW bot bankroll does not fail a valid human JOIN.
   - Bot funding is isolated in a savepoint; depleted bot pool rolls back only the bot seat/funding, allowing the human JOIN to commit successfully (`is_slow_only = true`, `seededBots = []`).

---

## 27. Pre-merge Production rollout preparation — AUTHORIZED / Production execution still forbidden

Prepares the Production rollout artifacts ahead of merge without performing any Production DDL/DML, refill, tier enablement, VPS activation, or PR merge.

### Production Baseline
- Project: `otbqfijerkieoxwpxjnm`, system identifier: `7575202818581710058`.
- E1 (`20260914090000`) and E2 (`20260914091000`) applied.
- `POKER_BOT_BANKROLL` = 1,000,490 CH active (preserved byte-for-byte).
- `POKER_BOT_BANKROLL_100`, `POKER_BOT_SLOW_BANKROLL_100`, `POKER_BOT_SLOW_BANKROLL_500` absent.
- `CONTINUOUS_BOT_DEFAULT` disabled / desired 0, 0 OPEN continuous tables.

### P1 Production Contract (T075)
- File: `supabase/production-migrations/20260929201500_poker_bot_quarantine_production_contract.sql`.
- Single atomic transaction guarded by canonical identity and E1/E2 presence.
- Installs #1018 schema dark/off: 3 new pools at balance 0, conservative access defaults `1,000,000,000 / 500 bps / 950,000,000`, 100/500 tiers disabled, `FORCE_RESTRICTED` in override CHECK, sticky `is_slow_only`, indexes, RLS.
- Zero financial transactions, entries, MINTs, or tables. Only P1 recorded in schema migrations.

### Inventory, Guards & Tests (T076–T077)
- `manifest.json`: P1 added to replacement_migrations; 4 Stage migrations mapped to P1.
- `check-db-migrations.mjs`: validates production migrations against manifest; requires E1, E2, P1.
- `chips.migration.test.mjs`: disposable PostgreSQL fixture test proving all P1 invariants.

### Future Post-Merge Cutover Runbook (T078)
1. Merge #1019 only after owner review and green CI.
2. Wait for Production Netlify + WS deploy; verify health.
3. Read-only preflight: canonical identity, E1/E2 present, P1 absent, 0 continuous tables.
4. Apply only P1 via reviewed operator psql route.
5. Read-only verify P1 post-state.
6. Keep access threshold at conservative default until owner approval.
7. Review disabled tier refill values; enable tier only after owner approval.
8. Perform authorized Production refill via dedicated workflow.
9. Verify positive 100 CH pools.
10. Targeted VPS dispatcher install (never `bootstrap.sh`).
11. Controlled test dispatch before timer enablement.
12. Restore `CONTINUOUS_BOT_DEFAULT` with desired count 2 (never 5).
13. Await supervisor natural convergence to 2 tables.
14. Production smoke.
15. Failure path: disable tier/profile, never fallback or manual SQL.

### Stage Continuous Inventory Restoration (T084)
- Run owner-gated Stage refill canary for `SLOW / buy_in=100` (`POKER_BOT_SLOW_BANKROLL_100: 0 -> 2000 CH`).
- Verify refill MINT read-only.
- Restore `CONTINUOUS_BOT_DEFAULT` (enabled=true, desired=5).
- Await supervisor convergence to 5 OPEN tables funded from `POKER_BOT_BANKROLL_100`.
