# AI Agent DB Migration Checklist

Use this checklist when an AI agent works on a task that may touch database schema, seed data, Supabase SQL, chips ledger tables, bonus campaigns, or `supabase/migrations/**`.

## Detect Whether Migration Tooling Is Needed

Start by checking the PR diff and local working tree:

```bash
git fetch origin main
git diff --name-only origin/main...HEAD -- supabase/migrations
git status --short -- supabase/migrations scripts/check-db-migrations.mjs scripts/stage-db-migrate.mjs .github/workflows/db-*.yml
```

If no migration files changed, tell the user:

```text
No Supabase migration files changed, so the stage DB migration workflow is not needed for this PR.
```

If migration files changed, tell the user:

```text
This PR changes Supabase migrations.
Run locally: node scripts/check-db-migrations.mjs
Expect GitHub checks: DB Migration Check and DB Stage Apply PR.
Test the deploy preview only after DB Stage Apply PR is green.
```

Then run:

```bash
node scripts/check-db-migrations.mjs
```

## Changed Already-Applied Migrations

Do not edit an already-applied migration in place. If a PR changes SQL under an existing timestamp, stage may reject the PR with:

```text
Stage already has this migration version; bump timestamp or reset/recreate stage.
```

Preferred agent recommendation:

```text
Create a new timestamped migration with the additional SQL. Do not modify the previously applied migration file.
```

Only suggest resetting/recreating stage when the owner explicitly wants to discard shared stage state.

## Multiple PRs And Shared Stage

The stage DB is shared and can represent only one compatible migration history at a time.

When the user switches between DB-heavy PRs:

1. Check the target PR's `DB Stage Apply PR` result.
2. If it is green, stage is compatible with that PR.
3. If it fails with unrelated remote migration versions, explain that stage likely contains migrations from another branch.
4. Suggest manual prepare only when the user intentionally wants stage to target the selected branch:

```bash
gh workflow run db-stage-prepare.yml --ref main -f ref=<branch-or-sha>
```

If manual prepare still fails with unrelated versions, do not force more SQL. Recommend finishing the currently staged PR first, resetting/recreating stage, or making the target branch migration history compatible.

## What Agents Should Not Do

- Do not run `scripts/stage-db-migrate.mjs --apply` locally by default.
- Do not mutate stage DB outside GitHub Actions unless the user explicitly asks and provides the required stage DB environment.
- Do not hide a failed `DB Stage Apply PR`; summarize the failure and the next safe action.
- Do not advise raw production `psql -f` unless the migration version is also recorded in `supabase_migrations.schema_migrations`.

## Short User Reminder Template

```text
Migration reminder: this branch changes supabase/migrations.
Local guard: node scripts/check-db-migrations.mjs
PR gates: DB Migration Check + DB Stage Apply PR
If stage says the version already exists, add a new timestamped migration instead of editing the old one.
```
