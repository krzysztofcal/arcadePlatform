// Offline-only policy planner. No network, credentials, DELETE or apply mode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = 'f7e19a84-28f7-41f7-978a-f3b4552a404d';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
export function planPreviewRetention({ inventory, pullRequests, pins, asOf }) {
  const now = timestamp(asOf);
  if (!Number.isFinite(now) || inventory.siteId !== SITE || inventory.complete !== true ||
      pins.siteId !== SITE || !Array.isArray(pins.rules) || !pins.rules.length ||
      !Array.isArray(inventory.rows) || !pullRequests) throw Error('retention_inputs_invalid');
  const seen = new Set();
  for (const d of inventory.rows) {
    if (!/^[a-f0-9]{24}$/.test(d.id) || seen.has(d.id)) throw Error('retention_inventory_invalid');
    seen.add(d.id);
  }
  const groups = new Map();
  const uncertainGroups = new Set();
  for (const d of inventory.rows) {
    if (d.context !== 'deploy-preview' || d.state !== 'ready') continue;
    const key = String(d.reviewId);
    if (!Number.isFinite(timestamp(d.created)) || timestamp(d.created) > now) { uncertainGroups.add(key); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  for (const group of groups.values()) group.sort((a,b) => timestamp(b.created)-timestamp(a.created) || a.id.localeCompare(b.id));
  const result = inventory.rows.map(d => {
    const row = { id:d.id, reviewId:d.reviewId ?? null, context:d.context, created:d.created, decision:'KEEP', reason:null, eligibleAt:null };
    const keep = reason => ({...row,reason});
    if (d.context === 'production' || d.id === inventory.published) return keep('production_or_published');
    if (d.locked === true) return keep('provider_locked');
    const pin = pins.rules.find(p => p.deployId === d.id || p.reviewId != null && String(p.reviewId) === String(d.reviewId));
    if (pin) return keep('pin:'+pin.reason);
    if (d.context !== 'deploy-preview') return keep('context_out_of_scope');
    if (d.state !== 'ready') return keep('not_ready');
    const created = timestamp(d.created);
    if (!Number.isFinite(created) || created > now) return keep('unknown_or_future_creation');
    if (uncertainGroups.has(String(d.reviewId))) return keep('unknown_pr_group_dates');
    const pr = pullRequests[String(d.reviewId)];
    if (!pr || !['OPEN','CLOSED','MERGED'].includes(pr.state)) return keep('unknown_pr');
    const group = groups.get(String(d.reviewId));
    const index = group.findIndex(x => x.id === d.id);
    let eligible;
    if (pr.state === 'OPEN') {
      if (index === 0) return keep('open_pr_current_alias');
      const superseded = timestamp(group[index-1].created);
      if (!Number.isFinite(superseded) || superseded > now) return keep('unknown_supersession');
      eligible = Math.max(created, superseded) + WEEK;
      row.reason = 'open_pr_superseded_7d';
    } else {
      const closed = timestamp(pr.closedAt);
      if (!Number.isFinite(closed) || closed > now) return keep('unknown_or_future_closure');
      eligible = Math.max(created, closed) + WEEK;
      row.reason = 'closed_pr_7d';
    }
    row.eligibleAt = new Date(eligible).toISOString();
    if (now < eligible) return {...row,reason:'grace_period'};
    return {...row,decision:'CANDIDATE_ESTIMATE'};
  });
  const byId = new Map(result.map(r => [r.id,r]));
  for (const group of groups.values()) {
    const latest = byId.get(group[0].id);
    if (latest.decision === 'CANDIDATE_ESTIMATE' && group.slice(1).some(d => byId.get(d.id).decision !== 'CANDIDATE_ESTIMATE')) {
      latest.decision = 'KEEP'; latest.reason = 'alias_fallback_guard';
    }
  }
  // Oldest first within PR; latest alias target must be deleted only after its older group has gone.
  result.sort((a,b) => String(a.reviewId).localeCompare(String(b.reviewId),undefined,{numeric:true}) || timestamp(a.created)-timestamp(b.created) || a.id.localeCompare(b.id));
  const counts = result.reduce((out,r) => {out[r.decision]=(out[r.decision]||0)+1;return out;},{});
  const reasons = result.reduce((out,r) => {out[r.reason]=(out[r.reason]||0)+1;return out;},{});
  return {siteId:SITE,asOf,mode:'OFFLINE_READ_ONLY',applyAuthorized:false,liveLocksAndAliasesRechecked:false,
    prerequisites:'Production and Stage rotation PASS + fresh inventory/pins/PR/lock checks + separate OWNER GO',
    counts,reasons,rows:result};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw Error('usage: inventory.json prs.json pins.json asOfISO; no apply mode');
  const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
  process.stdout.write(JSON.stringify(planPreviewRetention({inventory:read(args[0]),pullRequests:read(args[1]).pullRequests,pins:read(args[2]),asOf:args[3]}),null,2)+'\n');
}
