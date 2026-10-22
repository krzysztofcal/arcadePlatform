// Runs only inside the existing explicitly authorized disposable PostgreSQL harness.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import postgres from 'postgres';
import { postTransaction } from '../../netlify/functions/_shared/chips-ledger.mjs';
import { claimBonusCampaign } from '../../netlify/functions/_shared/bonus-campaigns.mjs';
import { claimWelcomeBonus } from '../../netlify/functions/_shared/welcome-bonus.mjs';
import { createPendingUpload, finalizeAvatar } from '../../netlify/functions/_shared/profile-avatar.mjs';

const canonicalId='7575202818581710058';
const normalize=value=>JSON.parse(JSON.stringify(value));
export async function assertProductionDeletionCompatibility({runMigration,migrationFiles}) {
 // Schema recreation changes enum OIDs; a fresh driver must not reuse old plans.
 const sql=postgres(process.env.CHIPS_MIGRATIONS_TEST_DB_URL,{max:1,prepare:false});
 try {
 await sql.unsafe("set chips.production_project_ref='otbqfijerkieoxwpxjnm'");
 const files=fs.readdirSync('supabase/production-migrations').filter(f=>f.endsWith('_account_deletion_production_compatibility.sql'));
 assert.equal(files.length,1,'One Production-equivalent migration is required');
 const [identity]=await sql`select system_identifier::text from pg_control_system()`;
 const fixtureSQL=file=>fs.readFileSync(path.join('supabase/production-migrations',file),'utf8').replaceAll(canonicalId,identity.system_identifier);
 // Complete the existing E1/E2/E3 fixture to the reviewed 65-version schema.
 for(const file of ['20261003183626_poker_demand_refill_production_contract.sql','20261004222426_poker_gift_purchases_production_contract.sql'])await sql.unsafe(fixtureSQL(file));
 // Final P4 schema only: no pg_cron installation/job in this isolated harness.
 await sql.unsafe('drop function public.poker_bot_pool_refill_hourly()');
 for(const v of ['20261011200000','20261012095657'])await runMigration(sql,migrationFiles.find(f=>f.startsWith(v+'_')));
 const manifest=JSON.parse(fs.readFileSync('supabase/production-migrations/manifest.json'));
 const versions=[...manifest.baseline_applied.map(x=>x.version),...manifest.replacement_migrations.filter(x=>x.file.split('_')[0]<'20261021191104').map(x=>x.file.split('_')[0]),'20261011200000','20261012095657'];
 await sql`insert into supabase_migrations.schema_migrations(version) select unnest(${versions}::text[]) on conflict do nothing`;
 assert.equal(Number((await sql`select count(*) n from supabase_migrations.schema_migrations`)[0].n),65);
 const current={claimBonusCampaign,claimWelcomeBonus,createPendingUpload,finalizeAvatar};
 const oldDir=process.env.CHIPS_PRODUCTION_COMPAT_OLD_RUNTIME_DIR;
 let old=current;
 if(oldDir){
  assert.equal(execFileSync('git',['-C',oldDir,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'82aee39d5b0bd006e72a199cc89963beaf5665c1');
  const load=async name=>import(pathToFileURL(path.join(oldDir,'netlify/functions/_shared',name+'.mjs')));
  old={...await load('bonus-campaigns'),...await load('welcome-bonus'),...await load('profile-avatar')};
 }
 const deps={env:{ACCOUNT_DELETION_ENABLED:'0',ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED:'0',WELCOME_BONUS_START_AT:'2020-01-01'},executeSql:(q,p=[])=>sql.unsafe(q,p),beginSql:fn=>sql.begin(fn)};
 const user=async()=>{const id=randomUUID();await sql`insert into auth.users(id,created_at,is_anonymous) values(${id},now(),false)`;return id;};
 const campaign=async(code,max=10)=>{const [r]=await sql`insert into bonus_campaigns(code,title,campaign_type,amount,status,starts_at,eligibility_type,claim_policy,max_total_claims,created_by) values(${code},'Compatibility','other',25,'active','2020-01-01','all_accounts','once',${max},'00000000-0000-4000-8000-000000000001') returning id`;return r.id;};
 await sql`insert into chips_accounts(account_type,system_key,balance) values('SYSTEM','GENESIS',0)`;
 const codes=['pc-history-a','pc-history-b'];const campaigns=await Promise.all(codes.map(code=>campaign(code)));
 const users=[];
 for(let i=0;i<5;i++){
  const uid=await user();users.push(uid);
  if(oldDir)assert.equal((await old.claimBonusCampaign(uid,codes[i%2],deps)).claimed,true);
  else await sql.begin(async tx=>{
   const campaignId=campaigns[i%2],key='bonus:'+codes[i%2]+':'+uid,metadata={campaign_id:campaignId,claim_period_key:'once'};
   const result=await postTransaction({userId:uid,txType:'PROMO_BONUS',idempotencyKey:key,metadata,tx,entries:[{accountType:'SYSTEM',systemKey:'GENESIS',amount:-25,metadata:{...metadata,entry_role:'debit'}},{accountType:'USER',userId:uid,amount:25,metadata:{...metadata,entry_role:'credit'}}]});
   await tx`insert into bonus_claims(campaign_id,user_id,transaction_id,idempotency_key,claim_period_key,metadata) values(${campaignId},${uid},${result.transaction.id},${key},'once',${JSON.stringify(metadata)})`;
  });
 }
 // All 5 real claims bind hot/registry receipts; do not manufacture metadata.
 const escrowKey='POKER_TABLE:'+randomUUID();await sql`insert into chips_accounts(account_type,system_key,balance) values('ESCROW',${escrowKey},0)`;
 const snapshot=async()=>({accounts:normalize(await sql`select to_jsonb(a) value from chips_accounts a order by id`),transactions:normalize(await sql`select to_jsonb(t) value from chips_transactions t order by id`),entries:normalize(await sql`select to_jsonb(e) value from chips_entries e order by id`),registry:normalize(await sql`select to_jsonb(r) value from chips_transaction_idempotency r order by idempotency_key`),archives:normalize(await sql`select to_jsonb(b) value from chips_ledger_archive_batches b order by batch_id`)});
 const before=await snapshot();const [wrapper]=await sql`select pg_get_functiondef('public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure) definition`;
 const originalRoutines=await sql`select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean)'::regprocedure,'public.chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'::regprocedure)`;
 const originalPermissions=normalize(await sql`select roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor`);
 const migration=fixtureSQL(files[0]);
 await assert.rejects(()=>sql.unsafe(migration),/identity\/confirmation mismatch/);await sql.unsafe('rollback');
 await sql.unsafe("set chips.production_deletion_compatibility_confirmation='INSTALL ACCOUNT DELETION COMPATIBILITY otbqfijerkieoxwpxjnm'");
 // Unmodified Production hashes must match before patching; test drift atomically.
 await sql.begin(async tx=>{const original=originalRoutines.find(r=>r.signature.includes('boolean,boolean)')).definition;await tx.unsafe(original.replace('declare','declare /* drift */'));await assert.rejects(()=>tx.savepoint(sp=>sp.unsafe(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,''))),/routine drift/);await tx.unsafe(original);});
 // A failure after all DDL/counter work must restore the exact baseline.
 const lateFailure=migration.replace(/^commit;$/m,'select 1/0;commit;');
 await assert.rejects(()=>sql.unsafe(lateFailure),error=>error.code==='22012');await sql.unsafe('rollback');
 assert.deepEqual(await snapshot(),before);assert.equal((await sql`select to_regclass('public.account_deletion_requests') x`)[0].x,null);
 assert.deepEqual(normalize(await sql`select roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor`),originalPermissions);
 await sql.unsafe(migration);
 const after=await snapshot();
 // New nullable retirement columns do not rewrite financial values or history.
 after.accounts=after.accounts.map(x=>{delete x.value.retired_user_id;delete x.value.retired_at;return x;});assert.deepEqual(after,before);
 assert.deepEqual(normalize(await sql`select roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor`),originalPermissions);
 assert.equal((await sql`select pg_get_functiondef('public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure) definition`)[0].definition,wrapper.definition);
 const patches=[...migration.matchAll(/needle text := \$needle\$(.*?)\$needle\$;\s*replacement text := \$replacement\$(.*?)\$replacement\$;/gs)];assert.equal(patches.length,2);
 for(const [index,signature] of ['chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean)','chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'].entries()){
  const original=originalRoutines.find(r=>r.signature===signature).definition;
  const [now]=await sql`select pg_get_functiondef(to_regprocedure(${signature})) definition`;
  assert.equal(now.definition,original.replaceAll(patches[index][1],patches[index][2]),'retention changes only the reviewed predicate');
 }

 const {createAccountDeleteHandler}=await import('../../netlify/functions/account-delete.mjs');
 const denied=await createAccountDeleteHandler({env:{ACCOUNT_DELETION_ENABLED:'0'},beginSql:()=>{throw new Error('OFF must not query');}})({httpMethod:'GET',headers:{}});assert.equal(denied.statusCode,503);
 const {createAccountDeletionRuntime}=await import('../../ws-server/poker/runtime/account-deletion.mjs');
 await createAccountDeletionRuntime({env:{ACCOUNT_DELETION_ENABLED:'0'},beginSql:()=>{throw new Error('OFF worker must not query');}}).tick();
 const [{enabled}]=await sql`select enabled from account_deletion_release`;assert.equal(enabled,false);
 assert.equal((await sql`select tgenabled from pg_trigger where tgname='account_avatar_manifest_guard_v3'`)[0].tgenabled,'D');
 assert.equal((await sql`select private.account_avatar_guards_ready() ready`)[0].ready,false);
 assert.equal((await sql`select to_regclass('private.account_reward_config') x`)[0].x,null);
 assert.deepEqual(normalize(await sql`select paid_count::int n from private.bonus_campaign_paid_totals where campaign_id=any(${campaigns}::uuid[]) order by paid_count`),[{n:2},{n:3}]);
 for(const r of new Set([old,current])){
  assert.equal((await r.claimBonusCampaign(users[0],codes[0],deps)).claimed,false);
  const uid=await user();const first=await r.claimWelcomeBonus(uid,deps);assert.equal(first.claimed,true);assert.equal((await r.claimWelcomeBonus(uid,deps)).claimed,false);
  const freshCode='pc-'+randomUUID();await campaign(freshCode,1);const a=await r.claimBonusCampaign(uid,freshCode,deps);assert.equal(a.claimed,true);assert.equal((await r.claimBonusCampaign(await user(),freshCode,deps)).claimed,false);
  const image=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();let output;
  const avatarDeps={...deps,storageConfig:{baseUrl:'https://fixture.supabase.co',serviceKey:'fixture'},fetch:async(url,options={})=>{
   if(url.includes('/upload/sign/'))return new Response(JSON.stringify({url:'/object/upload/sign/profile-avatar-uploads/pending/test?token=fixture'}),{status:200});
   if(options.method==='GET')return new Response(image,{status:200,headers:{'content-type':'image/png'}});
   if(options.method==='POST')output=url;return new Response('[]',{status:200});
  }};
  const pending=await r.createPendingUpload(uid,{mimeType:'image/png',size:image.length},avatarDeps);assert(pending.uploadId);await r.finalizeAvatar(uid,pending.uploadId,avatarDeps);assert(output);assert((await sql`select avatar_key from user_profiles where user_id=${uid}`)[0].avatar_key);
 }
 assert.deepEqual(normalize(await sql`select paid_count::int n from private.bonus_campaign_paid_totals where campaign_id=any(${campaigns}::uuid[]) order by paid_count`),[{n:2},{n:3}]);
 const uid=users[0],other=users[1];await sql`insert into favorites(user_id,game_id) values(${uid},'compat-own'),(${other},'compat-other')`;
 await sql.unsafe("create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated;grant select on public.favorites to authenticated");
 await sql.begin(async tx=>{await tx`select set_config('request.jwt.claim.sub',${uid},true)`;await tx.unsafe('set local role authenticated');const f=await tx`select game_id from favorites`;assert(f.some(x=>x.game_id==='compat-own'));assert(!f.some(x=>x.game_id==='compat-other'));});
 await sql.begin(async tx=>{
  const retired=randomUUID();await tx.unsafe("set local session_replication_role='replica'");
  // Synthetic final row shape only; no deletion request/BURN/Auth action.
  await tx`insert into chips_accounts(account_type,retired_user_id,retired_at,status,balance) values('USER',${retired},now(),'closed',0)`;
  await tx.unsafe("set local session_replication_role='origin'");
  assert.equal((await tx`select public.chips_retention_user_matches_v2(a,${retired}) ok from chips_accounts a where retired_user_id=${retired}`)[0].ok,true);
  assert.equal((await tx`select public.chips_retention_user_matches_v2(a,${users[0]}) ok from chips_accounts a where user_id=${users[0]}`)[0].ok,true);
  await assert.rejects(()=>tx.savepoint(sp=>sp`update chips_accounts set balance=1 where retired_user_id=${retired}`),error=>error.code==='23514');
  throw Object.assign(new Error('fixture rollback'),{fixtureRollback:true});
 }).catch(e=>{if(!e.fixtureRollback)throw e;});
 const changed=await sql`select pg_get_functiondef('public.chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'::regprocedure) definition`;
 assert.equal((changed[0].definition.match(/md5\(pg_catalog.pg_get_functiondef/g)||[]).length,2);
 const predicate=changed[0].definition.match(/exists\(select 1 from pg_catalog.pg_trigger triggers.*?\) then/s)[0].replace(/\) then$/,' )');
 assert.equal((await sql.unsafe('select '+predicate+' bad'))[0].bad,false);
 await sql.begin(async tx=>{await tx.unsafe("create function public.compat_unknown_delete() returns trigger language plpgsql as $$begin return old;end$$;create trigger compat_unknown before delete on chips_accounts for each row execute function public.compat_unknown_delete()");assert.equal((await tx.unsafe('select '+predicate+' bad'))[0].bad,true);throw Object.assign(new Error('fixture rollback'),{fixtureRollback:true});}).catch(e=>{if(!e.fixtureRollback)throw e;});
 assert.equal(Number((await sql`select count(*) n from (select transaction_id from chips_entries group by transaction_id having sum(amount)<>0)x`)[0].n),0);
 await assert.rejects(()=>sql.unsafe(migration),/migration history drift/);await sql.unsafe('rollback');
 // #1132: one forward-only schema-only equivalent against the reconstructed Production 66.
 const policyFile='20261022091126_account_avatar_known_capability_policy.sql';
 const policy=fixtureSQL(policyFile);
 const catalog=async()=>normalize({
  routines:await sql`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind in ('f','p') order by 1`,
  triggers:await sql`select tgrelid::regclass::text relation,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by 1,2`,
  policies:await sql`select * from pg_policies where schemaname in ('public','private') order by schemaname,tablename,policyname`,
  relations:await sql`select c.oid::regclass::text relation,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') order by 1`
 });
 const policyBefore=await catalog(),financeBefore=await snapshot();
 await assert.rejects(()=>sql.unsafe(policy),/identity\/confirmation mismatch/);await sql.unsafe('rollback');
 await sql.unsafe("set chips.production_avatar_risk_confirmation='INSTALL AVATAR KNOWN CAPABILITY POLICY otbqfijerkieoxwpxjnm'");
 const signature='private.account_avatar_prepare_purge(uuid,uuid,bigint,text)';
 const original=policyBefore.routines.find(r=>r.signature===signature).definition;
 await sql.begin(async tx=>{
  await tx.unsafe(original.replace('declare','declare /* fixture drift */'));
  await assert.rejects(()=>tx.savepoint(sp=>sp.unsafe(policy.replace(/^begin;$/m,'').replace(/^commit;$/m,''))),/function drift/);
  await tx.unsafe(original);
 });
 await assert.rejects(()=>sql.unsafe(policy.replace(/^commit;$/m,'select 1/0;commit;')),error=>error.code==='22012');await sql.unsafe('rollback');
 assert.deepEqual(await catalog(),policyBefore);assert.deepEqual(await snapshot(),financeBefore);
 await sql.unsafe(policy);
 const policyAfter=await catalog();
 assert.deepEqual(policyAfter.triggers,policyBefore.triggers);assert.deepEqual(policyAfter.policies,policyBefore.policies);assert.deepEqual(policyAfter.relations,policyBefore.relations);
 assert.deepEqual(await snapshot(),financeBefore);
 const substitutions=new Map([
  ['private.account_avatar_manifest_reconciled(uuid,uuid,uuid)',["c.cutover_at+interval '7200 seconds'<=clock_timestamp()","private.account_avatar_safe_after(c.marker)<=clock_timestamp()"]],
  ['private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text)',["cut.cutover_at+interval '7200 seconds'>clock_timestamp()","coalesce(private.account_avatar_safe_after(marker_key)>clock_timestamp(),true)"]],
  [signature,["cut.cutover_at+interval '7200 seconds'>clock_timestamp()","coalesce(private.account_avatar_safe_after(marker_key)>clock_timestamp(),true)"]]
 ]);
 for(const routine of policyBefore.routines){
  const expected={...routine};const patch=substitutions.get(routine.signature);if(patch)expected.definition=expected.definition.replace(...patch);
  assert.deepEqual(policyAfter.routines.find(r=>r.signature===routine.signature),expected,'only the three exact time predicates may change; ownership/ACL remain identical');
 }
 assert.equal(policyAfter.routines.length,policyBefore.routines.length+1);
 for(const role of ['anon','authenticated','service_role']){
  const [rights]=await sql`select has_column_privilege(${role},'private.avatar_tracking_cutover','unobserved_capability_risk_accepted_at','UPDATE') can_update,has_table_privilege(${role},'private.avatar_tracking_cutover','INSERT,UPDATE,DELETE,TRUNCATE') can_write`;
  assert.deepEqual(rights,{can_update:false,can_write:false});
  await sql.begin(async tx=>{
   await tx.unsafe('set local role '+role);
   await assert.rejects(()=>tx.savepoint(sp=>sp.unsafe("update private.avatar_tracking_cutover set unobserved_capability_risk_accepted_at=statement_timestamp()")),error=>error.code==='42501');
   if(role!=='service_role')await assert.rejects(()=>tx.savepoint(sp=>sp.unsafe("select private.account_avatar_safe_after('fixture')")),error=>error.code==='42501');
  });
 }
 await sql`insert into private.avatar_tracking_cutover(marker,cutover_at,legacy_inventory_verified,upload_bucket,public_bucket) values('policy-fixture',statement_timestamp(),true,'profile-avatar-uploads','profile-avatars')`;
 assert.equal((await sql`select private.account_avatar_safe_after(marker)-cutover_at=interval '7200 seconds' delayed from private.avatar_tracking_cutover where marker='policy-fixture'`)[0].delayed,true);
 await sql`update private.avatar_tracking_cutover set unobserved_capability_risk_accepted_at=statement_timestamp() where marker='policy-fixture'`;
 assert.equal((await sql`select private.account_avatar_safe_after(marker)=cutover_at waived from private.avatar_tracking_cutover where marker='policy-fixture'`)[0].waived,true);
 await sql`delete from private.avatar_tracking_cutover where marker='policy-fixture'`;
 assert.equal(Number((await sql`select count(*) n from supabase_migrations.schema_migrations`)[0].n),67);
 assert.equal((await sql`select enabled from public.account_deletion_release`)[0].enabled,false);
 assert.equal((await sql`select tgenabled from pg_trigger where tgname='account_avatar_manifest_guard_v3'`)[0].tgenabled,'D');
 await assert.rejects(()=>sql.unsafe(policy),/history drift/);await sql.unsafe('rollback');
 process.stdout.write('[klog] production_avatar_policy '+JSON.stringify({history:67,changedTimePredicates:3,newReadOnlyFunction:1,financialHistoryUnchanged:true,existingAclTriggersRlsUnchanged:true,apiRolesCannotAcceptRisk:true,backendSharesOwnerPrincipal:true,deletion:false,avatarV3:'DISABLED'})+'\n');
 process.stdout.write('[klog] production_deletion_compatibility '+JSON.stringify({migration:true,history:66,oldRuntime:oldDir?'executed':'SQL writer contract',newRuntime:'executed',deletion:false,avatarV3:'DISABLED',historicalPromo:5,historyRepaid:0,financialHistoryUnchanged:true,wrapperUnchanged:true,rls:true,legacyAvatar:true,unknownTriggerRejected:true})+'\n');
 } finally {await sql.end({timeout:1});const oldDir=process.env.CHIPS_PRODUCTION_COMPAT_OLD_RUNTIME_DIR;if(oldDir){const admin=await import(pathToFileURL(path.join(oldDir,'netlify/functions/_shared/supabase-admin.mjs')));await admin.closeSql?.();}}
}
