# Stage Bonus Campaign Operations — agent workflow

Use **Stage Bonus Campaign Operations** (`.github/workflows/stage-bonus-campaigns.yml`) to let an AI agent operating through the owner's authenticated GitHub CLI run approved Stage Daily Bonus operations. No Supabase Auth agent account, shared owner JWT, or new VPS secret is needed. The existing Stage runner uses the pre-existing `SUPABASE_STAGE_DIRECT_DB_URL` and `SUPABASE_STAGE_PROJECT_REF` GitHub secrets.

## Authority and safety

- Only the exact repository `krzysztofcal/arcadePlatform`, `main`, `workflow_dispatch`, and GitHub actor `krzysztofcal` are permitted. A non-owner GitHub bot account cannot run this workflow without a separately reviewed authorization change.
- The job runs only on `[self-hosted, linux, x64, stage-db-ipv6]`, checks the exact direct Stage host/port, project reference `krydukthwdvccggbyjfw` and PostgreSQL system identifier `7656985631720456337`. It refuses `SUPABASE_DB_URL` and never reads Production secrets.
- Only `inspect` is read-only. Mutating modes require the matching exact `confirmation`, Stage guards, and backend campaign validation. GitHub Actions records the authenticated actor, run ID and outcome; `created_by` is NULL for an operator-created draft rather than falsely attributing the action to a Supabase user.
- `create_daily_draft` creates a new `poker_daily` Draft using four positive amounts, UTC daily policy, all registered accounts and unlimited claims. It does not activate it or pay CH.
- `switch_daily` requires an active old Daily campaign and valid new `poker_daily` Draft. Both status changes commit in **one Stage database transaction** using existing locked Admin status functions. A committed repeated request reports `alreadySwitched`; mismatched/partial state fails closed.
- `set_status` only supports `paused` or `ended` for Daily campaigns. It cannot activate a new campaign or undo `ended`. End is irreversible under the current Admin status machine.
- **No scheduled trigger, Production action, bonus claim, schema change or new credential is created.** Workflow only becomes dispatchable after merge to `main`. Do not merge solely to bypass code review.

## Operator / AI-agent commands

All examples are one-line commands. Run only after receiving authorization for that exact Stage action.

Inspect all Stage Daily campaigns:

`gh workflow run stage-bonus-campaigns.yml --repo krzysztofcal/arcadePlatform --ref main -f action=inspect`

Create a new Draft with 25/50/100/200 CH (example code; do **not** repeat if it exists):

`gh workflow run stage-bonus-campaigns.yml --repo krzysztofcal/arcadePlatform --ref main -f action=create_daily_draft -f code=daily-streak-2026 -f title="Poker Daily Bonus" -f rewards=25,50,100,200 -f "confirmation=GO STAGE BONUS create_daily_draft daily-streak-2026 25,50,100,200"`

Atomically End the old Daily and activate the verified Draft:

`gh workflow run stage-bonus-campaigns.yml --repo krzysztofcal/arcadePlatform --ref main -f action=switch_daily -f code=daily-streak-2026 -f old_code=daily-active-2026 -f "confirmation=GO STAGE BONUS switch_daily daily-streak-2026 FROM daily-active-2026"`

Pause a Daily campaign:

`gh workflow run stage-bonus-campaigns.yml --repo krzysztofcal/arcadePlatform --ref main -f action=set_status -f code=daily-streak-2026 -f status=paused -f "confirmation=GO STAGE BONUS set_status daily-streak-2026 paused"`

The 2026-10-11 initial Stage cutover was **already executed** by the owner-authorized connected Supabase management operation: `daily-active-2026` = ended; `daily-streak-2026` = active; four rewards = 25/50/100/200 CH. **Do not re-create it.** Use `inspect` for future checks. This initial operation was not a GitHub workflow run.

After a workflow run, inspect GitHub Actions logs and verify the returned state with a fresh Stage read. Netlify Preview must target this same Stage backend; a successful workflow never proves browser/real-Claim behavior. Production requires a separate approved process.
