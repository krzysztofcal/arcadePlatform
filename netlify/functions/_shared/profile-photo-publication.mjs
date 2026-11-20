import { signedPhotoUrls } from "./profile-avatar.mjs";
import { executeSql, klog } from "./supabase-admin.mjs";

// #1140 UGC phase D, read side only (no image libraries): which Google photos may be shown on WWW.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[0-9a-f-]{36}\.webp$/;

export function googlePhotoEnabled(env = process.env) {
  return env.GOOGLE_PHOTO_IMPORT_ENABLED === "1" && env.UGC_SAFETY_ENABLED === "1";
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
         and p.google_photo_suppressed = false and p.public_profile_blocked = false
         and exists(select 1 from storage.buckets where id='profile-avatar-uploads' and public=false)
         and not exists(select 1 from private.ugc_avatar_holds h where h.user_id=p.user_id)
         and not exists(select 1 from public.account_deletion_requests d where d.old_user_id=p.user_id);`,
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
  const list = (profiles || []).filter(Boolean).map(profile=>{const copy={...profile};delete copy.publishedPhotoKey;delete copy.publishedPhotoUrl;return copy;});
  const keys = await publishedPhotoKeys(list.map((profile) => profile.userId), deps);
  if (!keys.size) return list;
  try {
    const urls=await signedPhotoUrls([...new Set(keys.values())],deps);
    const current=await publishedPhotoKeys(list.map(profile=>profile.userId),deps);
    return list.map(profile=>keys.has(profile.userId)&&current.get(profile.userId)===keys.get(profile.userId)&&urls.has(keys.get(profile.userId))
      ? {...profile,publishedPhotoKey:keys.get(profile.userId),publishedPhotoUrl:urls.get(keys.get(profile.userId))}:profile);
  } catch { klog('google_photo_signing_failed',{}); return list; }
}
