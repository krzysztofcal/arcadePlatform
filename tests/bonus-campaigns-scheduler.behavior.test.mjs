import assert from "node:assert/strict";
import test from "node:test";

import {
  runBonusCampaignScheduler,
} from "../netlify/functions/bonus-campaigns-scheduled.mjs";

function createDeps() {
  const campaigns = [
    {
      id: "campaign-scheduled-ready",
      code: "scheduled-ready",
      status: "scheduled",
      starts_at: "2026-07-07T09:00:00.000Z",
      ends_at: "2026-07-08T09:00:00.000Z",
    },
    {
      id: "campaign-scheduled-future",
      code: "scheduled-future",
      status: "scheduled",
      starts_at: "2026-07-08T09:00:00.000Z",
      ends_at: null,
    },
    {
      id: "campaign-scheduled-expired",
      code: "scheduled-expired",
      status: "scheduled",
      starts_at: "2026-07-01T09:00:00.000Z",
      ends_at: "2026-07-06T09:00:00.000Z",
    },
    {
      id: "campaign-active-expired",
      code: "active-expired",
      status: "active",
      starts_at: "2026-07-01T09:00:00.000Z",
      ends_at: "2026-07-07T08:59:59.000Z",
    },
    {
      id: "campaign-active-open",
      code: "active-open",
      status: "active",
      starts_at: "2026-07-01T09:00:00.000Z",
      ends_at: null,
    },
    {
      id: "campaign-paused-expired",
      code: "paused-expired",
      status: "paused",
      starts_at: "2026-07-01T09:00:00.000Z",
      ends_at: "2026-07-06T09:00:00.000Z",
    },
  ];
  const calls = [];
  return {
    campaigns,
    calls,
    logs: [],
    klog(kind, data) {
      this.logs.push({ kind, data });
    },
    async executeSql(query, params = []) {
      calls.push({ query, params });
      const text = String(query).replace(/\s+/g, " ").trim().toLowerCase();
      const now = Date.parse(params[0]);

      if (text.includes("where status = 'scheduled'") && text.includes("ends_at <= $1")) {
        return campaigns
          .filter((campaign) => campaign.status === "scheduled" && campaign.ends_at && Date.parse(campaign.ends_at) <= now)
          .map((campaign) => {
            campaign.status = "ended";
            return { id: campaign.id, code: campaign.code };
          });
      }

      if (text.includes("where status = 'scheduled'") && text.includes("starts_at <= $1")) {
        return campaigns
          .filter((campaign) => (
            campaign.status === "scheduled" &&
            Date.parse(campaign.starts_at) <= now &&
            (!campaign.ends_at || Date.parse(campaign.ends_at) > now)
          ))
          .map((campaign) => {
            campaign.status = "active";
            return { id: campaign.id, code: campaign.code };
          });
      }

      if (text.includes("where status = 'active'") && text.includes("ends_at <= $1")) {
        return campaigns
          .filter((campaign) => campaign.status === "active" && campaign.ends_at && Date.parse(campaign.ends_at) <= now)
          .map((campaign) => {
            campaign.status = "ended";
            return { id: campaign.id, code: campaign.code };
          });
      }

      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test("bonus campaign scheduler activates ready campaigns and ends expired campaigns", async () => {
  const deps = createDeps();
  const result = await runBonusCampaignScheduler({
    executeSql: deps.executeSql,
    klog: deps.klog.bind(deps),
    now: "2026-07-07T09:00:00.000Z",
  });

  assert.equal(deps.calls.length, 3);
  assert.equal(deps.calls.every((call) => call.params[0] === "2026-07-07T09:00:00.000Z"), true);
  assert.deepEqual(result.expiredScheduled.codes, ["scheduled-expired"]);
  assert.deepEqual(result.activated.codes, ["scheduled-ready"]);
  assert.deepEqual(result.ended.codes, ["active-expired"]);
  assert.equal(deps.campaigns.find((campaign) => campaign.code === "scheduled-ready").status, "active");
  assert.equal(deps.campaigns.find((campaign) => campaign.code === "scheduled-future").status, "scheduled");
  assert.equal(deps.campaigns.find((campaign) => campaign.code === "scheduled-expired").status, "ended");
  assert.equal(deps.campaigns.find((campaign) => campaign.code === "active-expired").status, "ended");
  assert.equal(deps.campaigns.find((campaign) => campaign.code === "active-open").status, "active");
  assert.equal(deps.campaigns.find((campaign) => campaign.code === "paused-expired").status, "paused");
  assert.equal(deps.logs[0].kind, "bonus_campaign_scheduler_ok");
});
