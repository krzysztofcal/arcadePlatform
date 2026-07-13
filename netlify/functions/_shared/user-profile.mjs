import { beginSql, executeSql } from "./supabase-admin.mjs";
import { syncUserLeaderboardVisibility } from "./xp-leaderboard-visibility.mjs";

const RESERVED_HANDLES = new Set(["admin", "admin-api", "about", "account", "api", "assets", "auth", "contact", "game", "games", "help", "leaderboard", "legal", "login", "logout", "me", "poker", "privacy", "profile", "register", "settings", "signup", "static", "support", "terms", "user", "users", "xp"]);
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;

function profileError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeWhitespace(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeHandle(value) {
  const handle = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!HANDLE_RE.test(handle)) throw profileError("invalid_handle");
  if (RESERVED_HANDLES.has(handle)) throw profileError("reserved_handle");
  return handle;
}

function normalizeDisplayName(value) {
  const displayName = typeof value === "string" ? normalizeWhitespace(value) : "";
  if (displayName.length < 2 || displayName.length > 40 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw profileError("invalid_display_name");
  }
  return displayName;
}

function normalizeBio(value) {
  const bio = typeof value === "string" ? value.trim() : "";
  if (bio.length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bio)) {
    throw profileError("bio_too_long");
  }
  return bio;
}

function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio || "",
    avatarKey: row.avatar_key || null,
    avatarVariant: row.avatar_variant,
    handleCustomizedAt: row.handle_customized_at || null,
    leaderboardVisible: row.leaderboard_visible !== false,
  };
}

function profileAvatar(profile) {
  if (profile.avatarKey) {
    const baseUrl = String(process.env.SUPABASE_URL || process.env.SUPABASE_URL_V2 || "").replace(/\/$/, "");
    if (/^https:\/\/[^/]+\.supabase\.co$/i.test(baseUrl) && /^[0-9a-f-]{36}\.webp$/i.test(profile.avatarKey)) {
      return { type: "uploaded", url: `${baseUrl}/storage/v1/object/public/profile-avatars/${encodeURIComponent(profile.avatarKey)}` };
    }
  }
  return { type: "default", variant: profile.avatarVariant };
}

function publicProfile(profile, stats = null) {
  const result = {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
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
    ...publicProfile(profile),
    handleCanBeCustomized: !profile.handleCustomizedAt,
    leaderboardVisible: profile.leaderboardVisible !== false,
  };
}

function isHandleConflict(error) {
  return error?.code === "23505" && String(error?.constraint || "").includes("user_profiles_handle_lower_unique");
}

async function readProfile(userId, runSql = executeSql) {
  const rows = await runSql(
    `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at, leaderboard_visible
     from public.user_profiles where user_id = $1 limit 1;`,
    [userId],
  );
  return normalizeProfileRow(rows?.[0]);
}

async function ensureUserProfile(userId, deps = {}) {
  if (typeof userId !== "string" || !userId.trim()) throw profileError("unauthorized", 401);
  const runSql = deps.executeSql || executeSql;
  const rows = await runSql(
    `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant,
            handle_customized_at, leaderboard_visible
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
    `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at, leaderboard_visible
     from public.user_profiles where lower(handle) = $1 limit 1;`,
    [normalized],
  );
  return normalizeProfileRow(rows?.[0]);
}

async function updateUserProfile(userId, payload = {}, deps = {}) {
  const profile = await ensureUserProfile(userId, deps);
  const hasDisplayName = Object.prototype.hasOwnProperty.call(payload, "displayName");
  const hasBio = Object.prototype.hasOwnProperty.call(payload, "bio");
  const hasHandle = Object.prototype.hasOwnProperty.call(payload, "handle");
  const hasLeaderboardVisible = Object.prototype.hasOwnProperty.call(payload, "leaderboardVisible");
  if (hasLeaderboardVisible && typeof payload.leaderboardVisible !== "boolean") throw profileError("invalid_leaderboard_visibility");
  const displayName = hasDisplayName ? normalizeDisplayName(payload.displayName) : profile.displayName;
  const bio = hasBio ? normalizeBio(payload.bio) : profile.bio;
  const requestedHandle = hasHandle ? normalizeHandle(payload.handle) : profile.handle;
  const leaderboardVisible = hasLeaderboardVisible ? payload.leaderboardVisible : profile.leaderboardVisible;
  const changesHandle = requestedHandle !== profile.handle;
  if (!hasDisplayName && !hasBio && !changesHandle && !hasLeaderboardVisible) return profile;

  const runTransaction = deps.beginSql || beginSql;
  const syncVisibility = deps.syncLeaderboardVisibility || syncUserLeaderboardVisibility;
  try {
    if (hasLeaderboardVisible && !leaderboardVisible) await syncVisibility(userId, false, deps);
    const updatedProfile = await runTransaction(async (tx) => {
      const rows = await tx.unsafe(
        `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at, leaderboard_visible
         from public.user_profiles where user_id = $1 for update;`,
        [userId],
      );
      const current = normalizeProfileRow(rows?.[0]);
      if (!current) throw profileError("profile_not_found", 404);
      const finalDisplayName = hasDisplayName ? displayName : current.displayName;
      const finalBio = hasBio ? bio : current.bio;
      const finalLeaderboardVisible = hasLeaderboardVisible ? leaderboardVisible : current.leaderboardVisible;
      if (changesHandle && current.handleCustomizedAt) throw profileError("handle_locked");
      const finalHandle = changesHandle ? requestedHandle : current.handle;
      const updated = await tx.unsafe(
        `update public.user_profiles
         set handle = $1, display_name = $2, bio = $3,
             handle_customized_at = case when $4 then timezone('utc', now()) else handle_customized_at end,
             leaderboard_visible = $5
         where user_id = $6
         returning user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at, leaderboard_visible;`,
        [finalHandle, finalDisplayName, finalBio, changesHandle, finalLeaderboardVisible, userId],
      );
      return normalizeProfileRow(updated?.[0]);
    });
    if (hasLeaderboardVisible && updatedProfile.leaderboardVisible) await syncVisibility(userId, true, deps);
    return updatedProfile;
  } catch (error) {
    if (isHandleConflict(error)) throw profileError("handle_taken", 409);
    throw error;
  }
}

async function updateUserAvatarKey(userId, avatarKey, deps = {}) {
  await ensureUserProfile(userId, deps);
  if (avatarKey !== null && !/^[0-9a-f-]{36}\.webp$/i.test(String(avatarKey || ""))) throw profileError("invalid_avatar_key");
  const runTransaction = deps.beginSql || beginSql;
  return runTransaction(async (tx) => {
    const currentRows = await tx.unsafe(
      `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at, leaderboard_visible
       from public.user_profiles where user_id = $1 for update;`,
      [userId],
    );
    const current = normalizeProfileRow(currentRows?.[0]);
    if (!current) throw profileError("profile_not_found", 404);
    const updatedRows = await tx.unsafe(
      `update public.user_profiles set avatar_key = $1 where user_id = $2
       returning user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at, leaderboard_visible;`,
      [avatarKey, userId],
    );
    return { profile: normalizeProfileRow(updatedRows?.[0]), previousAvatarKey: current.avatarKey };
  });
}

export {
  ensureUserProfile,
  findPublicProfile,
  normalizeBio,
  normalizeDisplayName,
  normalizeHandle,
  ownerProfile,
  profileError,
  publicProfile,
  updateUserAvatarKey,
  updateUserProfile,
};
