import { accountDeletionEnabled, assertAccountActive } from "../../../shared/account-deletion.mjs";
import { beginSql, executeSql } from "./supabase-admin.mjs";

// #1140 UGC phase B: user reports and private blocks. A report names a target by profile handle (profile page) or
// by user id (poker table, where seats already carry it), with a fixed reason code and no free text. A block is the
// blocker's own filter; nothing in poker, chips or settlement reads it. Both require a signed-in, active account.
export const REPORT_REASONS = Object.freeze(["inappropriate_avatar", "inappropriate_name", "harassment", "cheating", "spam", "other"]);
export const REPORT_CONTEXTS = Object.freeze(["profile", "table"]);
export const MAX_BLOCKS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;

export function ugcError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

// Dark by default: the endpoints answer only with UGC_SAFETY_ENABLED=1; deploy previews are on unless set.
export function ugcSafetyEnabled(env = process.env, event = {}) {
  if (Object.hasOwn(env, "UGC_SAFETY_ENABLED")) return env.UGC_SAFETY_ENABLED === "1";
  if (env.CONTEXT === "deploy-preview" || env.NETLIFY_CONTEXT === "deploy-preview") return true;
  const host = event.headers?.host || event.headers?.Host || "";
  return /^deploy-preview-[a-z0-9-]+\.netlify\.app$/i.test(String(host).split(":")[0]);
}

// Exactly one of targetUserId / targetHandle.
export function parseTarget(input = {}) {
  const hasId = Object.hasOwn(input, "targetUserId");
  const hasHandle = Object.hasOwn(input, "targetHandle");
  if (hasId === hasHandle) throw ugcError("invalid_target");
  if (hasId) {
    if (typeof input.targetUserId !== "string" || !UUID_RE.test(input.targetUserId)) throw ugcError("invalid_target");
    return { userId: input.targetUserId.toLowerCase() };
  }
  const handle = typeof input.targetHandle === "string" ? input.targetHandle.trim().toLowerCase() : "";
  if (!HANDLE_RE.test(handle)) throw ugcError("invalid_target");
  return { handle };
}

function requireUser(userId) {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) throw ugcError("unauthorized", 401);
  return userId.toLowerCase();
}

async function resolveTarget(tx, target) {
  const [row] = target.userId
    ? await tx.unsafe("select user_id::text, handle, display_name, avatar_variant, avatar_key from public.user_profiles where user_id = $1 limit 1;", [target.userId])
    : await tx.unsafe("select user_id::text, handle, display_name, avatar_variant, avatar_key from public.user_profiles where lower(handle) = $1 limit 1;", [target.handle]);
  if (!row) throw ugcError("target_not_found", 404);
  return row;
}

function inTransaction(deps, actorId, work) {
  const env = deps.env || process.env;
  return (deps.beginSql || beginSql)(async (tx) => {
    if (accountDeletionEnabled(env)) await assertAccountActive(tx, actorId);
    return work(tx);
  });
}

export async function createReport(reporterId, input = {}, deps = {}) {
  const reporter = requireUser(reporterId);
  const allowed = new Set(["targetUserId", "targetHandle", "reason", "context", "tableId"]);
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !allowed.has(key))) throw ugcError("invalid_report");
  const target = parseTarget(input);
  if (!REPORT_REASONS.includes(input.reason)) throw ugcError("invalid_reason");
  if (!REPORT_CONTEXTS.includes(input.context)) throw ugcError("invalid_context");
  const tableId = input.context === "table" ? input.tableId : null;
  if (input.context === "table" && (typeof tableId !== "string" || !UUID_RE.test(tableId))) throw ugcError("invalid_table");
  if (input.context === "profile" && Object.hasOwn(input, "tableId")) throw ugcError("invalid_table");
  return inTransaction(deps, reporter, async (tx) => {
    const row = await resolveTarget(tx, target);
    if (row.user_id === reporter) throw ugcError("cannot_report_self");
    // Evidence is the server's own snapshot of the public identity, so a later change cannot erase it.
    const evidence = { handle: row.handle, displayName: row.display_name, avatarVariant: row.avatar_variant, avatarKey: row.avatar_key || null };
    const inserted = await tx.unsafe(
      `insert into private.ugc_reports (reporter_user_id, target_user_id, reason, context, table_id, evidence)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (reporter_user_id, target_user_id) where status = 'pending' do nothing
       returning id;`,
      [reporter, row.user_id, input.reason, input.context, tableId ? tableId.toLowerCase() : null, JSON.stringify(evidence)],
    );
    return { status: inserted.length ? "reported" : "already_reported" };
  });
}

function blockedUser(row) {
  return { userId: row.user_id, handle: row.handle || null, displayName: row.display_name || null };
}

export async function listBlocks(blockerId, deps = {}) {
  const blocker = requireUser(blockerId);
  const rows = await (deps.executeSql || executeSql)(
    `select b.blocked_user_id::text as user_id, p.handle, p.display_name
     from private.user_blocks b left join public.user_profiles p on p.user_id = b.blocked_user_id
     where b.blocker_user_id = $1 order by b.created_at desc, b.blocked_user_id limit ${MAX_BLOCKS};`,
    [blocker],
  );
  return rows.map(blockedUser);
}

export async function blockUser(blockerId, input = {}, deps = {}) {
  const blocker = requireUser(blockerId);
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => key !== "targetUserId" && key !== "targetHandle")) throw ugcError("invalid_block");
  const target = parseTarget(input);
  return inTransaction(deps, blocker, async (tx) => {
    const row = await resolveTarget(tx, target);
    if (row.user_id === blocker) throw ugcError("cannot_block_self");
    // Serialize one blocker's changes so the cap cannot be passed by parallel requests.
    await tx.unsafe("select pg_advisory_xact_lock(hashtextextended('ugc_block:' || $1, 0));", [blocker]);
    const [{ total, present }] = await tx.unsafe(
      `select count(*)::int as total, bool_or(blocked_user_id = $2) as present from private.user_blocks where blocker_user_id = $1;`,
      [blocker, row.user_id],
    );
    if (present) return { status: "already_blocked", user: blockedUser(row) };
    if (total >= MAX_BLOCKS) throw ugcError("block_limit_reached", 409);
    await tx.unsafe("insert into private.user_blocks (blocker_user_id, blocked_user_id) values ($1, $2) on conflict do nothing;", [blocker, row.user_id]);
    return { status: "blocked", user: blockedUser(row) };
  });
}

// Unblocking only removes the caller's own row, so it is allowed in every account state.
export async function unblockUser(blockerId, targetUserId, deps = {}) {
  const blocker = requireUser(blockerId);
  const { userId } = parseTarget({ targetUserId });
  const removed = await (deps.executeSql || executeSql)(
    "delete from private.user_blocks where blocker_user_id = $1 and blocked_user_id = $2 returning blocked_user_id;",
    [blocker, userId],
  );
  return { status: removed.length ? "unblocked" : "not_blocked" };
}
