import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DOMAINS = ['core', 'web', 'chips_db', 'ws_poker', 'games', 'infra'];
export function normalizePath(filePath) {
  return String(filePath || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

// Preserve the existing Production deploy surface. Broad validation must never
// turn an unknown diff or a test-only push into a Production mutation.
function deployPath(p) {
  return p.startsWith('ws-server/') || p.startsWith('shared/') ||
    /^netlify\/functions\/_shared\/(chips-ledger|poker-[^/]+|supabase-admin|api-cors)\.mjs$/.test(p) ||
    p === 'netlify/functions/_generated/deploy-context.mjs' ||
    p === '.github/workflows/ws-server-deploy.yml';
}

export function classifyCiImpact(paths) {
  const files = [...paths].map(normalizePath).filter(Boolean);
  const result = Object.fromEntries(DOMAINS.map(d => [d, false]));
  result.deploy_ws = files.some(deployPath);
  const add = (...domains) => domains.forEach(d => { result[d] = true; });
  if (!files.length) add(...DOMAINS);
  for (const p of files) {
    if (p.startsWith('infra/') || /^ws-tests\/(infra-vps|vps-maintenance)/.test(p) || p === '.github/workflows/infra-vps.yml') add('infra');
    else if (p === 'docs/ws-poker-protocol.md') add('ws_poker');
    else if (p.startsWith('docs/') || p.startsWith('specs/') || /^(README|agents|skills|AGENTS)\.md$/i.test(p)) continue;
    else if (['js/games.json', 'js/games.schema.json', 'scripts/validate-games.js', '.github/workflows/validate-games.yml'].includes(p)) add('games');
    else if (p.startsWith('supabase/') || p.startsWith('tests/chips/') || /^scripts\/ops\/chips-/.test(p) || ['scripts/check-db-migrations.mjs', 'scripts/stage-db-migrate.mjs', '.github/workflows/db-migration-check.yml', '.github/workflows/db-stage-apply-pr.yml'].includes(p)) add('chips_db');
    else if (p.startsWith('shared/') || p.startsWith('.github/') || /^package(-lock)?\.json$/.test(p) || ['scripts/test-all.mjs', 'scripts/ci-impact.mjs', 'tests/test-all.runner-registration.guard.test.mjs', 'tests/poker-workflows.playwright-install.guard.test.mjs'].includes(p)) add(...DOMAINS);
    else if (p.startsWith('ws-server/')) add('core', 'ws_poker');
    else if (p.startsWith('ws-tests/')) add('ws_poker');
    else if (p.startsWith('netlify/functions/_shared/')) add('core', 'chips_db', 'ws_poker');
    else if (['tests/poker-ws-client.test.mjs', 'tests/poker-v2-live.behavior.test.mjs'].includes(p)) add('core', 'web', 'ws_poker');
    else if (p.startsWith('poker/')) add('core', 'web', 'ws_poker');
    else if (p.startsWith('tests/e2e') || /^playwright\.config\./.test(p) || ['scripts/run-e2e.js', 'scripts/prepare-playwright.js'].includes(p)) add('web');
    else if (p.startsWith('games/') || /scripts\/(check|guard)-games/.test(p) || p === 'scripts/check-xpbadge.js' || p === 'scripts/check-lifecycle.js') add('core', 'web', 'games');
    else if (p.startsWith('tests/')) add('core');
    else if (p.startsWith('js/') || p.startsWith('css/') || p.startsWith('poker/') || p.startsWith('netlify/functions/') || /\.html$/.test(p)) add('core', 'web');
    else add(...DOMAINS);
  }
  return result;
}

function changedPaths() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event === 'workflow_dispatch') return [];
  const base = process.env.CI_BASE_SHA;
  const head = process.env.CI_HEAD_SHA;
  if (!base || !head || /^0+$/.test(base)) return [];
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', base, head], { encoding: 'utf8' });
  if (diff.status !== 0) return [];
  return diff.stdout.split(/\r?\n/);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = classifyCiImpact(changedPaths());
  const output = process.argv[process.argv.indexOf('--github-output') + 1];
  if (!process.argv.includes('--github-output') || !output) throw new Error('--github-output is required');
  // Explicit manual deploy keeps its existing semantics; all validations run.
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') result.deploy_ws = true;
  fs.appendFileSync(output, Object.entries(result).map(([k, v]) => `${k}=${v}\n`).join(''));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
