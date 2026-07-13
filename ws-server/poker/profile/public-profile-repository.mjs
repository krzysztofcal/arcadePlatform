import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";
import { projectPublicPokerIdentity } from "../read-model/public-poker-identity.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROFILE_CANDIDATES = 10;

function normalizeUserIds(userIds) {
  if (!Array.isArray(userIds)) {
    return [];
  }
  return [...new Set(userIds
    .map((userId) => typeof userId === "string" ? userId.trim() : "")
    .filter((userId) => UUID_RE.test(userId)))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_PROFILE_CANDIDATES);
}

export function createPublicProfileRepository({ env = process.env, beginSql = beginSqlWs } = {}) {
  const storageBaseUrl = env.SUPABASE_URL || env.SUPABASE_URL_V2 || "";

  async function loadPublicProfiles(userIds) {
    const candidates = normalizeUserIds(userIds);
    if (candidates.length === 0 || !env.SUPABASE_DB_URL) {
      return {};
    }

    return beginSql(async (tx) => {
      const rows = await tx.unsafe(
        `select user_id::text, handle, display_name, avatar_key, avatar_variant
         from public.user_profiles
         where user_id = any($1::uuid[]);`,
        [candidates]
      );
      const allowedIds = new Set(candidates);
      const profiles = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const userId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
        if (!allowedIds.has(userId)) {
          continue;
        }
        const projected = projectPublicPokerIdentity(row, { storageBaseUrl });
        if (projected) {
          profiles[userId] = projected;
        }
      }
      return profiles;
    }, { env });
  }

  return { loadPublicProfiles };
}

export const __testOnly = { normalizeUserIds };
