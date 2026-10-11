import postgres from "postgres";
import { pathToFileURL } from "node:url";

const STAGE_REF = "krydukthwdvccggbyjfw";
const STAGE_SYSTEM_ID = "7656985631720456337";
const CODE = /^[a-z0-9][a-z0-9_-]*$/;

function requireValue(ok, reason) {
  if (!ok) throw new Error(reason);
}

export function readRequest(env = process.env) {
  requireValue(env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && env.GITHUB_REPOSITORY === "krzysztofcal/arcadePlatform"
    && env.GITHUB_REF === "refs/heads/main"
    && env.GITHUB_ACTOR === "krzysztofcal", "unauthorized_stage_operator");
  const action = env.BONUS_ACTION || "inspect";
  requireValue(["inspect", "create_daily_draft", "switch_daily", "set_status"].includes(action), "invalid_action");
  const code = (env.BONUS_CODE || "").trim();
  const oldCode = (env.BONUS_OLD_CODE || "").trim();
  const status = (env.BONUS_STATUS || "").trim();
  if (action !== "inspect") requireValue(CODE.test(code), "invalid_campaign_code");
  if (action === "switch_daily") requireValue(CODE.test(oldCode) && oldCode !== code, "invalid_old_campaign_code");
  if (action === "set_status") requireValue(["paused", "ended"].includes(status), "invalid_status");
  const suffix = action === "create_daily_draft" ? " " + parseRewards(env.BONUS_REWARDS).join(",")
    : action === "switch_daily" ? " FROM " + oldCode
    : action === "set_status" ? " " + status : "";
  if (action !== "inspect") requireValue(env.BONUS_CONFIRM === "GO STAGE BONUS " + action + " " + code + suffix, "stage_bonus_go_required");
  return { action, code, oldCode, status };
}

export function stageConnection(env = process.env) {
  requireValue(env.SUPABASE_STAGE_PROJECT_REF === STAGE_REF, "wrong_stage_project_ref");
  requireValue(!env.SUPABASE_DB_URL, "unexpected_generic_db_url");
  let url;
  try { url = new URL(env.SUPABASE_STAGE_DIRECT_DB_URL || ""); }
  catch { throw new Error("invalid_stage_db_url"); }
  requireValue(["postgres:", "postgresql:"].includes(url.protocol)
    && url.hostname === "db." + STAGE_REF + ".supabase.co"
    && url.port === "5432" && !!url.username && !!url.password
    && url.pathname.length > 1, "wrong_stage_database_target");
  return url.toString();
}

export function parseRewards(raw) {
  const rewards = String(raw || "").split(",").map(v => Number(v.trim()));
  requireValue(rewards.length === 4 && rewards.every(v => Number.isSafeInteger(v) && v > 0), "invalid_daily_rewards");
  return rewards;
}

async function run(env = process.env) {
  const request = readRequest(env);
  const sql = postgres(stageConnection(env), { max: 1, ssl: "require", prepare: false, connect_timeout: 10 });
  try {
    const [database] = await sql.unsafe("select system_identifier::text as id from pg_catalog.pg_control_system()");
    requireValue(database?.id === STAGE_SYSTEM_ID, "stage_system_identity_mismatch");
    if (request.action === "inspect") {
      const rows = await sql.unsafe("select code, campaign_type, status, amount, starts_at, ends_at, eligibility_config from public.bonus_campaigns where campaign_type in ('daily', 'poker_daily') order by code");
      process.stdout.write(JSON.stringify({ environment: "Stage", campaigns: rows }, null, 2) + "\n");
      return;
    }
    const { createBonusCampaign, setBonusCampaignStatus } = await import("../../netlify/functions/admin-bonus-campaigns.mjs");
    const { klog } = await import("../../netlify/functions/_shared/supabase-admin.mjs");
    const exec = (query, params = []) => sql.unsafe(query, params);
    let result;
    if (request.action === "create_daily_draft") {
      const rewards = parseRewards(env.BONUS_REWARDS);
      const [clock] = await sql.unsafe("select now() as now");
      result = await createBonusCampaign({
        code: request.code, title: env.BONUS_TITLE || "Poker Daily Bonus",
        description: "Consecutive UTC days: " + rewards.join(", ") + " CH (Day 4+ repeats).",
        campaignType: "poker_daily", amount: rewards[0],
        startsAt: new Date(new Date(clock.now).getTime() - 60000).toISOString(),
        endsAt: null, eligibilityType: "all_accounts",
        eligibilityConfig: { daily_rewards: rewards }, claimPolicy: "daily", maxTotalClaims: null,
      }, null, exec);
    } else if (request.action === "set_status") {
      const [campaign] = await sql.unsafe("select id, campaign_type from public.bonus_campaigns where code = $1", [request.code]);
      requireValue(campaign && ["daily", "poker_daily"].includes(campaign.campaign_type), "daily_campaign_not_found");
      result = await setBonusCampaignStatus(campaign.id, request.status, exec, fn => sql.begin(fn));
    } else {
      result = await sql.begin(async tx => {
        const campaigns = await tx.unsafe("select id, code, status, campaign_type, starts_at from public.bonus_campaigns where code in ($1, $2) order by code for update", [request.oldCode, request.code]);
        const oldCampaign = campaigns.find(c => c.code === request.oldCode);
        const newCampaign = campaigns.find(c => c.code === request.code);
        requireValue(oldCampaign && newCampaign, "campaign_missing");
        if (oldCampaign.status === "ended" && newCampaign.status === "active") return { alreadySwitched: true };
        requireValue(oldCampaign.status === "active" && ["daily", "poker_daily"].includes(oldCampaign.campaign_type)
          && newCampaign.status === "draft" && newCampaign.campaign_type === "poker_daily"
          && Date.parse(newCampaign.starts_at) <= Date.now(), "invalid_daily_switch_state");
        const other = await tx.unsafe("select code from public.bonus_campaigns where campaign_type in ('daily', 'poker_daily') and status = 'active' and code <> $1", [request.oldCode]);
        requireValue(other.length === 0, "another_daily_campaign_active");
        const lockedBegin = fn => fn(tx);
        await setBonusCampaignStatus(oldCampaign.id, "ended", exec, lockedBegin);
        await setBonusCampaignStatus(newCampaign.id, "active", exec, lockedBegin);
        return { switched: true, oldCode: request.oldCode, newCode: request.code };
      });
    }
    klog("stage_bonus_agent_operation", { action: request.action, code: request.code,
      actor: env.GITHUB_ACTOR, runId: env.GITHUB_RUN_ID || null });
    process.stdout.write(JSON.stringify({ environment: "Stage", action: request.action, result }) + "\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch(error => {
    process.stderr.write("Stage bonus operation refused: " + (error.code || error.message || "unknown") + "\n");
    process.exitCode = 1;
  });
}
