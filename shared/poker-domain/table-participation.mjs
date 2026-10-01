export const TABLE_SLOT_LOCK_NAMESPACE = "poker-table-slots:v1";
export const MAX_ACTIVE_POKER_TABLES = 4;
export const MAX_PENDING_POKER_TABLES = 4;

function normalizeUserId(userId) {
  const value = typeof userId === "string" ? userId.trim().toLowerCase() : "";
  return value || null;
}

function slotError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export async function lockUserTableSlots(tx, userId) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_table_slots_tx_required");
  const normalized = normalizeUserId(userId);
  if (!normalized) throw slotError("poker_table_slots_user_invalid");
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", [`${TABLE_SLOT_LOCK_NAMESPACE}:${normalized}`]);
  return normalized;
}

export async function countActivePokerTables(tx, userId, { limit = MAX_ACTIVE_POKER_TABLES + 1 } = {}) {
  const normalized = normalizeUserId(userId);
  if (!normalized) return 0;
  const boundedLimit = Math.max(1, Math.min(MAX_ACTIVE_POKER_TABLES + 1, Number(limit) || MAX_ACTIVE_POKER_TABLES + 1));
  const rows = await tx.unsafe(`
select count(*)::int as count
from (
  select distinct s.table_id
  from public.poker_seats s
  join public.poker_tables t on t.id = s.table_id
  where s.user_id = $1
    and s.status = 'ACTIVE'
    and coalesce(s.is_bot, false) = false
    and coalesce(s.stack, 0) > 0
    and upper(coalesce(t.status, 'OPEN')) not in ('CLOSED', 'TERMINAL')
  limit ${boundedLimit}
) active_tables;
`, [normalized]);
  return Math.max(0, Number(rows?.[0]?.count || 0));
}

export async function countPendingPokerTables(tx, userId, { limit = MAX_PENDING_POKER_TABLES + 1 } = {}) {
  const normalized = normalizeUserId(userId);
  if (!normalized) return 0;
  const boundedLimit = Math.max(1, Math.min(MAX_PENDING_POKER_TABLES + 1, Number(limit) || MAX_PENDING_POKER_TABLES + 1));
  const rows = await tx.unsafe(`
select count(*)::int as count
from (
  select t.id
  from public.poker_tables t
  where t.created_by = $1
    and t.status = 'OPEN'
    and t.lifecycle_kind = 'STANDARD'
    and t.has_human_participant = false
    and exists (
      select 1
      from public.poker_state ps
      where ps.table_id = t.id
        and ps.state -> 'seats' = '[]'::jsonb
        and ps.state -> 'stacks' = '{}'::jsonb
    )
    and not exists (
      select 1
      from public.poker_seats s
      where s.table_id = t.id
    )
    and not exists (
      select 1
      from public.chips_transactions ct
      where ct.metadata ->> 'tableId' = t.id::text
    )
  limit ${boundedLimit}
) pending_tables;
`, [normalized]);
  return Math.max(0, Number(rows?.[0]?.count || 0));
}

export async function readPokerTableSlotCounts(tx, userId) {
  return {
    active: await countActivePokerTables(tx, userId),
    pending: await countPendingPokerTables(tx, userId),
  };
}

export async function assertActivePokerTableCapacity(tx, userId) {
  const count = await countActivePokerTables(tx, userId);
  if (count >= MAX_ACTIVE_POKER_TABLES) {
    throw slotError("active_table_limit", { count, limit: MAX_ACTIVE_POKER_TABLES });
  }
  return count;
}

export async function assertPendingPokerTableCapacity(tx, userId) {
  const count = await countPendingPokerTables(tx, userId);
  if (count >= MAX_PENDING_POKER_TABLES) {
    throw slotError("pending_table_limit", { count, limit: MAX_PENDING_POKER_TABLES });
  }
  return count;
}
