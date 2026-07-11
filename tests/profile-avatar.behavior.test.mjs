import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createPendingUpload, finalizeAvatar, validateUploadRequest } from "../netlify/functions/_shared/profile-avatar.mjs";
import { createAvatarUploadUrlHandler } from "../netlify/functions/profile-avatar-upload-url.mjs";

const USER_ID = "00000000-0000-4000-8000-000000000003";

test("avatar upload request accepts only bounded raster formats", () => {
  assert.deepEqual(validateUploadRequest({ mimeType: "image/png", size: 1024 }), { mimeType: "image/png", size: 1024 });
  assert.throws(() => validateUploadRequest({ mimeType: "image/svg+xml", size: 1024 }), { code: "unsupported_avatar_type" });
  assert.throws(() => validateUploadRequest({ mimeType: "image/png", size: 1048577 }), { code: "avatar_too_large" });
});

test("upload-url endpoint requires auth and returns only backend-generated upload data", async () => {
  const unauthorized = createAvatarUploadUrlHandler({ verifySupabaseJwt: async () => ({ valid: false }) });
  const denied = await unauthorized({ httpMethod: "POST", headers: {}, body: "{}" });
  assert.equal(denied.statusCode, 401);

  const handler = createAvatarUploadUrlHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    createPendingUpload: async (userId, payload) => {
      assert.equal(userId, USER_ID);
      assert.deepEqual(payload, { mimeType: "image/webp", size: 1234, path: "client/path" });
      return { uploadId: "10000000-0000-4000-8000-000000000001", uploadUrl: "https://stage.supabase.co/signed", token: "signed", expiresAt: "2026-07-11T10:00:00Z" };
    },
  });
  const response = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ mimeType: "image/webp", size: 1234, path: "client/path" }),
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.uploadId, "10000000-0000-4000-8000-000000000001");
  assert.equal("sourcePath" in body, false);
});

test("pending upload signs only a server-generated private Storage path", async () => {
  const queries = [];
  const result = await createPendingUpload(USER_ID, { mimeType: "image/png", size: 512 }, {
    ensureUserProfile: async () => ({}),
    executeSql: async (query) => { queries.push(query); return []; },
    storageConfig: { baseUrl: "https://stage.supabase.co", serviceKey: "service-role" },
    fetch: async (url, options) => {
      assert.match(url, /\/storage\/v1\/object\/upload\/sign\/profile-avatar-uploads\/pending\/[0-9a-f-]{36}$/);
      assert.equal(options.method, "POST");
      return { ok: true, json: async () => ({ url: "/object/upload/sign/profile-avatar-uploads/pending/file?token=signed", token: "signed" }), text: async () => "" };
    },
  });
  assert.match(result.uploadId, /^[0-9a-f-]{36}$/);
  assert.equal(result.uploadUrl, "https://stage.supabase.co/storage/v1/object/upload/sign/profile-avatar-uploads/pending/file?token=signed");
  assert.ok(queries.some((query) => query.includes("insert into public.profile_avatar_uploads")));
});

test("finalization publishes only normalized 256px WebP and removes the original", async () => {
  const source = await sharp({
    create: { width: 420, height: 300, channels: 3, background: { r: 30, g: 120, b: 220 } },
  }).png().toBuffer();
  const uploadId = "10000000-0000-4000-8000-000000000002";
  const calls = [];
  let publicBody = null;
  const executeSql = async (query) => {
    calls.push(query);
    if (query.includes("update public.profile_avatar_uploads")) {
      return [{ id: uploadId, source_path: `pending/${uploadId}`, declared_mime_type: "image/png", declared_size: source.length }];
    }
    return [];
  };
  const fetchMock = async (url, options = {}) => {
    if (options.method === "GET") return { ok: true, arrayBuffer: async () => source, text: async () => "" };
    if (options.method === "POST") {
      publicBody = Buffer.from(options.body);
      assert.match(url, /profile-avatars\/[0-9a-f-]{36}\.webp$/);
      assert.equal(options.headers["content-type"], "image/webp");
      return { ok: true, text: async () => "" };
    }
    if (options.method === "DELETE") return { ok: true, text: async () => "" };
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const profile = {
    userId: USER_ID,
    handle: "avatar-test",
    displayName: "Avatar Test",
    bio: "",
    avatarKey: null,
    avatarVariant: "fox-blue",
    handleCustomizedAt: null,
  };

  const result = await finalizeAvatar(USER_ID, uploadId, {
    executeSql,
    fetch: fetchMock,
    storageConfig: { baseUrl: "https://stage.supabase.co", serviceKey: "service-role" },
    updateUserAvatarKey: async (_userId, avatarKey) => ({ profile: { ...profile, avatarKey }, previousAvatarKey: "old-avatar.webp" }),
  });

  assert.match(result.avatarKey, /^[0-9a-f-]{36}\.webp$/);
  const metadata = await sharp(publicBody).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.ok(calls.some((query) => query.includes("delete from public.profile_avatar_uploads")));
});
