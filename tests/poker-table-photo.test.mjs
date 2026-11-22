import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

process.env.XP_TEST_MODE = "1";
process.env.XP_CORS_ALLOW = "https://kcswh.pl";
const { createPokerTablePhotoHandler } = await import("../netlify/functions/poker-table-photo.mjs");

const viewer = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const photoId = "00000000-0000-4000-8000-000000000004";
const key = photoId + ".webp";
const signedUrl = "https://test.supabase.co/storage/v1/object/sign/profile-avatar-uploads/pending/" + photoId + "?token=synthetic";
const enabled = { POKER_TABLE_PHOTO_ENABLED: "1", GOOGLE_PHOTO_IMPORT_ENABLED: "1", UGC_SAFETY_ENABLED: "1" };
const row = { user_id: target, avatar_key: key, consent_revision: "1", avatar_revision: "2" };

function fixture(overrides = {}) {
  const calls = { sql: [], sign: [] };
  const handler = createPokerTablePhotoHandler({
    env: enabled, verify: async token => ({ valid: token === "synthetic", userId: viewer }), allow: async () => true,
    sql: async (_query, args) => { calls.sql.push(args); return [row]; },
    sign: async keys => { calls.sign.push(keys); return new Map([[key, signedUrl]]); },
    ...overrides
  });
  const read = async (params, token = "synthetic") => {
    const response = await handler({ httpMethod: "GET", headers: { origin: "https://kcswh.pl", authorization: "Bearer " + token },
      queryStringParameters: params });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };
  return { calls, read };
}

test("signed-in viewers need no membership; known revision never bypasses eligibility", async () => {
  const { calls, read } = fixture();
  assert.deepEqual(await read({ ids: target + "," + target + "," + viewer }), {
    status: 200, body: { photos: { [target]: { version: "1.2", url: signedUrl }, [viewer]: null } }
  });
  assert.deepEqual(calls.sql, [[viewer, [target, viewer], "2026-11-21-g4"], [viewer, [target], "2026-11-21-g4"]]);
  assert.deepEqual(calls.sign, [[key]]);
  assert.deepEqual(await read({ ids: target, known: target + ":1.2" }), {
    status: 200, body: { photos: { [target]: { version: "1.2" } } }
  });
  assert.equal(calls.sql.length, 3);
  assert.equal(calls.sign.length, 1);
  assert.deepEqual((await fixture({ sql: async () => [] }).read({ ids: target, known: target + ":1.2" })).body.photos,
    { [target]: null });
});

test("batch validates bounds and distinguishes denial from dependency failure", async () => {
  const { calls, read } = fixture();
  for (const params of [null, {}, { ids: "invalid" }, { ids: Array(10).fill(target).join(",") },
    { ids: target, known: viewer + ":1.2" }, { ids: target, known: target + ":x" },
    { ids: target, known: target + ":1.2," + target + ":1.2" }, { ids: target, known: "a".repeat(1100) }]) {
    assert.equal((await read(params)).status, 400);
  }
  assert.equal((await read({ ids: target }, "guest")).status, 401);
  assert.equal(calls.sql.length, 0);
  const statuses = [
    [{ verify: async () => ({ valid: true, userId: viewer, user: { claims: { is_anonymous: true } } }) }, 403, "unauthorized"],
    [{ verify: async () => ({ valid: false, reason: "remote_verify_failed" }) }, 503, "photo_unavailable"],
    [{ env: {} }, 404, "table_photos_disabled"],
    [{ allow: async () => false }, 429, "rate_limit_exceeded"],
    [{ sql: async () => { throw new Error(); } }, 503, "photo_unavailable"],
    [{ sign: async () => new Map() }, 503, "photo_unavailable"]
  ];
  for (const [deps, status, error] of statuses) {
    assert.deepEqual(await fixture(deps).read({ ids: target }), { status, body: { error } });
  }
});

test("withdrawal or changed revision during signing removes the capability from the response", async () => {
  for (const after of [[], [{ ...row, consent_revision: "2" }], [{ ...row, avatar_key: viewer + ".webp" }]]) {
    let reads = 0;
    const { read } = fixture({ sql: async () => ++reads === 1 ? [row] : after });
    assert.deepEqual(await read({ ids: target }), { status: 200, body: { photos: { [target]: null } } });
    assert.equal(reads, 2);
  }
});

test("photo lifecycle settles the spinner without flashing fallback or attaching stale bytes", async () => {
  const source = await readFile(new URL("../poker/poker-v2.js", import.meta.url), "utf8");
  const renderer = source.slice(source.indexOf("  var tablePhotoContext"), source.indexOf("  function seatAvatarSource("));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const revoked = [];
  const timeouts = new Set();
  let requests = 0, downloads = 0, blocked = false, mode = "ok", settleDecode;
  let shown, sessionToken = "synthetic";
  const seat = { seatNo: 2, userId: target, status: "ACTIVE" };
  const avatar = { dataset: { userId: target }, appendChild(image) { image.parentNode = this; shown = image; } };
  const runtime = {
    state: { tableId: viewer, currentUserId: viewer, mode: "live", seats: [seat], wsReady: true, hasAppliedAuthoritativeSnapshot: true },
    currentAccessToken: "synthetic", pendingLeaveNavigation: false, isGuestMode: false, snapshotRecoveryTimedOut: false,
    getAccessToken: async () => sessionToken, renderedSeatAvatars: { 2: avatar },
    isClosedTableStatus: () => false, currentPlayerStatus: () => "", ugcBlocked: () => blocked,
    AbortController, Uint8Array, Blob, URL: class extends URL {
      static createObjectURL() { return "blob:" + downloads; }
      static revokeObjectURL(url) { revoked.push(url); }
    },
    document: { hidden: false, createElement: () => ({
      decode: () => mode === "late" ? new Promise(resolve => { settleDecode = resolve; }) : Promise.resolve(),
      remove() { if (shown === this) shown = undefined; }
    }) },
    window: {
      SUPABASE_CONFIG: { SUPABASE_URL: "https://test.supabase.co" },
      setTimeout(callback, delay) {
        assert.equal(delay, 15000, "only active request timeouts are allowed");
        timeouts.add(callback);
        return callback;
      },
      clearTimeout(callback) { timeouts.delete(callback); }
    },
    fetch: async url => {
      if (url === signedUrl) {
        downloads++;
        return { type: "cors", ok: true, headers: new Headers({ "content-type": "image/webp" }),
          body: new Blob(["RIFF0000WEBP"]).stream() };
      }
      requests++;
      if (mode === "transient") return { status: 503 };
      if (mode === "off") return { status: 404, json: async () => ({ error: "table_photos_disabled" }) };
      const known = new URL(url, "https://kcswh.pl").searchParams.get("known");
      const value = mode === "denied" ? null : known ? { version: "1.2" } : { version: "1.2", url: signedUrl };
      return { ok: true, status: 200, json: async () => ({ photos: { [target]: value } }) };
    }
  };
  const { reconcile, clear, interrupt, attach, foreground } = runInNewContext(renderer + "({reconcile: reconcileTablePhotos, clear: clearTablePhotos, interrupt: interruptTablePhotoRead, attach: attachTablePhoto, foreground: reconcileTablePhotosOnForeground});", runtime);
  runtime.isGuestMode = true;
  reconcile();
  assert.equal(requests, 0);
  assert.equal(avatar.dataset.photoState, undefined);
  runtime.isGuestMode = false;
  runtime.state.hasAppliedAuthoritativeSnapshot = false;
  reconcile();
  assert.equal(avatar.dataset.photoState, "pending", "a patch before the snapshot cannot reveal the fallback");
  assert.equal(requests, 0, "a patch cannot start an eligibility request");
  assert.equal(timeouts.size, 1);
  reconcile();
  assert.equal(timeouts.size, 1, "rerender does not extend the snapshot wait");
  for (const onTimeout of timeouts) onTimeout();
  assert.equal(avatar.dataset.photoState, "settled", "a missing snapshot cannot leave the spinner indefinitely");
  clear();
  reconcile();
  assert.equal(avatar.dataset.photoState, "pending");
  runtime.state.hasAppliedAuthoritativeSnapshot = true;
  mode = "denied";
  reconcile();
  assert.equal(avatar.dataset.photoState, "pending", "cold eligibility check hides the fallback");
  await flush();
  assert.equal(avatar.dataset.photoState, "settled", "explicit denial reveals the catalog avatar");
  assert.equal(downloads, 0);
  reconcile(true);
  assert.equal(avatar.dataset.photoState, "settled", "known catalog avatar stays visible during revalidation");
  await flush();
  clear();
  mode = "transient";
  reconcile();
  assert.equal(avatar.dataset.photoState, "pending");
  await flush();
  assert.equal(avatar.dataset.photoState, "settled", "a failed batch ends the cold spinner");
  assert.equal(timeouts.size, 0);
  clear();
  mode = "late";
  reconcile();
  await flush();
  assert.equal(avatar.dataset.photoState, "pending", "wait for the Blob decoder");
  assert.equal(shown, undefined);
  settleDecode();
  await flush();
  assert.equal(shown?.src, "blob:1");
  assert.equal(avatar.dataset.photoState, "ready");
  attach(avatar, seat);
  assert.equal(avatar.dataset.photoState, "ready", "a ready cached Blob renders without spinner");
  mode = "ok";
  const beforeRerender = requests;
  assert.equal(timeouts.size, 0);
  reconcile();
  assert.equal(requests, beforeRerender);
  interrupt();
  runtime.currentAccessToken = null;
  reconcile();
  assert.equal(shown?.src, "blob:1");
  assert.equal(requests, beforeRerender);
  runtime.currentAccessToken = "new-token";
  reconcile();
  await flush();
  assert.equal(requests, beforeRerender + 1);
  assert.equal(downloads, 1);
  assert.equal(avatar.dataset.photoState, "ready");
  const beforeForeground = requests;
  foreground();
  await flush();
  assert.equal(requests, beforeForeground, "do not revalidate using the session token held before foreground");
  assert.equal(shown?.src, "blob:1");
  sessionToken = "new-token";
  mode = "transient";
  foreground();
  await flush();
  assert.equal(shown?.src, "blob:1");
  assert.equal(requests, beforeForeground + 1);
  mode = "denied";
  reconcile(true);
  await flush();
  assert.equal(shown, undefined);
  assert.equal(avatar.dataset.photoState, "settled");
  assert.deepEqual(revoked, ["blob:1"]);
  mode = "late";
  reconcile(true);
  await flush();
  assert.equal(typeof settleDecode, "function");
  assert.equal(avatar.dataset.photoState, "pending");
  runtime.state.currentUserId = target;
  clear();
  assert.equal(avatar.dataset.photoState, undefined);
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  settleDecode();
  await flush();
  assert.equal(shown, undefined);
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  mode = "ok";
  blocked = true;
  reconcile();
  assert.equal(downloads, 2);
  blocked = false;
  reconcile();
  await flush();
  assert.equal(shown?.src, "blob:3");
  mode = "off";
  reconcile(true);
  await flush();
  assert.equal(shown, undefined);
  assert.notEqual(avatar.dataset.photoState, "pending");
  const before = requests;
  reconcile(true);
  assert.equal(requests, before);
  assert.equal(timeouts.size, 0);
});
