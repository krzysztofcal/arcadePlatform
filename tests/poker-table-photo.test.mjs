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
        assert.deepEqual(params, [viewer, subject, "2026-11-21-g3"]);
        reads++;
        if (scenario === "no-consent" || scenario === "withdrawn" && reads === 2) return [];
        return [{ avatar_key: key, consent_revision: 1 }];
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
