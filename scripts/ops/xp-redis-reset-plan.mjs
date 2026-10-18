// Planning only. This module never connects to Redis or executes mutations.
// Live capture/backup/reset requires a separately reviewed target-specific GO.
import {createHash} from 'node:crypto';
const NS='kcswh:xp:v2:';
const XP_COUNTER_FIELDS=new Set(['totalXp','total','xp','level','dailyXp','sessionXp']);
const XP_PROFILE_METADATA=new Set(['userId','createdAt','updatedAt']);
export function legacyXpResetAction(key, {type, value}={}) {
  if (typeof key!=='string') throw new TypeError('invalid_reset_key');
  // Exact families only. Never classify by loose substring or FLUSH the database.
  if (key.startsWith('kcswh:xp:user:')) {
    if(type!=='string') throw new Error('xp_profile_type_unreviewed');
    let record;try{record=JSON.parse(value);}catch{throw new Error('xp_profile_format_unreviewed');}
    if(!record || Array.isArray(record) || typeof record!=='object') throw new Error('xp_profile_format_unreviewed');
    const fields=Object.keys(record);
    if(!fields.some(field=>XP_COUNTER_FIELDS.has(field))) throw new Error('xp_profile_without_counter_unreviewed');
    if(fields.every(field=>XP_COUNTER_FIELDS.has(field)||XP_PROFILE_METADATA.has(field))) return {key,operation:'DEL'};
    // Preserve unknown/non-XP fields exactly; never rewrite a mixed profile via
    // the XP-only normalizer (which would silently discard identity data).
    const replacement={...record};
    for(const field of fields)if(XP_COUNTER_FIELDS.has(field))replacement[field]=field==='level'?1:0;
    return {key,operation:'SET',value:JSON.stringify(replacement),preserveTtl:true};
  }
  if (!key.startsWith(NS)) return null;
  const rest=key.slice(NS.length);
  const strings=/^(total:[A-Za-z0-9:_-]+|daily:[A-Za-z0-9:_-]+:\d{4}-\d{2}-\d{2}|session:(?:(?:last|state):)?[a-f0-9]{64}|(?:lock|registry):[a-f0-9]{64}|migration:(?:user:)?[a-f0-9]{64}|server-session:[A-Za-z0-9_-]+|(?:session-ratelimit:ip|ratelimit:(?:user|ip)):[A-Za-z0-9:_-]+|leaderboard:v1:hidden:[A-Za-z0-9_-]+)$/;
  const boards=/^leaderboard:v1:(all_time|day:\d{4}-\d{2}-\d{2}|week:\d{4}-W\d{2})$/;
  if(strings.test(rest)) {
    if(type!=='string')throw new Error('xp_key_type_unreviewed');
    return {key,operation:'DEL'};
  }
  if(boards.test(rest)) {
    if(type!=='zset')throw new Error('xp_board_type_unreviewed');
    return {key,operation:'DEL'};
  }
  return null;
}
export function buildLegacyXpResetPlan(records) {
  if(!Array.isArray(records))throw new TypeError('invalid_reset_inventory');
  const seen=new Set();const operations=[];let preserved=0;
  for(const record of [...records].sort((a,b)=>a.key.localeCompare(b.key))) {
    if(seen.has(record.key))throw new Error('duplicate_reset_key');seen.add(record.key);
    const action=legacyXpResetAction(record.key,record);
    if(action)operations.push(action);else preserved++;
  }
  const manifest=JSON.stringify({version:1,namespace:NS.slice(0,-1),operations});
  return {operations,preserved,manifestHash:createHash('sha256').update(manifest).digest('hex')};
}
