import test from "node:test";
import assert from "node:assert/strict";
process.env.XP_TEST_MODE = "1";
const { createPokerTablePhotoHandler } = await import("../netlify/functions/poker-table-photo.mjs");

const viewer = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const tableId = "00000000-0000-4000-8000-000000000003";
const key = "00000000-0000-4000-8000-000000000004.webp";
const enabled = { POKER_TABLE_PHOTO_ENABLED: "1", GOOGLE_PHOTO_IMPORT_ENABLED: "1", UGC_SAFETY_ENABLED: "1" };

test("table photo signs only the WS participant's current, separately consented copy", async () => {
  for (const scenario of ["ok", "own", "off", "unavailable", "no-consent", "withdrawn", "seat-changed", "unauthorized"]) {
    let reads = 0, projections = 0, signed = 0;
    const subject = scenario === "own" ? viewer : target;
    const handler = createPokerTablePhotoHandler({
      env: scenario === "off" ? {} : enabled,
      verify: async () => ({ valid: scenario !== "unauthorized", userId: viewer }),
      allow: async () => true,
      membership: async query => {
        projections++;
        assert.equal(query.viewerUserId, viewer);
        assert.equal(query.targetUserId, subject);
        assert.equal(query.tableId, tableId);
        if (scenario === "unavailable") return null;
        return { ...query, viewerSeatNo: 1, targetSeatNo: subject === viewer ? 1 : scenario === "seat-changed" && projections === 2 ? 3 : 2, stateVersion: projections };
      },
      sql: async (_query, params) => {
        assert.deepEqual(params.slice(0, 2), [viewer, subject]);
        reads++;
        if (scenario === "no-consent" || scenario === "withdrawn" && reads === 2) return [];
        return [{ avatar_key: key, consent_revision: 1, table_grant: "grant" }];
      },
      sign: async keys => {
        signed++;
        assert.deepEqual(keys, [key]);
        return new Map([[key, "https://example.invalid/signed"]]);
      }
    });
    const response = await handler({ httpMethod: "GET", headers: { authorization: "Bearer synthetic" },
      queryStringParameters: { tableId, targetUserId: subject, viewerUserId: target } });
    const allowed = ["ok", "own"].includes(scenario);
    assert.equal(response.statusCode, allowed ? 200 : scenario === "unauthorized" ? 401 : 404, scenario);
    assert.equal(signed, ["ok", "own", "withdrawn", "seat-changed"].includes(scenario) ? 1 : 0, scenario);
    if (!allowed) assert.doesNotMatch(response.body, /signed/);
  }
});

test("table consent uses only the authenticated owner's account and never grants from g2 alone", async () => {
  const calls = [];
  const handler = createPokerTablePhotoHandler({
    env: enabled,
    verify: async () => ({ valid: true, userId: viewer }),
    allow: async () => true,
    sql: async (query, params) => {
      calls.push({ query, params });
      return query.startsWith("insert") ? [{ user_id: viewer }] : [{ available: true, granted: false }];
    }
  });
  const post = body => handler({ httpMethod: "POST", headers: { authorization: "Bearer synthetic" }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "grant", noticeVersion: "2026-11-17-g2" })).statusCode, 400);
  assert.equal((await post({ action: "grant", noticeVersion: "2026-11-21-p1", userId: target })).statusCode, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post({ action: "grant", noticeVersion: "2026-11-21-p1" })).statusCode, 200);
  assert.match(calls[0].query, /select c.user_id, c.imported_avatar_key/);
  assert.equal((await post({ action: "withdraw" })).statusCode, 200);
  assert.match(calls[2].query, /^delete from private.poker_table_photo_consents/);
  assert.ok(calls.every(call => call.params[0] === viewer));
});

test("internal table photo client never accepts absent or malformed authorization", async () => {
  const { loadWsTablePhotoMembership } = await import("../netlify/functions/_shared/poker-ws-runtime-notify.mjs");
  const params = { tableId, viewerUserId: viewer, targetUserId: target,
    env: { POKER_WS_INTERNAL_BASE_URL: "https://internal.invalid", POKER_WS_INTERNAL_TOKEN: "synthetic" } };
  assert.equal(await loadWsTablePhotoMembership({ ...params, fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await loadWsTablePhotoMembership({ ...params, fetchImpl: async () => ({ ok: true,
    json: async () => ({ authorized: true, tableId, viewerSeatNo: 1, targetSeatNo: 1, stateVersion: 1 })
  }) }), null);
  const match = await loadWsTablePhotoMembership({ ...params, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get("userId"), viewer);
    assert.equal(options.headers.authorization, "Bearer synthetic");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ authorized: true, tableId, viewerSeatNo: 1, targetSeatNo: 2, stateVersion: 8 }) };
  } });
  assert.equal(match.targetUserId, target);
  assert.equal(match.targetSeatNo, 2);
});

test("table permission is deleted with g2 withdrawal even if the same copy key is later reused", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema private;
      create table private.profile_photo_consents (user_id uuid primary key, decision text, imported_avatar_key text);`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261121120000_poker_table_photo_consent.sql", import.meta.url), "utf8"));
    await db.query("insert into private.profile_photo_consents values ($1, 'granted', $2)", [viewer, key]);
    await db.query("insert into private.poker_table_photo_consents (user_id, avatar_key, notice_version) values ($1, $2, '2026-11-21-p1')", [viewer, key]);
    await db.query("update private.profile_photo_consents set decision = 'withdrawn' where user_id = $1", [viewer]);
    await db.query("update private.profile_photo_consents set decision = 'granted' where user_id = $1", [viewer]);
    const { rows } = await db.query("select user_id from private.poker_table_photo_consents");
    assert.deepEqual(rows, []);
  } finally {
    await db.close();
  }
});
