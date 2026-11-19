import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cleanupExpiredUploads, createPendingUpload, finalizeAvatar, validateUploadRequest, signedPhotoUrls, deleteTrackedPhoto } from "../netlify/functions/_shared/profile-avatar.mjs";
import { createAvatarUploadUrlHandler } from "../netlify/functions/profile-avatar-upload-url.mjs";

const USER_ID = "00000000-0000-4000-8000-000000000003";

test("avatar upload request accepts only bounded raster formats", () => {
  assert.deepEqual(validateUploadRequest({ mimeType: "image/png", size: 1024 }), { mimeType: "image/png", size: 1024 });
  assert.deepEqual(validateUploadRequest({ mimeType: "image/x-png", size: 1024 }), { mimeType: "image/png", size: 1024 });
  assert.throws(() => validateUploadRequest({ mimeType: "image/svg+xml", size: 1024 }), { code: "unsupported_avatar_type" });
  assert.throws(() => validateUploadRequest({ mimeType: "image/png", size: 1048577 }), { code: "avatar_too_large" });
});

test("finalization trusts detected safe image content over browser-declared raster MIME", async () => {
  const source = await sharp({ create: { width: 612, height: 778, channels: 3, background: "#336699" } }).png().toBuffer();
  const uploadId = "10000000-0000-4000-8000-000000000005";
  let published = false;
  const profile = { userId: USER_ID, handle: "png-avatar", displayName: "PNG Avatar", bio: "", avatarKey: null, avatarVariant: "fox-blue", handleCustomizedAt: null };
  const result = await finalizeAvatar(USER_ID, uploadId, {
    executeSql: async (query) => query.includes("update public.profile_avatar_uploads")
      ? [{ id: uploadId, source_path: `pending/${uploadId}`, declared_mime_type: "image/jpeg", declared_size: source.length }]
      : [],
    storageConfig: { baseUrl: "https://stage.supabase.co", serviceKey: "service-role" },
    fetch: async (_url, options = {}) => {
      if (options.method === "GET") return { ok: true, arrayBuffer: async () => source, text: async () => "" };
      if (options.method === "POST") { published = true; return { ok: true, text: async () => "" }; }
      if (options.method === "DELETE") return { ok: true, text: async () => "" };
      throw new Error(`unexpected request ${options.method}`);
    },
    updateUserAvatarKey: async (_userId, avatarKey) => ({ profile: { ...profile, avatarKey }, previousAvatarKey: null }),
  });
  assert.equal(published, true);
  assert.match(result.avatarKey, /^[0-9a-f-]{36}\.webp$/);
});

test("retired public upload URL endpoint cannot sign a new Storage capability", async () => {
 const handler=createAvatarUploadUrlHandler({createPendingUpload:async()=>{throw Error("must not sign");}});
 assert.equal((await handler({httpMethod:"POST",headers:{origin:"https://arcade.test"},body:"{}"})).statusCode,410);
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
      assert.match(url, /\/storage\/v1\/object\/profile-avatars\/[0-9a-f-]{36}\.webp$/);
      assert.doesNotMatch(url, /\/object\/authenticated\/profile-avatars\//);
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

test("expired upload receipt remains retryable when private Storage cleanup fails", async () => {
  const queries = [];
  await cleanupExpiredUploads({
    executeSql: async (query) => {
      queries.push(query);
      if (query.includes("select id::text")) return [{ id: "10000000-0000-4000-8000-000000000003", user_id: USER_ID, source_path: "pending/expired" }];
      return [];
    },
    storageConfig: { baseUrl: "https://stage.supabase.co", serviceKey: "service-role" },
    fetch: async () => ({ ok: false, status: 503, text: async () => "temporary failure" }),
  });
  assert.equal(queries.filter((query) => query.includes("delete from public.profile_avatar_uploads")).length, 0);
});

test("finalization removes a newly published avatar when profile update fails", async () => {
  const source = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).png().toBuffer();
  const uploadId = "10000000-0000-4000-8000-000000000004";
  const deleted = [];
  await assert.rejects(() => finalizeAvatar(USER_ID, uploadId, {
    executeSql: async (query) => query.includes("update public.profile_avatar_uploads")
      ? [{ id: uploadId, source_path: `pending/${uploadId}`, declared_mime_type: "image/png", declared_size: source.length }]
      : [],
    storageConfig: { baseUrl: "https://stage.supabase.co", serviceKey: "service-role" },
    fetch: async (url, options = {}) => {
      if (options.method === "GET") return { ok: true, arrayBuffer: async () => source, text: async () => "" };
      if (options.method === "POST") return { ok: true, text: async () => "" };
      if (options.method === "DELETE") {
        deleted.push(JSON.parse(options.body).prefixes[0]);
        return { ok: true, text: async () => "" };
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
    updateUserAvatarKey: async () => { throw new Error("database unavailable"); },
  }), /database unavailable/);
  assert.ok(deleted.some((path) => /^[0-9a-f-]{36}\.webp$/.test(path)));
  assert.ok(deleted.includes(`pending/${uploadId}`));
});


test('photo signing keeps its 5s signal while tracked deletion keeps its 30s default', async t => {
  const five = new AbortController().signal, thirty = new AbortController().signal, timeouts = [];
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return ms === 5000 ? five : thirty; });
  const key = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', signals = [];
  const deps = { env: { ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED: '1' }, storageConfig: { baseUrl: 'https://test.supabase.co', serviceKey: 'fake' },
    fetch: async (url, options) => { signals.push(options.signal); return new Response(JSON.stringify(url.includes('/object/sign/') ? [{path:'pending/'+key.slice(0,-5),signedURL:'/object/sign/profile-avatar-uploads/pending/'+key.slice(0,-5)+'?token=fake'}] : {})); }
  };
  await signedPhotoUrls([key], deps); assert.equal(signals[0], five); assert.deepEqual(timeouts, [5000]);
  await deleteTrackedPhoto(USER_ID, key, deps); assert.equal(signals[1], thirty); assert.deepEqual(timeouts, [5000,30000]);
  await deleteTrackedPhoto(USER_ID, key, {...deps,env:{}}); assert.equal(signals[2], undefined);
});

test('a signing timeout falls back to the existing catalog projection', async () => {
  const {attachPublishedPhotos} = await import('../netlify/functions/_shared/profile-photo-publication.mjs');
  const input = { userId: USER_ID, avatarKey:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp',avatarVariant:'wizard-indigo' };
  const [result] = await attachPublishedPhotos([input], { env:{GOOGLE_PHOTO_IMPORT_ENABLED:'1',UGC_SAFETY_ENABLED:'1',ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED:'1'},
    executeSql:async()=>[{user_id:USER_ID,avatar_key:input.avatarKey}],storageConfig:{baseUrl:'https://test.supabase.co',serviceKey:'fake'},
    fetch:async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}
  });
  assert.equal(result.publishedPhotoUrl,undefined);assert.equal(result.avatarVariant,'wizard-indigo');assert.equal(input.publishedPhotoUrl,undefined);
});
