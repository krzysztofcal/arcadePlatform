import { executeSql, klog } from "./supabase-admin.mjs";

// #1140 UGC phase D, read side only (no image libraries): which Google photos may be shown on WWW.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[0-9a-f-]{36}\.webp$/;

export function googlePhotoEnabled(env = process.env) {
  return env.GOOGLE_PHOTO_IMPORT_ENABLED === "1";
}

// Avatar keys whose Google photo may be shown: consent granted, the imported key is still the profile's avatar and
// the user did not choose a catalog avatar since. Read failures show the Arcade avatar instead of failing the page.
export async function publishedPhotoKeys(userIds, deps = {}) {
  const keys = new Map();
  if (!googlePhotoEnabled(deps.env || process.env)) return keys;
  const ids = [...new Set((userIds || []).filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  if (!ids.length) return keys;
  try {
    const rows = await (deps.executeSql || executeSql)(
      `select p.user_id::text as user_id, p.avatar_key from public.user_profiles p
       join private.profile_photo_consents c on c.user_id = p.user_id
       where p.user_id = any($1::uuid[]) and c.decision = 'granted' and c.imported_avatar_key = p.avatar_key
         and p.google_photo_suppressed = false;`,
      [ids],
    );
    for (const row of rows || []) if (KEY_RE.test(String(row.avatar_key || ""))) keys.set(row.user_id, row.avatar_key);
  } catch (error) {
    klog("google_photo_read_failed", { code: error?.code || "read_failed" });
  }
  return keys;
}

// Sets publishedPhotoKey on profile objects (with userId and avatarKey) for the WWW avatar projection.
export async function attachPublishedPhotos(profiles, deps = {}) {
  const list = (profiles || []).filter(Boolean);
  const keys = await publishedPhotoKeys(list.map((profile) => profile.userId), deps);
  return list.map((profile) => (keys.has(profile.userId) ? { ...profile, publishedPhotoKey: keys.get(profile.userId) } : profile));
}

