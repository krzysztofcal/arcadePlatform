import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// #1140 UGC phase C: admin moderation against the real phase B and C migrations in an in-process Postgres.
const { decideReport, listReports, unrestrictProfile } = await import("../netlify/functions/_shared/ugc-moderation.mjs");
const { createReport } = await import("../netlify/functions/_shared/ugc-safety.mjs");
const { createAdminUgcReportsHandler } = await import("../netlify/functions/admin-ugc-reports.mjs");

const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const phaseB = await read("20261107120000_ugc_reports_blocks.sql");
const phaseC = await read("20261107130000_ugc_moderation.sql");
// phaseA: false (no #1155), true (#1155 column and its administrator-only guard), "noGuard" (column only),
// "disabledGuard" / "replicaGuard" (column with the guard trigger disabled or firing only in replica sessions).
async function database(phaseA) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
  grant usage on schema private to service_role;
  create table auth.users(id uuid primary key);
  create table public.user_profiles(user_id uuid primary key references auth.users(id) on delete cascade, handle text not null,
    display_name text not null, avatar_key text, avatar_variant text not null);
  grant select, update on public.user_profiles to service_role;
  create table public.account_deletion_requests(old_user_id uuid);
  create table private.account_avatar_objects(user_id uuid not null, output_path text not null check (output_path ~ '^[0-9a-f-]{36}\\.webp$'),
    deleted_at timestamptz, primary key (user_id, output_path));
  -- Same rule as public.account_guard_owned_write_v2: no profile write for an account in deletion.
  create function public.fake_account_guard() returns trigger language plpgsql security definer as $$
  begin
    if exists(select 1 from public.account_deletion_requests where old_user_id = new.user_id) then
      raise exception using errcode='42501', message='Account is not active';
    end if;
    return new;
  end $$;
  create trigger account_owned_write_v2 before insert or update on public.user_profiles for each row execute function public.fake_account_guard();`);
  if (phaseA) {
    await db.exec(`alter table public.user_profiles add column public_profile_blocked boolean not null default false;
    create function private.guard_public_profile_block() returns trigger language plpgsql set search_path=pg_catalog as $$
    begin
      if TG_OP='UPDATE' and new.public_profile_blocked is distinct from old.public_profile_blocked and current_user not in ('postgres','supabase_admin') then
        raise exception 'public profile block requires database administrator' using errcode='42501';
      end if;
      return new;
    end $$;
    create trigger user_profiles_block_guard before insert or update on public.user_profiles for each row execute function private.guard_public_profile_block();`);
    if (phaseA === "noGuard") await db.exec("drop trigger user_profiles_block_guard on public.user_profiles;");
    if (phaseA === "disabledGuard") await db.exec("alter table public.user_profiles disable trigger user_profiles_block_guard;");
    if (phaseA === "replicaGuard") await db.exec("alter table public.user_profiles enable replica trigger user_profiles_block_guard;");
  }
  await db.exec(phaseB);
  await db.exec(phaseC);
  const executeSql = async (query, params = []) => (await db.query(query, params)).rows;
  const beginSql = (work) => db.transaction((tx) => work({ unsafe: async (query, params = []) => (await tx.query(query, params)).rows }));
  let serial = 1;
  const user = async (avatarKey = null) => {
    const id = randomUUID();
    await executeSql("insert into auth.users(id) values($1)", [id]);
    await executeSql("insert into public.user_profiles(user_id, handle, display_name, avatar_variant, avatar_key) values($1,$2,$3,'fox-blue',$4)", [id, `player-${serial}`, `Player ${serial}`, avatarKey]);
    serial += 1;
    return id;
  };
  return { db, executeSql, deps: { executeSql, beginSql, env: {} }, user };
}

const ADMIN = "00000000-0000-4000-8000-00000000adad";
const report = (env, reporter, target, reason = "inappropriate_avatar") => createReport(reporter, { targetUserId: target, reason, context: "profile" }, env.deps);

test("the queue lists pending reports oldest first with the counter, and a report is decided only once with an audit", async () => {
  const env = await database(false);
  const reporterA = await env.user(); const reporterB = await env.user(); const target = await env.user();
  await report(env, reporterA, target);
  await report(env, reporterB, target, "harassment");
  const queue = await listReports(ADMIN, {}, env.deps);
  assert.equal(queue.pendingCount, 2);
  assert.deepEqual(queue.reports.map((r) => r.reason), ["inappropriate_avatar", "harassment"], "oldest first");
  assert.equal(queue.reports[0].target.openReports, 2);
  assert.equal(queue.reports[0].evidence.handle, queue.reports[0].target.handle);

  const first = queue.reports[0].id;
  assert.deepEqual(await decideReport(ADMIN, { reportId: first, decision: "dismissed" }, env.deps), { reportId: first, status: "dismissed", action: "none" });
  await assert.rejects(decideReport(ADMIN, { reportId: first, decision: "resolved" }, env.deps), (e) => e.code === "report_already_decided" && e.status === 409);
  assert.equal((await listReports(ADMIN, {}, env.deps)).pendingCount, 1, "the counter drops only after a decision");
  const dismissed = await listReports(ADMIN, { status: "dismissed" }, env.deps);
  assert.equal(dismissed.reports[0].status, "dismissed");
  assert.equal(dismissed.reports[0].resolution, null);
  const audit = await env.executeSql("select action, admin_user_id::text as admin from private.ugc_moderation_actions where report_id=$1", [first]);
  assert.deepEqual(audit, [{ action: "dismiss", admin: ADMIN }]);

  for (const [input, code] of [[{ reportId: "abc", decision: "resolved" }, "invalid_report"], [{ reportId: "1", decision: "maybe" }, "invalid_decision"],
    [{ reportId: "1", decision: "dismissed", action: "hide_avatar" }, "invalid_action"], [{ reportId: "1", decision: "resolved", action: "ban" }, "invalid_action"],
    [{ reportId: "1", decision: "resolved", note: "x" }, "invalid_decision"], [{ reportId: "999999", decision: "resolved" }, "report_not_found"]]) {
    await assert.rejects(decideReport(ADMIN, input, env.deps), (e) => e.code === code, code);
  }
  await assert.rejects(listReports(ADMIN, { status: "open" }, env.deps), (e) => e.code === "invalid_status");
  await assert.rejects(listReports("nope", {}, env.deps), (e) => e.status === 401);
});

test("hiding an avatar falls back to the Arcade avatar, hands the object to cleanup and records a hold", async () => {
  const env = await database(false);
  const key = `${randomUUID()}.webp`;
  const reporter = await env.user(); const target = await env.user(key);
  await report(env, reporter, target);
  const [pending] = (await listReports(ADMIN, {}, env.deps)).reports;
  assert.equal(pending.target.hasUploadedAvatar, true);
  await decideReport(ADMIN, { reportId: pending.id, decision: "resolved", action: "hide_avatar" }, env.deps);
  const [profile] = await env.executeSql("select avatar_key, avatar_variant from public.user_profiles where user_id=$1", [target]);
  assert.deepEqual(profile, { avatar_key: null, avatar_variant: "fox-blue" });
  assert.equal((await env.executeSql("select count(*)::int n from private.account_avatar_objects where user_id=$1 and output_path=$2", [target, key]))[0].n, 1);
  assert.equal((await env.executeSql("select count(*)::int n from private.ugc_avatar_holds where user_id=$1", [target]))[0].n, 1);
  const [resolved] = (await listReports(ADMIN, { status: "resolved" }, env.deps)).reports;
  assert.equal(resolved.resolution, "avatar_hidden");
  assert.equal(resolved.target.avatarHeld, true);
  assert.deepEqual((await env.executeSql("select action from private.ugc_moderation_actions where report_id=$1 order by id", [pending.id])).map((r) => r.action), ["hide_avatar", "resolve"]);
});

test("restricting a profile goes only through the audited function; without #1155 it refuses and keeps the report pending", async () => {
  const withBlock = await database(true);
  const reporter = await withBlock.user(); const target = await withBlock.user();
  await report(withBlock, reporter, target, "inappropriate_name");
  const [pending] = (await listReports(ADMIN, {}, withBlock.deps)).reports;
  await assert.rejects(withBlock.db.transaction(async (tx) => { await tx.query("set local role service_role"); await tx.query("update public.user_profiles set public_profile_blocked=true where user_id=$1", [target]); }), /database administrator/, "a direct update by the service role is still refused");
  await decideReport(ADMIN, { reportId: pending.id, decision: "resolved", action: "restrict_profile" }, withBlock.deps);
  assert.equal((await withBlock.executeSql("select public_profile_blocked from public.user_profiles where user_id=$1", [target]))[0].public_profile_blocked, true);
  assert.deepEqual(await unrestrictProfile(ADMIN, target, withBlock.deps), { userId: target, status: "unrestricted" });
  assert.equal((await withBlock.executeSql("select public_profile_blocked from public.user_profiles where user_id=$1", [target]))[0].public_profile_blocked, false);
  assert.deepEqual((await withBlock.executeSql("select action from private.ugc_moderation_actions where target_user_id=$1 order by id", [target])).map((r) => r.action), ["restrict_profile", "resolve", "unrestrict_profile"]);

  const withoutBlock = await database(false);
  const r2 = await withoutBlock.user(); const t2 = await withoutBlock.user();
  await report(withoutBlock, r2, t2);
  const [open] = (await listReports(ADMIN, {}, withoutBlock.deps)).reports;
  await assert.rejects(decideReport(ADMIN, { reportId: open.id, decision: "resolved", action: "restrict_profile" }, withoutBlock.deps), (e) => e.code === "profile_restriction_unavailable" && e.status === 409);
  assert.equal((await listReports(ADMIN, {}, withoutBlock.deps)).pendingCount, 1, "the failed decision is rolled back: the report is still pending");
  assert.equal((await withoutBlock.executeSql("select count(*)::int n from private.ugc_moderation_actions", []))[0].n, 0, "no audit row for a rolled-back decision");

  for (const variant of ["noGuard", "disabledGuard", "replicaGuard"]) {
    const unguarded = await database(variant);
    const r3 = await unguarded.user(); const t3 = await unguarded.user();
    await report(unguarded, r3, t3);
    const [item] = (await listReports(ADMIN, {}, unguarded.deps)).reports;
    await assert.rejects(decideReport(ADMIN, { reportId: item.id, decision: "resolved", action: "restrict_profile" }, unguarded.deps), (e) => e.code === "profile_restriction_unavailable", variant);
    await assert.rejects(unrestrictProfile(ADMIN, t3, unguarded.deps), (e) => e.code === "profile_restriction_unavailable", `${variant} unrestrict`);
    assert.equal((await listReports(ADMIN, {}, unguarded.deps)).pendingCount, 1, `${variant}: still pending`);
    assert.equal((await unguarded.executeSql("select public_profile_blocked from public.user_profiles where user_id=$1", [t3]))[0].public_profile_blocked, false, `${variant}: unchanged`);
    assert.equal((await unguarded.executeSql("select count(*)::int n from private.ugc_moderation_actions", []))[0].n, 0, `${variant}: no audit`);
  }
});

test("moderation tables are private and follow account deletion", async () => {
  const env = await database(false);
  for (const role of ["anon", "authenticated"]) {
    for (const statement of ["select 1 from private.ugc_moderation_actions", "select 1 from private.ugc_avatar_holds", "select private.ugc_set_profile_blocked(gen_random_uuid(), true)"]) {
      await assert.rejects(env.db.transaction(async (tx) => { await tx.query(`set local role ${role}`); await tx.query(statement); }), /permission denied/i, `${role}: ${statement}`);
    }
  }
  const reporter = await env.user(); const target = await env.user();
  await report(env, reporter, target);
  const [pending] = (await listReports(ADMIN, {}, env.deps)).reports;
  await decideReport(ADMIN, { reportId: pending.id, decision: "resolved", action: "hide_avatar" }, env.deps);
  await env.executeSql("delete from auth.users where id=$1", [target]);
  for (const table of ["ugc_reports", "ugc_moderation_actions", "ugc_avatar_holds"]) {
    assert.equal((await env.executeSql(`select count(*)::int n from private.${table}`, []))[0].n, 0, `${table} removed with the deleted account`);
  }
});

test("the admin endpoint is admin-only, dark by default and never echoes internal errors", async () => {
  const ev = (method, body, query) => ({ httpMethod: method, headers: { origin: "https://arcade.test", authorization: "Bearer t" }, body: body == null ? null : JSON.stringify(body), queryStringParameters: query || {} });
  const admin = async () => ({ userId: ADMIN });
  const make = (over = {}) => createAdminUgcReportsHandler({ env: { UGC_SAFETY_ENABLED: "1" }, requireAdminUser: admin,
    listReports: async () => ({ pendingCount: 3, reports: [], next: null }), decideReport: async (id, body) => ({ reportId: body.reportId, status: body.decision, action: "none" }),
    unrestrictProfile: async (id, userId) => ({ userId, status: "unrestricted" }), ...over });
  assert.equal((await make()(ev("OPTIONS"))).statusCode, 204);
  assert.equal((await make()(ev("DELETE"))).statusCode, 405);
  const denied = await make({ requireAdminUser: async () => { throw Object.assign(new Error("admin_required"), { status: 403, code: "admin_required" }); } })(ev("GET"));
  assert.equal(denied.statusCode, 403);
  assert.equal((await make({ env: {} })(ev("GET"))).statusCode, 404, "dark unless enabled");
  assert.deepEqual(JSON.parse((await make()(ev("GET"))).body), { pendingCount: 3, reports: [], next: null });
  assert.equal((await make()(ev("POST", { reportId: "1", decision: "resolved" }))).statusCode, 200);
  assert.equal((await make()(ev("POST", { action: "unrestrict_profile", userId: "x", extra: 1 }))).statusCode, 400);
  assert.equal((await make()({ ...ev("POST"), body: "{" })).statusCode, 400);
  const conflict = await make({ decideReport: async () => { throw Object.assign(new Error("x"), { status: 409, code: "report_already_decided" }); } })(ev("POST", { reportId: "1", decision: "resolved" }));
  assert.deepEqual([conflict.statusCode, JSON.parse(conflict.body)], [409, { error: "report_already_decided" }]);
  const broken = await make({ listReports: async () => { throw new Error("relation does not exist"); } })(ev("GET"));
  assert.deepEqual([broken.statusCode, JSON.parse(broken.body)], [500, { error: "server_error" }]);
});

test("pending reports removed by a real account deletion are counted anonymously, and a rolled-back deletion counts nothing", async () => {
  const env = await database(false);
  const count = async () => (await listReports(ADMIN, {}, env.deps)).removedWithDeletedAccount;
  const reporterA = await env.user(); const reporterB = await env.user();
  const target = await env.user(); const decided = await env.user(); const kept = await env.user();
  await report(env, reporterA, target);
  await report(env, reporterB, target, "harassment");
  await report(env, reporterA, decided);
  await report(env, reporterB, kept, "spam");
  const queue = (await listReports(ADMIN, {}, env.deps)).reports;
  await decideReport(ADMIN, { reportId: queue.find((r) => r.target.userId === decided).id, decision: "dismissed" }, env.deps);
  assert.equal(await count(), 0);

  await assert.rejects(env.db.transaction(async (tx) => {
    await tx.query("delete from auth.users where id=$1", [target]);
    throw new Error("abort deletion");
  }), /abort deletion/);
  assert.equal(await count(), 0, "a rolled-back deletion leaves the counter unchanged");
  assert.equal((await listReports(ADMIN, {}, env.deps)).pendingCount, 3, "and keeps the reports");

  await env.executeSql("delete from auth.users where id=$1", [target]);
  assert.equal(await count(), 2, "both pending reports about the deleted account are counted");
  await env.executeSql("delete from auth.users where id=$1", [decided]);
  assert.equal(await count(), 2, "a decided report removed with its account is not counted");
  await env.executeSql("delete from auth.users where id=$1", [reporterB]);
  assert.equal(await count(), 2, "deleting a reporter removes no report");
  const keptReport = (await listReports(ADMIN, {}, env.deps)).reports.find((r) => r.target.userId === kept);
  assert.ok(keptReport, "the report of a deleted reporter stays pending");
  await env.executeSql("delete from private.ugc_reports where id=$1", [keptReport.id]);
  assert.equal(await count(), 2, "a deletion that is not an account deletion is not counted");

  const columns = (await env.executeSql("select column_name from information_schema.columns where table_schema='private' and table_name='ugc_moderation_counters' order by ordinal_position", [])).map((r) => r.column_name);
  assert.deepEqual(columns, ["key", "value"], "no identifiers, content or hashes");
  assert.deepEqual(await env.executeSql("select key, value::int from private.ugc_moderation_counters", []), [{ key: "pending_removed_with_deleted_account", value: 2 }]);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(env.db.transaction(async (tx) => { await tx.query(`set local role ${role}`); await tx.query("select 1 from private.ugc_moderation_counters"); }), /permission denied/i, role);
  }
  await assert.rejects(env.db.transaction(async (tx) => { await tx.query("set local role service_role"); await tx.query("update private.ugc_moderation_counters set value = 0"); }), /permission denied/i, "service_role reads only");
});

test("a profile action on an account in deletion answers 409 account_deleting and changes nothing", async () => {
  const env = await database(true);
  const key = `${randomUUID()}.webp`;
  const reporter = await env.user(); const target = await env.user(key);
  await report(env, reporter, target);
  await report(env, await env.user(), target, "inappropriate_name");
  await env.executeSql("insert into public.account_deletion_requests(old_user_id) values($1)", [target]);
  const [first, second] = (await listReports(ADMIN, {}, env.deps)).reports;
  for (const action of ["hide_avatar", "restrict_profile"]) {
    await assert.rejects(decideReport(ADMIN, { reportId: first.id, decision: "resolved", action }, env.deps), (e) => e.code === "account_deleting" && e.status === 409, action);
  }
  await assert.rejects(unrestrictProfile(ADMIN, target, env.deps), (e) => e.code === "account_deleting" && e.status === 409);
  const [profile] = await env.executeSql("select avatar_key, public_profile_blocked from public.user_profiles where user_id=$1", [target]);
  assert.deepEqual(profile, { avatar_key: key, public_profile_blocked: false });
  for (const table of ["ugc_moderation_actions", "ugc_avatar_holds", "account_avatar_objects"]) {
    assert.equal((await env.executeSql(`select count(*)::int n from private.${table}`, []))[0].n, 0, `${table} untouched`);
  }
  assert.equal((await listReports(ADMIN, {}, env.deps)).pendingCount, 2, "both reports stay pending");
  assert.equal((await decideReport(ADMIN, { reportId: second.id, decision: "resolved" }, env.deps)).status, "resolved", "a decision without a profile action still works");
  await env.executeSql("delete from auth.users where id=$1", [target]);
  assert.equal((await listReports(ADMIN, {}, env.deps)).removedWithDeletedAccount, 1, "the still pending report is counted when the deletion completes");

  // The account lifecycle lock (the one requestDeletion takes) is held before the deletion check and before any write,
  // so a deletion cannot start between the check and the profile change.
  const other = await env.user(`${randomUUID()}.webp`);
  await report(env, reporter, other);
  const [open] = (await listReports(ADMIN, {}, env.deps)).reports;
  for (const [action, run] of [["hide_avatar", (deps) => decideReport(ADMIN, { reportId: open.id, decision: "resolved", action: "hide_avatar" }, deps)],
    ["unrestrict_profile", (deps) => unrestrictProfile(ADMIN, other, deps)]]) {
    const seen = [];
    const recording = { ...env.deps, beginSql: (work) => env.deps.beginSql((tx) => work({ unsafe: (query, params = []) => { seen.push({ query, params }); return tx.unsafe(query, params); } })) };
    await run(recording);
    const lock = seen.findIndex((q) => /pg_advisory_xact_lock/.test(q.query) && q.params[0] === `account-lifecycle:${other}`);
    const check = seen.findIndex((q) => /account_deletion_requests/.test(q.query));
    const firstWrite = seen.findIndex((q) => /^\s*(insert|update)\b|ugc_set_profile_blocked/i.test(q.query));
    assert.ok(lock >= 0 && lock < check && check < firstWrite, `${action}: lock, then deletion check, then writes`);
  }
});
