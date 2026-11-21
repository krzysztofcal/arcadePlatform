import test from "node:test";
import assert from "node:assert/strict";
process.env.XP_TEST_MODE = "1";
const { createPokerTablePhotoHandler } = await import("../netlify/functions/poker-table-photo.mjs");

const viewer = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const tableId = "00000000-0000-4000-8000-000000000003";
const photoId = "00000000-0000-4000-8000-000000000004";
const key = photoId + ".webp";
const signedPath = "/storage/v1/object/sign/profile-avatar-uploads/pending/" + photoId;
const signedUrl = "https://test.supabase.co" + signedPath + "?token=synthetic";
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
    if (allowed) assert.ok(JSON.parse(response.body).expiresInMs > 0 && JSON.parse(response.body).expiresInMs <= 60000);
    if (scenario === "off") assert.equal(JSON.parse(response.body).error, "table_photos_disabled");
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

test("seat photo reauthorizes on expiry, clears on ejection and stops when disabled", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const source = await readFile(new URL("../poker/poker-v2.js", import.meta.url), "utf8");
  const renderer = source.slice(source.indexOf("  var seatPhotoReads"), source.indexOf("  function seatAvatarSource("));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const invalidUrls = {
    "wrong-origin": "https://other.supabase.co" + signedPath + "?token=synthetic",
    "wrong-path": signedUrl.replace(photoId, key),
    "no-token": "https://test.supabase.co" + signedPath
  };
  for (const scenario of ["expiry", "target-ejected", "viewer-ejected", "disabled", ...Object.keys(invalidUrls)]) {
    let now = 0, requests = 0, shown = false, status = "ACTIVE", timerId = 0;
    const timers = new Map();
    const seats = [{ userId: viewer, seatNo: 1, status }, { userId: target, seatNo: 2, status, profile: {} }];
    const avatar = { isConnected: true, appendChild() { shown = true; } };
    const sync = runInNewContext(renderer + "\nsyncSeatPhoto;", {
      state: { tableId, currentUserId: viewer, wsReady: true, seats },
      currentAccessToken: "synthetic", renderedSeatAvatars: { 2: avatar },
      deriveCurrentSeat: () => seats[0], isSeatedAtLiveTable: () => true,
      currentPlayerStatus: () => status, isClosedTableStatus: () => false, seatAvatarSource: () => "",
      AbortController, URL, performance: { now: () => now },
      document: { createElement: () => ({ addEventListener() {}, remove() { shown = false; } }) },
      window: {
        SUPABASE_CONFIG: { SUPABASE_URL: "https://test.supabase.co" },
        setTimeout(fn, delay) { timers.set(++timerId, { fn, due: now + delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); }
      },
      fetch: async () => {
        requests++;
        if (scenario === "disabled") return { ok: false, status: 404, json: async () => ({ error: "table_photos_disabled" }) };
        return { ok: true, json: async () => ({
          url: invalidUrls[scenario] ?? signedUrl,
          expiresInMs: 50000, seatNo: 2
        }) };
      }
    });
    sync(avatar, seats[1]);
    await flush();
    assert.equal(shown, scenario !== "disabled" && !(scenario in invalidUrls), scenario);
    if (scenario in invalidUrls) {
      assert.equal(timers.size, 0, scenario);
      continue;
    }
    if (scenario === "target-ejected") seats[1].status = "EJECTION_PENDING";
    if (scenario === "viewer-ejected") status = "REMOVED";
    if (scenario.endsWith("ejected")) {
      sync(avatar, seats[1]);
      assert.equal(shown, false);
      assert.equal(timers.size, 0);
    } else if (scenario === "expiry") {
      for (const when of [50000, 60000]) {
        now = when;
        for (const [id, timer] of timers) if (timer.due <= now) { timers.delete(id); timer.fn(); }
        await flush();
        assert.equal(shown, when === 60000);
      }
      assert.equal(requests, 2);
    } else {
      assert.equal(timers.size, 0);
      now = 120000;
      sync(avatar, seats[1]);
      assert.equal(requests, 1);
    }
  }
});
