// Planning only. This module never connects to Redis or executes mutations.
// Live capture/backup/reset requires a separately reviewed target-specific GO.
import {createHash} from 'node:crypto';
const NS='kcswh:xp:v2:';
const XP_COUNTER_FIELDS=new Set(['totalXp','total','xp','level','dailyXp','sessionXp']);
const XP_PROFILE_METADATA=new Set(['userId','createdAt','updatedAt','hasConvertedAnonXp']);
const ANON_COUNTER_FIELDS=new Set(['totalAnonXp','anonActiveDays']);
const ANON_PROFILE_METADATA=new Set(['anonId','createdAt','lastActivityTs','lastActiveDayKey','convertedToUserId']);
export function legacyXpResetAction(key, {type, value}={}) {
  if (typeof key!=='string') throw new TypeError('invalid_reset_key');
  // Exact families only. Never classify by loose substring or FLUSH the database.
  if (key.startsWith('kcswh:xp:user:') || key.startsWith('kcswh:xp:anon:')) {
    const anonymous=key.startsWith('kcswh:xp:anon:');
    const counters=anonymous ? ANON_COUNTER_FIELDS : XP_COUNTER_FIELDS;
    const metadata=anonymous ? ANON_PROFILE_METADATA : XP_PROFILE_METADATA;
    if(type!=='string') throw new Error('xp_profile_type_unreviewed');
    let record;try{record=JSON.parse(value);}catch{throw new Error('xp_profile_format_unreviewed');}
    if(!record || Array.isArray(record) || typeof record!=='object') throw new Error('xp_profile_format_unreviewed');
    const fields=Object.keys(record);
    if(!fields.some(field=>counters.has(field))) throw new Error('xp_profile_without_counter_unreviewed');
    if(fields.every(field=>counters.has(field)||metadata.has(field))) return {key,operation:'DEL'};
    // Preserve unknown/non-XP fields exactly; never rewrite a mixed profile via
    // the XP-only normalizer (which would silently discard identity data).
    const replacement={...record};
    for(const field of fields)if(counters.has(field))replacement[field]=field==='level'?1:0;
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
    if(action) {
      if(record.value===undefined || !Number.isSafeInteger(record.pttl) || record.pttl < -1 || !Number.isSafeInteger(record.capturedAtMs) || record.capturedAtMs < 0 || record.pttl>=0 && !Number.isSafeInteger(record.capturedAtMs+record.pttl)) throw new Error('reset_snapshot_incomplete');
      operations.push({...action,expected:{type:record.type,pttl:record.pttl,capturedAtMs:record.capturedAtMs,expiresAtMs:record.pttl<0 ? null : record.capturedAtMs+record.pttl,valueHash:createHash('sha256').update(JSON.stringify(record.value)).digest('hex')}});
    } else preserved++;
  }
  const manifest=JSON.stringify({version:1,namespace:NS.slice(0,-1),operations});
  return {operations,preserved,manifestHash:createHash('sha256').update(manifest).digest('hex')};
}

// Pure contract for a future executor, NOT authority to execute a reset.
// nowMs/capturedAtMs must come from Redis TIME, not unrelated host clocks.
export function validateLegacyXpResetObservation(action, observation, {nowMs, toleranceMs=1000}={}) {
  if (!action?.expected || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(toleranceMs) || toleranceMs<0 || toleranceMs>1000) throw new Error('reset_clock_unproven');
  const expected=action.expected;
  if (nowMs<expected.capturedAtMs) throw new Error('reset_clock_unproven');
  if (observation?.pttl===-2 && observation.type==='none') {
    if (expected.expiresAtMs!==null && nowMs>=expected.expiresAtMs) return {action:'SKIP_EXPIRED'};
    // A persistent/missing-before-deadline key might have been replaced/deleted
    // by another writer. Lost-response retries require a prior trusted receipt.
    throw new Error('reset_absence_unproven');
  }
  if (!observation || observation.type!==expected.type || observation.value===undefined ||
      createHash('sha256').update(JSON.stringify(observation.value)).digest('hex')!==expected.valueHash) throw new Error('reset_content_changed');
  if (!Number.isSafeInteger(observation.pttl) || observation.pttl < -1) throw new Error('reset_expiry_unproven');
  if (expected.expiresAtMs===null) {
    if (observation.pttl!==-1) throw new Error('reset_expiry_changed');
  } else {
    if (observation.pttl<0 || Math.abs(nowMs+observation.pttl-expected.expiresAtMs)>toleranceMs) throw new Error('reset_expiry_changed');
  }
  return {action:action.operation,preserveCurrentTtl:action.operation==='SET'};
}

// No network/CLI. The separately authorized runner must journal each result and
// stop on an uncertain response. Persistent-key absence is NOT replay success.
const RESET_CAS_LUA = `
local kind=redis.call('TYPE',KEYS[1]).ok
local clock=redis.call('TIME'); local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
local deadline=tonumber(ARGV[3]); local captured=tonumber(ARGV[4])
if now<captured then return redis.error_reply('reset_clock_unproven') end
if kind=='none' then
 if deadline>=0 and now>=deadline then return 'SKIP_EXPIRED' end
 return redis.error_reply('reset_absence_unproven')
end
if kind~=ARGV[1] then return redis.error_reply('reset_content_changed') end
local expected=cjson.decode(ARGV[2])
if kind=='string' then
 if redis.call('GET',KEYS[1])~=expected then return redis.error_reply('reset_content_changed') end
elseif kind=='zset' then
 local actual=redis.call('ZRANGE',KEYS[1],0,-1,'WITHSCORES')
 if #actual~=#expected then return redis.error_reply('reset_content_changed') end
 for i=1,#actual do if actual[i]~=expected[i] then return redis.error_reply('reset_content_changed') end end
else return redis.error_reply('reset_type_unreviewed') end
local ttl=redis.call('PTTL',KEYS[1])
if deadline<0 then
 if ttl~=-1 then return redis.error_reply('reset_expiry_changed') end
elseif ttl<=0 or math.abs(now+ttl-deadline)>1000 then return redis.error_reply('reset_expiry_changed') end
if ARGV[5]=='DEL' then redis.call('DEL',KEYS[1]); return 'DELETED' end
if ARGV[5]=='SET' and kind=='string' then
 redis.call('SET',KEYS[1],ARGV[6],'KEEPTTL'); return 'XP_FIELDS_RESET'
end
return redis.error_reply('reset_action_unreviewed')`;

export function prepareLegacyXpResetCommand(action, snapshot) {
  // Recompute the plan from the original snapshot; never accept a caller's SET
  // payload, namespace, key or hash as authority to erase data.
  const plan=buildLegacyXpResetPlan([snapshot]);
  const expected=plan.operations[0];
  if (!expected || JSON.stringify(action)!==JSON.stringify(expected)) throw new Error('reset_action_changed');
  if (snapshot.type==='string' ? typeof snapshot.value!=='string'
    : snapshot.type!=='zset' || !Array.isArray(snapshot.value) || snapshot.value.some(x=>typeof x!=='string')) throw new Error('reset_snapshot_format');
  return ['EVAL',RESET_CAS_LUA,1,action.key,snapshot.type,JSON.stringify(snapshot.value),
    action.expected.expiresAtMs===null?'-1':String(action.expected.expiresAtMs),String(action.expected.capturedAtMs),action.operation,action.value||''];
}
