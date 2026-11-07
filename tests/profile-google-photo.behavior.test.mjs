import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";

// #1140 UGC phase D: voluntary Google photo against the real phase D migration in an in-process Postgres.
// The fixture stands in for #1155 (profile columns, Terms policy), account deletion and phase C (avatar holds).
const photo = await import("../netlify/functions/_shared/profile-google-photo.mjs");
const { publishedPhotoKeys } = await import("../netlify/functions/_shared/profile-photo-publication.mjs");
const { publicProfile } = await import("../netlify/functions/_shared/user-profile.mjs");
const { createProfileGooglePhotoHandler } = await import("../netlify/functions/profile-google-photo.mjs");
const migration = await readFile(new URL("../supabase/migrations/20261107140000_google_photo_consent.sql", import.meta.url), "utf8");

const NOTICE = photo.GOOGLE_PHOTO_NOTICE_VERSION;
const TOKEN = "ya29.test-provider-token-0000";
const PICTURE = "https://lh3.googleusercontent.com/a/ACg8ocTestPhoto=s96-c";
const PNG = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#c33" } }).png().toBuffer();
// A valid image that is larger than 1 MiB: only the stream limit can refuse it.
const LARGE_PNG = await sharp(randomBytes(1000 * 1000 * 3), { raw: { width: 1000, height: 1000, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();

async function database({ holds = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
  grant usage on schema private to service_role;
  create table auth.users(id uuid primary key);
  create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, provider text not null, provider_id text not null);
  create table public.user_profiles(user_id uuid primary key references auth.users(id) on delete cascade, handle text not null, display_name text not null,
    avatar_key text, avatar_variant text not null default 'fox-blue', avatar_revision integer not null default 1, google_photo_suppressed boolean not null default false,
    leaderboard_visible boolean not null default true, public_profile_blocked boolean not null default false);
  create table public.account_deletion_requests(old_user_id uuid);
  create table private.account_avatar_objects(user_id uuid not null, output_path text not null, deleted_at timestamptz, primary key (user_id, output_path));
  create table public.profile_avatar_uploads(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, source_path text not null unique,
    declared_mime_type text not null, declared_size integer not null, created_at timestamptz default now(), expires_at timestamptz not null, consumed_at timestamptz,
    tracking_version integer, signing_finished_at timestamptz, capability_until timestamptz, output_path text, output_write_started_at timestamptz,
    output_write_finished_at timestamptz, source_deleted_at timestamptz, output_deleted_at timestamptz);
  create table private.profile_terms_policy(singleton boolean primary key, version text not null, active boolean not null, variants_enabled boolean not null);
  insert into private.profile_terms_policy values (true, 'a1', false, false);
  create table private.profile_terms_receipts(subject_kind text, subject_id text, account_user_id uuid, terms_version text, accepted_at timestamptz default now(), request_id text, expires_at timestamptz);`);
  if (holds) await db.exec("create table private.ugc_avatar_holds(user_id uuid primary key references auth.users(id) on delete cascade, admin_user_id uuid not null);");
  await db.exec(migration);
  const executeSql = async (query, params = []) => (await db.query(query, params)).rows;
  const beginSql = (work) => db.transaction((tx) => work({ unsafe: async (query, params = []) => (await tx.query(query, params)).rows }));
  let serial = 1;
  const user = async ({ google = "google-sub-1", avatarKey = null } = {}) => {
    const id = randomUUID();
    await executeSql("insert into auth.users(id) values($1)", [id]);
    if (google) await executeSql("insert into auth.identities(user_id, provider, provider_id) values($1,'google',$2)", [id, google]);
    await executeSql("insert into public.user_profiles(user_id, handle, display_name, avatar_key) values($1,$2,$3,$4)", [id, `player-${serial}`, `Player ${serial}`, avatarKey]);
    serial += 1;
    return id;
  };
  return { db, executeSql, beginSql, user };
}

// Fake network: Google userinfo, the Google image host and our Storage. Records every call.
function network(env, { sub = "google-sub-1", picture = PICTURE, image = PNG, userinfoStatus = 200, imageHeaders = {}, onUserinfo, onImage, onStorage, deleteStatus = 200, tracking = true } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || "GET", headers: { ...(options.headers || {}) }, redirect: options.redirect };
    calls.push(call);
    if (call.url === "https://openidconnect.googleapis.com/v1/userinfo") {
      if (onUserinfo) await onUserinfo();
      return new Response(JSON.stringify({ sub, picture }), { status: userinfoStatus, headers: { "content-type": "application/json" } });
    }
    if (call.url.startsWith("https://lh3.googleusercontent.com/")) {
      if (onImage) await onImage();
      return new Response(image, { status: 200, headers: { "content-type": "image/png", ...imageHeaders } });
    }
    if (call.url.startsWith("https://test.supabase.co/storage/")) {
      if (onStorage) await onStorage(call);
      return new Response("{}", { status: call.method === "DELETE" ? deleteStatus : 200 });
    }
    throw new Error(`unexpected fetch ${call.url}`);
  };
  const deps = { executeSql: env.executeSql, beginSql: env.beginSql, fetch, storageConfig: { baseUrl: "https://test.supabase.co", serviceKey: "service-key" }, env: { GOOGLE_PHOTO_IMPORT_ENABLED: "1", ...(tracking ? { ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED: "1" } : {}) } };
  return { calls, deps };
}

const input = (over = {}) => ({ action: "import", consent: true, noticeVersion: NOTICE, providerToken: TOKEN, ...over });
const profileRow = async (env, id) => (await env.executeSql("select avatar_key, avatar_revision, google_photo_suppressed from public.user_profiles where user_id=$1", [id]))[0];
const consentRow = async (env, id) => (await env.executeSql("select decision, notice_version, consent_revision, withdrawn_at, imported_avatar_key from private.profile_photo_consents where user_id=$1", [id]))[0];

test("an explicit import proves the Google account, stores a normalized copy tracked first, and publishes it on WWW only with consent", async () => {
  const env = await database();
  const id = await env.user();
  let atWrite = null;
  const net = network(env, {
    onStorage: async (call) => {
      if (call.method === "POST") atWrite = (await env.executeSql("select output_path, tracking_version, signing_finished_at is not null as signed, capability_until > now() + interval '7199 seconds' as horizon, output_write_started_at is not null as started, output_write_finished_at is null as open, source_deleted_at is not null as no_source from public.profile_avatar_uploads where user_id=$1", [id]))[0];
    },
  });
  const status = await photo.importGooglePhoto(id, input(), net.deps);
  assert.equal(status.photoInUse, true);
  assert.equal(status.consent.decision, "granted");
  assert.equal(status.consent.noticeVersion, NOTICE);
  const profile = await profileRow(env, id);
  assert.match(profile.avatar_key, /^[0-9a-f-]{36}\.webp$/);
  assert.deepEqual([profile.avatar_revision, profile.google_photo_suppressed], [2, false]);
  assert.deepEqual(await consentRow(env, id), { decision: "granted", notice_version: NOTICE, consent_revision: 1, withdrawn_at: null, imported_avatar_key: profile.avatar_key });
  assert.deepEqual(atWrite, { output_path: profile.avatar_key, tracking_version: 3, signed: true, horizon: true, started: true, open: true, no_source: true }, "the write is an open V3 manifest intent while it runs");
  assert.equal((await env.executeSql("select count(*)::int n from public.profile_avatar_uploads where user_id=$1 and output_write_finished_at is not null", [id]))[0].n, 1, "and confirmed after it");
  assert.equal((await env.executeSql("select count(*)::int n from private.account_avatar_objects where user_id=$1 and output_path=$2", [id, profile.avatar_key]))[0].n, 1);

  const legacy = await database();
  const lid = await legacy.user();
  let legacyTracked = null;
  const lnet = network(legacy, { tracking: false, onStorage: async (call) => { if (call.method === "POST") legacyTracked = (await legacy.executeSql("select count(*)::int n from private.account_avatar_objects where user_id=$1", [lid]))[0].n; } });
  await photo.importGooglePhoto(lid, input(), lnet.deps);
  assert.equal(legacyTracked, 1, "with tracking off the object is listed before the write");

  const [userinfo, download, upload] = net.calls;
  assert.equal(userinfo.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(userinfo.redirect, "error");
  assert.equal(download.url, "https://lh3.googleusercontent.com/a/ACg8ocTestPhoto=s256-c");
  assert.equal(download.redirect, "error");
  assert.equal(Object.keys(download.headers).some((h) => /authorization|apikey/i.test(h)), false, "no credentials to the image host");
  assert.equal(upload.url, `https://test.supabase.co/storage/v1/object/profile-avatars/${profile.avatar_key}`);
  assert.deepEqual([upload.headers["content-type"], upload.headers["cache-control"], upload.headers["x-upsert"]], ["image/webp", "3600", "false"]);

  const keys = await publishedPhotoKeys([id], net.deps);
  assert.equal(keys.get(id), profile.avatar_key);
  assert.equal((await publishedPhotoKeys([id], { ...net.deps, env: {} })).size, 0, "nothing is published while the flag is off");
  process.env.SUPABASE_URL = "https://test.supabase.co";
  const base = { userId: id, handle: "player-1", displayName: "Player 1", avatarKey: profile.avatar_key, avatarVariant: "fox-blue" };
  assert.deepEqual(publicProfile({ ...base, publishedPhotoKey: profile.avatar_key }).avatar, { type: "uploaded", url: `https://test.supabase.co/storage/v1/object/public/profile-avatars/${profile.avatar_key}` });
  assert.deepEqual(publicProfile(base).avatar, { type: "default", variant: "fox-blue" }, "an avatar key without consent stays unpublished");

  // Choosing an Arcade avatar later (phase A detaches the key and suppresses) stops publication.
  await env.executeSql("update public.user_profiles set avatar_key = null, google_photo_suppressed = true where user_id=$1", [id]);
  assert.equal((await publishedPhotoKeys([id], net.deps)).size, 0);
});

test("nothing leaves the server without a valid explicit request, a linked Google identity, current Terms and no moderator hold", async () => {
  const env = await database();
  const id = await env.user();
  for (const [bad, code] of [[{ consent: false }, "consent_required"], [{ consent: "yes" }, "consent_required"], [{ noticeVersion: "old" }, "notice_version_changed"],
    [{ providerToken: "" }, "google_proof_required"], [{ extra: 1 }, "invalid_request"]]) {
    const net = network(env);
    await assert.rejects(photo.importGooglePhoto(id, input(bad), net.deps), (e) => e.code === code, code);
    assert.equal(net.calls.length, 0, `${code}: no network call`);
  }
  const cases = [
    [async () => env.user({ google: null }), "google_identity_required"],
    [async () => { const u = await env.user(); await env.executeSql("insert into private.ugc_avatar_holds values($1,$2)", [u, randomUUID()]); return u; }, "photo_import_blocked"],
    [async () => { const u = await env.user(); await env.executeSql("insert into public.account_deletion_requests values($1)", [u]); return u; }, "account_not_active"],
  ];
  for (const [make, code] of cases) {
    const u = await make();
    const net = network(env);
    await assert.rejects(photo.importGooglePhoto(u, input(), net.deps), (e) => e.code === code, code);
    assert.equal(net.calls.length, 0, `${code}: no network call`);
  }
  await env.executeSql("update private.profile_terms_policy set active = true", []);
  const net = network(env);
  await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === "terms_required");
  assert.equal(net.calls.length, 0);

  const noPhaseC = await database({ holds: false });
  const u = await noPhaseC.user();
  const netC = network(noPhaseC);
  await assert.rejects(photo.importGooglePhoto(u, input(), netC.deps), (e) => e.code === "photo_import_unavailable", "fails closed without the phase C hold table");
  assert.equal(netC.calls.length, 0);
});

test("a wrong proof or an unusable photo changes nothing and stores nothing", async () => {
  assert.ok(LARGE_PNG.length > 1024 * 1024 && (await sharp(LARGE_PNG).metadata()).width === 1000, "fixture: valid image over 1 MiB");
  const env = await database();
  const id = await env.user();
  const variants = [
    [{ sub: "someone-else" }, "google_proof_invalid", 1],
    [{ userinfoStatus: 401 }, "google_proof_invalid", 1],
    [{ picture: "https://evil.example.com/a.png" }, "google_photo_unavailable", 1],
    [{ picture: "http://lh3.googleusercontent.com/a/x" }, "google_photo_unavailable", 1],
    [{ picture: "https://lh3.googleusercontent.com:8443/a/x" }, "google_photo_unavailable", 1],
    [{ picture: null }, "google_photo_unavailable", 1],
    [{ imageHeaders: { "content-length": String(2 * 1024 * 1024) } }, "google_photo_unavailable", 2],
    [{ image: LARGE_PNG }, "google_photo_unavailable", 2],
    [{ image: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") }, "google_photo_unavailable", 2],
  ];
  for (const [options, code, expectedCalls] of variants) {
    const net = network(env, options);
    await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === code, JSON.stringify(options).slice(0, 60));
    assert.equal(net.calls.length, expectedCalls, "no Storage call");
  }
  assert.deepEqual(await profileRow(env, id), { avatar_key: null, avatar_revision: 1, google_photo_suppressed: false });
  assert.equal(await consentRow(env, id), undefined, "no consent row without a completed import");
  assert.equal((await env.executeSql("select count(*)::int n from private.account_avatar_objects", []))[0].n, 0);
  assert.equal((await env.executeSql("select count(*)::int n from public.profile_avatar_uploads", []))[0].n, 0);
});

test("a change during the import (new avatar choice or a moderator hold) wins: the new copy is deleted and nothing is attached", async () => {
  for (const [label, during, code] of [
    ["avatar changed", (env, id) => env.executeSql("update public.user_profiles set avatar_revision = avatar_revision + 1 where user_id=$1", [id]), "stale_avatar_revision"],
    ["moderator hold", (env, id) => env.executeSql("insert into private.ugc_avatar_holds values($1,$2)", [id, randomUUID()]), "photo_import_blocked"],
  ]) {
    const env = await database();
    const id = await env.user();
    const net = network(env, { onImage: () => during(env, id) });
    await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === code, label);
    const posted = net.calls.find((c) => c.method === "POST");
    const removed = net.calls.find((c) => c.method === "DELETE");
    assert.ok(posted && removed, `${label}: the written copy is deleted`);
    assert.equal((await profileRow(env, id)).avatar_key, null);
    assert.equal(await consentRow(env, id), undefined);
    assert.equal((await env.executeSql("select count(*)::int n from public.profile_avatar_uploads where user_id=$1 and output_path is not null and output_deleted_at is null", [id]))[0].n, 1, `${label}: stays in the manifest for the purge`);
  }
});

test("an account deletion during the write never loses the object: it stays in the manifest, uncertain if the write is uncertain", async () => {
  const env = await database();
  const id = await env.user();
  const net = network(env, { deleteStatus: 500, onStorage: async (call) => { if (call.method === "POST") await env.executeSql("insert into public.account_deletion_requests values($1)", [id]); } });
  await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === "account_not_active");
  const [row] = await env.executeSql("select output_path, output_write_finished_at is not null as finished, output_deleted_at from public.profile_avatar_uploads where user_id=$1", [id]);
  assert.ok(net.calls.some((c) => c.method === "DELETE"), "compensating delete attempted");
  assert.deepEqual([!!row.output_path, row.finished, row.output_deleted_at], [true, true, null], "a failed compensation leaves a confirmed manifest output for the purge");
  assert.equal((await profileRow(env, id)).avatar_key, null);

  const lost = await database();
  const lid = await lost.user();
  const lnet = network(lost, { onStorage: async (call) => { if (call.method === "POST") throw new Error("response lost"); } });
  await assert.rejects(photo.importGooglePhoto(lid, input(), lnet.deps));
  const [uncertain] = await lost.executeSql("select output_write_started_at is not null as started, output_write_finished_at from public.profile_avatar_uploads where user_id=$1", [lid]);
  assert.deepEqual([uncertain.started, uncertain.output_write_finished_at], [true, null], "a lost write response stays uncertain for the deletion reconciliation");
});

test("a copy from a failed or uncertain import stays listed until deleted: it blocks a new import and the next withdrawal deletes it", async () => {
  const env = await database();
  const id = await env.user();
  const net = network(env, { deleteStatus: 500, onImage: () => photo.withdrawGooglePhoto(id, network(env).deps) });
  await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === "stale_avatar_revision");
  const [orphan] = await env.executeSql("select avatar_key from private.profile_photo_pending_deletions where user_id=$1", [id]);
  assert.ok(orphan, "the copy whose compensating deletion failed stays listed");
  const status = await photo.googlePhotoStatus(id, net.deps);
  assert.equal(status.copyStored, true);
  const blocked = network(env);
  await assert.rejects(photo.importGooglePhoto(id, input(), blocked.deps), (e) => e.code === "photo_copy_exists");
  assert.equal(blocked.calls.length, 0);
  const retry = network(env);
  const done = await photo.withdrawGooglePhoto(id, retry.deps);
  assert.deepEqual([done.copyDeleted, done.copyStored], [true, false]);
  assert.ok(retry.calls.some((c) => c.method === "DELETE"));
  assert.equal((await env.executeSql("select count(*)::int n from private.profile_photo_pending_deletions", []))[0].n, 0);
  await photo.importGooglePhoto(id, input(), network(env).deps);
  assert.equal((await env.executeSql("select count(*)::int n from private.profile_photo_pending_deletions", []))[0].n, 0, "an attached import is unlisted");

  const lost = await database();
  const lid = await lost.user();
  await assert.rejects(photo.importGooglePhoto(lid, input(), network(lost, { deleteStatus: 500, onStorage: async (call) => { if (call.method === "POST") throw new Error("response lost"); } }).deps));
  assert.equal((await lost.executeSql("select count(*)::int n from private.profile_photo_pending_deletions where user_id=$1", [lid]))[0].n, 1, "an uncertain write stays listed");
  assert.equal((await photo.withdrawGooglePhoto(lid, network(lost).deps)).copyDeleted, true);
});

test("a withdrawal while the copy is being written cannot orphan it", async () => {
  const env = await database();
  const id = await env.user();
  const deleted = [];
  const net = network(env, {
    onStorage: async (call) => {
      if (call.method === "POST") await photo.withdrawGooglePhoto(id, network(env).deps);
      if (call.method === "DELETE") deleted.push(call);
    },
  });
  await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === "stale_avatar_revision");
  assert.equal(deleted.length, 1, "the import deletes its own object after the write, although the withdrawal unlisted it");
  assert.equal((await env.executeSql("select count(*)::int n from private.profile_photo_pending_deletions", []))[0].n, 0);

  const failing = await database();
  const fid = await failing.user();
  const fnet = network(failing, { deleteStatus: 500, onStorage: async (call) => { if (call.method === "POST") await photo.withdrawGooglePhoto(fid, network(failing).deps); } });
  await assert.rejects(photo.importGooglePhoto(fid, input(), fnet.deps));
  assert.equal((await failing.executeSql("select count(*)::int n from private.profile_photo_pending_deletions where user_id=$1", [fid]))[0].n, 1, "listed again when its deletion fails");
  assert.equal((await photo.googlePhotoStatus(fid, fnet.deps)).copyStored, true);
});

test("a withdrawal during a first import wins", async () => {
  const env = await database();
  const id = await env.user();
  const net = network(env, { onImage: () => photo.withdrawGooglePhoto(id, network(env).deps) });
  await assert.rejects(photo.importGooglePhoto(id, input(), net.deps), (e) => e.code === "stale_avatar_revision");
  const profile = await profileRow(env, id);
  assert.deepEqual([profile.avatar_key, profile.google_photo_suppressed], [null, true]);
  assert.equal(await consentRow(env, id), undefined);
  assert.equal((await publishedPhotoKeys([id], net.deps)).size, 0);
});

test("a failed deletion of our copy is reported and retried by the next withdrawal", async () => {
  const env = await database();
  const id = await env.user();
  await photo.importGooglePhoto(id, input(), network(env).deps);
  const key = (await profileRow(env, id)).avatar_key;
  const failed = await photo.withdrawGooglePhoto(id, network(env, { deleteStatus: 500 }).deps);
  assert.deepEqual([failed.copyDeleted, failed.copyStored, failed.photoInUse, failed.consent.decision], [false, true, false, "withdrawn"]);
  const pending = await consentRow(env, id);
  assert.equal(pending.imported_avatar_key, key, "the key is kept until the copy is gone");
  assert.equal((await profileRow(env, id)).avatar_key, null, "but it is no longer shown");
  assert.equal((await publishedPhotoKeys([id], network(env).deps)).size, 0);
  const retry = network(env);
  const done = await photo.withdrawGooglePhoto(id, retry.deps);
  assert.deepEqual([done.copyDeleted, done.copyStored], [true, false]);
  assert.ok(retry.calls.some((c) => c.method === "DELETE"));
  const after = await consentRow(env, id);
  assert.deepEqual([after.imported_avatar_key, after.consent_revision, String(after.withdrawn_at)], [null, pending.consent_revision, String(pending.withdrawn_at)], "a retry does not record a new withdrawal");
});

test("withdrawal shows the Arcade avatar at once, deletes our copy and is recorded; a new import needs the old copy deleted first", async () => {
  const env = await database();
  const legacy = `${randomUUID()}.webp`;
  const id = await env.user({ avatarKey: legacy });
  const net = network(env);
  await photo.importGooglePhoto(id, input(), net.deps);
  const first = (await profileRow(env, id)).avatar_key;
  assert.equal(net.calls.filter((c) => c.method === "DELETE").length, 0, "a legacy upload is not deleted, only tracked");
  assert.equal((await env.executeSql("select count(*)::int n from private.account_avatar_objects where user_id=$1 and output_path=$2", [id, legacy]))[0].n, 1);

  const again = network(env);
  await assert.rejects(photo.importGooglePhoto(id, input(), again.deps), (e) => e.code === "photo_copy_exists");
  assert.equal(again.calls.length, 0, "refused before any network call while a copy exists");
  // A copy left by a failed deletion also blocks a new import until a withdrawal deletes it.
  await photo.withdrawGooglePhoto(id, network(env, { deleteStatus: 500 }).deps);
  await assert.rejects(photo.importGooglePhoto(id, input(), network(env).deps), (e) => e.code === "photo_copy_exists");
  await photo.withdrawGooglePhoto(id, network(env).deps);
  await photo.importGooglePhoto(id, input(), network(env).deps);
  const second = (await profileRow(env, id)).avatar_key;
  assert.notEqual(second, first);
  assert.equal((await consentRow(env, id)).consent_revision, 3);

  const out = network(env);
  const status = await photo.withdrawGooglePhoto(id, out.deps);
  assert.deepEqual([status.photoInUse, status.consent.decision], [false, "withdrawn"]);
  const profile = await profileRow(env, id);
  assert.deepEqual([profile.avatar_key, profile.google_photo_suppressed, profile.avatar_revision], [null, true, 6]);
  assert.equal(status.copyDeleted, true);
  const consent = await consentRow(env, id);
  assert.deepEqual([consent.decision, consent.imported_avatar_key, consent.consent_revision], ["withdrawn", null, 4]);
  assert.ok(consent.withdrawn_at);
  assert.equal(out.calls.filter((c) => c.method === "DELETE").length, 1, "our copy is deleted");
  assert.equal((await publishedPhotoKeys([id], out.deps)).size, 0);

  const plain = await env.user();
  await photo.withdrawGooglePhoto(plain, network(env).deps);
  assert.equal((await profileRow(env, plain)).google_photo_suppressed, true, "withdrawal without consent still stops any import");
  const deleting = await env.user();
  await env.executeSql("insert into public.account_deletion_requests values($1)", [deleting]);
  await assert.rejects(photo.withdrawGooglePhoto(deleting, network(env).deps), (e) => e.code === "account_deleting");
});

test("the consent record is private and follows account deletion", async () => {
  const env = await database();
  const id = await env.user();
  await photo.importGooglePhoto(id, input(), network(env).deps);
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["profile_photo_consents", "profile_photo_pending_deletions"]) {
      await assert.rejects(env.db.transaction(async (tx) => { await tx.query(`set local role ${role}`); await tx.query(`select 1 from private.${table}`); }), /permission denied/i, `${role} ${table}`);
    }
  }
  await assert.rejects(env.executeSql("insert into private.profile_photo_consents(user_id, notice_version, decision, granted_at, withdrawn_at) values($1,'x','withdrawn',now(),null)", [randomUUID()]), /check|foreign/i);
  await env.executeSql("delete from auth.users where id=$1", [id]);
  assert.equal((await env.executeSql("select count(*)::int n from private.profile_photo_consents", []))[0].n, 0);
});

test("the endpoint is signed-in only, dark by default, rate limited and never logs the provider token", async () => {
  const ev = (method, body) => ({ httpMethod: method, headers: { origin: "https://arcade.test", authorization: "Bearer t" }, body: body == null ? null : (typeof body === "string" ? body : JSON.stringify(body)) });
  const userId = randomUUID();
  const make = (over = {}) => createProfileGooglePhotoHandler({ env: { GOOGLE_PHOTO_IMPORT_ENABLED: "1" }, verifySupabaseJwt: async () => ({ valid: true, userId }),
    googlePhotoStatus: async () => ({ photoInUse: false }), importGooglePhoto: async () => ({ photoInUse: true }), withdrawGooglePhoto: async () => ({ photoInUse: false }),
    allowImport: async () => true, xpStoreUnavailableResponse: () => null, ...over });
  const logs = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    assert.equal((await make()(ev("OPTIONS"))).statusCode, 204);
    assert.equal((await make()(ev("PUT"))).statusCode, 405);
    assert.equal((await make({ verifySupabaseJwt: async () => ({ valid: false }) })(ev("GET"))).statusCode, 401);
    assert.equal((await make({ env: {} })(ev("GET"))).statusCode, 404);
    assert.equal((await make()(ev("GET"))).statusCode, 200);
    assert.equal((await make()(ev("POST", input()))).statusCode, 200);
    assert.equal((await make()(ev("POST", { action: "withdraw" }))).statusCode, 200);
    assert.equal((await make()(ev("POST", { action: "withdraw", consent: true }))).statusCode, 400);
    assert.equal((await make()(ev("POST", { action: "other" }))).statusCode, 400);
    assert.equal((await make()(ev("POST", "{"))).statusCode, 400);
    assert.equal((await make()(ev("POST", "x".repeat(9000)))).statusCode, 413);
    assert.equal((await make({ allowImport: async () => false })(ev("POST", input()))).statusCode, 429);
    assert.equal((await make({ allowImport: async () => { throw new Error("redis down"); } })(ev("POST", input()))).statusCode, 503);
    const refused = await make({ importGooglePhoto: async () => { throw photo.photoError("google_proof_invalid", 403); } })(ev("POST", input()));
    assert.deepEqual([refused.statusCode, JSON.parse(refused.body)], [403, { error: "google_proof_invalid" }]);
    const broken = await make({ importGooglePhoto: async () => { throw new Error(`boom ${TOKEN}`); } })(ev("POST", input()));
    assert.deepEqual([broken.statusCode, JSON.parse(broken.body)], [500, { error: "server_error" }]);
  } finally {
    console.log = original;
  }
  assert.equal(logs.some((line) => line.includes(TOKEN) || line.includes("googleusercontent")), false, "no token or photo URL in logs");
});
