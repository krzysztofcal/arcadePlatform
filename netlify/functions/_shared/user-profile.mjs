import { accountDeletionEnabled, assertAccountActive, lockAccountLifecycle } from "../../../shared/account-deletion.mjs";
import { requireCurrentTerms } from "../../../shared/profile-terms.mjs";
import { beginSql, executeSql } from "./supabase-admin.mjs";
import { syncUserLeaderboardVisibility } from "./xp-leaderboard-visibility.mjs";
import { PUBLIC_AVATAR_VARIANTS, projectPublicAvatar } from "../../../shared/profile-avatar-projection.mjs";

const RESERVED_HANDLES = new Set(["admin", "admin-api", "about", "account", "api", "assets", "auth", "contact", "game", "games", "help", "leaderboard", "legal", "login", "logout", "me", "poker", "privacy", "profile", "register", "settings", "signup", "static", "support", "terms", "user", "users", "xp"]);
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;

function profileError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarKey: row.avatar_key || null,
    avatarVariant: row.avatar_variant,
    avatarRevision: Number(row.avatar_revision || 1),
    googlePhotoSuppressed: row.google_photo_suppressed === true,
    leaderboardVisible: row.leaderboard_visible !== false,
    publicProfileBlocked: row.public_profile_blocked === true,
  };
}

function profileAvatar(profile) {
  return projectPublicAvatar({
    avatarKey: profile.avatarKey,
    avatarVariant: profile.avatarVariant,
    storageBaseUrl: process.env.SUPABASE_URL || process.env.SUPABASE_URL_V2 || ""
  });
}

function publicProfile(profile, stats = null) {
  if (profile.publicProfileBlocked === true) return null;
  const result = {
    handle: profile.handle,
    displayName: profile.displayName,
    avatar: profileAvatar(profile),
  };
  if (stats) {
    result.xp = Math.max(0, Math.floor(Number(stats.xp) || 0));
    result.level = Math.max(1, Math.floor(Number(stats.level) || 1));
  }
  return result;
}

function ownerProfile(profile) {
  return {
    ...publicProfile({ ...profile, publicProfileBlocked: false }),
    avatarRevision: profile.avatarRevision || 1,
    avatarVariant: profile.avatarVariant,
    leaderboardVisible: profile.leaderboardVisible !== false,
  };
}

async function readProfile(userId, runSql = executeSql) {
  const rows = await runSql(
    `select user_id::text, handle, display_name, avatar_key, avatar_variant, avatar_revision, google_photo_suppressed, leaderboard_visible
     from public.user_profiles where user_id = $1 limit 1;`,
    [userId],
  );
  return normalizeProfileRow(rows?.[0]);
}

async function ensureUserProfile(userId, deps = {}) {
  if (accountDeletionEnabled(deps.env || process.env) && !deps.profileTx) {
    return (deps.beginSql || beginSql)(async (tx) => {
      await assertAccountActive(tx, userId);
      return ensureUserProfile(userId, { ...deps, profileTx: tx, executeSql: (q,p) => tx.unsafe(q,p) });
    });
  }
  if (typeof userId !== "string" || !userId.trim()) throw profileError("unauthorized", 401);
  const runSql = deps.executeSql || executeSql;
  const rows = await runSql(
    `select user_id::text, handle, display_name, avatar_key, avatar_variant,
            avatar_revision, google_photo_suppressed, leaderboard_visible
     from public.ensure_user_profile($1::uuid);`,
    [userId],
  );
  const profile = normalizeProfileRow(rows?.[0]);
  if (!profile) throw profileError("profile_generation_exhausted", 503);
  return profile;
}

async function findPublicProfile(handle, runSql = executeSql) {
  const normalized = typeof handle === "string" ? handle.trim().toLowerCase() : "";
  if (!HANDLE_RE.test(normalized) || RESERVED_HANDLES.has(normalized)) return null;
  const rows = await runSql(
    `select user_id::text, handle, display_name, avatar_key, avatar_variant, avatar_revision, google_photo_suppressed, leaderboard_visible, public_profile_blocked
     from public.user_profiles where lower(handle) = $1 and public_profile_blocked = false limit 1;`,
    [normalized],
  );
  return normalizeProfileRow(rows?.[0]);
}

async function updateUserProfile(userId, payload = {}, deps = {}) {
  const allowed = new Set(['avatarVariant','expectedRevision','leaderboardVisible']);
  if(Object.keys(payload).some(key=>!allowed.has(key))) throw profileError('profile_field_read_only');
  const choose = Object.hasOwn(payload,'avatarVariant');
  const visible = Object.hasOwn(payload,'leaderboardVisible');
  if(choose && (!PUBLIC_AVATAR_VARIANTS.includes(payload.avatarVariant) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision<1)) throw profileError('invalid_avatar_choice');
  if(visible && typeof payload.leaderboardVisible!=='boolean')throw profileError('invalid_leaderboard_visibility');
  await ensureUserProfile(userId,deps);
  const lifecycle = accountDeletionEnabled(deps.env || process.env);
  const syncVisibility = deps.syncLeaderboardVisibility || syncUserLeaderboardVisibility;
  if(visible && !payload.leaderboardVisible && !lifecycle)await syncVisibility(userId,false,deps);
  const profile = await (deps.beginSql || beginSql)(async tx=>{
    if(accountDeletionEnabled(deps.env || process.env))await assertAccountActive(tx,userId);
    else await lockAccountLifecycle(tx,[userId]);
    const policy=choose ? await requireCurrentTerms(tx,{kind:'account',id:userId}) : null;
    if(choose && !policy.variantsEnabled && PUBLIC_AVATAR_VARIANTS.indexOf(payload.avatarVariant)>=6)throw profileError('avatar_variants_not_active',409);
    const [row]=await tx.unsafe(`select user_id::text,handle,display_name,avatar_key,avatar_variant,avatar_revision,google_photo_suppressed,leaderboard_visible from public.user_profiles where user_id=$1 for update;`,[userId]);
    const current=normalizeProfileRow(row);
    if(!current)throw profileError('profile_not_found',404);
    const same=choose&&current.avatarVariant===payload.avatarVariant&&!current.avatarKey&&current.googlePhotoSuppressed;
    if(choose&&!same&&current.avatarRevision!==payload.expectedRevision)throw profileError('stale_avatar_revision',409);
    if(choose&&current.avatarKey)await tx.unsafe(`insert into private.account_avatar_objects(user_id,output_path) values($1,$2) on conflict(user_id,output_path) do nothing;`,[userId,current.avatarKey]);
    const [updated]=await tx.unsafe(`update public.user_profiles set avatar_variant=$2,
      avatar_key=case when $3 then null else avatar_key end,
      google_photo_suppressed=case when $3 then true else google_photo_suppressed end,
      avatar_revision=avatar_revision+case when $3 and not $4 then 1 else 0 end,
      leaderboard_visible=$5 where user_id=$1
      returning user_id::text,handle,display_name,avatar_key,avatar_variant,avatar_revision,google_photo_suppressed,leaderboard_visible;`,
      [userId,choose?payload.avatarVariant:current.avatarVariant,choose,same,visible?payload.leaderboardVisible:current.leaderboardVisible]);
    return normalizeProfileRow(updated);
  });
  if(visible && (profile.leaderboardVisible || lifecycle))await syncVisibility(userId,profile.leaderboardVisible,deps);
  return profile;
}

async function updateUserAvatarKey(userId, avatarKey, deps = {}) {
  await ensureUserProfile(userId, deps);
  if (avatarKey !== null && !/^[0-9a-f-]{36}\.webp$/i.test(String(avatarKey || ""))) throw profileError("invalid_avatar_key");
  const env = deps.env || process.env;
  const tracking = env.ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED === "1" || accountDeletionEnabled(env);
  const runTransaction = deps.beginSql || beginSql;
  return runTransaction(async (tx) => {
    if (tracking) await assertAccountActive(tx, userId);
    const currentRows = await tx.unsafe(
      `select user_id::text, handle, display_name, avatar_key, avatar_variant, avatar_revision, google_photo_suppressed, leaderboard_visible
       from public.user_profiles where user_id = $1 for update;`,
      [userId],
    );
    const current = normalizeProfileRow(currentRows?.[0]);
    if (!current) throw profileError("profile_not_found", 404);
    if (tracking) {
      for (const key of new Set([current.avatarKey, avatarKey].filter(Boolean))) {
        await tx.unsafe(`insert into private.account_avatar_objects(user_id, output_path) values($1,$2)
on conflict (user_id,output_path) do nothing;`, [userId,key]);
      }
    }
    const updatedRows = await tx.unsafe(
      `update public.user_profiles set avatar_key = $1 where user_id = $2
       returning user_id::text, handle, display_name, avatar_key, avatar_variant, avatar_revision, google_photo_suppressed, leaderboard_visible;`,
      [avatarKey, userId],
    );
    return { profile: normalizeProfileRow(updatedRows?.[0]), previousAvatarKey: current.avatarKey };
  });
}

export {
  ensureUserProfile,
  findPublicProfile,
  ownerProfile,
  profileError,
  publicProfile,
  updateUserAvatarKey,
  updateUserProfile,
};
