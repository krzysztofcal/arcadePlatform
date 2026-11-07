import crypto from "node:crypto";
import { assertAccountActive, lockAccountLifecycle } from "../../../shared/account-deletion.mjs";
import { requireCurrentTerms } from "../../../shared/profile-terms.mjs";
import { PUBLIC_BUCKET, deleteStorageObject, normalizeAvatarImage, writeTrackedOutput } from "./profile-avatar.mjs";
import { googlePhotoEnabled } from "./profile-photo-publication.mjs";
import { beginSql, executeSql } from "./supabase-admin.mjs";

// #1140 UGC phase D: a voluntary, explicit, withdrawable Google profile photo.
// - Consent is a separate unticked choice sent with this request; sign-in alone never imports or grants anything.
// - Proof: the current Google provider token must return, from Google's fixed userinfo endpoint, the same `sub` as
//   the account's server-side Google identity. user_metadata, e-mail or a client URL are never trusted.
// - The photo is downloaded once from a fixed Google image host, re-encoded by the existing avatar normalizer and
//   stored in our public avatar bucket. The provider token, the Google URL and the image are never logged or stored.
// - A moderator avatar hold (phase C) refuses the import; without the phase C table the import fails closed.
export { googlePhotoEnabled };
export const GOOGLE_PHOTO_NOTICE_VERSION = "2026-11-07-g1";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const PHOTO_HOST_RE = /^lh[3-6]\.googleusercontent\.com$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;

export function photoError(code, status = 409) {
  return Object.assign(new Error(code), { code, status });
}

function requireUser(userId) {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) throw photoError("unauthorized", 401);
  return userId.toLowerCase();
}

async function assertNoModeratorHold(tx, userId) {
  const [table] = await tx.unsafe("select to_regclass('private.ugc_avatar_holds') is not null as present;", []);
  if (table?.present !== true) throw photoError("photo_import_unavailable");
  const [hold] = await tx.unsafe("select exists(select 1 from private.ugc_avatar_holds where user_id = $1) as held;", [userId]);
  if (hold?.held === true) throw photoError("photo_import_blocked");
}

async function googleSubject(tx, userId) {
  const rows = await tx.unsafe("select provider_id from auth.identities where user_id = $1 and provider = 'google' limit 2;", [userId]);
  if (rows?.length !== 1 || typeof rows[0].provider_id !== "string" || !rows[0].provider_id) throw photoError("google_identity_required");
  return rows[0].provider_id;
}

// Checks done before any network call and again, under the row locks, before the photo is attached. At most one
// copy exists and it is always on the consent record: a new import needs the earlier copy deleted first (withdraw).
async function importChecks(tx, userId, ownKey = null) {
  await assertAccountActive(tx, userId);
  await requireCurrentTerms(tx, { kind: "account", id: userId });
  await assertNoModeratorHold(tx, userId);
  const sub = await googleSubject(tx, userId);
  const [consent] = await tx.unsafe("select imported_avatar_key from private.profile_photo_consents where user_id = $1 for update;", [userId]);
  const [pending] = await tx.unsafe("select exists(select 1 from private.profile_photo_pending_deletions where user_id = $1 and avatar_key is distinct from $2) as any;", [userId, ownKey]);
  if (consent?.imported_avatar_key || pending?.any === true) throw photoError("photo_copy_exists");
  return sub;
}

// Deletes the listed copies and unlists each one whose Storage deletion succeeded.
async function deletePendingCopies(userId, deps) {
  const runSql = deps.executeSql || executeSql;
  const rows = await runSql("select avatar_key from private.profile_photo_pending_deletions where user_id = $1 order by avatar_key;", [userId]);
  let all = true;
  for (const { avatar_key: key } of rows || []) {
    try {
      await deleteStorageObject(PUBLIC_BUCKET, key, deps);
      await runSql("delete from private.profile_photo_pending_deletions where user_id = $1 and avatar_key = $2;", [userId, key]);
    } catch {
      all = false;
    }
  }
  return all;
}

function photoUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw photoError("google_photo_unavailable", 404);
  }
  if (url.protocol !== "https:" || !PHOTO_HOST_RE.test(url.hostname) || url.port || url.username || url.password) {
    throw photoError("google_photo_unavailable", 404);
  }
  url.pathname = url.pathname.replace(/=s\d+(-c)?$/, "=s256-c");
  url.search = "";
  url.hash = "";
  return url.href;
}

async function verifyGoogleProof(providerToken, expectedSub, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(USERINFO_URL, {
      headers: { Authorization: `Bearer ${providerToken}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw photoError("google_unavailable", 503);
  }
  if (response.status === 401 || response.status === 403) throw photoError("google_proof_invalid", 403);
  if (!response.ok) throw photoError("google_unavailable", 503);
  const info = await response.json().catch(() => null);
  if (!info || typeof info.sub !== "string" || info.sub !== expectedSub) throw photoError("google_proof_invalid", 403);
  return photoUrl(info.picture);
}

async function downloadPhoto(url, fetchImpl) {
  let response;
  try {
    // No credentials of ours are ever sent to the image host.
    response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "image/jpeg,image/png,image/webp" } });
  } catch {
    throw photoError("google_photo_unavailable", 404);
  }
  if (!response.ok || !response.body) throw photoError("google_photo_unavailable", 404);
  if (Number(response.headers.get("content-length") || 0) > MAX_PHOTO_BYTES) throw photoError("google_photo_unavailable", 404);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PHOTO_BYTES) {
      await reader.cancel().catch(() => {});
      throw photoError("google_photo_unavailable", 404);
    }
    chunks.push(Buffer.from(value));
  }
  if (!size) throw photoError("google_photo_unavailable", 404);
  return Buffer.concat(chunks);
}

export async function googlePhotoStatus(userId, deps = {}) {
  const user = requireUser(userId);
  const runSql = deps.executeSql || executeSql;
  const [row] = await runSql(
    `select c.decision, c.notice_version, c.granted_at, c.withdrawn_at, c.imported_avatar_key,
            p.avatar_key, p.google_photo_suppressed,
            exists(select 1 from private.profile_photo_pending_deletions d where d.user_id = $1) as pending_copy,
            exists(select 1 from auth.identities i where i.user_id = $1 and i.provider = 'google') as google_linked
     from (select $1::uuid as user_id) u
     left join private.profile_photo_consents c on c.user_id = u.user_id
     left join public.user_profiles p on p.user_id = u.user_id;`,
    [user],
  );
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  return {
    noticeVersion: GOOGLE_PHOTO_NOTICE_VERSION,
    googleLinked: row?.google_linked === true,
    consent: row?.decision ? { decision: row.decision, noticeVersion: row.notice_version, grantedAt: iso(row.granted_at), withdrawnAt: iso(row.withdrawn_at) } : null,
    photoInUse: row?.decision === "granted" && !!row.imported_avatar_key && row.imported_avatar_key === row.avatar_key && row.google_photo_suppressed === false,
    // Our copy still exists (after a withdrawal: its deletion failed and is retried by the next withdrawal).
    copyStored: !!row?.imported_avatar_key || row?.pending_copy === true,
  };
}

export async function importGooglePhoto(userId, input = {}, deps = {}) {
  const user = requireUser(userId);
  const allowed = new Set(["action", "consent", "noticeVersion", "providerToken"]);
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !allowed.has(key))) throw photoError("invalid_request", 400);
  if (input.consent !== true) throw photoError("consent_required", 400);
  if (input.noticeVersion !== GOOGLE_PHOTO_NOTICE_VERSION) throw photoError("notice_version_changed");
  if (typeof input.providerToken !== "string" || !/^[\x21-\x7e]{16,4096}$/.test(input.providerToken)) throw photoError("google_proof_required", 400);
  const runTx = deps.beginSql || beginSql;
  const fetchImpl = deps.fetch || fetch;

  // 1. Short transaction, no lock held during the network calls.
  const before = await runTx(async (tx) => {
    const sub = await importChecks(tx, user);
    const [profile] = await tx.unsafe("select avatar_revision from public.user_profiles where user_id = $1;", [user]);
    if (!profile) throw photoError("profile_not_found", 404);
    return { sub, revision: Number(profile.avatar_revision) };
  });
  // 2. Proof, download and normalization.
  const url = await verifyGoogleProof(input.providerToken, before.sub, fetchImpl);
  let image;
  try {
    image = await normalizeAvatarImage(await downloadPhoto(url, fetchImpl), deps);
  } catch (error) {
    throw error?.code === "google_photo_unavailable" ? error : photoError("google_photo_unavailable", 404);
  }
  // 3. Listed for deletion, then written under the avatar manifest protocol (tracked before the Storage write).
  const key = `${crypto.randomUUID()}.webp`;
  await (deps.executeSql || executeSql)("insert into private.profile_photo_pending_deletions (user_id, avatar_key) values ($1, $2);", [user, key]);
  let attached = false;
  try {
    await writeTrackedOutput(user, image, deps, key);
    // 4. Attach under the lifecycle lock and the profile row lock, re-checking everything.
    await runTx(async (tx) => {
      const sub = await importChecks(tx, user, key);
      if (sub !== before.sub) throw photoError("google_identity_required");
      const [profile] = await tx.unsafe("select avatar_key, avatar_revision from public.user_profiles where user_id = $1 for update;", [user]);
      if (!profile) throw photoError("profile_not_found", 404);
      if (Number(profile.avatar_revision) !== before.revision) throw photoError("stale_avatar_revision");
      for (const tracked of new Set([profile.avatar_key, key].filter(Boolean))) {
        await tx.unsafe("insert into private.account_avatar_objects (user_id, output_path) values ($1, $2) on conflict (user_id, output_path) do nothing;", [user, tracked]);
      }
      await tx.unsafe(
        `insert into private.profile_photo_consents (user_id, notice_version, decision, granted_at, imported_avatar_key)
         values ($1, $2, 'granted', now(), $3)
         on conflict (user_id) do update set notice_version = excluded.notice_version, decision = 'granted',
           consent_revision = private.profile_photo_consents.consent_revision + 1, granted_at = now(), withdrawn_at = null,
           imported_avatar_key = excluded.imported_avatar_key;`,
        [user, GOOGLE_PHOTO_NOTICE_VERSION, key],
      );
      await tx.unsafe("update public.user_profiles set avatar_key = $2, google_photo_suppressed = false, avatar_revision = avatar_revision + 1 where user_id = $1;", [user, key]);
      await tx.unsafe("delete from private.profile_photo_pending_deletions where user_id = $1 and avatar_key = $2;", [user, key]);
    });
    attached = true;
  } finally {
    // Not attached (refused, failed or uncertain): always delete our own object now that the write is over, even if a
    // concurrent withdrawal already unlisted it; it is listed again until a deletion is confirmed.
    if (!attached) {
      const runSql = deps.executeSql || executeSql;
      try {
        await deleteStorageObject(PUBLIC_BUCKET, key, deps);
        await runSql("delete from private.profile_photo_pending_deletions where user_id = $1 and avatar_key = $2;", [user, key]);
      } catch {
        await runSql("insert into private.profile_photo_pending_deletions (user_id, avatar_key) values ($1, $2) on conflict (user_id, avatar_key) do nothing;", [user, key]).catch(() => {});
      }
    }
  }
  // An earlier avatar object (e.g. a legacy upload) is not deleted here; it stays tracked for the existing purge.
  return googlePhotoStatus(user, deps);
}

// Withdrawal: the photo stops being shown at once (Arcade avatar), future sign-ins never re-import it, and our copy
// is deleted. The copy's key stays on the record until the Storage deletion succeeds, so a failed deletion is
// reported and retried by the next withdrawal. Every withdrawal bumps avatar_revision, so an import that is still
// running loses its attach check. Allowed while Terms are pending; refused (409) once account deletion has started.
export async function withdrawGooglePhoto(userId, deps = {}) {
  const user = requireUser(userId);
  const imported = await (deps.beginSql || beginSql)(async (tx) => {
    await lockAccountLifecycle(tx, [user]);
    const [state] = await tx.unsafe(
      `select exists(select 1 from auth.users where id = $1) as present,
              exists(select 1 from public.account_deletion_requests where old_user_id = $1) as deleting;`,
      [user],
    );
    if (state?.present !== true) throw photoError("unauthorized", 401);
    if (state?.deleting === true) throw photoError("account_deleting");
    const [consent] = await tx.unsafe("select decision, imported_avatar_key from private.profile_photo_consents where user_id = $1 for update;", [user]);
    const [profile] = await tx.unsafe("select avatar_key from public.user_profiles where user_id = $1 for update;", [user]);
    if (!profile) throw photoError("profile_not_found", 404);
    const key = consent?.imported_avatar_key || null;
    if (consent && consent.decision !== "withdrawn") {
      await tx.unsafe(
        "update private.profile_photo_consents set decision = 'withdrawn', withdrawn_at = now(), consent_revision = consent_revision + 1 where user_id = $1;",
        [user],
      );
    }
    await tx.unsafe(
      `update public.user_profiles set google_photo_suppressed = true,
         avatar_key = case when $2 then null else avatar_key end, avatar_revision = avatar_revision + 1 where user_id = $1;`,
      [user, !!key && profile.avatar_key === key],
    );
    return key;
  });
  // Also copies of imports that failed or were outrun by this withdrawal (it bumped avatar_revision above).
  let copyDeleted = await deletePendingCopies(user, deps).catch(() => false);
  if (imported) {
    try {
      await deleteStorageObject(PUBLIC_BUCKET, imported, deps);
      await (deps.executeSql || executeSql)(
        "update private.profile_photo_consents set imported_avatar_key = null where user_id = $1 and decision = 'withdrawn' and imported_avatar_key = $2;",
        [user, imported],
      );
    } catch {
      copyDeleted = false;
    }
  }
  return { ...(await googlePhotoStatus(user, deps)), copyDeleted };
}
