import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
test('migration validation never receives Stage credentials',()=>{
 const s=read('.github/workflows/db-migration-check.yml');
 assert.match(s,/node scripts\/check-db-migrations.mjs/);
 assert.doesNotMatch(s,/SUPABASE_STAGE_DB_URL|stage-db-migrate\.mjs --apply/);
});
test('Stage mutation is dispatch-only from trusted main, with approved SQL data only',()=>{
 const s=read('.github/workflows/db-stage-apply-pr.yml');
 assert.match(s,/workflow_dispatch:/);assert.doesNotMatch(s,/pull_request:|pull_request_target:/);
 assert.match(s,/github.ref == 'refs\/heads\/main'/);assert.match(s,/ref: \$\{\{ github.sha \}\}/);
 assert.match(s,/persist-credentials: false/);assert.match(s,/group: db-stage/);assert.match(s,/cancel-in-progress: false/);
 assert.match(s,/--prepare/);assert.match(s,/--apply/);assert.match(s,/SUPABASE_STAGE_DIRECT_DB_URL/);
 assert.doesNotMatch(s,/ref: \$\{\{ inputs\./);assert.doesNotMatch(s,/npm (ci|install)/);
 assert.equal(fs.existsSync('.github/workflows/db-stage-prepare.yml'),false,'unsafe alternate Stage executor must be retired');
});

import { spawnSync, spawn } from 'node:child_process';
import { digest, approvalDigest, confirmation, validateApproval, connectionEnv, psql, historyDigest, inspect, operationalSql, planPending, applyBundle, prepare } from '../scripts/stage-db-migrate.mjs';
const sourceSha='a'.repeat(40);
function bundle(sqls, rows=[]) {
 const names=sqls.map((_,i)=>`2099010${rows.length ? 2 : 1}00000${i}_fixture.sql`);
 return {approval:{sourceSha,pr:1,historyCount:rows.length,historySha256:historyDigest(rows),migrations:names.map((file,i)=>({file,sha256:digest(sqls[i])}))},files:[...rows.map(r=>r.file),...names].sort(),sql:sqls};
}
test('approval/hash/pending/transaction boundaries fail closed',()=>{
 const b=bundle(['begin; create table fixture(id int); commit;']);
 assert.equal(validateApproval(b.approval),b.approval);assert.match(approvalDigest(b.approval),/^[a-f0-9]{64}$/);
 assert.equal(operationalSql(b.sql[0]),'create table fixture(id int);');
 assert.match(operationalSql("begin; do $$ begin perform 1; end $$; commit;"),/do \$\$/);
 for(const sql of ['select 1; commit; select 2;','\\! echo unsafe','begin; select 1; rollback;','begin; commit; begin; select 1; commit;'])assert.throws(()=>operationalSql(sql));
 const state={rows:[],historyCount:0,historySha256:historyDigest([])};
 assert.equal(planPending(b,state).length,1);
 assert.throws(()=>planPending({...b,sql:['select 42;']},state),/hash/);
 assert.throws(()=>planPending({...b,files:[...b.files,'20990201000000_unapproved.sql']},state),/unapproved_pending/);
 assert.throws(()=>planPending(b,{...state,historySha256:'0'.repeat(64)}),/history_approval/);
 assert.throws(()=>applyBundle(b,{},state,'wrong'),/operator_confirmation/);
});
test('connection is exact Stage; no password URL/SQL output reaches process args or diagnostics',()=>{
 const raw='postgresql://postgres:sentinel_password@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres';
 const env=connectionEnv(raw,'krydukthwdvccggbyjfw');assert.equal(env.PGPASSWORD,'sentinel_password');assert.equal(connectionEnv(raw+'?sslmode=require','krydukthwdvccggbyjfw').PGSSLMODE,'require');
 for(const x of [raw.replace('krydukthwdvccggbyjfw','otbqfijerkieoxwpxjnm'),raw+'?host=other',raw.replace(':5432',':6543')])assert.throws(()=>connectionEnv(x,'krydukthwdvccggbyjfw'));
 let captured;assert.throws(()=>psql('select secret;',env,(bin,args,opts)=>{captured={bin,args,opts};return {status:1,stdout:'sentinel_password',stderr:raw};}),/^Error: stage_sql_failed$/);
 assert.equal(captured.bin,'psql');assert.ok(!JSON.stringify(captured.args).includes('sentinel_password'));assert.ok(!captured.args.includes(raw));assert.equal(captured.opts.env.PGPASSWORD,'sentinel_password');assert.equal(captured.opts.input,'select secret;');
});
const dbUrl=process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
const consent=process.env.STAGE_MIGRATION_DISPOSABLE_CONFIRMATION;
test('disposable PostgreSQL: read-only missing metadata, exact batch receipts, rollback/noop/identity/locks', {skip:!dbUrl||consent!=='I_CONFIRM_LOCAL_DISPOSABLE_STAGE_CONTRACT'},async()=>{
 const u=new URL(dbUrl);assert.ok(['127.0.0.1','localhost'].includes(u.hostname),'no remote test DB');
 const admin={PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGSSLMODE:'disable'};
 const identity=psql("select json_build_object('id',(select system_identifier::text from pg_control_system()),'version',current_setting('server_version_num')::int);",admin);assert.ok(identity.version>=160000);assert.ok(!['7656985631720456337','7575202818581710058'].includes(identity.id));
 if(process.env.CHIPS_MIGRATIONS_EXPECTED_SYSTEM_IDENTIFIER)assert.equal(identity.id,process.env.CHIPS_MIGRATIONS_EXPECTED_SYSTEM_IDENTIFIER);
 const database=`stage_apply_contract_${process.pid}`;
 function execute(sql,pg=admin){const r=spawnSync('psql',['--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','-f','-'],{env:{PATH:process.env.PATH,...pg},input:sql,encoding:'utf8'});assert.equal(r.status,0,'disposable fixture SQL failed');return r.stdout;}
 execute(`create database ${database};`);const pg={...admin,PGDATABASE:database};
 assert.throws(()=>inspect(pg,identity.id),/stage_sql_failed/);assert.equal(psql("select json_build_object('exists',to_regnamespace('supabase_migrations') is not null);",pg).exists,false);
 execute(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);create table supabase_migrations.schema_migration_files(version text primary key,name text,file text,sha256 text not null,recorded_at timestamptz default now());create type public.chips_tx_type as enum('TEST');create table public.chips_transactions(id int);create table public.chips_entries(id int);create table public.chips_accounts(account_type text,system_key text);insert into public.chips_accounts values('SYSTEM','GENESIS');create table protected_state(id int primary key, ch bigint, xp bigint, avatar text, privacy boolean, poker jsonb);insert into protected_state values(1,123,456,'comet-blue',false,'{"stack":100,"stateVersion":7}');`,pg);
 const protectedBefore=psql('select row_to_json(p) from protected_state p;',pg);
 const empty=inspect(pg,identity.id);assert.equal(empty.historySha256,historyDigest([]));
 const bad=bundle(['begin; create table should_rollback(id int); commit;','begin; do $$ begin raise exception \'late failure\'; end $$; commit;']);
 assert.throws(()=>applyBundle(bad,pg,empty,confirmation(bad.approval),identity.id),/stage_sql_failed/);
 assert.deepEqual(inspect(pg,identity.id),empty);assert.equal(psql("select json_build_object('exists',to_regclass('should_rollback') is not null);",pg).exists,false);
 const badSmoke=bundle(["begin; delete from public.chips_accounts where system_key='GENESIS'; create table smoke_rollback(id int); commit;"]);
 assert.throws(()=>applyBundle(badSmoke,pg,empty,confirmation(badSmoke.approval),identity.id),/stage_sql_failed/);assert.deepEqual(inspect(pg,identity.id),empty);assert.equal(psql("select json_build_object('n',count(*)) from public.chips_accounts where system_key='GENESIS';",pg).n,1);
 const good=bundle(['begin; create table approved_one(id int); commit;','create table approved_two(id int);']);
 const out=applyBundle(good,pg,empty,confirmation(good.approval),identity.id);assert.equal(out.applied,2);
 const after=inspect(pg,identity.id);assert.equal(after.rows.length,2);assert.equal(after.rows[0].sha256,good.approval.migrations[0].sha256);assert.equal(after.rows[1].sha256,good.approval.migrations[1].sha256);assert.deepEqual(psql('select row_to_json(p) from protected_state p;',pg),protectedBefore);
 assert.equal(applyBundle(good,pg,after,confirmation(good.approval),identity.id).applied,0);
 const noop={...good,approval:{...good.approval,historyCount:2,historySha256:after.historySha256}};assert.equal(applyBundle(noop,pg,after,confirmation(noop.approval),identity.id).applied,0);assert.deepEqual(inspect(pg,identity.id),after);
 assert.throws(()=>inspect(pg,'wrong-system'),/wrong_stage_system/);
 const next=bundle(['create table never_applied(id int);'],after.rows);const changed={...after,historySha256:'f'.repeat(64)};assert.throws(()=>planPending(next,changed),/history_approval/);
 // Competing DDL/history lock is bounded and must not create a receipt/table.
 const blocker=spawn('psql',['--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','-f','-'],{env:{PATH:process.env.PATH,...pg},stdio:['pipe','pipe','pipe']});
 const ready=new Promise((resolve,reject)=>{blocker.stdout.on('data',b=>{if(b.toString().includes('locked'))resolve();});blocker.on('error',reject);blocker.on('close',()=>reject(new Error('fixture lock holder closed before ready')));});
 blocker.stdin.write("begin; lock table supabase_migrations.schema_migrations in access exclusive mode; select 'locked';\n");await ready;
 try{assert.throws(()=>applyBundle(next,pg,after,confirmation(next.approval),identity.id),/stage_sql_failed/);}finally{const closed=new Promise(resolve=>blocker.on('close',resolve));blocker.stdin.end('rollback;\n');await closed;}
 assert.deepEqual(inspect(pg,identity.id),after);
 // Snapshot drifts after initial inspect: transaction guard must still roll back.
 execute("update supabase_migrations.schema_migration_files set sha256=repeat('f',64) where version='20990101000000';",pg);
 assert.throws(()=>applyBundle(next,pg,after,confirmation(next.approval),identity.id),/stage_sql_failed/);assert.equal(psql("select json_build_object('exists',to_regclass('never_applied') is not null);",pg).exists,false);
 process.stdout.write(`Disposable PostgreSQL ${Math.floor(identity.version/10000)}: exact batch/rollback/receipts/protected data PASS\n`);
});

test('prepare reads trusted main executor and only approved SQL blobs, refusing fork/head drift',async()=>{
 const b=bundle(['select 1;']);const a=b.approval;const calls=[];const env={GITHUB_REF:'refs/heads/main',GITHUB_SHA:'b'.repeat(40),GITHUB_REPOSITORY:'krzysztofcal/arcadePlatform'};
 const read=async path=>{calls.push(path);if(path==='/commits/main')return {sha:env.GITHUB_SHA};if(path==='/pulls/1')return {state:'open',head:{sha:sourceSha,repo:{full_name:env.GITHUB_REPOSITORY}}};if(path.startsWith('/git/trees/'))return {truncated:false,tree:[{path:'supabase/migrations/'+a.migrations[0].file,type:'blob',mode:'100644',sha:'c'.repeat(40)},{path:'scripts/stage-db-migrate.mjs',type:'blob',mode:'100644',sha:'d'.repeat(40)}]};if(path==='/git/blobs/'+'c'.repeat(40))return {encoding:'base64',content:Buffer.from(b.sql[0]).toString('base64')};throw Error('unapproved_download');};
 const prepared=await prepare(a,read,env);assert.deepEqual(prepared.sql,b.sql);assert.equal(calls.filter(p=>p.startsWith('/git/blobs/')).length,1);assert.ok(!calls.some(p=>p.includes('d'.repeat(40))));
 await assert.rejects(prepare(a,read,{...env,GITHUB_REF:'refs/heads/untrusted'}),/trusted_main/);
 await assert.rejects(prepare(a,async path=>path==='/pulls/1'?{state:'open',head:{sha:sourceSha,repo:{full_name:'fork/repo'}}}:read(path),env),/source_pr/);
 await assert.rejects(prepare(a,async path=>path==='/pulls/1'?{state:'open',head:{sha:'e'.repeat(40),repo:{full_name:env.GITHUB_REPOSITORY}}}:read(path),env),/source_pr/);
});
