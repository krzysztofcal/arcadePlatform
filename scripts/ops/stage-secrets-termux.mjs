// Standalone OWNER operation on Android/Termux. No project/npm imports.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const REF = 'krydukthwdvccggbyjfw';
const SITE = 'f7e19a84-28f7-41f7-978a-f3b4552a404d';
const REPO = 'krzysztofcal/arcadePlatform';
const ENVIRONMENT = 'stage-automation';
const ENDPOINT = `repos/${REPO}/environments/${ENVIRONMENT}`;
const NAMES = ['SUPABASE_STAGE_DB_URL', 'SUPABASE_STAGE_DIRECT_DB_URL', 'SUPABASE_STAGE_MANAGEMENT_TOKEN'];
function klog(status, detail) { process.stdout.write(`[klog] ${status} ${detail}\n`); }
function requireSafe(ok, code) { if (!ok) throw new Error(code); }

export function previewValue(variable, key) {
  requireSafe(variable?.key === key && variable.is_secret === false, 'NETLIFY_SOURCE_UNREADABLE');
  const values = variable.values?.filter(v => v.context === 'deploy-preview' && !v.context_parameter);
  requireSafe(values?.length === 1 && typeof values[0].value === 'string' && values[0].value.length > 0, 'NETLIFY_PREVIEW_AMBIGUOUS');
  return values[0].value;
}
export function prepareConnections(raw, api, ref) {
  requireSafe(ref === REF && [ `https://${REF}.supabase.co`, `https://${REF}.supabase.co/` ].includes(api), 'WRONG_STAGE');
  const u = new URL(raw);
  requireSafe(['postgres:', 'postgresql:'].includes(u.protocol) && u.pathname === '/postgres' && !u.hash, 'BAD_DB_URL');
  requireSafe(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)
    && decodeURIComponent(u.username) === `postgres.${REF}` && ['5432', '6543'].includes(u.port), 'WRONG_DB_TENANT');
  requireSafe([...u.searchParams].every(([k,v]) => k === 'sslmode' && ['require','verify-full'].includes(v)), 'UNSAFE_DB_OPTIONS');
  const password = decodeURIComponent(u.password);
  requireSafe(password.length > 0 && !/[\x00-\x1f\x7f]/.test(password), 'BAD_DB_PASSWORD');
  u.protocol = 'postgresql:'; u.port = '5432'; u.search = '';
  const direct = new URL(u); direct.hostname = `db.${REF}.supabase.co`; direct.username = 'postgres'; direct.search = '?sslmode=require';
  // Matches stage-db-migrate.mjs::connectionEnv: pinned direct host, postgres DB, 5432, SSL require.
  return { SUPABASE_STAGE_DB_URL: u.href, SUPABASE_STAGE_DIRECT_DB_URL: direct.href };
}
export function verifyMetadata(metadata, name, previous) {
  requireSafe(metadata?.name === name && Number.isFinite(Date.parse(metadata.updated_at))
    && (!previous || (previous.name === name && Number.isFinite(Date.parse(previous.updated_at))
      && Date.parse(metadata.updated_at) > Date.parse(previous.updated_at))), 'SECRET_METADATA_NOT_FRESH');
  return true;
}
export async function migrate(secrets, { preflight, write, metadata }) {
  const report = Object.fromEntries(Object.keys(secrets).map(k => [k,'STOP']));
  try {
    await preflight();
    for (const [name, value] of Object.entries(secrets)) {
      const previous = await metadata(name);
      await write(name, value);
      verifyMetadata(await metadata(name), name, previous);
      report[name] = 'PASS';
    }
  } catch { /* Never output child errors, response bodies or secret values. No rollback/retry. */ }
  return report;
}

// Deliberately exclude inherited debug/trace, endpoint overrides, NODE_OPTIONS and other tokens.
function cliEnvironment(token) {
  const env = {};
  for (const key of ['PATH','HOME','PREFIX','TMPDIR','LANG','TERM','ANDROID_ROOT','ANDROID_DATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { GH_HOST:'github.com', GH_PROMPT_DISABLED:'1', GH_PAGER:'cat',
    NETLIFY_TELEMETRY_DISABLED:'1', DO_NOT_TRACK:'1', CI:'true', NO_COLOR:'1', BROWSER:'termux-open-url' });
  if (token) env.GH_TOKEN = token;
  return env;
}
async function run(command, args, { input, token, interactive = false } = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{ cwd:homedir(), env:cliEnvironment(token),
      stdio:interactive ? 'inherit' : ['pipe','pipe','pipe'] });
    let output = '', size = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI_TIMEOUT')); }, interactive ? 600000 : 60000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('CLI_UNAVAILABLE')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output); else reject(new Error('CLI_FAILED'));
    });
    if (!interactive) {
      child.stdout.on('data', data => {
        size += data.length;
        if (size > 4 * 1024 * 1024) { child.kill('SIGKILL'); return; }
        output += data;
      });
      child.stderr.resume(); // Discard private diagnostics, including auth and URL errors.
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    }
  });
}
async function hiddenInput(prompt) {
  requireSafe(process.stdin.isTTY && process.stdout.isTTY, 'LOCAL_TTY_REQUIRED');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve,reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('data',onData); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(new Error('INPUT_CANCELLED')); else resolve(value);
    };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\x03' || char === '\x04') return finish(true);
        if (char === '\r' || char === '\n') return finish(false);
        if (char === '\x7f' || char === '\b') value = value.slice(0,-1);
        else if (char >= ' ' && char <= '~') value += char;
        else return finish(true);
        if (value.length > 8192) return finish(true);
      }
    };
    process.stdin.on('data',onData);
  });
}
async function validateManagement(token) {
  requireSafe(/^sbp_fc[A-Za-z0-9_-]+$/.test(token), 'BAD_MANAGEMENT_TOKEN');
  for (const path of ['analytics/endpoints/metrics','config/disk','config/disk/util']) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/${path}`, {
      headers:{Authorization:`Bearer ${token}`}, redirect:'error', signal:AbortSignal.timeout(20000),
    });
    // Only status required; do not download metric series or print bodies.
    await response.body?.cancel();
    requireSafe(response.ok,'MANAGEMENT_READ_DENIED');
  }
}
async function main() {
  let phase = 'TERMUX_PREFLIGHT';
  let report = Object.fromEntries(NAMES.map(k => [k,'STOP']));
  try {
    requireSafe(process.platform === 'android' && process.env.PREFIX?.startsWith('/data/data/com.termux/'), 'TERMUX_ONLY');
    requireSafe(Number(process.versions.node.split('.')[0]) >= 22 && process.stdin.isTTY && process.stdout.isTTY, 'NODE22_AND_TTY_REQUIRED');
    process.umask(0o077);
    const ghVersion = await run('gh',['--version']);
    requireSafe(/gh version (?:2\.(?:4[5-9]|[5-9]\d|\d{3,})\.|[3-9]\.)/.test(ghVersion),'GH_245_REQUIRED');
    requireSafe(/^netlify-cli\/26\.2\.0\s/.test(await run('netlify',['--version'])),'NETLIFY_2620_REQUIRED');
    const methods = await run('netlify',['api','--list']);
    requireSafe(['getSite','getEnvVar'].every(m => new RegExp(`\\b${m}\\b`).test(methods)), 'NETLIFY_API_INCOMPATIBLE');
    let ownerToken;
    const gh = (args,input) => run('gh',args,{token:ownerToken,input});
    const api = async path => JSON.parse(await gh(['api','--hostname','github.com',path]));
    phase = 'GITHUB_OWNER_AUTH';
    let user;
    try { user = await api('user'); } catch { /* Request least-privilege local token below. */ }
    if (user?.login !== 'krzysztofcal') {
      klog('AUTH','GitHub: use an OWNER fine-grained PAT, only arcadePlatform, Environments read/write + Actions read. No classic PAT or OAuth scope expansion.');
      ownerToken = await hiddenInput('GitHub fine-grained PAT (hidden; RAM only): ');
      requireSafe(ownerToken.startsWith('github_pat_'),'FINE_GRAINED_PAT_REQUIRED');
      user = await api('user');
    }
    requireSafe(user.login === 'krzysztofcal', 'OWNER_REQUIRED');
    const preflight = async () => {
      const environment = await api(ENDPOINT);
      requireSafe(environment.name === ENVIRONMENT && environment.deployment_branch_policy?.custom_branch_policies === true
        && environment.deployment_branch_policy?.protected_branches === false,'ENVIRONMENT_RESTRICTION');
      const policies = await api(`${ENDPOINT}/deployment-branch-policies?per_page=100`);
      requireSafe(policies.total_count === 1 && policies.branch_policies?.length === 1
        && policies.branch_policies[0].name === 'main' && policies.branch_policies[0].type === 'branch','MAIN_ONLY_REQUIRED');
      await api(`${ENDPOINT}/secrets/public-key`);
      // This proves read access only; each write and fresh metadata must still succeed.
    };
    phase = 'GITHUB_PREFLIGHT'; await preflight();
    phase = 'NETLIFY_AUTH';
    await run('netlify',['login','--new'],{interactive:true}); // Browser login; only auth output inherits the terminal.
    const netlify = async (method,data) => JSON.parse(await run('netlify',['api',method,'--data',JSON.stringify(data)]));
    phase = 'NETLIFY_SOURCE';
    const site = await netlify('getSite',{site_id:SITE});
    requireSafe(site.id === SITE && site.name === 'playkcswh' && typeof site.account_slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(site.account_slug),'NETLIFY_SITE_IDENTITY');
    const get = async key => previewValue(await netlify('getEnvVar',{account_id:site.account_slug,site_id:SITE,key}),key);
    const secrets = prepareConnections(await get('SUPABASE_DB_URL'), await get('SUPABASE_URL'), await get('SUPABASE_STAGE_PROJECT_REF'));
    klog('PASS','Netlify exact deploy-preview Stage source; session 5432 and Direct 5432 prepared. No DB queries performed on this phone.');
    phase = 'MANAGEMENT_TOKEN';
    klog('ACTION',`Supabase account/tokens: scoped PAT, only ${REF}, Logs Read + Disk Config Read, expiry. Confirm these restrictions before pasting.`);
    secrets.SUPABASE_STAGE_MANAGEMENT_TOKEN = await hiddenInput('Supabase scoped PAT (hidden): ');
    await validateManagement(secrets.SUPABASE_STAGE_MANAGEMENT_TOKEN);
    phase = 'GITHUB_WRITE_OR_METADATA';
    report = await migrate(secrets, { preflight,
      write: (name,value) => gh(['secret','set',name,'--repo',REPO,'--env',ENVIRONMENT],value),
      metadata: async name => {
        const list = await api(`${ENDPOINT}/secrets?per_page=100`);
        requireSafe(Number.isInteger(list.total_count) && list.total_count <= 100
          && list.secrets?.length === list.total_count,'SECRET_METADATA_INCOMPLETE');
        return list.secrets.find(s => s.name === name) ?? null;
      },
    });
    ownerToken = undefined;
    for (const key of NAMES) secrets[key] = '';
  } catch { /* phase is a fixed safe label; never emit the original exception. */ }
  for (const name of NAMES) klog(report[name],name);
  if (Object.values(report).some(s => s !== 'PASS')) {
    klog('STOP',`${phase}; no automatic retry/rollback. Earlier PASS writes remain. Repository secrets unchanged.`);
    process.exitCode = 1;
  } else klog('PASS','Three Environment secret writes confirmed by fresh metadata; values cannot be read back. No workflows/deployments executed.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
