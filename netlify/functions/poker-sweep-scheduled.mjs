import { klog } from "./_shared/supabase-admin.mjs";

const siteUrl =
  process.env.URL ||
  process.env.DEPLOY_PRIME_URL ||
  process.env.SITE_URL ||
  "https://play.kcswh.pl";

export default async (req) => {
  const sweepSecret = process.env.POKER_SWEEP_SECRET;
  if (!sweepSecret) {
    klog("[poker-sweep-scheduled] sweep_secret_missing");
    return;
  }

  const res = await fetch(`${siteUrl}/.netlify/functions/poker-sweep`, {
    method: "POST",
    headers: { "x-sweep-secret": sweepSecret },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    klog("[poker-sweep-scheduled] sweep_failed", { status: res.status, body: text?.slice(0, 300) });
    return;
  }

  klog("[poker-sweep-scheduled] ok", { status: res.status, body: text?.slice(0, 300) });
};

export const config = {
  schedule: "*/5 * * * *",
};
