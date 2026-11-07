import { lockAccountLifecycle } from "../../../shared/account-deletion.mjs";
import { beginSql, executeSql } from "./supabase-admin.mjs";
import { ugcError } from "./ugc-safety.mjs";

// #1140 UGC phase C: admin moderation. The queue is read when the admin panel opens or refreshes; there is no
// notification or background job. A report leaves "pending" only through decideReport, one audited transaction.
export const STATUSES = Object.freeze(["pending", "resolved", "dismissed"]);
export const DECISIONS = Object.freeze(["resolved", "dismissed"]);
export const TARGET_ACTIONS = Object.freeze(["none", "hide_avatar", "restrict_profile"]);
const RESOLUTION = Object.freeze({ none: "no_action", hide_avatar: "avatar_hidden", restrict_profile: "profile_restricted" });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE = 100;

function requireAdmin(adminId) {
  if (typeof adminId !== "string" || !UUID_RE.test(adminId)) throw ugcError("unauthorized", 401);
  return adminId.toLowerCase();
}

function reportRow(row) {
  return {
    id: String(row.id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    reason: row.reason,
    context: row.context,
    tableId: row.table_id || null,
    status: row.status,
    resolution: row.resolution || null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    evidence: row.evidence || {},
    target: {
      userId: row.target_user_id,
      handle: row.handle || null,
      displayName: row.display_name || null,
      avatarVariant: row.avatar_variant || null,
      hasUploadedAvatar: !!row.avatar_key,
      avatarHeld: row.avatar_held === true,
      openReports: Number(row.open_reports || 0),
    },
  };
}

// Oldest first, so no pending report is pushed out of view by newer ones; pendingCount is the panel counter.
export async function listReports(adminId, query = {}, deps = {}) {
  requireAdmin(adminId);
  const status = query.status || "pending";
  if (!STATUSES.includes(status)) throw ugcError("invalid_status");
  const limit = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.limit || "50", 10) || 50));
  const after = query.after == null || query.after === "" ? 0 : Number.parseInt(query.after, 10);
  if (!Number.isSafeInteger(after) || after < 0) throw ugcError("invalid_cursor");
  const runSql = deps.executeSql || executeSql;
  const [{ pending, removed }] = await runSql(
    `select (select count(*)::int from private.ugc_reports where status = 'pending') as pending,
            coalesce((select value from private.ugc_moderation_counters where key = 'pending_removed_with_deleted_account'), 0)::text as removed;`,
    [],
  );
  const rows = await runSql(
    `select r.id, r.created_at, r.reason, r.context, r.table_id::text, r.status, r.resolution, r.resolved_at, r.evidence,
            r.target_user_id::text, p.handle, p.display_name, p.avatar_variant, p.avatar_key,
            exists(select 1 from private.ugc_avatar_holds h where h.user_id = r.target_user_id) as avatar_held,
            (select count(*) from private.ugc_reports o where o.target_user_id = r.target_user_id and o.status = 'pending') as open_reports
     from private.ugc_reports r left join public.user_profiles p on p.user_id = r.target_user_id
     where r.status = $1 and r.id > $2 order by r.id asc limit $3;`,
    [status, after, limit],
  );
  const reports = rows.map(reportRow);
  return {
    pendingCount: Number(pending || 0),
    removedWithDeletedAccount: Number(removed || 0),
    reports,
    next: rows.length === limit ? reports[reports.length - 1].id : null,
  };
}

async function hideAvatar(tx, targetId, adminId) {
  const [profile] = await tx.unsafe("select avatar_key from public.user_profiles where user_id = $1 for update;", [targetId]);
  if (profile?.avatar_key) {
    // The old object goes to the existing avatar cleanup, as when a user changes the avatar.
    await tx.unsafe("insert into private.account_avatar_objects (user_id, output_path) values ($1, $2) on conflict (user_id, output_path) do nothing;", [targetId, profile.avatar_key]);
    await tx.unsafe("update public.user_profiles set avatar_key = null where user_id = $1;", [targetId]);
  }
  await tx.unsafe("insert into private.ugc_avatar_holds (user_id, admin_user_id) values ($1, $2) on conflict (user_id) do nothing;", [targetId, adminId]);
}

async function setProfileBlocked(tx, targetId, blocked) {
  let rows;
  try {
    rows = await tx.unsafe("select private.ugc_set_profile_blocked($1, $2) as changed;", [targetId, blocked]);
  } catch (error) {
    // Missing #1155 column or a guard that refuses the function owner: the whole decision is rolled back.
    throw ugcError("profile_restriction_unavailable", 409);
  }
  if (rows?.[0]?.changed !== true) throw ugcError("profile_not_found", 404);
}

// Profile writes of an account in deletion are refused by the account lifecycle guard; take the same lifecycle lock
// and answer 409 account_deleting before any write. The transaction is rolled back as before.
async function assertNotDeleting(tx, targetId) {
  await lockAccountLifecycle(tx, [targetId]);
  const [row] = await tx.unsafe("select exists(select 1 from public.account_deletion_requests where old_user_id = $1) as deleting;", [targetId]);
  if (row?.deleting === true) throw ugcError("account_deleting", 409);
}

async function audit(tx, reportId, targetId, adminId, action) {
  await tx.unsafe("insert into private.ugc_moderation_actions (report_id, target_user_id, admin_user_id, action) values ($1, $2, $3, $4);", [reportId, targetId, adminId, action]);
}

export async function decideReport(adminId, input = {}, deps = {}) {
  const admin = requireAdmin(adminId);
  const allowed = new Set(["reportId", "decision", "action"]);
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !allowed.has(key))) throw ugcError("invalid_decision");
  const reportId = typeof input.reportId === "string" && /^[1-9][0-9]{0,18}$/.test(input.reportId) ? input.reportId : null;
  if (!reportId) throw ugcError("invalid_report");
  if (!DECISIONS.includes(input.decision)) throw ugcError("invalid_decision");
  const action = input.action == null ? "none" : input.action;
  if (!TARGET_ACTIONS.includes(action)) throw ugcError("invalid_action");
  if (input.decision === "dismissed" && action !== "none") throw ugcError("invalid_action");
  return (deps.beginSql || beginSql)(async (tx) => {
    const [report] = await tx.unsafe("select id, target_user_id::text, status from private.ugc_reports where id = $1 for update;", [reportId]);
    if (!report) throw ugcError("report_not_found", 404);
    if (report.status !== "pending") throw ugcError("report_already_decided", 409);
    const target = report.target_user_id;
    if (action !== "none") await assertNotDeleting(tx, target);
    if (action === "hide_avatar") await hideAvatar(tx, target, admin);
    if (action === "restrict_profile") await setProfileBlocked(tx, target, true);
    if (action !== "none") await audit(tx, reportId, target, admin, action);
    await tx.unsafe(
      "update private.ugc_reports set status = $2, resolved_at = now(), resolved_by = $3, resolution = $4 where id = $1;",
      [reportId, input.decision, admin, input.decision === "resolved" ? RESOLUTION[action] : null],
    );
    await audit(tx, reportId, target, admin, input.decision === "resolved" ? "resolve" : "dismiss");
    return { reportId, status: input.decision, action };
  });
}

// Correction of an earlier restriction; audited without a report.
export async function unrestrictProfile(adminId, userId, deps = {}) {
  const admin = requireAdmin(adminId);
  if (typeof userId !== "string" || !UUID_RE.test(userId)) throw ugcError("invalid_target");
  const target = userId.toLowerCase();
  return (deps.beginSql || beginSql)(async (tx) => {
    await assertNotDeleting(tx, target);
    await setProfileBlocked(tx, target, false);
    await audit(tx, null, target, admin, "unrestrict_profile");
    return { userId: target, status: "unrestricted" };
  });
}
