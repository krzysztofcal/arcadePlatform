const AVATAR_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const SUPABASE_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i;

export const PUBLIC_AVATAR_VARIANTS = Object.freeze([
  "comet-blue",
  "falcon-orange",
  "fox-blue",
  "nova-purple",
  "orbit-green",
  "panda-pink"
]);

const PUBLIC_AVATAR_VARIANT_SET = new Set(PUBLIC_AVATAR_VARIANTS);

export function normalizePublicAvatarVariant(value) {
  const variant = typeof value === "string" ? value.trim() : "";
  return PUBLIC_AVATAR_VARIANT_SET.has(variant) ? variant : "default";
}

export function projectPublicAvatar({ avatarKey = null, avatarVariant = null, storageBaseUrl = "" } = {}) {
  const key = typeof avatarKey === "string" ? avatarKey.trim() : "";
  const baseUrl = typeof storageBaseUrl === "string" ? storageBaseUrl.trim().replace(/\/$/, "") : "";
  if (AVATAR_KEY_RE.test(key) && SUPABASE_ORIGIN_RE.test(baseUrl)) {
    return {
      type: "uploaded",
      url: `${baseUrl}/storage/v1/object/public/profile-avatars/${encodeURIComponent(key)}`
    };
  }
  return { type: "default", variant: normalizePublicAvatarVariant(avatarVariant) };
}
