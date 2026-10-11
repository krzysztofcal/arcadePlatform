import assert from "node:assert/strict";
import test from "node:test";
import { readRequest, stageConnection, parseRewards } from "../scripts/ops/stage-bonus-campaigns.mjs";

const owner = { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
  GITHUB_REF: "refs/heads/main", GITHUB_ACTOR: "krzysztofcal" };

test("Stage bonus operator refuses wrong identity or target", () => {
  assert.equal(readRequest({ ...owner, BONUS_ACTION: "inspect" }).action, "inspect");
  for (const [key, value] of [["GITHUB_ACTOR", "bot"], ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_REPOSITORY", "other/repo"], ["GITHUB_EVENT_NAME", "pull_request"]]) {
    assert.throws(() => readRequest({ ...owner, [key]: value }), /unauthorized_stage_operator/);
  }
  const validDb = { SUPABASE_STAGE_PROJECT_REF: "krydukthwdvccggbyjfw",
    SUPABASE_STAGE_DIRECT_DB_URL: "postgresql://user:password@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres" };
  assert.equal(new URL(stageConnection(validDb)).hostname, "db.krydukthwdvccggbyjfw.supabase.co");
  assert.throws(() => stageConnection({ ...validDb, SUPABASE_DB_URL: "postgresql://other" }), /unexpected_generic_db_url/);
  assert.throws(() => stageConnection({ ...validDb, SUPABASE_STAGE_PROJECT_REF: "otbqfijerkieoxwpxjnm" }), /wrong_stage_project_ref/);
  assert.throws(() => stageConnection({ ...validDb, SUPABASE_STAGE_DIRECT_DB_URL: validDb.SUPABASE_STAGE_DIRECT_DB_URL.replace("krydukthwdvccggbyjfw", "otbqfijerkieoxwpxjnm") }), /wrong_stage_database_target/);
});

test("Stage mutations require exact approved parameters and valid Daily rewards", () => {
  assert.deepEqual(parseRewards("25,50,100,200"), [25, 50, 100, 200]);
  assert.throws(() => parseRewards("25,0,100,200"), /invalid_daily_rewards/);
  assert.throws(() => readRequest({ ...owner, BONUS_ACTION: "create_daily_draft", BONUS_CODE: "bonus", BONUS_REWARDS: "25,50,100,200" }), /stage_bonus_go_required/);
  assert.equal(readRequest({ ...owner, BONUS_ACTION: "create_daily_draft", BONUS_CODE: "bonus", BONUS_REWARDS: "25,50,100,200",
    BONUS_CONFIRM: "GO STAGE BONUS create_daily_draft bonus 25,50,100,200" }).code, "bonus");
  assert.throws(() => readRequest({ ...owner, BONUS_ACTION: "switch_daily", BONUS_CODE: "new", BONUS_OLD_CODE: "old",
    BONUS_CONFIRM: "GO STAGE BONUS switch_daily new FROM wrong" }), /stage_bonus_go_required/);
  assert.equal(readRequest({ ...owner, BONUS_ACTION: "switch_daily", BONUS_CODE: "new", BONUS_OLD_CODE: "old",
    BONUS_CONFIRM: "GO STAGE BONUS switch_daily new FROM old" }).action, "switch_daily");
  assert.throws(() => readRequest({ ...owner, BONUS_ACTION: "set_status", BONUS_CODE: "bonus", BONUS_STATUS: "active" }), /invalid_status/);
  assert.equal(readRequest({ ...owner, BONUS_ACTION: "set_status", BONUS_CODE: "bonus", BONUS_STATUS: "ended",
    BONUS_CONFIRM: "GO STAGE BONUS set_status bonus ended" }).status, "ended");
});
