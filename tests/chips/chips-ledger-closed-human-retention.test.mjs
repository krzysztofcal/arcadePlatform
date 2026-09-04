import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260904100000_chips_ledger_closed_human_table_retention.sql", "utf8");
const cleanup = fs.readFileSync("ws-server/poker/persistence/closed-table-cleanup.mjs", "utf8");

assert.match(migration, /human_retention_complete_at timestamptz/);
assert.match(migration, /chips_assert_closed_human_table_lifecycle_gate/);
assert.match(migration, /stage-ledger-auto-retention-30d-v1/);
assert.match(migration, /stage-ledger-closed-human-table-retention-30d-v1/);
assert.doesNotMatch(migration, /replay_transaction/);
assert.doesNotMatch(migration, /chips\.bot_registry_cleanup/);
assert.match(cleanup, /t\.has_human_participant is true and t\.human_retention_complete_at is not null/);
assert.match(cleanup, /t\.has_human_participant is not true and t\.bot_only_retention_complete_at is not null/);

process.stdout.write("chips-ledger-closed-human-retention contracts passed\n");
