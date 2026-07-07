import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import {
  badRequest,
  buildPagination,
  conflict,
  escapeLike,
  notFound,
  parseJsonBody,
  parsePageLimit,
  parseTimestamp,
  parseUuid,
} from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";

const CODE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const STATUSES = new Set(["draft", "scheduled", "active", "paused", "ended"]);
const ELIGIBILITY_TYPES = new Set(["all_accounts", "created_after", "created_before", "allowlist"]);
const CLAIM_POLICIES = new Set(["once", "daily", "weekly", "monthly"]);
const STATUS_TRANSITIONS = {
  draft: new Set(["scheduled", "active", "ended"]),
  scheduled: new Set(["active", "paused", "ended"]),
  active: new Set(["paused", "ended"]),
  paused: new Set(["active", "ended"]),
  ended: new Set([]),
};

function normalizeCampaignRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || "",
    campaignType: row.campaign_type,
    amount: Number(row.amount),
    status: row.status,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    eligibilityType: row.eligibility_type,
    eligibilityConfig: row.eligibility_config || {},
    claimPolicy: row.claim_policy || "once",
    maxTotalClaims: row.max_total_claims == null ? null : Number(row.max_total_claims),
    claimCount: Number(row.claim_count || 0),
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function parseRequiredText(value, code, { maxLength = 160 } = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw badRequest(code, code);
  if (normalized.length > maxLength) throw badRequest(`${code}_too_long`, `${code}_too_long`);
  return normalized;
}

function parseOptionalText(value, code, { maxLength = 500 } = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (normalized.length > maxLength) throw badRequest(`${code}_too_long`, `${code}_too_long`);
  return normalized;
}

function parseCode(value) {
  const code = parseRequiredText(value, "missing_code", { maxLength: 80 });
  if (!CODE_RE.test(code)) throw badRequest("invalid_code", "invalid_code");
  return code;
}

function parseEnum(value, allowed, code) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!allowed.has(normalized)) throw badRequest(code, code);
  return normalized;
}

function parsePositiveAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed <= 0) {
    throw badRequest("invalid_amount", "invalid_amount");
  }
  if (parsed > Number.MAX_SAFE_INTEGER) throw badRequest("invalid_amount", "invalid_amount");
  return parsed;
}

function parseOptionalPositiveInt(value, code) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed <= 0) {
    throw badRequest(code, code);
  }
  if (parsed > Number.MAX_SAFE_INTEGER) throw badRequest(code, code);
  return parsed;
}

function parseJsonObjectStrict(value) {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_error) {
      throw badRequest("invalid_eligibility_config", "invalid_eligibility_config");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("invalid_eligibility_config", "invalid_eligibility_config");
  }
  return value;
}

function parseCampaignInput(payload = {}, { requireCode = true } = {}) {
  const startsAt = parseTimestamp(payload.startsAt ?? payload.starts_at, "invalid_starts_at");
  if (!startsAt) throw badRequest("missing_starts_at", "missing_starts_at");
  const endsAt = parseTimestamp(payload.endsAt ?? payload.ends_at, "invalid_ends_at");
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw badRequest("invalid_time_window", "invalid_time_window");
  }
  return {
    code: requireCode ? parseCode(payload.code) : null,
    title: parseRequiredText(payload.title, "missing_title", { maxLength: 160 }),
    description: parseOptionalText(payload.description, "description", { maxLength: 500 }),
    campaignType: parseRequiredText(payload.campaignType ?? payload.campaign_type, "missing_campaign_type", { maxLength: 80 }),
    amount: parsePositiveAmount(payload.amount),
    startsAt,
    endsAt,
    eligibilityType: parseEnum(payload.eligibilityType ?? payload.eligibility_type, ELIGIBILITY_TYPES, "invalid_eligibility_type"),
    eligibilityConfig: parseJsonObjectStrict(payload.eligibilityConfig ?? payload.eligibility_config),
    claimPolicy: parseEnum(payload.claimPolicy ?? payload.claim_policy ?? "once", CLAIM_POLICIES, "invalid_claim_policy"),
    maxTotalClaims: parseOptionalPositiveInt(payload.maxTotalClaims ?? payload.max_total_claims, "invalid_max_total_claims"),
  };
}

async function listBonusCampaigns(filters = {}, runSql = executeSql) {
  const pageInfo = parsePageLimit(filters, { defaultLimit: 25, maxLimit: 100 });
  const status = typeof filters.status === "string" && filters.status.trim()
    ? parseEnum(filters.status, STATUSES, "invalid_status")
    : "";
  const search = typeof filters.q === "string" ? filters.q.trim() : "";
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (status) where.push(`c.status = ${nextParam(status)}`);
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    where.push(`(c.code ilike ${nextParam(pattern)} escape '\\' or c.title ilike ${nextParam(pattern)} escape '\\')`);
  }
  const whereSql = where.length ? `where ${where.join("\n  and ")}` : "";
  const rows = await runSql(
    `
with campaign_claims as (
  select campaign_id, count(*)::bigint as claim_count
  from public.bonus_claims
  group by campaign_id
),
filtered as (
  select
    c.id,
    c.code,
    c.title,
    c.description,
    c.campaign_type,
    c.amount,
    c.status,
    c.starts_at,
    c.ends_at,
    c.eligibility_type,
    c.eligibility_config,
    c.claim_policy,
    c.max_total_claims,
    c.created_by,
    c.created_at,
    c.updated_at,
    coalesce(cc.claim_count, 0)::bigint as claim_count
  from public.bonus_campaigns c
  left join campaign_claims cc on cc.campaign_id = c.id
  ${whereSql}
)
select filtered.*, count(*) over() as total_count
from filtered
order by created_at desc, code asc
offset ${nextParam(pageInfo.offset)}
limit ${nextParam(pageInfo.limit)};
`,
    params,
  );
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0;
  return {
    items: (Array.isArray(rows) ? rows : []).map(normalizeCampaignRow),
    pagination: buildPagination({ page: pageInfo.page, limit: pageInfo.limit, total }),
  };
}

async function fetchCampaignById(id, runSql = executeSql) {
  const rows = await runSql(
    `
select
  c.id,
  c.code,
  c.title,
  c.description,
  c.campaign_type,
  c.amount,
  c.status,
  c.starts_at,
  c.ends_at,
  c.eligibility_type,
  c.eligibility_config,
  c.claim_policy,
  c.max_total_claims,
  c.created_by,
  c.created_at,
  c.updated_at,
  coalesce(count(bc.id), 0)::bigint as claim_count
from public.bonus_campaigns c
left join public.bonus_claims bc on bc.campaign_id = c.id
where c.id = $1
group by c.id
limit 1;
`,
    [id],
  );
  return normalizeCampaignRow(rows?.[0] || null);
}

async function createBonusCampaign(payload = {}, adminUserId, runSql = executeSql) {
  const input = parseCampaignInput(payload, { requireCode: true });
  const rows = await runSql(
    `
insert into public.bonus_campaigns (
  code,
  title,
  description,
  campaign_type,
  amount,
  status,
  starts_at,
  ends_at,
  eligibility_type,
  eligibility_config,
  claim_policy,
  max_total_claims,
  created_by
)
values ($1, $2, $3, $4, $5, 'draft', $6::timestamptz, $7::timestamptz, $8, $9::jsonb, $10, $11, $12)
returning *, 0::bigint as claim_count;
`,
    [
      input.code,
      input.title,
      input.description || null,
      input.campaignType,
      input.amount,
      input.startsAt,
      input.endsAt,
      input.eligibilityType,
      JSON.stringify(input.eligibilityConfig),
      input.claimPolicy,
      input.maxTotalClaims,
      adminUserId,
    ],
  );
  return normalizeCampaignRow(rows?.[0] || null);
}

async function updateBonusCampaign(id, payload = {}, runSql = executeSql) {
  const input = parseCampaignInput(payload, { requireCode: false });
  const current = await fetchCampaignById(id, runSql);
  if (!current) throw notFound("campaign_not_found", "campaign_not_found");
  if (current.status !== "draft") {
    throw conflict("campaign_not_draft", "campaign_not_draft");
  }
  const rows = await runSql(
    `
update public.bonus_campaigns
set title = $2,
    description = $3,
    campaign_type = $4,
    amount = $5,
    starts_at = $6::timestamptz,
    ends_at = $7::timestamptz,
    eligibility_type = $8,
    eligibility_config = $9::jsonb,
    claim_policy = $10,
    max_total_claims = $11
where id = $1
returning *, 0::bigint as claim_count;
`,
    [
      id,
      input.title,
      input.description || null,
      input.campaignType,
      input.amount,
      input.startsAt,
      input.endsAt,
      input.eligibilityType,
      JSON.stringify(input.eligibilityConfig),
      input.claimPolicy,
      input.maxTotalClaims,
    ],
  );
  return normalizeCampaignRow(rows?.[0] || null);
}

async function setBonusCampaignStatus(id, status, runSql = executeSql) {
  const nextStatus = parseEnum(status, STATUSES, "invalid_status");
  const current = await fetchCampaignById(id, runSql);
  if (!current) throw notFound("campaign_not_found", "campaign_not_found");
  if (current.status === nextStatus) return current;
  const allowed = STATUS_TRANSITIONS[current.status] || new Set();
  if (!allowed.has(nextStatus)) {
    throw conflict("invalid_status_transition", "invalid_status_transition");
  }
  const rows = await runSql(
    `
update public.bonus_campaigns
set status = $2
where id = $1
returning *, $3::bigint as claim_count;
`,
    [id, nextStatus, current.claimCount],
  );
  return normalizeCampaignRow(rows?.[0] || null);
}

function mapAdminCampaignError(error) {
  if (error?.status === 400) return { statusCode: 400, body: { error: error.code || "invalid_request" } };
  if (error?.status === 404) return { statusCode: 404, body: { error: error.code || "not_found" } };
  if (error?.status === 409) return { statusCode: 409, body: { error: error.code || "conflict" } };
  if (error?.code === "23505") return { statusCode: 409, body: { error: "campaign_code_exists" } };
  if (error?.constraint === "bonus_campaigns_time_window_valid") return { statusCode: 400, body: { error: "invalid_time_window" } };
  return { statusCode: 500, body: { error: "server_error" } };
}

function createAdminBonusCampaignsHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const runSql = deps.executeSql || executeSql;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    }
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }

    let adminUserId = null;
    try {
      const admin = await requireAdmin(event, env);
      adminUserId = admin.userId;
      if (event.httpMethod === "GET") {
        const payload = await listBonusCampaigns(event.queryStringParameters || {}, runSql);
        return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
      }
      if (event.httpMethod !== "POST") {
        return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
      }

      const body = parseJsonBody(event.body);
      const action = typeof body.action === "string" ? body.action.trim() : "";
      let campaign = null;
      if (action === "create") {
        campaign = await createBonusCampaign(body.campaign || body, adminUserId, runSql);
      } else if (action === "update") {
        const id = parseUuid(body.campaignId || body.id, "invalid_campaign_id");
        campaign = await updateBonusCampaign(id, body.campaign || body, runSql);
      } else if (action === "set_status") {
        const id = parseUuid(body.campaignId || body.id, "invalid_campaign_id");
        campaign = await setBonusCampaignStatus(id, body.status, runSql);
      } else {
        throw badRequest("invalid_action", "invalid_action");
      }
      klog("bonus_campaign_admin_updated", {
        adminUserId,
        campaignId: campaign?.id || null,
        campaignCode: campaign?.code || null,
        campaignType: campaign?.campaignType || null,
        amount: campaign?.amount || null,
        reason: action,
      });
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, campaign }) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      const mapped = mapAdminCampaignError(error);
      klog("bonus_campaign_admin_update_failed", {
        adminUserId,
        reason: error?.code || error?.message || "server_error",
      });
      return { statusCode: mapped.statusCode, headers: cors, body: JSON.stringify(mapped.body) };
    }
  };
}

const handler = createAdminBonusCampaignsHandler();

export {
  createAdminBonusCampaignsHandler,
  createBonusCampaign,
  handler,
  listBonusCampaigns,
  setBonusCampaignStatus,
  updateBonusCampaign,
};
