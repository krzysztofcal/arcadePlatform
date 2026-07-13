import { projectPublicAvatar, PUBLIC_AVATAR_VARIANTS } from "../../../shared/profile-avatar-projection.mjs";

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const DISPLAY_NAME_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SUPABASE_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i;
const UPLOADED_AVATAR_PATH_RE = /^\/storage\/v1\/object\/public\/profile-avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const PUBLIC_AVATAR_VARIANT_SET = new Set([...PUBLIC_AVATAR_VARIANTS, "default"]);

function normalizeHandle(value) {
  const handle = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HANDLE_RE.test(handle) ? handle : "";
}

function normalizeDisplayName(value) {
  const displayName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (displayName.length < 2 || displayName.length > 40 || DISPLAY_NAME_CONTROL_RE.test(displayName)) {
    return "";
  }
  return displayName;
}

function normalizeTrustedStorageOrigin(storageBaseUrl) {
  const rawValue = typeof storageBaseUrl === "string" ? storageBaseUrl.trim() : "";
  try {
    const parsed = new URL(rawValue);
    if (!SUPABASE_ORIGIN_RE.test(parsed.origin) || parsed.href !== `${parsed.origin}/`) {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

function normalizePublicAvatar(value, { storageBaseUrl = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (value.type === "uploaded" && typeof value.url === "string") {
    const trustedOrigin = normalizeTrustedStorageOrigin(storageBaseUrl);
    try {
      const parsed = new URL(value.url);
      if (trustedOrigin && parsed.origin === trustedOrigin && UPLOADED_AVATAR_PATH_RE.test(parsed.pathname)
        && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && !parsed.port) {
        return { type: "uploaded", url: parsed.href };
      }
    } catch {
      return null;
    }
  }
  if (value.type === "default" && PUBLIC_AVATAR_VARIANT_SET.has(value.variant)) {
    return { type: "default", variant: value.variant };
  }
  return null;
}

export function normalizePublicPokerIdentity(value, { storageBaseUrl = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const handle = normalizeHandle(value.handle);
  const displayName = normalizeDisplayName(value.displayName);
  const avatar = normalizePublicAvatar(value.avatar, { storageBaseUrl });
  if (!handle || !displayName || !avatar) {
    return null;
  }
  return { handle, displayName, avatar };
}

export function projectPublicPokerIdentity(row, { storageBaseUrl = "" } = {}) {
  const handle = normalizeHandle(row?.handle);
  const displayName = normalizeDisplayName(row?.display_name ?? row?.displayName);
  if (!handle || !displayName) {
    return null;
  }
  return normalizePublicPokerIdentity({
    handle,
    displayName,
    avatar: projectPublicAvatar({
      avatarKey: row?.avatar_key ?? row?.avatarKey,
      avatarVariant: row?.avatar_variant ?? row?.avatarVariant,
      storageBaseUrl
    })
  }, { storageBaseUrl });
}
