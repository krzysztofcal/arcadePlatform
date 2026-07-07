import { executeSql, klog } from "./_shared/supabase-admin.mjs";

const SCHEDULE = "*/5 * * * *";

function toIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function summarizeRows(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return {
    count: items.length,
    codes: items.map((row) => row?.code).filter(Boolean),
  };
}

async function runBonusCampaignScheduler(deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const log = deps.klog || klog;
  const nowIso = toIso(deps.now || new Date());

  const expiredScheduledRows = await runSql(
    `
update public.bonus_campaigns
set status = 'ended'
where status = 'scheduled'
  and ends_at is not null
  and ends_at <= $1::timestamptz
returning id, code;
`,
    [nowIso],
  );

  const activatedRows = await runSql(
    `
update public.bonus_campaigns
set status = 'active'
where status = 'scheduled'
  and starts_at <= $1::timestamptz
  and (ends_at is null or ends_at > $1::timestamptz)
returning id, code;
`,
    [nowIso],
  );

  const endedRows = await runSql(
    `
update public.bonus_campaigns
set status = 'ended'
where status = 'active'
  and ends_at is not null
  and ends_at <= $1::timestamptz
returning id, code;
`,
    [nowIso],
  );

  const result = {
    now: nowIso,
    expiredScheduled: summarizeRows(expiredScheduledRows),
    activated: summarizeRows(activatedRows),
    ended: summarizeRows(endedRows),
  };

  log("bonus_campaign_scheduler_ok", result);
  return result;
}

export default async () => {
  if (process.env.CHIPS_ENABLED !== "1") {
    klog("bonus_campaign_scheduler_disabled", { chipsEnabled: process.env.CHIPS_ENABLED || "" });
    return;
  }

  try {
    await runBonusCampaignScheduler();
  } catch (error) {
    klog("bonus_campaign_scheduler_failed", {
      message: error?.message || "unknown_error",
      code: error?.code || null,
    });
  }
};

export const config = {
  schedule: SCHEDULE,
};

export {
  runBonusCampaignScheduler,
};
