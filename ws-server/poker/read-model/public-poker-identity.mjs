import { projectPublicAvatar, PUBLIC_AVATAR_VARIANTS } from "../../../shared/profile-avatar-projection.mjs";

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const DISPLAY_NAME_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const UPLOADED_AVATAR_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/profile-avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
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

function normalizePublicAvatar(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (value.type === "uploaded" && typeof value.url === "string" && UPLOADED_AVATAR_URL_RE.test(value.url)) {
    return { type: "uploaded", url: value.url };
  }
  if (value.type === "default" && PUBLIC_AVATAR_VARIANT_SET.has(value.variant)) {
    return { type: "default", variant: value.variant };
  }
  return null;
}

export function normalizePublicPokerIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const handle = normalizeHandle(value.handle);
  const displayName = normalizeDisplayName(value.displayName);
  const avatar = normalizePublicAvatar(value.avatar);
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
  });
}
