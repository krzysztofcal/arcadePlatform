import { atomicRateLimitIncr } from "./_shared/store-upstash.mjs";
import { baseHeaders, corsHeaders, executeSql, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { googlePhotoEnabled } from "./_shared/profile-photo-publication.mjs";
import { signedPhotoUrls } from "./_shared/profile-avatar.mjs";
import { GOOGLE_PHOTO_TABLE_NOTICE_VERSION } from "./_shared/profile-google-photo.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^\d{1,10}\.\d{1,19}$/;
const KEY = /^[0-9a-f-]{36}\.webp$/;

function parseBatch({ ids, known = "" } = {}) {
  if (typeof ids !== "string" || typeof known !== "string" || ids.length + known.length > 1024) return null;
  const targets = ids.toLowerCase().split(",");
  const hints = known ? known.split(",") : [];
  if (targets.length > 9 || hints.length > 9 || !targets.every(id => UUID.test(id))) return null;
  const requested = new Set(targets);
  const versions = new Map();
  for (const hint of hints) {
    const [rawId, version, extra] = hint.split(":");
    const id = rawId.toLowerCase();
    if (extra !== undefined || !requested.has(id) || !VERSION.test(version) || versions.has(id)) return null;
    versions.set(id, version);
  }
  return { ids: [...requested], versions };
}

async function eligiblePhotos(sql, viewer, ids) {
  const rows = await sql(
    `select p.user_id::text as user_id, p.avatar_key, c.consent_revision::text, p.avatar_revision::text
       from public.user_profiles p
       join private.profile_photo_consents c on c.user_id = p.user_id
       where p.user_id = any($2::uuid[]) and c.notice_version = $3
         and c.decision = 'granted' and c.imported_avatar_key = p.avatar_key
         and p.google_photo_suppressed = false and p.public_profile_blocked = false
         and exists (select 1 from auth.users where id = $1 and is_anonymous is not true)
         and exists (select 1 from storage.buckets where id = 'profile-avatar-uploads' and public = false)
         and not exists (select 1 from private.ugc_avatar_holds where user_id = p.user_id)
         and not exists (select 1 from public.account_deletion_requests where old_user_id in ($1, p.user_id))
         and not exists (
           select 1 from private.user_blocks
           where (blocker_user_id = $1 and blocked_user_id = p.user_id)
              or (blocker_user_id = p.user_id and blocked_user_id = $1)
         )`, [viewer, ids, GOOGLE_PHOTO_TABLE_NOTICE_VERSION]);
  const photos = new Map();
  for (const row of rows) {
    const version = row.consent_revision + "." + row.avatar_revision;
    if (KEY.test(row.avatar_key) && VERSION.test(version)) photos.set(row.user_id, { key: row.avatar_key, version });
  }
  return photos;
}

async function allowRead(userId) {
  const { count } = await atomicRateLimitIncr(`kcswh:poker:table-photo:${userId}:${Math.floor(Date.now() / 60000)}`, 60);
  return count <= 24;
}

export function createPokerTablePhotoHandler({
  env = process.env, verify = verifySupabaseJwt, sql = executeSql, sign = signedPhotoUrls, allow = allowRead
} = {}) {
  return async (event) => {
    const cors = corsHeaders(event.headers?.origin || event.headers?.Origin, { methods: "GET, OPTIONS" });
    const reply = (statusCode, body) => ({
      statusCode, headers: { ...(cors || baseHeaders()), "cache-control": "private, no-store" }, body: JSON.stringify(body)
    });
    if (!cors) return reply(403, { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "GET") return reply(405, { error: "method_not_allowed" });
    try {
      // Eligibility checks the viewer's active account in the same SQL query as the targets.
      const auth = await verify(extractBearerToken(event.headers), { allowDeleting: true });
      if (!auth?.valid || !UUID.test(auth.userId || "")) {
        if (["remote_verify_failed", "remote_verify_unconfigured", "remote_verify_invalid_response", "missing_jwt_secret"].includes(auth?.reason)) {
          return reply(503, { error: "photo_unavailable" });
        }
        return reply(401, { error: "unauthorized" });
      }
      if (auth.user?.claims?.is_anonymous === true) return reply(403, { error: "unauthorized" });
      if (env.POKER_TABLE_PHOTO_ENABLED !== "1" || !googlePhotoEnabled(env)) return reply(404, { error: "table_photos_disabled" });
      const batch = parseBatch(event.queryStringParameters || {});
      if ((event.rawQuery || "").length > 2048 || !batch) return reply(400, { error: "invalid_batch" });
      if (!await allow(auth.userId)) return reply(429, { error: "rate_limit_exceeded" });
      const eligible = await eligiblePhotos(sql, auth.userId, batch.ids);
      const photos = Object.fromEntries(batch.ids.map(id => [id, null]));
      const changed = [];
      for (const id of batch.ids) {
        const photo = eligible.get(id);
        if (!photo) continue;
        if (photo.version === batch.versions.get(id)) photos[id] = { version: photo.version };
        else changed.push(id);
      }
      if (changed.length) {
        const urls = await sign([...new Set(changed.map(id => eligible.get(id).key))]);
        const current = await eligiblePhotos(sql, auth.userId, changed);
        for (const id of changed) {
          const { key, version } = eligible.get(id);
          const url = urls.get(key);
          if (!url) throw new Error("photo_signing_unavailable");
          if (current.get(id)?.key === key && current.get(id).version === version) photos[id] = { version, url };
        }
      }
      return reply(200, { photos });
    } catch {
      klog("poker_table_photo_read_failed", {});
      return reply(503, { error: "photo_unavailable" });
    }
  };
}

export const handler = createPokerTablePhotoHandler();
