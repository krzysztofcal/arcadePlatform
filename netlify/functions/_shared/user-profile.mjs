import crypto from "node:crypto";
import { beginSql, executeSql } from "./supabase-admin.mjs";

const ADJECTIVES = Object.freeze(["Blue", "Bright", "Cosmic", "Echo", "Neon", "Pixel", "Rocket", "Solar", "Swift", "Turbo"]);
const NOUNS = Object.freeze(["Comet", "Falcon", "Fox", "Nova", "Orbit", "Panda", "Raven", "Tiger", "Wave", "Wizard"]);
const AVATAR_VARIANTS = Object.freeze(["comet-blue", "falcon-orange", "fox-blue", "nova-purple", "orbit-green", "panda-pink"]);
const RESERVED_HANDLES = new Set(["admin", "api", "account", "profile", "poker", "xp", "login", "logout", "settings", "support", "about", "leaderboard"]);
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const MAX_IDENTITY_ATTEMPTS = 12;

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

function randomItem(items) {
  return items[crypto.randomInt(0, items.length)];
}

function createGeneratedIdentity() {
  const displayName = `${randomItem(ADJECTIVES)}${randomItem(NOUNS)}${crypto.randomInt(10, 100)}`;
  return {
    displayName,
    handle: displayName.toLowerCase(),
    avatarVariant: randomItem(AVATAR_VARIANTS),
  };
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
  };
}

function profileAvatar(profile) {
  return { type: "default", variant: profile.avatarVariant };
}

function publicProfile(profile) {
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    avatar: profileAvatar(profile),
  };
}

function ownerProfile(profile) {
  return {
    ...publicProfile(profile),
    handleCanBeCustomized: !profile.handleCustomizedAt,
  };
}

function isHandleConflict(error) {
  return error?.code === "23505" && String(error?.constraint || "").includes("user_profiles_handle_lower_unique");
}

async function readProfile(userId, runSql = executeSql) {
  const rows = await runSql(
    `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at
     from public.user_profiles where user_id = $1 limit 1;`,
    [userId],
  );
  return normalizeProfileRow(rows?.[0]);
}

async function ensureUserProfile(userId, deps = {}) {
  if (typeof userId !== "string" || !userId.trim()) throw profileError("unauthorized", 401);
  const runTransaction = deps.beginSql || beginSql;
  for (let attempt = 0; attempt < MAX_IDENTITY_ATTEMPTS; attempt += 1) {
    const identity = createGeneratedIdentity();
    try {
      const profile = await runTransaction(async (tx) => {
        const inserted = await tx.unsafe(
          `insert into public.user_profiles (user_id, handle, display_name, avatar_variant)
           values ($1, $2, $3, $4)
           on conflict (user_id) do nothing
           returning user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at;`,
          [userId, identity.handle, identity.displayName, identity.avatarVariant],
        );
        if (inserted?.[0]) return normalizeProfileRow(inserted[0]);
        const existing = await tx.unsafe(
          `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at
           from public.user_profiles where user_id = $1 limit 1;`,
          [userId],
        );
        return normalizeProfileRow(existing?.[0]);
      });
      if (profile) return profile;
    } catch (error) {
      if (isHandleConflict(error)) continue;
      throw error;
    }
  }
  throw profileError("profile_generation_exhausted", 503);
}

async function findPublicProfile(handle, runSql = executeSql) {
  const normalized = typeof handle === "string" ? handle.trim().toLowerCase() : "";
  if (!HANDLE_RE.test(normalized) || RESERVED_HANDLES.has(normalized)) return null;
  const rows = await runSql(
    `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at
     from public.user_profiles where lower(handle) = $1 limit 1;`,
    [normalized],
  );
  return normalizeProfileRow(rows?.[0]);
}

async function updateUserProfile(userId, payload = {}, deps = {}) {
  const profile = await ensureUserProfile(userId, deps);
  const hasDisplayName = Object.prototype.hasOwnProperty.call(payload, "displayName");
  const hasBio = Object.prototype.hasOwnProperty.call(payload, "bio");
  const hasHandle = Object.prototype.hasOwnProperty.call(payload, "handle") && payload.handle != null;
  const displayName = hasDisplayName ? normalizeDisplayName(payload.displayName) : profile.displayName;
  const bio = hasBio ? normalizeBio(payload.bio) : profile.bio;
  const requestedHandle = hasHandle ? normalizeHandle(payload.handle) : profile.handle;
  const changesHandle = requestedHandle !== profile.handle;
  if (!hasDisplayName && !hasBio && !changesHandle) return profile;

  const runTransaction = deps.beginSql || beginSql;
  try {
    return await runTransaction(async (tx) => {
      const rows = await tx.unsafe(
        `select user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at
         from public.user_profiles where user_id = $1 for update;`,
        [userId],
      );
      const current = normalizeProfileRow(rows?.[0]);
      if (!current) throw profileError("profile_not_found", 404);
      const finalDisplayName = hasDisplayName ? displayName : current.displayName;
      const finalBio = hasBio ? bio : current.bio;
      if (changesHandle && current.handleCustomizedAt) throw profileError("handle_locked");
      const finalHandle = changesHandle ? requestedHandle : current.handle;
      const updated = await tx.unsafe(
        `update public.user_profiles
         set handle = $1, display_name = $2, bio = $3,
             handle_customized_at = case when $4 then timezone('utc', now()) else handle_customized_at end
         where user_id = $5
         returning user_id::text, handle, display_name, bio, avatar_key, avatar_variant, handle_customized_at;`,
        [finalHandle, finalDisplayName, finalBio, changesHandle, userId],
      );
      return normalizeProfileRow(updated?.[0]);
    });
  } catch (error) {
    if (isHandleConflict(error)) throw profileError("handle_taken", 409);
    throw error;
  }
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
  updateUserProfile,
};
