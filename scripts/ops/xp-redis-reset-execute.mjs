// VPS-only operator tool. No application imports, migrations, automatic retry or broad deletes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildLegacyXpResetPlan,prepareLegacyXpResetCommand,validateLegacyXpResetObservation} from './xp-redis-reset-plan.mjs';
const ENDPOINT_HASH='c6e6a1508c51ef4c6cc22e035d54487a1afe36123a8f4610224c848d4b21e762';
const sha=value=>createHash('sha256').update(value).digest('hex');
function need(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
function parents(file,boundary='/'){
 let current=path.dirname(path.resolve(file));boundary=path.resolve(boundary);
 while(true){
  need(current===boundary||current.startsWith(boundary==='/'?'/':boundary+'/'),'reset_path_unsafe');
  const m=fs.lstatSync(current);need(m.isDirectory()&&[0,process.getuid()].includes(m.uid)&&!(m.mode&0o022),'reset_path_unsafe');
  if(current===boundary)break;current=path.dirname(current);
 }
}
function check(fd){const m=fs.fstatSync(fd);need(m.isFile()&&m.nlink===1&&m.uid===process.getuid()&&(m.mode&0o777)===0o600,'reset_file_unsafe');}
export function protectedRead(file,{boundary='/'}={}){
 parents(file,boundary);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{check(fd);need(fs.fstatSync(fd).size<=32*1024*1024,'reset_file_too_large');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
function syncDirectory(file){const fd=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function protectedCreate(file,text,{boundary='/'}={}){
 parents(file,boundary);const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{check(fd);fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(file);
}
export function readJournal(file,{boundary='/'}={}){
 let text;try{text=protectedRead(file,{boundary});}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(!text)return [];
 need(text.endsWith('\n'),'reset_journal_corrupt');
 try{return text.trimEnd().split('\n').map(line=>JSON.parse(line));}catch{throw Error('reset_journal_corrupt');}
}
export function validateScope(snapshot,scope){
 need(snapshot.endpointHash===scope.endpointHash&&Array.isArray(scope.operations),'reset_scope_changed');
 const plan=buildLegacyXpResetPlan(snapshot.records);
 const actual=plan.operations.map(a=>({key:a.key,type:a.expected.type,operation:a.operation})).sort((a,b)=>a.key.localeCompare(b.key));
 const approved=scope.operations.map(a=>({key:a.key,type:a.type,operation:a.operation})).sort((a,b)=>a.key.localeCompare(b.key));
 need(plan.preserved===0&&actual.length===approved.length&&JSON.stringify(actual)===JSON.stringify(approved),'reset_scope_changed');return plan;
}
async function verifyEffect(action,result,observe){
 const current=await observe(action.key);
 if(result==='DELETED'||result==='SKIP_EXPIRED'){need(current.type==='none'&&current.pttl===-2,'reset_effect_changed');return;}
 need(result==='XP_FIELDS_RESET'&&action.operation==='SET','reset_journal_corrupt');
 if(current.type==='none'&&action.expected.expiresAtMs!==null&&current.capturedAtMs>=action.expected.expiresAtMs)return;
 const expected={...action,expected:{...action.expected,type:'string',valueHash:sha(JSON.stringify(action.value))}};
 validateLegacyXpResetObservation(expected,current,{nowMs:current.capturedAtMs});
}
export async function executeReset({snapshot,scope,manifestHash,journal,boundary='/',observe,command,apply=false,verifyOnly=false}){
 const plan=validateScope(snapshot,scope);need(plan.manifestHash===manifestHash,'reset_manifest_changed');
 const header={kind:'header',version:1,manifestHash,snapshotHash:sha(JSON.stringify(snapshot)),scopeHash:sha(JSON.stringify(scope))};
 if(!apply){for(const a of plan.operations){const r=await observe(a.key);validateLegacyXpResetObservation(a,r,{nowMs:r.capturedAtMs});}return {mode:'dry-run',count:plan.operations.length,manifestHash};}
 parents(journal,boundary);
 const lock=fs.openSync(journal+'.lock',fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
 let fd;
 try{
  check(lock);
  // flock is associated with the shared open-file description; parent keeps it
  // after the child exits. Kernel releases it on process crash, no stale PID files.
  need(spawnSync('/usr/bin/flock',['-n','3'],{stdio:['ignore','ignore','ignore',lock]}).status===0,'reset_executor_busy');
  const rows=readJournal(journal,{boundary});const completed=new Map();let pending=null;
  if(rows.length){
   need(JSON.stringify(rows[0])===JSON.stringify(header),'reset_journal_changed');
   for(const row of rows.slice(1)){
    const action=plan.operations[row.index];need(action&&row.actionHash===sha(JSON.stringify(action)),'reset_journal_corrupt');
    if(row.kind==='intent'){need(pending===null&&row.index===completed.size&&!completed.has(row.index),'reset_journal_corrupt');pending=row.index;}
    else if(row.kind==='done'){
     need(pending===row.index,'reset_journal_corrupt');
     need(row.result===(action.operation==='DEL'?'DELETED':'XP_FIELDS_RESET')||row.result==='SKIP_EXPIRED','reset_journal_corrupt');
     need(row.result!=='SKIP_EXPIRED'||action.expected.expiresAtMs!==null,'reset_journal_corrupt');
     completed.set(row.index,row.result);pending=null;
    }else throw Error('reset_journal_unresolved');
   }
   need(pending===null,'reset_journal_unresolved');
  }else {need(!verifyOnly,'reset_journal_incomplete');protectedCreate(journal,JSON.stringify(header)+'\n',{boundary});}
  need(!verifyOnly||completed.size===plan.operations.length,'reset_journal_incomplete');
  fd=fs.openSync(journal,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);check(fd);
  const append=row=>{fs.writeFileSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);};
  for(let index=0;index<plan.operations.length;index++){
   const action=plan.operations[index];
   if(completed.has(index)){await verifyEffect(action,completed.get(index),observe);continue;}
   const actionHash=sha(JSON.stringify(action));
   append({kind:'intent',index,actionHash}); // MUST persist before sending anything.
   let result;
   try{
    result=await command(prepareLegacyXpResetCommand(action,snapshot.records.find(r=>r.key===action.key)));
    need(result===(action.operation==='DEL'?'DELETED':'XP_FIELDS_RESET')||result==='SKIP_EXPIRED','reset_result_unproven');
   }catch{
    append({kind:'stop',index,actionHash,code:'reset_operation_uncertain'});
    throw Error('reset_operation_uncertain');
   }
   append({kind:'done',index,actionHash,result});
   await verifyEffect(action,result,observe);completed.set(index,result);
  }
  return {mode:verifyOnly?'verify':'apply',completed:completed.size,manifestHash};
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.closeSync(lock);}
}
const OBSERVE=`-- xp-reset-observe
local kind=redis.call('TYPE',KEYS[1]).ok;local value=false
if kind=='string' then value=redis.call('GET',KEYS[1]) elseif kind=='zset' then value=redis.call('ZRANGE',KEYS[1],0,-1,'WITHSCORES') end
local ttl=redis.call('PTTL',KEYS[1]);local t=redis.call('TIME')
return {kind,value,ttl,tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)}`;
export function redisClient(credentials,fetcher=fetch){
 const endpoint=String(credentials.UPSTASH_REDIS_REST_URL||'').replace(/\/$/,'');
 need(sha(endpoint)===ENDPOINT_HASH&&typeof credentials.UPSTASH_REDIS_REST_TOKEN==='string'&&credentials.UPSTASH_REDIS_REST_TOKEN.trim(),'reset_target_mismatch');
 async function request(cmd){
  let response,body;try{response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+credentials.UPSTASH_REDIS_REST_TOKEN,'content-type':'application/json'},body:JSON.stringify(cmd)});body=await response.json();}catch{throw Error('reset_transport_uncertain');}
  return {status:response.status,body};
 }
 return {
  request,
  async command(cmd){const r=await request(cmd);need(r.status===200&&!r.body.error,'reset_redis_error');return r.body.result;},
  async observe(key){const r=await this.command(['EVAL',OBSERVE,1,key]);need(Array.isArray(r)&&r.length===4,'reset_observation_invalid');return {key,type:r[0],value:r[1],pttl:r[2],capturedAtMs:r[3]};}
 };
}
export function verifyRevocation(denied){
 need(denied.status===401&&typeof denied.body?.error==='string'&&/WRONGPASS|unauthoriz|invalid.*token/i.test(denied.body.error),'reset_old_credential_not_revoked');
}
export async function verifyCredentials(current,old){
 need(current.UPSTASH_REDIS_REST_URL.replace(/\/$/,'')===old.UPSTASH_REDIS_REST_URL.replace(/\/$/,'')&&current.UPSTASH_REDIS_REST_TOKEN!==old.UPSTASH_REDIS_REST_TOKEN,'reset_credentials_not_rotated');
 const client=redisClient(current);need(await client.command(['PING'])==='PONG','reset_new_credential_failed');need(await client.command(['EVAL','return 1',0])===1,'reset_new_lua_permission_failed');
 const denied=await redisClient(old).request(['PING']);
 verifyRevocation(denied);return client;
}
async function inventory(client){
 const keys=new Set();let cursor='0';let pages=0;
 do{need(++pages<=1000,'reset_scan_unbounded');const row=await client.command(['SCAN',cursor,'COUNT','100']);need(Array.isArray(row)&&Array.isArray(row[1]),'reset_scan_invalid');cursor=String(row[0]);for(const key of row[1])keys.add(key);}while(cursor!=='0');return keys;
}
function legacy(key){return key.startsWith('kcswh:xp:v2:')||key.startsWith('kcswh:xp:user:')||key.startsWith('kcswh:xp:anon:');}
async function cli(){
 const args=process.argv.slice(2),mode=args.shift();need(['capture','dry-run','apply','verify','verify-credentials'].includes(mode),'reset_arguments_invalid');const opts={};
 while(args.length){const key=args.shift();need(/^--[a-z-]+$/.test(key)&&args.length&&!opts[key.slice(2)],'reset_arguments_invalid');opts[key.slice(2)]=args.shift();}
 need(Object.keys(opts).every(k=>['credentials','old-credentials','scope','scope-sha','output','snapshot','snapshot-sha','manifest-sha','journal'].includes(k)),'reset_arguments_invalid');
 const read=file=>JSON.parse(protectedRead(file));const credentials=read(opts.credentials);
 if(mode==='verify-credentials'){await verifyCredentials(credentials,read(opts['old-credentials']));return {mode,result:'PASS'};}
 const scopeText=protectedRead(opts.scope);need(sha(scopeText)===opts['scope-sha'],'reset_scope_checksum');const scope=JSON.parse(scopeText);
 need(scope.endpointHash===ENDPOINT_HASH&&scope.operations.length===570,'reset_scope_count');
 const old=mode==='dry-run'?null:read(opts['old-credentials']);
 if(old)need(/^[a-f0-9]{64}$/.test(scope.oldCredentialHash||'')&&sha(old.UPSTASH_REDIS_REST_TOKEN)===scope.oldCredentialHash,'reset_old_credential_changed');
 const client=mode==='dry-run'?redisClient(credentials):await verifyCredentials(credentials,old);
 if(mode==='capture'){
  const all=await inventory(client);const expected=new Set(scope.operations.map(r=>r.key));
  need([...all].filter(legacy).every(key=>expected.has(key))&&[...expected].every(key=>all.has(key)),'reset_inventory_changed');
  const records=[];for(const row of scope.operations)records.push(await client.observe(row.key));
  const snapshot={version:1,final:true,endpointHash:ENDPOINT_HASH,records,preservedKeys:[...all].filter(key=>!expected.has(key)).sort()};
  const plan=validateScope(snapshot,scope);const text=JSON.stringify(snapshot);protectedCreate(opts.output,text);
  protectedCreate(opts.output+'.sha256',sha(text)+'\n');return {mode,count:records.length,snapshotHash:sha(text),manifestHash:plan.manifestHash};
 }
 const snapshotText=protectedRead(opts.snapshot);need(sha(snapshotText)===opts['snapshot-sha'],'reset_snapshot_checksum');const snapshot=JSON.parse(snapshotText);
 if(mode==='apply'||mode==='verify')need(snapshot.final===true,'reset_final_capture_required');
 const result=await executeReset({snapshot,scope,manifestHash:opts['manifest-sha'],journal:opts.journal,observe:key=>client.observe(key),command:cmd=>client.command(cmd),apply:mode==='apply'||mode==='verify',verifyOnly:mode==='verify'});
 if(mode==='apply'||mode==='verify'){
  const after=await inventory(client);
  need([...after].filter(legacy).every(key=>scope.operations.some(r=>r.key===key&&r.operation==='SET')),'reset_legacy_reappeared');
 }
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 cli().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({status:'NO-GO',code:/^reset_[a-z_]+$/.test(error.message)?error.message:'reset_io_failed'})+'\n');process.exitCode=1;});
}
