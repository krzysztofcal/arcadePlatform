import { atomicRateLimitIncr } from "./_shared/store-upstash.mjs";
import { baseHeaders, corsHeaders, executeSql, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { googlePhotoEnabled } from "./_shared/profile-photo-publication.mjs";
import { signedPhotoUrls } from "./_shared/profile-avatar.mjs";
import { loadWsTablePhotoMembership } from "./_shared/poker-ws-runtime-notify.mjs";

export const TABLE_PHOTO_NOTICE = "2026-11-21-p1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f-]{36}[.]webp$/;

async function eligiblePhoto(sql, viewer, target) {
  const [row] = await sql(
    `select p.avatar_key, c.consent_revision, t.granted_at::text as table_grant
       from public.user_profiles p
       join private.profile_photo_consents c on c.user_id = p.user_id
       join private.poker_table_photo_consents t on t.user_id = p.user_id
       where p.user_id = $2 and t.notice_version = $3
         and c.decision = 'granted' and c.imported_avatar_key = p.avatar_key and t.avatar_key = p.avatar_key
         and p.google_photo_suppressed = false and p.public_profile_blocked = false
         and exists (select 1 from storage.buckets where id = 'profile-avatar-uploads' and public = false)
         and not exists (select 1 from private.ugc_avatar_holds where user_id = $2)
         and not exists (select 1 from public.account_deletion_requests where old_user_id in ($1, $2))
         and not exists (
           select 1 from private.user_blocks
           where (blocker_user_id = $1 and blocked_user_id = $2)
              or (blocker_user_id = $2 and blocked_user_id = $1)
         )`, [viewer, target, TABLE_PHOTO_NOTICE]);
  return row && KEY.test(row.avatar_key) ? row : null;
}

const OWN_COPY = `from private.profile_photo_consents c
  where c.user_id = $1 and c.decision = 'granted' and c.imported_avatar_key is not null
    and not exists (select 1 from public.account_deletion_requests where old_user_id = $1)`;

async function consentStatus(sql, userId, enabled) {
  const [row] = await sql(`select exists(select 1 ${OWN_COPY}) as available,
    exists(select 1 ${OWN_COPY} and exists (
      select 1 from private.poker_table_photo_consents t where t.user_id = c.user_id
      and t.avatar_key = c.imported_avatar_key and t.notice_version = $2
    )) as granted`, [userId, TABLE_PHOTO_NOTICE]);
  return { available: enabled && row?.available === true, granted: row?.granted === true, noticeVersion: TABLE_PHOTO_NOTICE };
}

async function allowRead(userId) {
  const { count } = await atomicRateLimitIncr(`kcswh:poker:table-photo:${userId}:${Math.floor(Date.now() / 60000)}`, 60);
  return count <= 24;
}

export function createPokerTablePhotoHandler({
  env = process.env, verify = verifySupabaseJwt, sql = executeSql,
  membership = loadWsTablePhotoMembership, sign = signedPhotoUrls, allow = allowRead
} = {}) {
  return async (event) => {
    const cors = corsHeaders(event.headers?.origin || event.headers?.Origin, { methods: "GET, POST, OPTIONS" });
    const reply = (statusCode, body) => ({
      statusCode, headers: { ...(cors || baseHeaders()), "cache-control": "no-store" }, body: JSON.stringify(body)
    });
    if (!cors) return reply(403, { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (!["GET", "POST"].includes(event.httpMethod)) return reply(405, { error: "method_not_allowed" });
    const absent = () => reply(404, { error: "not_found" });
    const enabled = env.POKER_TABLE_PHOTO_ENABLED === "1" && googlePhotoEnabled(env);
    try {
      const auth = await verify(extractBearerToken(event.headers));
      if (!auth?.valid || !UUID.test(auth.userId || "")) return reply(401, { error: "unauthorized" });
      if (event.queryStringParameters?.scope === "own" && event.httpMethod === "GET") {
        return reply(200, await consentStatus(sql, auth.userId, enabled));
      }
      if (event.httpMethod === "POST") {
        if (event.isBase64Encoded || typeof event.body !== "string" || event.body.length > 256) return reply(400, { error: "invalid_request" });
        let body;
        try { body = JSON.parse(event.body); } catch { return reply(400, { error: "invalid_request" }); }
        if (body?.action === "withdraw" && Object.keys(body).length === 1) {
          await sql("delete from private.poker_table_photo_consents where user_id = $1", [auth.userId]);
        } else if (body?.action === "grant" && body.noticeVersion === TABLE_PHOTO_NOTICE && Object.keys(body).length === 2 && enabled) {
          const rows = await sql(`insert into private.poker_table_photo_consents (user_id, avatar_key, notice_version)
            select c.user_id, c.imported_avatar_key, $2 ${OWN_COPY} for update of c
            on conflict (user_id) do update set avatar_key = excluded.avatar_key,
              notice_version = excluded.notice_version, granted_at = clock_timestamp()
            returning user_id`, [auth.userId, TABLE_PHOTO_NOTICE]);
          if (!rows.length) return absent();
        } else return reply(400, { error: "invalid_request" });
        return reply(200, await consentStatus(sql, auth.userId, enabled));
      }
      if (!enabled) return absent();
      const { tableId, targetUserId } = event.queryStringParameters || {};
      if (!UUID.test(tableId || "") || !UUID.test(targetUserId || "")) return absent();
      if (!await allow(auth.userId)) return reply(429, { error: "rate_limit_exceeded" });
      const query = { tableId, viewerUserId: auth.userId, targetUserId, env };
      const before = await membership(query);
      if (!before) return absent();
      const photo = await eligiblePhoto(sql, auth.userId, targetUserId);
      if (!photo) return absent();
      const expiresAt = Date.now() + 60_000;
      const url = (await sign([photo.avatar_key])).get(photo.avatar_key);
      if (!url) return absent();
      const current = await eligiblePhoto(sql, auth.userId, targetUserId);
      if (!current || current.avatar_key !== photo.avatar_key || current.consent_revision !== photo.consent_revision
        || current.table_grant !== photo.table_grant) return absent();
      const after = await membership(query);
      if (!after || ["tableId", "viewerUserId", "targetUserId", "viewerSeatNo", "targetSeatNo"].some(key => before[key] !== after[key])
        || Date.now() >= expiresAt) return absent();
      return reply(200, { url, expiresAt, seatNo: after.targetSeatNo });
    } catch {
      klog("poker_table_photo_read_failed", {});
      return absent();
    }
  };
}

export const handler = createPokerTablePhotoHandler();
