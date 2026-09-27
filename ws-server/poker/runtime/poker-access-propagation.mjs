const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Persist the one-way SLOW table marker while the authoritative access
 * transaction is open. Callers must only pass a schema-backed SLOW snapshot;
 * every other state is intentionally a no-op.
 */
export async function persistAuthoritativeSlowOnlyForUser(tx, {
  userId,
  schemaBacked = false,
  effectiveClass = null
} = {}) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!tx || typeof tx.unsafe !== "function"
    || !UUID_RE.test(normalizedUserId)
    || schemaBacked !== true
    || effectiveClass !== "SLOW") {
    return [];
  }
  const rows = await tx.unsafe(`
update public.poker_tables as t
   set is_slow_only = true
 where t.lifecycle_kind = 'STANDARD'
   and t.is_slow_only is not true
   and exists (
     select 1
       from public.poker_seats as s
      where s.table_id = t.id
        and s.user_id = $1::uuid
        and s.status = 'ACTIVE'
        and coalesce(s.is_bot, false) = false
   )
returning t.id;
`, [normalizedUserId]);
  return Array.isArray(rows)
    ? rows.map((row) => typeof row?.id === "string" ? row.id.trim() : "").filter(Boolean)
    : [];
}
