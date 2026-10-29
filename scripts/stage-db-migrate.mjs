import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const STAGE_REF = 'krydukthwdvccggbyjfw';
export const STAGE_SYSTEM = '7656985631720456337';
const REPO = 'krzysztofcal/arcadePlatform';
const FILE = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/;
const HEX = /^[a-f0-9]{64}$/;
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
function check(value, code) { if (!value) throw new Error(code); }
export function validateApproval(a) {
  check(a && /^[a-f0-9]{40}$/.test(a.sourceSha) && Number.isSafeInteger(a.pr) && a.pr > 0, 'invalid_source_approval');
  check(HEX.test(a.historySha256) && Number.isSafeInteger(a.historyCount) && a.historyCount >= 0, 'invalid_history_approval');
  check(Array.isArray(a.migrations) && a.migrations.length <= 100, 'invalid_migration_set');
  check(Object.keys(a).sort().join(',') === 'historyCount,historySha256,migrations,pr,sourceSha', 'unexpected_approval_field');
  const names = a.migrations.map(m => { check(m && FILE.test(m.file) && HEX.test(m.sha256) && Object.keys(m).sort().join(',') === 'file,sha256', 'invalid_migration_approval'); return m.file; });
  check(new Set(names.map(n => n.slice(0,14))).size === names.length && names.join() === [...names].sort().join(), 'unordered_or_duplicate_migrations');
  return a;
}
export const approvalDigest = a => digest(JSON.stringify({ sourceSha:a.sourceSha, pr:a.pr, historyCount:a.historyCount, historySha256:a.historySha256, migrations:a.migrations.map(m=>({file:m.file,sha256:m.sha256})) }));
export const confirmation = a => `APPLY ${STAGE_REF} ${a.sourceSha} ${approvalDigest(a)}`;

// Credentials go to libpq environment only, never argv or child diagnostics.
export function connectionEnv(raw, stageRef) {
  let u; try { u = new URL(raw); } catch { throw new Error('invalid_stage_connection'); }
  check(stageRef === STAGE_REF && ['postgresql:','postgres:'].includes(u.protocol), 'wrong_stage_project');
  check(u.hostname === `db.${STAGE_REF}.supabase.co` && (u.port || '5432') === '5432' && u.username && u.password && u.pathname === '/postgres' && [...u.searchParams.keys()].every(k=>k==='sslmode') && (!u.searchParams.has('sslmode') || ['require','verify-full'].includes(u.searchParams.get('sslmode'))) && !u.hash, 'wrong_stage_connection');
  return { PGHOST:u.hostname, PGPORT:'5432', PGUSER:decodeURIComponent(u.username), PGPASSWORD:decodeURIComponent(u.password), PGDATABASE:'postgres', PGSSLMODE:u.searchParams.get('sslmode')||'require' };
}
export function psql(sql, pg, spawn = spawnSync) {
  const env = { PATH:process.env.PATH, LANG:'C', ...pg, PGCONNECT_TIMEOUT:'10' };
  const r = spawn('psql', ['--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-v','SHOW_CONTEXT=never','-f','-'], { input:sql, encoding:'utf8', env, timeout:300000, maxBuffer:8*1024*1024 });
  // Never print stdout/stderr on failure: SQL, NOTICE/DETAIL and connection errors can contain secrets.
  check(r.status === 0 && !r.error, 'stage_sql_failed');
  const lines = String(r.stdout).trim().split('\n');
  try { return JSON.parse(lines.at(-1)); } catch { throw new Error('invalid_stage_result'); }
}
const historyQuery = `select coalesce(json_agg(row_to_json(h) order by h.version),'[]'::json) from (
 select m.version,f.file,f.sha256 from supabase_migrations.schema_migrations m
 full join supabase_migrations.schema_migration_files f using(version)) h;`;
export function historyDigest(rows) { return digest([...rows].sort((a,b)=>a.version.localeCompare(b.version)).map(r=>`${r.version}:${r.file}:${r.sha256}`).join('\n')); }
export function validateHistory(rows) {
  check(Array.isArray(rows) && rows.every(r=>/^\d{14}$/.test(r.version) && FILE.test(r.file) && r.file.startsWith(r.version+'_') && HEX.test(r.sha256)), 'history_missing_or_drifted');
  check(new Set(rows.map(r=>r.version)).size === rows.length, 'duplicate_history');
}
export function inspect(pg, expectedSystem = STAGE_SYSTEM) {
  const result = psql(`begin transaction read only; set local statement_timeout='15s'; select json_build_object('system',(select system_identifier::text from pg_control_system()),'rows',(${historyQuery.slice(0,-1)})); commit;`, pg);
  check(result.system === expectedSystem, 'wrong_stage_system');
  const rows = result.rows;
  validateHistory(rows);
  return { rows, historyCount:rows.length, historySha256:historyDigest(rows) };
}

// Lex only top-level SQL: quoted/dollar-quoted function bodies and comments stay opaque.
// Approved migrations may have one outer BEGIN/COMMIT; no psql commands or early transaction exit.
export function operationalSql(sql) {
  const tokens = []; let i=0;
  while(i<sql.length) {
    const start=i, c=sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith('--',i)) { i=sql.indexOf('\n',i); if(i<0)i=sql.length; continue; }
    if (sql.startsWith('/*',i)) { let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}check(!depth,'unterminated_sql_comment');continue; }
    check(c!=='\\','psql_commands_forbidden');
    const dollar = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));
    if (dollar) { const end=sql.indexOf(dollar[0],i+dollar[0].length);check(end>=0,'unterminated_sql_quote');i=end+dollar[0].length;tokens.push({word:'quoted',start,end:i});continue; }
    if(c==="'"||c==='"') {const quote=c;i++;let closed=false;while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote){i+=2;continue;}i++;closed=true;break;}check(sql[i]!=='\\','escaped_sql_quote_unsupported');i++;}check(closed,'unterminated_sql_quote');tokens.push({word:'quoted',start,end:i});continue;}
    const word=/^[A-Za-z_][A-Za-z_0-9]*/.exec(sql.slice(i));
    if(word){i+=word[0].length;tokens.push({word:word[0].toLowerCase(),start,end:i});}else{tokens.push({word:c,start,end:++i});}
  }
  if(tokens[0]?.word==='begin') {
    check(tokens[1]?.word===';' && tokens.at(-2)?.word==='commit' && tokens.at(-1)?.word===';', 'unsupported_transaction_wrapper');
    tokens.splice(-2);tokens.splice(0,2);
  }
  let first=true;
  for(const t of tokens){if(first)check(!['begin','start','commit','end','rollback','abort','prepare'].includes(t.word),'transaction_control_forbidden');first=t.word===';';}
  check(tokens.length>0 && tokens.at(-1).word===';', 'incomplete_migration_sql');
  return sql.slice(tokens[0].start,tokens.at(-1).end);
}
export function validateBundle(bundle) {
  const a=validateApproval(bundle.approval);
  check(Array.isArray(bundle.files) && new Set(bundle.files).size===bundle.files.length && bundle.files.every(f=>FILE.test(f)) && new Set(bundle.files.map(f=>f.slice(0,14))).size===bundle.files.length, 'invalid_source_catalog');
  check(bundle.sql.length===a.migrations.length, 'invalid_bundle');
  a.migrations.forEach((m,i)=>{check(bundle.files.includes(m.file) && digest(bundle.sql[i])===m.sha256,'migration_hash_mismatch');operationalSql(bundle.sql[i]);});
  return a;
}
export function planPending(bundle, state) {
  const a=validateBundle(bundle);validateHistory(state.rows);
  const exactBaseline = state.historyCount===a.historyCount && state.historySha256===a.historySha256;
  const originalRows = state.rows.filter(r=>!a.migrations.some(m=>m.file===r.file));
  const alreadyCommitted = a.migrations.length>0 && a.migrations.every(m=>state.rows.some(r=>r.file===m.file && r.sha256===m.sha256)) && originalRows.length===a.historyCount && historyDigest(originalRows)===a.historySha256;
  check(exactBaseline || alreadyCommitted, 'history_approval_mismatch');
  check(state.rows.every(r=>bundle.files.includes(r.file)), 'unknown_remote_migration');
  const done=new Map(state.rows.map(r=>[r.file,r.sha256]));
  for(const m of a.migrations) if(done.has(m.file))check(done.get(m.file)===m.sha256,'applied_hash_mismatch');
  const pending=bundle.files.filter(f=>!done.has(f)).sort();
  const approved=a.migrations.filter(m=>!done.has(m.file));
  check(JSON.stringify(pending)===JSON.stringify(approved.map(m=>m.file)), 'unapproved_pending_migrations');
  return approved;
}
export function applyBundle(bundle, pg, state, operatorConfirmation, expectedSystem=STAGE_SYSTEM) {
  const a=validateBundle(bundle);check(operatorConfirmation===confirmation(a),'operator_confirmation_required');
  const pending=planPending(bundle,state);
  if(!pending.length)return { applied:0, historyCount:state.historyCount, historySha256:state.historySha256 };
  const fingerprint=`select encode(sha256(convert_to(coalesce(string_agg(m.version||':'||f.file||':'||f.sha256,E'\\n' order by m.version),''),'UTF8')),'hex') from supabase_migrations.schema_migrations m full join supabase_migrations.schema_migration_files f using(version)`;
  let sql=`begin; set local lock_timeout='3s'; set local statement_timeout='60s'; set local idle_in_transaction_session_timeout='60s'; set local standard_conforming_strings=on;
select pg_advisory_xact_lock(hashtextextended('arcade-stage-migrations',0));
lock table supabase_migrations.schema_migrations,supabase_migrations.schema_migration_files in share row exclusive mode;
do $guard$ begin
 if (select system_identifier::text from pg_control_system()) <> ${literal(expectedSystem)} then raise exception 'wrong_stage_system'; end if;
 if (select count(*) from supabase_migrations.schema_migrations) <> ${a.historyCount} or (select count(*) from supabase_migrations.schema_migration_files) <> ${a.historyCount}
 or (${fingerprint}) <> ${literal(a.historySha256)} then raise exception 'history_changed'; end if;
end $guard$;\n`;
  for(const m of pending) {
    const index=a.migrations.findIndex(x=>x.file===m.file),match=m.file.match(FILE);
    sql+=operationalSql(bundle.sql[index])+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(match[1])},${literal(match[2])},'{}'::text[]);
insert into supabase_migrations.schema_migration_files(version,name,file,sha256) values(${literal(match[1])},${literal(match[2])},${literal(m.file)},${literal(m.sha256)});\n`;
  }
  const expected=[...state.rows,...pending.map(m=>({version:m.file.slice(0,14),file:m.file,sha256:m.sha256}))];
  // Preserve the existing CH schema/GENESIS smoke inside the committing transaction.
  sql+=`do $smoke$ begin
 if to_regclass('public.chips_accounts') is null or to_regclass('public.chips_transactions') is null or to_regclass('public.chips_entries') is null or to_regtype('public.chips_tx_type') is null then raise exception 'missing_chips_schema'; end if;
 if not exists(select 1 from public.chips_accounts where account_type='SYSTEM' and system_key='GENESIS') then raise exception 'missing_genesis'; end if;
end $smoke$;\n`;
  sql+=`do $guard$ begin if (${fingerprint}) <> ${literal(historyDigest(expected))} then raise exception 'receipt_mismatch'; end if; end $guard$;
commit;
select json_build_object('applied',${pending.length},'historyCount',${expected.length},'historySha256',${literal(historyDigest(expected))});`;
  return psql(sql,pg);
}
async function github(url) {
  const r=await fetch(`https://api.github.com/repos/${REPO}${url}`, {headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2022-11-28'}});
  check(r.ok,'github_read_failed');return r.json();
}
export async function verifySource(a, read=github, env=process.env) {
  check(env.GITHUB_REF==='refs/heads/main' && env.GITHUB_REPOSITORY===REPO && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'trusted_main_required');
  check((await read('/commits/main')).sha===env.GITHUB_SHA,'trusted_main_moved');
  const pr=await read(`/pulls/${a.pr}`);
  check(pr.state==='open' && pr.head.repo?.full_name===REPO && pr.head.sha===a.sourceSha,'source_pr_changed_or_untrusted');
}
export async function prepare(a, read=github, env=process.env) {
  validateApproval(a);await verifySource(a,read,env);
  const tree=await read(`/git/trees/${a.sourceSha}?recursive=1`);check(!tree.truncated,'source_tree_truncated');
  const entries=tree.tree.filter(e=>e.path.startsWith('supabase/migrations/')&&e.path.endsWith('.sql'));
  check(entries.every(e=>e.type==='blob' && e.mode==='100644' && FILE.test(e.path.slice('supabase/migrations/'.length))),'invalid_source_migration');
  const sql=[];
  for(const m of a.migrations){const entry=entries.find(e=>e.path===`supabase/migrations/${m.file}`);check(entry,'approved_file_missing');const blob=await read(`/git/blobs/${entry.sha}`);check(blob.encoding==='base64','unsupported_blob');const bytes=Buffer.from(blob.content,'base64');check(digest(bytes)===m.sha256,'migration_hash_mismatch');sql.push(bytes.toString('utf8'));}
  const bundle={approval:a,files:entries.map(e=>e.path.slice('supabase/migrations/'.length)).sort(),sql};validateBundle(bundle);return bundle;
}
async function main() {
  const args=process.argv.slice(2);check(args.length===1 && ['--prepare','--inspect','--apply'].includes(args[0]),'explicit_mode_required');
  const file=process.env.STAGE_MIGRATION_BUNDLE;check(file,'bundle_path_required');
  if(args[0]==='--prepare') {const a=validateApproval(JSON.parse(process.env.STAGE_MIGRATION_APPROVAL||'null'));const b=await prepare(a);fs.writeFileSync(file,JSON.stringify(b),{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify({approvalSha256:approvalDigest(a),confirmation:confirmation(a)})+'\n');return;}
  const b=JSON.parse(fs.readFileSync(file,'utf8'));validateBundle(b);await verifySource(b.approval);
  const pg=connectionEnv(process.env.SUPABASE_STAGE_DB_URL,process.env.SUPABASE_STAGE_PROJECT_REF);
  const state=inspect(pg);
  if(args[0]==='--inspect'){process.stdout.write(JSON.stringify({historyCount:state.historyCount,historySha256:state.historySha256,history:state.rows,pending:b.files.filter(f=>!state.rows.some(r=>r.file===f))})+'\n');return;}
  const result=applyBundle(b,pg,state,process.env.STAGE_MIGRATION_CONFIRMATION);
  const after=inspect(pg);check(after.historyCount===result.historyCount && after.historySha256===result.historySha256,'postflight_mismatch');
  process.stdout.write(JSON.stringify({status:'COMMITTED_OR_VERIFIED_NOOP',...result})+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{const code=/^[a-z_]{1,64}$/.test(error?.message||'')?error.message:'operation_failed';process.stderr.write(`Stage operation refused: ${code}; no automatic retry. Verify transaction outcome by independent inspect. No SQL/connection diagnostics printed.\n`);process.exitCode=1;});
