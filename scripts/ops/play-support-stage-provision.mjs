import { createHash, createHmac, pbkdf2Sync, randomBytes, X509Certificate } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface as lines } from 'node:readline';
import { createInterface as prompts } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { playSupportStageConnection } from '../../netlify/functions/_shared/play-support-db.mjs';

const PROJECT = 'krydukthwdvccggbyjfw';
const POOLER = 'aws-0-eu-west-3.pooler.supabase.com';
const WRITER = 'play_support_writer';
const SITE = 'f7e19a84-28f7-41f7-978a-f3b4552a404d';
const ACCOUNT = '68f2ba461a0b7c140142b210';
const BRANCH = 'codex/1285-play-support-rtdn-entry';
const SHA = '694c689dd08dbbf71d2a69daef81d20ccded4148';
const REPO = 'krzysztofcal/arcadePlatform';
const KEY = 'PLAY_SUPPORT_DB_URL';
const LOCK = [1356, 1285];
const VALIDATOR = 'netlify/functions/_shared/play-support-db.mjs';

function requireState(condition, code) {
  if (!condition) throw new Error(code);
}

export function scramVerifier(password) {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const mac = label => createHmac('sha256', salted).update(label).digest();
  const stored = createHash('sha256').update(mac('Client Key')).digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${mac('Server Key').toString('base64')}`;
}

function valueId(entry) {
  requireState(entry?.key === KEY && entry.is_secret === true &&
    Array.isArray(entry.scopes) && entry.scopes.length === 1 && entry.scopes[0] === 'functions' &&
    Array.isArray(entry.values) && entry.values.length === 1, 'netlify_scope_mismatch');
  const [value] = entry.values;
  requireState(value?.context === 'branch' && value.context_parameter === BRANCH &&
    typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id), 'netlify_scope_mismatch');
  return value.id;
}

function entries(list) {
  requireState(Array.isArray(list) && list.every(entry => typeof entry?.key === 'string'), 'netlify_metadata_invalid');
  return list.filter(entry => entry.key === KEY);
}

export async function provision({ apply = false, ca, env, state, checkTarget, activate, verify, report }) {
  const checkAbsent = async () => {
    requireState(!entries((await env(false)).data).length && !entries((await env(true)).data).length, 'existing_netlify_key');
  };
  const first = await state();
  requireState(first.stage && first.authorized && first.safe, 'stage_role_preflight_failed');
  requireState(first.login === false, 'role_already_login');
  requireState(!apply || first.locked, 'ops_lock_unavailable');
  await checkTarget();
  await checkAbsent();
  if (!apply) return report('PREFLIGHT_OK_NO_WRITES');

  const password = randomBytes(32).toString('hex');
  const url = `postgresql://${WRITER}.${PROJECT}:${password}@${POOLER}:6543/postgres`;
  const connection = playSupportStageConnection(url, ca);
  const payload = { key: KEY, scopes: ['functions'], is_secret: true,
    values: [{ context: 'branch', context_parameter: BRANCH, value: url }] };
  let id;
  await checkTarget();
  await checkAbsent();
  const beforeCreate = await state();
  requireState(beforeCreate.stage && beforeCreate.safe && beforeCreate.authorized && beforeCreate.locked &&
    beforeCreate.pid === first.pid && beforeCreate.login === false, 'stage_role_preflight_failed');
  let stage = 'create_post';
  let httpStatus;
  try {
    const createdResponse = await env(true, payload);
    httpStatus = createdResponse.status;
    stage = 'create_metadata';
    const created = entries(createdResponse.data);
    requireState(created.length === 1, 'netlify_create_invalid');
    id = valueId(created[0]);
    report(`NETLIFY_VALUE_ID ${id}`);
    stage = 'site_readback';
    httpStatus = undefined;
    const site = await env(true);
    httpStatus = site.status;
    const saved = entries(site.data);
    requireState(saved.length === 1 && valueId(saved[0]) === id, 'netlify_readback_mismatch');
    stage = 'team_readback';
    httpStatus = undefined;
    const team = await env(false);
    httpStatus = team.status;
    requireState(!entries(team.data).length, 'netlify_readback_mismatch');
  } catch (error) {
    report(netlifyDiagnostic(stage, error, httpStatus));
    let candidateStatus;
    try {
      const candidate = await env(true);
      candidateStatus = candidate.status;
      const found = entries(candidate.data);
      if (found.length === 1) report(`NETLIFY_CANDIDATE_VALUE_ID ${valueId(found[0])}`);
    } catch (error) {
      report(netlifyDiagnostic('candidate_readback', error, candidateStatus));
    }
    throw new Error('netlify_write_unconfirmed');
  }

  await checkTarget();
  try {
    await activate(first.pid, scramVerifier(password));
  } catch {
    report('ACTIVATION_UNCONFIRMED_CHECK_ROLE_STATE');
    throw new Error('activation_unconfirmed');
  }
  report('WRITER_LOGIN_ACTIVATED_PROOF_PENDING');
  await verify(connection);
  report('WRITER_LOGIN_VERIFIED_NETLIFY_PLACEMENT_ONLY');
}

const FUNCTIONS = [
  'apply_purchase(text,bytea,bigint,text,text,text,boolean,text,timestamptz,boolean)',
  'begin_ack(uuid,bigint)', 'claim_inbox(text,bytea)', 'complete_inbox(uuid,bigint)',
  'enqueue_inbox(text,bytea,integer,bytea,bytea,bytea,text,timestamptz)', 'finish_ack(uuid,bigint,uuid,text)',
  'inbox_is_complete(text,bytea,text)', 'recover_ack(uuid,bigint)',
  'reschedule_inbox(text,bytea,bigint,timestamptz,boolean)'
].map(name => `'arcade_play_api.play_support_${name}'::regprocedure::oid`).join(',');
const LOCK_HELD = `exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid()
  and classid=${LOCK[0]} and objid=${LOCK[1]} and objsubid=2 and granted)`;
const EFFECTIVE = `has_schema_privilege(r.oid,'arcade_play_api','USAGE')
  and not has_schema_privilege(r.oid,'arcade_play_api','CREATE')
  and not has_schema_privilege(r.oid,'private','USAGE,CREATE')
  and not has_schema_privilege(r.oid,'auth','USAGE,CREATE')
  and (select count(*) from pg_proc p where p.oid in (${FUNCTIONS}) and has_function_privilege(r.oid,p.oid,'EXECUTE'))=9
  and (select count(*) from pg_proc p where p.pronamespace='arcade_play_api'::regnamespace
    and has_function_privilege(r.oid,p.oid,'EXECUTE'))=9
  and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname like 'play_support_%' and c.relkind='r'
      and (has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        or has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,TRIGGER')))`;
const IDENTITY = `session_user='postgres' and current_user='postgres' and current_database()='postgres'
  and (select system_identifier::text from pg_control_system())='7656985631720456337'`;
const LIMITS = "set local statement_timeout='8s'; set local lock_timeout='3s';";
const STATE = `begin read only;
${LIMITS}
select json_build_object('pid',pg_backend_pid(),'stage',(${IDENTITY}),'login',r.rolcanlogin,
  'locked',${LOCK_HELD},'authorized',exists(
    select 1 from pg_auth_members m join pg_roles a on a.oid=m.member
    where m.roleid=r.oid and m.admin_option and a.rolname=current_user and a.rolcreaterole
    union all select 1 from pg_roles where rolname=current_user and rolsuper),
  'safe',not (r.rolsuper or r.rolinherit or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication)
    and r.rolconnlimit=-1 and r.rolvaliduntil is null
    and not exists(select 1 from pg_auth_members where member=r.oid)
    and not exists(select 1 from pg_db_role_setting where setrole=r.oid)
    and not exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass
      and d.refobjid=r.oid and (d.deptype='o' or d.deptype='a' and not (
        d.dbid=(select oid from pg_database where datname=current_database()) and d.objsubid=0 and (
          (d.classid='pg_namespace'::regclass and d.objid='arcade_play_api'::regnamespace::oid)
          or (d.classid='pg_proc'::regclass and d.objid in (${FUNCTIONS}))
        ))))
    and (select count(*) from pg_namespace n cross join lateral aclexplode(n.nspacl) a
      where n.oid='arcade_play_api'::regnamespace and a.grantee=r.oid and a.privilege_type='USAGE' and not a.is_grantable)=1
    and (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid in (${FUNCTIONS}) and a.grantee=r.oid and a.privilege_type='EXECUTE' and not a.is_grantable)=9
    and (${EFFECTIVE}))
from pg_roles r where r.rolname='${WRITER}';
commit;`;
const PROOF = `begin read only;
${LIMITS}
select json_build_object('ok',current_user='${WRITER}' and session_user='${WRITER}'
  and current_database()='postgres' and (${EFFECTIVE})
  and not arcade_play_api.play_support_inbox_is_complete('pl.kcswh.arcadepoker.stage',decode(repeat('00',32),'hex'),'fixture-noop'))
from pg_roles r where r.rolname=current_user;
commit;`;

function psql(connection, caPath) {
  const child = spawn('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env: { PATH: process.env.PATH, PGHOST: connection.host, PGPORT: String(connection.port),
      PGUSER: connection.username, PGPASSWORD: connection.password, PGDATABASE: 'postgres',
      PGSSLMODE: 'verify-full', PGSSLROOTCERT: caPath, PGGSSENCMODE: 'disable', PGCONNECT_TIMEOUT: '8' },
    stdio: ['pipe', 'pipe', 'ignore']
  });
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  const output = lines({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    close: () => child.kill(),
    async query(sql) {
      let timer;
      try {
        requireState(child.exitCode === null && child.stdin.writable, 'stage_sql_session_closed');
        child.stdin.write(sql + '\n');
        const row = await Promise.race([output.next(), new Promise((_, reject) => {
          timer = setTimeout(() => { child.kill(); reject(new Error('stage_sql_timeout')); }, 15_000);
        })]);
        requireState(!row.done, 'stage_sql_refused');
        return JSON.parse(row.value);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

async function http(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  requireState(response.ok, 'target_api_refused');
  return response;
}

class NetlifyError extends Error {
  constructor(kind, status) {
    super('netlify_request_unconfirmed');
    this.kind = kind;
    this.status = status;
  }
}

function netlifyDiagnostic(stage, error, fallbackStatus) {
  const status = error instanceof NetlifyError ? error.status : fallbackStatus;
  const kind = error instanceof NetlifyError ? error.kind : 'metadata';
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'none';
  return `NETLIFY_DIAGNOSTIC stage=${stage} http=${safeStatus} reason=${kind}`;
}

export function netlify(token, fetchApi = fetch) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const host = 'https://api.netlify.com/api/v1';
  return async (path, payload) => {
    let response;
    const timeout = AbortSignal.timeout(12_000);
    try {
      response = await fetchApi(host + path, {
        headers, redirect: 'error', signal: timeout,
        ...(payload ? { method: 'POST', body: JSON.stringify([payload]) } : {})
      });
    } catch {
      throw new NetlifyError(timeout.aborted ? 'timeout' : 'transport');
    }
    if (!response.ok || (payload && response.status !== 201)) throw new NetlifyError('http', response.status);
    try {
      return { status: response.status, data: await response.json() };
    } catch {
      throw new NetlifyError('response_json', response.status);
    }
  };
}

async function input(question, hidden = false) {
  const output = hidden ? new Writable({ write(_chunk, _enc, done) { done(); } }) : process.stderr;
  const prompt = prompts({ input: process.stdin, output, terminal: true });
  try {
    if (hidden) process.stderr.write(question);
    return await prompt.question(hidden ? '' : question);
  } finally {
    prompt.close();
    if (hidden) process.stderr.write('\n');
  }
}

async function main() {
  const [caFile, flag, extra] = process.argv.slice(2);
  requireState(process.stdin.isTTY && caFile && (!flag || flag === '--apply') && extra === undefined, 'usage_readonly_or_apply');
  const apply = flag === '--apply';
  const ca = readFileSync(caFile, 'utf8');
  requireState(/^\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$/.test(ca), 'ca_expected_one_pem');
  const certificate = new X509Certificate(ca);
  requireState(certificate.ca, 'ca_required');
  const fingerprint = certificate.fingerprint256;
  process.stdout.write(`Stage CA SHA-256 ${fingerprint}\n`);
  requireState((await input('Confirm the full SHA-256 from an independent trusted copy: ')).replaceAll(':', '').toUpperCase() ===
    fingerprint.replaceAll(':', ''), 'ca_confirmation_failed');
  if (apply) requireState(await input(`Freeze ${BRANCH} and type STAGE FIRST ACTIVATION: `) ===
    'STAGE FIRST ACTIVATION', 'operator_confirmation_failed');

  const password = await input('Existing Stage postgres password: ', true);
  const token = await input('Existing Netlify access token: ', true);
  requireState(password && /^[\x21-\x7e]+$/.test(token), 'credentials_required');
  const api = netlify(token);
  const checkTarget = async () => {
    const [{ data: site }, pr] = await Promise.all([
      api('/sites/' + SITE),
      http('https://api.github.com/repos/' + REPO + '/pulls/1354').then(r => r.json())
    ]);
    requireState(site.id === SITE && site.name === 'playkcswh' && site.account_id === ACCOUNT, 'netlify_site_mismatch');
    requireState(pr.state === 'open' && pr.head?.sha === SHA && pr.head.ref === BRANCH &&
      pr.head.repo?.full_name === REPO, 'consumer_pr_mismatch');
  };
  const raw = await http(`https://raw.githubusercontent.com/${REPO}/${SHA}/${VALIDATOR}`);
  requireState(Buffer.from(await raw.arrayBuffer()).equals(readFileSync(new URL('../../' + VALIDATOR, import.meta.url))),
    'consumer_validator_mismatch');

  const dir = mkdtempSync(join(tmpdir(), 'stage-billing-'));
  const caPath = join(dir, 'ca.pem');
  const adminOptions = { host: POOLER, port: 5432, username: `postgres.${PROJECT}`, password };
  let admin;
  try {
    writeFileSync(caPath, ca, { mode: 0o600 });
    admin = psql(adminOptions, caPath);
    const state = () => admin.query(STATE);
    if (apply) {
      const initial = await state();
      requireState(initial.stage && initial.safe && initial.authorized && initial.login === false, 'stage_role_preflight_failed');
      const lock = await admin.query(`select json_build_object('ok',pg_try_advisory_lock(${LOCK.join(',')}));`);
      requireState(lock.ok === true, 'ops_lock_unavailable');
    }
    const report = code => process.stdout.write(code + '\n');
    try {
      await provision({
        apply, ca, state, checkTarget, report,
        env: (site, payload) => api(`/accounts/${ACCOUNT}/env${site ? '?site_id=' + SITE : ''}`, payload),
        activate: async (pid, verifier) => {
          requireState(Number.isSafeInteger(pid) && pid > 0, 'stage_session_mismatch');
          const result = await admin.query(`begin;
${LIMITS}
do $provision$ begin
  if pg_backend_pid() <> ${pid} or not (${LOCK_HELD}) or not (${IDENTITY})
    or not exists(select 1 from pg_roles where rolname='${WRITER}' and not rolcanlogin)
  then raise exception 'activation_precondition'; end if;
  alter role play_support_writer login password '${verifier}';
end $provision$;
commit;
select json_build_object('ok',true);`);
          requireState(result.ok === true, 'activation_unconfirmed');
        },
        verify: async connection => {
          for (let attempt = 0; attempt < 3; attempt++) {
            const writer = psql(connection, caPath);
            try {
              const result = await writer.query(PROOF);
              requireState(result.ok === true, 'writer_permissions_unexpected');
              return;
            } catch {
              if (attempt === 2) throw new Error('writer_proof_failed');
            } finally {
              writer.close();
            }
            await delay(1000);
          }
        }
      });
    } catch (error) {
      if (error.message === 'activation_unconfirmed') {
        const recovery = psql(adminOptions, caPath);
        try {
          const status = await recovery.query(STATE);
          report(status.stage ? (status.login ? 'STAGE_WRITER_LOGIN' : 'STAGE_WRITER_NOLOGIN') : 'STAGE_WRITER_STATE_UNKNOWN');
        } catch {
          report('STAGE_WRITER_STATE_UNKNOWN');
        } finally {
          recovery.close();
        }
      }
      throw error;
    }
  } finally {
    admin?.close();
    try { unlinkSync(caPath); } catch { /* no private CA copy to remove */ }
    try { rmdirSync(dir); } catch { process.stderr.write('CA_TEMP_CLEANUP_UNCONFIRMED\n'); }
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    const code = /^[a-z0-9_]{3,60}$/.test(error?.message ?? '') ? error.message : 'operation_refused';
    process.stderr.write(`Stopped (${code}). Read the recovery notes before retrying.\n`);
    process.exitCode = 1;
  });
}
