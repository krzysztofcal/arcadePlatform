import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// #1140 UGC phase B: reports and blocks against the real migration in an in-process Postgres.
const { blockUser, createReport, listBlocks, MAX_BLOCKS, ugcSafetyEnabled, unblockUser } = await import("../netlify/functions/_shared/ugc-safety.mjs");
const { createUgcReportHandler } = await import("../netlify/functions/ugc-report.mjs");
const { createUserBlocksHandler } = await import("../netlify/functions/user-blocks.mjs");

const migration = await readFile(new URL("../supabase/migrations/20261107120000_ugc_reports_blocks.sql", import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
create table auth.users(id uuid primary key);
create table public.user_profiles(user_id uuid primary key references auth.users(id) on delete cascade, handle text not null,
  display_name text not null, avatar_key text, avatar_variant text not null);
create table public.account_deletion_requests(old_user_id uuid);`);
await db.exec(migration);

const executeSql = async (query, params = []) => (await db.query(query, params)).rows;
const beginSql = (work) => db.transaction((tx) => work({ unsafe: async (query, params = []) => (await tx.query(query, params)).rows }));
const deps = { executeSql, beginSql, env: {} };
let serial = 100;
async function user(handle = `player-${serial++}`) {
  const id = randomUUID();
  await executeSql("insert into auth.users(id) values($1)", [id]);
  await executeSql("insert into public.user_profiles(user_id, handle, display_name, avatar_variant) values($1,$2,$3,'fox-blue')", [id, handle, `Name ${handle}`]);
  return { id, handle };
}
const reports = () => executeSql("select reporter_user_id::text as reporter, target_user_id::text as target, reason, context, table_id::text as table_id, evidence, status from private.ugc_reports order by id");

test("migration keeps both tables private, without free text and with consistent moderation state", async () => {
  for (const table of ["user_blocks", "ugc_reports"]) {
    assert.match(migration, new RegExp(`alter table private\\.${table} enable row level security;`));
  }
  assert.match(migration, /revoke all on private\.user_blocks, private\.ugc_reports from public, anon, authenticated;/);
  const columns = (await executeSql("select column_name, data_type from information_schema.columns where table_schema='private' and table_name='ugc_reports'"))
    .filter((c) => c.data_type === "text").map((c) => c.column_name).sort();
  assert.deepEqual(columns, ["context", "reason", "resolution", "status"], "every text column is a checked code, none is free text");
  const a = await user(); const b = await user();
  // Clients never reach these tables: the browser roles have no privilege at all.
  for (const role of ["anon", "authenticated"]) {
    for (const statement of ["select 1 from private.ugc_reports", "select 1 from private.user_blocks", `insert into private.user_blocks values('${a.id}','${b.id}')`]) {
      await assert.rejects(db.transaction(async (tx) => { await tx.query(`set local role ${role}`); await tx.query(statement); }), /permission denied/i, `${role}: ${statement}`);
    }
  }
  await assert.rejects(executeSql("insert into private.ugc_reports(reporter_user_id,target_user_id,reason,context) values($1,$2,'other','table')", [a.id, b.id]), /check/i, "table context needs a table");
  await assert.rejects(executeSql("insert into private.ugc_reports(reporter_user_id,target_user_id,reason,context,status) values($1,$2,'other','profile','resolved')", [a.id, b.id]), /check/i, "resolved needs resolved_at");
  await assert.rejects(executeSql("insert into private.user_blocks values($1,$1)", [a.id]), /check/i, "no self block");
});

test("a report names the target by handle or seat user id, keeps a server snapshot and is deduplicated while pending", async () => {
  const reporter = await user(); const target = await user("rough-wolf-1"); const other = await user();
  assert.deepEqual(await createReport(reporter.id, { targetHandle: "Rough-Wolf-1", reason: "inappropriate_avatar", context: "profile" }, deps), { status: "reported" });
  assert.deepEqual(await createReport(reporter.id, { targetUserId: target.id, reason: "harassment", context: "table", tableId: randomUUID() }, deps), { status: "already_reported" });
  assert.deepEqual(await createReport(other.id, { targetUserId: target.id.toUpperCase(), reason: "cheating", context: "table", tableId: randomUUID() }, deps), { status: "reported" });
  const rows = await reports();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].evidence, { handle: "rough-wolf-1", displayName: "Name rough-wolf-1", avatarVariant: "fox-blue", avatarKey: null });
  assert.equal(rows[1].context, "table");
  // A closed report allows a new one for the same pair.
  await executeSql("update private.ugc_reports set status='dismissed', resolved_at=now() where reporter_user_id=$1", [reporter.id]);
  assert.deepEqual(await createReport(reporter.id, { targetHandle: target.handle, reason: "spam", context: "profile" }, deps), { status: "reported" });

  const refuse = async (input, code) => assert.rejects(createReport(reporter.id, input, deps), (error) => error.code === code, code);
  await refuse({ targetHandle: target.handle, reason: "insult", context: "profile" }, "invalid_reason");
  await refuse({ targetHandle: target.handle, reason: "spam", context: "chat" }, "invalid_context");
  await refuse({ targetHandle: target.handle, reason: "spam", context: "table" }, "invalid_table");
  await refuse({ targetHandle: target.handle, reason: "spam", context: "profile", tableId: randomUUID() }, "invalid_table");
  await refuse({ targetHandle: target.handle, reason: "spam", context: "profile", note: "free text" }, "invalid_report");
  await refuse({ targetHandle: target.handle, targetUserId: target.id, reason: "spam", context: "profile" }, "invalid_target");
  await refuse({ targetHandle: reporter.handle, reason: "spam", context: "profile" }, "cannot_report_self");
  await refuse({ targetHandle: "nobody-here", reason: "spam", context: "profile" }, "target_not_found");
  await assert.rejects(createReport("not-a-user", { targetHandle: target.handle, reason: "spam", context: "profile" }, deps), (error) => error.status === 401);
});

test("blocks are the caller's own list, capped, idempotent and removable", async () => {
  const me = await user(); const them = await user("calm-owl-2");
  assert.deepEqual(await blockUser(me.id, { targetHandle: "calm-owl-2" }, deps), { status: "blocked", user: { userId: them.id, handle: "calm-owl-2", displayName: "Name calm-owl-2" } });
  assert.equal((await blockUser(me.id, { targetUserId: them.id }, deps)).status, "already_blocked");
  assert.deepEqual(await listBlocks(me.id, deps), [{ userId: them.id, handle: "calm-owl-2", displayName: "Name calm-owl-2" }]);
  assert.deepEqual(await listBlocks(them.id, deps), [], "a block is invisible to the blocked user's list");
  await assert.rejects(blockUser(me.id, { targetUserId: me.id }, deps), (error) => error.code === "cannot_block_self");
  await assert.rejects(blockUser(me.id, { targetUserId: them.id, reason: "x" }, deps), (error) => error.code === "invalid_block");
  assert.deepEqual(await unblockUser(me.id, them.id, deps), { status: "unblocked" });
  assert.deepEqual(await unblockUser(me.id, them.id, deps), { status: "not_blocked" });
  await assert.rejects(unblockUser(me.id, "nope", deps), (error) => error.code === "invalid_target");

  const heavy = await user();
  for (let i = 0; i < MAX_BLOCKS; i += 1) {
    const id = randomUUID();
    await executeSql("insert into auth.users(id) values($1)", [id]);
    await executeSql("insert into private.user_blocks(blocker_user_id, blocked_user_id) values($1,$2)", [heavy.id, id]);
  }
  await assert.rejects(blockUser(heavy.id, { targetUserId: them.id }, deps), (error) => error.code === "block_limit_reached" && error.status === 409);
});

test("account deletion cascades blocks and reports about the user and forgets a deleted reporter", async () => {
  const reporter = await user(); const target = await user(); const blocker = await user();
  await createReport(reporter.id, { targetUserId: target.id, reason: "spam", context: "profile" }, deps);
  await createReport(target.id, { targetUserId: blocker.id, reason: "other", context: "profile" }, deps);
  await blockUser(blocker.id, { targetUserId: target.id }, deps);
  await blockUser(target.id, { targetUserId: blocker.id }, deps);
  await executeSql("delete from auth.users where id=$1", [target.id]);
  assert.equal((await executeSql("select count(*)::int n from private.ugc_reports where target_user_id=$1", [target.id]))[0].n, 0);
  const [kept] = await executeSql("select reporter_user_id from private.ugc_reports where target_user_id=$1", [blocker.id]);
  assert.equal(kept.reporter_user_id, null, "the deleted reporter is forgotten, the report about another user stays");
  assert.equal((await executeSql("select count(*)::int n from private.user_blocks where $1 in (blocker_user_id, blocked_user_id)", [target.id]))[0].n, 0);
});

test("an account in deletion cannot report, block, list or unblock, whether or not new deletions are enabled", async () => {
  const leaving = await user(); const target = await user();
  await executeSql("insert into public.account_deletion_requests(old_user_id) values($1)", [leaving.id]);
  for (const lifecycle of [{ ...deps, env: { ACCOUNT_DELETION_ENABLED: "1" } }, { ...deps, env: {} }]) {
    await assert.rejects(createReport(leaving.id, { targetUserId: target.id, reason: "spam", context: "profile" }, lifecycle), (error) => error.code === "account_not_active");
    await assert.rejects(blockUser(leaving.id, { targetUserId: target.id }, lifecycle), (error) => error.code === "account_not_active");
    await assert.rejects(listBlocks(leaving.id, lifecycle), (error) => error.code === "account_not_active");
    await assert.rejects(unblockUser(leaving.id, target.id, lifecycle), (error) => error.code === "account_not_active");
  }
  assert.equal((await createReport(target.id, { targetUserId: leaving.id, reason: "spam", context: "profile" }, deps)).status, "reported", "others can still report that account");
  const gone = randomUUID();
  await assert.rejects(blockUser(gone, { targetUserId: target.id }, deps), (error) => error.code === "account_not_active", "a deleted auth user cannot act");
});

function event(method, body, extra = {}) {
  return { httpMethod: method, headers: { origin: "https://arcade.test", authorization: "Bearer t", ...extra.headers }, body: body == null ? null : JSON.stringify(body), queryStringParameters: extra.query || {} };
}
const signedIn = async () => ({ valid: true, userId: "00000000-0000-4000-8000-000000000001" });

test("report endpoint: signed-in only, dark by default, rate limited and failing closed", async () => {
  assert.equal(ugcSafetyEnabled({}), false);
  assert.equal(ugcSafetyEnabled({ CONTEXT: "deploy-preview" }), false, "never inferred from the context");
  assert.equal(ugcSafetyEnabled({ UGC_SAFETY_ENABLED: "true" }), false);
  assert.equal(ugcSafetyEnabled({ UGC_SAFETY_ENABLED: "1" }), true);
  assert.equal((await createUgcReportHandler({ env: {}, verifySupabaseJwt: signedIn })({ ...event("POST", { targetHandle: "abc-1", reason: "spam", context: "profile" }), headers: { origin: "https://arcade.test", authorization: "Bearer t", host: "deploy-preview-1--playkcswh.netlify.app" } })).statusCode, 404, "a preview Host header does not enable writes");
  const calls = [];
  const make = (over = {}) => createUgcReportHandler({ env: { UGC_SAFETY_ENABLED: "1" }, verifySupabaseJwt: signedIn, allowReport: async () => true,
    createReport: async (id, body) => { calls.push([id, body]); return { status: "reported" }; }, ...over });
  const body = { targetHandle: "rough-wolf-1", reason: "spam", context: "profile" };
  assert.equal((await make()(event("OPTIONS"))).statusCode, 204);
  assert.equal((await make()(event("GET"))).statusCode, 405);
  assert.equal((await make()({ ...event("POST", body), headers: { origin: "https://evil.example", authorization: "Bearer t" } })).statusCode, 403);
  assert.equal((await make()({ ...event("POST", body), headers: { origin: "https://arcade.test" } })).statusCode, 401);
  assert.equal((await make({ verifySupabaseJwt: async () => ({ valid: false }) })(event("POST", body))).statusCode, 401);
  assert.equal((await make({ env: {} })(event("POST", body))).statusCode, 404, "dark unless enabled");
  assert.equal((await make()({ ...event("POST"), body: "{" })).statusCode, 400);
  assert.equal((await make({ allowReport: async () => false })(event("POST", body))).statusCode, 429);
  assert.equal((await make({ allowReport: async () => { throw new Error("redis down"); } })(event("POST", body))).statusCode, 503);
  assert.equal(calls.length, 0, "nothing is written before auth, flag and rate limit pass");
  const ok = await make()(event("POST", body));
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.deepEqual(calls, [["00000000-0000-4000-8000-000000000001", body]]);
  assert.equal((await make({ createReport: async () => ({ status: "already_reported" }) })(event("POST", body))).statusCode, 200);
  const failing = (error) => make({ createReport: async () => { throw error; } })(event("POST", body));
  assert.equal((await failing(Object.assign(new Error("x"), { code: "target_not_found", status: 404 }))).statusCode, 404);
  assert.equal((await failing(Object.assign(new Error("x"), { code: "account_not_active" }))).statusCode, 403);
  assert.deepEqual(JSON.parse((await failing(new Error("database exploded"))).body), { error: "server_error" }, "internal errors are not echoed");
});

test("blocks endpoint: list, block and unblock only for the caller", async () => {
  const seen = [];
  const handler = createUserBlocksHandler({ env: { UGC_SAFETY_ENABLED: "1" }, verifySupabaseJwt: signedIn, allowChange: async () => true,
    listBlocks: async (id) => { seen.push(["list", id]); return []; },
    blockUser: async (id, body) => { seen.push(["block", id, body]); return { status: "blocked", user: {} }; },
    unblockUser: async (id, target) => { seen.push(["unblock", id, target]); return { status: "unblocked" }; } });
  assert.deepEqual(JSON.parse((await handler(event("GET"))).body), { blocks: [] });
  assert.equal((await handler(event("POST", { targetUserId: "00000000-0000-4000-8000-000000000002" }))).statusCode, 201);
  assert.equal((await handler(event("DELETE", null, { query: { userId: "00000000-0000-4000-8000-000000000002" } }))).statusCode, 200);
  assert.equal((await handler(event("PUT"))).statusCode, 405);
  assert.deepEqual(seen.map((entry) => entry.slice(0, 2)), [["list", "00000000-0000-4000-8000-000000000001"], ["block", "00000000-0000-4000-8000-000000000001"], ["unblock", "00000000-0000-4000-8000-000000000001"]]);
  const limited = createUserBlocksHandler({ env: { UGC_SAFETY_ENABLED: "1" }, verifySupabaseJwt: signedIn, allowChange: async () => false, listBlocks: async () => [] });
  assert.equal((await limited(event("GET"))).statusCode, 200, "reading the own list is not rate limited");
  assert.equal((await limited(event("POST", { targetUserId: "00000000-0000-4000-8000-000000000002" }))).statusCode, 429);
});
