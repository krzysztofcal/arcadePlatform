# Stage Database Implementation Plan

## Goal

Add a self-service stage database workflow for Arcade Hub so database migrations can be tested before touching production.

Current deployment flow:

- Developer opens a feature PR.
- GitHub triggers CI.
- Netlify automatically builds a public deploy preview URL for the PR.
- Netlify Functions run from the preview deploy.
- Today, database-related preview testing can still point at production unless environment variables are manually changed.

Problem:

- Small additive migrations have been acceptable on production so far.
- Larger economy/database work, such as `bonus_campaigns`, should not be validated directly against the only production database.
- A database rollback is not as simple as reverting frontend code. Ledger mutations and enum migrations are especially hard to undo.

Decision:

- Add a stage DB workflow before implementing large database features.
- Keep it self-service: one-time setup by the owner, then agent/developer can trigger validation with one command.

## Repository Analysis

Relevant files:

- `.github/workflows/ws-preview-deploy.yml`
- `.github/workflows/ci.yml`
- `netlify.toml`
- `supabase/migrations/*`
- `docs/chips-ledger.md`
- `docs/poker-deployment.md`
- `netlify/functions/_shared/supabase-admin.mjs`

Current observations:

- The repo already uses timestamped Supabase SQL migrations in `supabase/migrations`.
- There is no current DB stage workflow.
- `ws-preview-deploy.yml` is a good operational pattern:
  - manual `workflow_dispatch`,
  - `ref` input,
  - preflight validation,
  - explicit secrets,
  - guarded deploy,
  - health checks.
- `netlify.toml` already separates `production`, `branch-deploy`, `deploy-preview`, and `development` contexts.
- Netlify deploy previews are public and automatic, but their DB credentials must come from Netlify environment variables.
- The backend reads database/auth settings from env:
  - `SUPABASE_DB_URL`
  - `SUPABASE_JWT_SECRET`
  - Supabase browser config values via `supabase-config.js` / Netlify env.
- Chips and poker are production-economy-sensitive.

## External Best-Practice Context

Supabase official docs support the direction:

- Supabase Branching provides isolated preview environments for pull requests and lets teams test database schemas without affecting production.
- Supabase Branches are separate environments with their own API credentials.
- Supabase preview branches are data-less by default to avoid copying sensitive production data.
- Supabase migrations are tracked in `supabase_migrations.schema_migrations`; `supabase db push` applies migrations not yet applied.
- Supabase recommends using migrations in git and coordinated deployment, or automating with branching/CI.

Useful sources:

- Supabase Branching: https://supabase.com/docs/guides/deployment/branching
- Working with Supabase branches: https://supabase.com/docs/guides/deployment/branching/working-with-branches
- Supabase GitHub integration: https://supabase.com/docs/guides/deployment/branching/github-integration
- Supabase Database Migrations: https://supabase.com/docs/guides/deployment/database-migrations

## Recommended Architecture

Use a staged approach, but start with automatic shared stage validation.

### Phase 1: Persistent Stage DB + Automatic PR Migration Apply

This is the practical first implementation for the current repo.

Create one separate Supabase project:

```text
Arcade Hub Stage
```

Netlify deploy-preview functions point to this stage project, not production.

Developer flow:

1. Open PR.
2. Netlify creates deploy preview URL as today.
3. GitHub detects whether `supabase/migrations/**` changed relative to `main`.
4. If migrations changed, GitHub automatically applies the PR migrations to shared stage DB.
5. GitHub runs smoke checks and reports a green/red PR check.
6. Test the public Netlify preview URL against stage DB after the stage check is green.

Why this first:

- Gives clear PR feedback when migrations fail.
- Removes the normal manual step for the common linear workflow.
- Does not require solving dynamic per-PR Netlify env injection.
- Gives immediate safety improvement for DB-heavy work.
- Still keeps production DB untouched.

Tradeoff:

- One shared stage DB means only one DB-heavy PR should be tested at a time.
- Stage can drift if abandoned PR migrations are applied and later changed.
- For conflicting DB PRs, use the manual prepare-stage workflow or recreate stage before the next test.

This tradeoff is acceptable for the current owner workflow because feature work is usually linear.

### Phase 1b: Manual Prepare Stage For Branch

Add a manual tool for switching stage DB between feature branches:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<feature-branch>
```

Plain explanation:

- The automatic PR check is enough when working on one DB PR at a time.
- If work switches from PR A to PR B, shared stage may still contain migrations from PR A.
- `db-stage-prepare.yml` is the explicit "make stage ready for this branch" command.
- It should make stage represent `main schema + selected feature branch migrations + safe seed`.

Initial implementation:

- Do not do a destructive remote reset.
- Inspect stage migration state.
- If stage is compatible with `main` plus the selected branch, apply pending migrations and smoke-check.
- If stage contains unrelated migrations from another PR, fail with a clear message that stage must be recreated or reset before testing this branch.

Later implementation:

- Add a safe reset/recreate path after the stage setup is proven.
- Prefer Supabase Branching or stage project recreation over hand-written destructive SQL.

### Phase 2: Supabase Branching / Ephemeral Preview DB

This is the better long-term model.

Enable Supabase Branching and GitHub integration:

- PR creates an isolated Supabase preview branch.
- Supabase runs migrations automatically for `supabase/` changes.
- Optional `supabase/seed.sql` seeds safe sample data.
- Production data is not copied by default.

Challenge:

- Netlify deploy previews do not automatically know the Supabase branch credentials.
- To make the public Netlify PR URL use the matching Supabase preview branch, we would need additional integration:
  - a workflow that fetches branch credentials through Supabase APIs,
  - injects those credentials into a corresponding Netlify preview deploy,
  - and triggers/retriggers the Netlify build with the right env.

Recommendation:

- Do Phase 1 and Phase 1b now.
- Revisit Phase 2 after stage DB is stable and large DB changes become frequent.

## Why Not Copy Production Data

Do not use raw production data for preview/stage by default.

Preferred:

- Fresh schema from migrations.
- Safe seed data.
- Manually created test accounts.
- Optional sanitized fixtures later.

Reasons:

- Auth/user data can contain personal data.
- Public Netlify preview URLs increase exposure.
- A data-less stage is enough to validate schema, functions, ledger behavior, and UI flows.

If prod-like data becomes necessary:

- Use a sanitized dump only.
- Strip or hash emails.
- Remove tokens, auth identities, session state, and sensitive metadata.
- Keep the sanitized dump out of git unless it contains no sensitive data.

## Stage DB Setup Model

### Stage Supabase Project

Create a separate Supabase project:

```text
arcade-platform-stage
```

Recommended configuration:

- Same region as production if possible.
- Same Postgres major version as production.
- Same Auth provider settings as production where needed.
- Separate JWT secret.
- Separate anon key.
- Separate DB connection string.
- Separate project ref.

Required stage URLs/redirects:

- Add Netlify deploy-preview URL patterns to Supabase Auth redirect URLs.
- Add local dev URLs if needed.
- Keep production URLs separate.

### Netlify Deploy Preview Env

Set deploy-preview env vars to stage values:

```text
SUPABASE_URL=<stage Supabase API URL>
SUPABASE_ANON_KEY=<stage anon key>
SUPABASE_ANON_KEY_V2=<stage anon key if current code expects it>
SUPABASE_JWT_SECRET=<stage JWT secret>
SUPABASE_DB_URL=<stage transaction pooler DB URL>
CHIPS_ENABLED=1
```

Production context keeps production values.

Important:

- The deploy-preview context should never point at production DB.
- If a PR deploy needs chips/poker DB behavior, it should use stage.

### GitHub Secrets

Add repository secrets for workflow use:

```text
SUPABASE_STAGE_DB_URL
SUPABASE_STAGE_PROJECT_REF
SUPABASE_STAGE_DB_PASSWORD
SUPABASE_ACCESS_TOKEN
```

Optional for Netlify rebuild automation:

```text
NETLIFY_AUTH_TOKEN
NETLIFY_SITE_ID
```

Optional for smoke users:

```text
STAGE_TEST_USER_EMAIL
STAGE_TEST_USER_PASSWORD
STAGE_TEST_USER_JWT
```

## Workflow Design

### Workflow 1: `db-migration-check.yml`

Purpose:

- Automatic PR check.
- Validate migration files without mutating cloud DB.

Trigger:

```yaml
pull_request:
  paths:
    - "supabase/**"
    - "tests/chips/**"
    - "tests/*migration*.mjs"
    - ".github/workflows/db-migration-check.yml"
```

Recommended behavior:

1. Checkout PR.
2. Setup Node.
3. Install/pin Supabase CLI.
4. Run migration structure guard.
5. Start local Supabase if feasible.
6. Apply migrations from scratch.
7. Run migration-focused tests.

Notes:

- This does not replace stage.
- It catches broken SQL and migration ordering early.
- It is safe for every PR because it uses local/disposable DB.

Potential blocker:

- GitHub runner must support Docker for Supabase local stack.
- If local Supabase is too slow/flaky, keep this as syntax/order guard initially and rely on the automatic stage apply workflow for full validation.

### Workflow 2: `db-stage-apply-pr.yml`

Purpose:

- Automatic shared stage DB migration apply for PRs that change migrations.

Trigger:

```yaml
pull_request:
  paths:
    - "supabase/migrations/**"
    - ".github/workflows/db-stage-apply-pr.yml"
```

Guards:

```text
only PRs from this repository
never forks
never production DB
```

Concurrency:

```text
db-stage
```

Set `cancel-in-progress: false` so two DB deploys cannot race.

Steps:

1. Checkout workflow ref.
2. Validate required secrets.
3. Checkout PR head SHA.
4. Show selected SHA.
5. Detect whether `supabase/migrations` changed relative to `origin/main`.
6. If no migrations changed:
   - run smoke/status checks,
   - exit successfully.
7. Install/pin Supabase CLI.
8. Run `supabase migration list` against stage.
9. Run `supabase db push` against stage DB.
10. Run `supabase migration list` again.
11. Run stage smoke SQL:
    - verify critical tables exist,
    - verify `chips_tx_type` contains expected values,
    - verify `SYSTEM/GENESIS` exists,
    - verify migration history is not divergent.
12. Optionally run stage-safe seed.
13. Print manual test instructions and stage target.

Implementation detail:

Use `--db-url "$SUPABASE_STAGE_DB_URL"` where possible instead of relying on local linked project state.

Expected workflow outcome:

- The stage DB schema now matches the feature branch migrations.
- The PR shows a green/red stage DB check.
- The existing Netlify PR deploy preview can be tested against stage after this check is green.

### Workflow 3: `db-stage-prepare.yml`

Purpose:

- Manually prepare shared stage DB for a selected branch when switching between DB-heavy PRs.

Command:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<feature-branch>
```

This is not needed for the normal linear flow. Use it when:

- stage was previously used for another PR,
- a feature branch was rebased or its migrations were rewritten,
- the automatic PR apply fails because stage contains unrelated migrations,
- manual testing should start from a known branch target.

Plain behavior:

```text
make shared stage ready for this branch
= main schema + selected branch migrations + safe seed
```

Initial safe implementation:

1. Checkout `main` and selected `ref`.
2. Compare migration files between `main`, selected `ref`, and remote stage history.
3. If stage is compatible:
   - apply pending selected-branch migrations,
   - run smoke checks,
   - print the Netlify preview testing target.
4. If stage contains unrelated migrations:
   - fail clearly,
   - tell the owner to recreate stage or run the future reset workflow.

Do not attempt to reverse already-applied migrations.

Reason:

- Supabase/Postgres migrations are usually forward-only.
- A feature migration may have changed data or enum values.
- Reverting remote migration history without reverting real schema/data can corrupt the migration state.

### Workflow 4: `db-stage-reset.yml`

Purpose:

- Restore stage DB to `main` baseline when a feature PR polluted stage and `db-stage-prepare.yml` cannot proceed.

This is the hard part.

Recommended options:

1. Preferred: recreate stage via Supabase Branching / dashboard if available.
2. Acceptable: manually create a new stage Supabase project and rotate secrets.
3. Advanced later: destructive reset workflow that drops application schemas/tables and reapplies `main` migrations.

Do not implement destructive reset first.

Reason:

- Hosted Supabase contains managed schemas such as `auth`, `storage`, `realtime`, and internal metadata.
- A generic remote reset script can be dangerous.
- A safe reset workflow needs careful allowlisting of what it may drop.

Initial policy:

- Stage is disposable.
- If stage gets bad, recreate the Supabase stage project or preview branch.
- Do not block Phase 1 on reset automation.

## Automatic vs Manual Stage DB

### Fully automatic on PR migration changes

Chosen for Phase 1, with strict guardrails.

Why this is acceptable:

- The owner workflow is usually linear.
- The PR gets a clear green/red status when migrations fail.
- Concurrency prevents two stage mutations from racing.
- Netlify deploy-preview already points to stage DB, so manual testing remains simple.

Known risks:

- A shared persistent stage DB can still be polluted by an abandoned PR.
- Two DB-heavy PRs should not be tested on shared stage at the same time.
- If a PR rewrites already-applied migrations, stage may need to be recreated or reset.
- Netlify deploy preview may build before DB stage is ready; wait for the stage DB check before testing DB-dependent behavior.

### Manual one-command stage prepare

Keep this as the branch-switching tool, not the normal happy path.

Command:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<branch>
```

Use it when moving shared stage from one feature branch to another.

## Netlify Preview Integration

### Recommended Phase 1

Set Netlify `deploy-preview` environment variables to the persistent stage Supabase project.

Result:

- Any PR preview uses stage DB.
- Production deploys use production DB.
- Branch deploys can be decided separately.

Important:

- If the automatic stage DB check is still running, a preview with new code may fail when it expects new tables.
- Wait for the automatic `db-stage-apply-pr.yml` check to be green before manual DB-dependent testing.
- If switching from another DB-heavy PR, run `db-stage-prepare.yml` first or recreate stage if the workflow reports unrelated migrations.

### Optional Rebuild Hook

If needed, add Netlify rebuild automation later:

```bash
netlify api createSiteBuild --data '{"site_id":"..."}'
```

But a rebuild is not always required:

- If the preview deploy already has the code and Netlify env already points to stage, applying migrations to stage is enough.
- Rebuild is needed only when env changes or a new commit must be deployed.

## Seed Strategy

Add `supabase/seed.sql` only with safe sample data.

Seed should be:

- deterministic,
- idempotent,
- small,
- free of production personal data,
- focused on smoke testing core flows.

Possible seed contents:

- system chip accounts if not already seeded by migrations,
- sample poker tables only if safe,
- sample campaign rows for future bonus testing,
- no real user emails unless they are clearly test-only.

Auth users:

- Prefer manually created stage test accounts at first.
- Later, add a controlled stage-only seed or setup script if needed.

## Rollback and Safety Model

### Production

Production migration rollback remains hard.

For economy changes:

- Prefer additive migrations.
- Keep old endpoints during transition.
- Add feature flags where practical.
- Disable risky feature by status/env rather than dropping schema.
- Use compensating ledger transactions instead of DB restore for financial corrections.

### Stage

Stage rollback can be simpler:

- Stage can be recreated.
- Stage secrets can be rotated.
- Stage data can be discarded.

Initial policy:

- Treat stage as disposable.
- Do not depend on stage data lasting.

## What The Owner Must Do

One-time setup:

1. Create a new Supabase project for stage.
2. Copy stage credentials:
   - API URL,
   - anon key,
   - JWT secret,
   - transaction pooler DB URL,
   - project ref,
   - DB password.
3. Add GitHub repository secrets:
   - `SUPABASE_STAGE_DB_URL`
   - `SUPABASE_STAGE_PROJECT_REF`
   - `SUPABASE_STAGE_DB_PASSWORD`
   - `SUPABASE_ACCESS_TOKEN`
4. Set Netlify deploy-preview env vars to stage values:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_ANON_KEY_V2` if used
   - `SUPABASE_JWT_SECRET`
   - `SUPABASE_DB_URL`
   - `CHIPS_ENABLED=1`
5. Configure stage Supabase Auth redirect URLs for Netlify preview URLs.
6. Create one or more stage test users manually.
7. Decide whether branch-deploy context should use stage or production.

Operational use:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<feature-branch>
```

## What The AI Agent Can Do

The agent can implement:

1. `docs/stage-db-implementation-plan.md`.
2. `.github/workflows/db-migration-check.yml`.
3. `.github/workflows/db-stage-apply-pr.yml`.
4. `.github/workflows/db-stage-prepare.yml`.
5. Guard tests for these workflows, similar to `ws-tests/ws-preview-deploy.workflow.guard.test.mjs`.
6. Stage smoke SQL scripts.
7. `supabase/seed.sql` with safe sample data if desired.
8. Documentation updates in `docs/operations.md` and `docs/chips-ledger.md`.
9. Optional scripts for:
   - migration diff detection,
   - stage smoke checks,
   - printing manual test instructions.

The agent cannot do without owner credentials:

- create the Supabase stage project,
- read/copy Supabase secrets,
- set Netlify environment variables in the owner account,
- configure Supabase dashboard Auth settings,
- create real stage test accounts unless credentials/API are provided.

## PR Breakdown

### PR1: Stage DB Plan

Goal:

- Document architecture, decisions, required secrets, and rollout plan.

Changes:

- Add this document.

Acceptance:

- Owner can review and decide the setup path.

### PR2: Local Migration Check Workflow

Goal:

- Automatically validate migrations on PR without cloud mutation.

Changes:

- Add `.github/workflows/db-migration-check.yml`.
- Add workflow guard tests.
- Add migration ordering/syntax guard if needed.

Acceptance:

- PRs touching `supabase/**` run migration validation.
- No production or stage DB is touched.

### PR3: Automatic Shared Stage DB PR Apply

Goal:

- Automatically apply PR migrations to shared stage DB and report a green/red PR check.

Changes:

- Add `.github/workflows/db-stage-apply-pr.yml`.
- Add stage smoke check script.
- Add workflow guard tests.

Acceptance:

- Workflow fails fast if required secrets are missing.
- Workflow runs only for PRs from this repository, not forks.
- Workflow runs only when `supabase/migrations/**` changes.
- Workflow applies pending migrations from PR head to shared stage.
- Workflow runs smoke checks after applying.
- Workflow uses concurrency to prevent simultaneous stage mutation.
- PR clearly shows success/failure for stage DB migration validation.

### PR4: Manual Prepare Stage Workflow

Goal:

- Let the owner manually prepare shared stage DB for a selected branch when switching between DB-heavy PRs.

Changes:

- Add `.github/workflows/db-stage-prepare.yml`.
- Add migration-state comparison and clear failure messaging.
- Add command docs:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<branch>
```

Acceptance:

- Workflow applies pending migrations if shared stage is compatible with `main + selected branch`.
- Workflow fails clearly if stage contains unrelated migrations from another PR.
- Workflow does not attempt unsafe migration rollback.
- Workflow explains whether stage must be recreated/reset.

### PR5: Netlify Preview Stage Configuration Docs

Goal:

- Ensure Netlify preview deploys use stage DB.

Changes:

- Update docs with exact Netlify env setup.
- Optionally add a runtime diagnostic endpoint or admin display showing current DB target is stage.

Acceptance:

- Owner can confirm deploy-preview context points at stage DB.
- Manual preview testing does not touch production DB.

### PR6: Optional Supabase Branching Investigation

Goal:

- Evaluate whether per-PR ephemeral DB branches can replace persistent stage.

Changes:

- Document Supabase Branching setup.
- Test GitHub integration.
- Decide whether Netlify preview credential injection is worth automating.

Acceptance:

- Clear go/no-go decision for automatic per-PR DB branches.

## Open Decisions

These need owner confirmation before implementing workflows:

1. Should Netlify `deploy-preview` always use stage DB?
2. Should `branch-deploy` also use stage DB, or stay production-like?
3. Is Supabase Branching available on the current Supabase plan?
4. Are we comfortable with one shared persistent stage DB initially?
5. Should PR migration changes automatically apply to shared stage DB?
6. Should stage DB be data-less plus seed, or should we invest in sanitized prod-like fixtures?

Recommended answers:

1. Yes, deploy-preview should always use stage DB.
2. Keep branch-deploy production-like unless there is a known branch deploy workflow.
3. Check plan; if available, use it later for ephemeral PR DBs.
4. Yes, acceptable initially with concurrency and a manual prepare-stage fallback.
5. Yes, for PRs from this repository that change `supabase/migrations/**`.
6. Data-less plus seed first.

## Recommended Immediate Next Step

Do not start `bonus_campaigns` until stage DB exists.

Implement in order:

1. Owner creates stage Supabase project and Netlify/GitHub secrets.
2. Add `db-migration-check.yml`.
3. Add `db-stage-apply-pr.yml`.
4. Add `db-stage-prepare.yml`.
5. Run:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=main
```

6. Confirm stage DB can run current `main` migrations.
7. Point Netlify deploy-preview at stage.
8. Open a test PR with a harmless migration and confirm automatic stage check is green.
9. Proceed with `bonus_campaigns`.
