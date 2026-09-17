import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(repositoryRoot, ...segments), 'utf8');

test('installs the fixed-scope root maintenance service and persistent weekly timer', () => {
  const service = read('infra/vps/arcadeplatform-vps-maintenance.service');
  const timer = read('infra/vps/arcadeplatform-vps-maintenance.timer');

  assert.match(service, /^User=root$/m);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^ExecStart=\/usr\/local\/sbin\/arcadeplatform-vps-maintenance\.sh$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.match(service, /^ProtectHome=true$/m);
  assert.match(service, /^PrivateTmp=false$/m);
  assert.match(service, /^ReadWritePaths=\/opt\/ws-server \/tmp$/m);
  assert.doesNotMatch(service, /^\s*Exec(?:Start|Stop|Reload)=.*\b(?:systemctl\s+(?:restart|reload|stop|start)|docker|kill|pkill|[^\n]*\b(?:prune|cache)\b)/im);

  assert.match(timer, /^OnCalendar=Sun \*-\*-\* 03:30:00 UTC$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^Unit=arcadeplatform-vps-maintenance\.service$/m);
});

test('bootstrap installs the shared lock and maintenance artifacts without activation', () => {
  const bootstrap = read('infra/vps/bootstrap.sh');

  assert.match(bootstrap, /install -d -o root -g arcade-deploy -m 2775 \/opt\/ws-server \/opt\/ws-server\/releases\ninstall -o root -g arcade-deploy -m 0660 \/dev\/null \/opt\/ws-server\/\.deploy-maintenance\.lock/);
  assert.match(bootstrap, /install -D -o root -g root -m 0755 \\\n\s+"\$REPO_ROOT\/infra\/vps\/vps-maintenance\.sh" \\\n\s+\/usr\/local\/sbin\/arcadeplatform-vps-maintenance\.sh/);
  for (const unit of ['arcadeplatform-vps-maintenance.service', 'arcadeplatform-vps-maintenance.timer']) {
    assert.match(bootstrap, new RegExp(`install -D -o root -g root -m 0644 "\\$REPO_ROOT/infra/vps/${unit.replace('.', '\\.') }" /etc/systemd/system/${unit.replace('.', '\\.')}`));
  }
  assert.match(bootstrap, /^systemctl daemon-reload$/m);
  assert.doesNotMatch(bootstrap, /systemctl\s+(?:enable|start|restart|reload|stop)\s+arcadeplatform-vps-maintenance(?:\.service|\.timer)?/);
  assert.match(bootstrap, /did not run VPS maintenance or enable\/start its timer/);
});

test('maintenance implementation stays out of service, container, process, and cache management', () => {
  const maintenance = read('infra/vps/vps-maintenance.sh');

  assert.match(maintenance, /^readonly APP_ROOT='\/opt\/ws-server'$/m);
  assert.match(maintenance, /^readonly RELEASES_ROOT='\/opt\/ws-server\/releases'$/m);
  assert.match(maintenance, /^readonly CURRENT_RELEASE_LINK='\/opt\/ws-server\/current'$/m);
  assert.match(maintenance, /^readonly TMP_ROOT='\/tmp'$/m);
  assert.match(maintenance, /^readonly LOCK_FILE='\/opt\/ws-server\/\.deploy-maintenance\.lock'$/m);
  assert.doesNotMatch(maintenance, /^\s*(?:systemctl|docker|kill|pkill)\b/m);
  assert.doesNotMatch(maintenance, /\b(?:prune|cache)\b/i);
});

test('recovery documentation requires a read-only owner review before separately approved deferred cleanup', () => {
  const documentation = `${read('infra/vps/README.md')}\n${read('docs/vps-disaster-recovery-inventory.md')}`;

  assert.match(documentation, /\.deployed-at.*(?:takes precedence|precedence)/is);
  assert.match(documentation, /legacy.*birth(?:-| )time/is);
  assert.match(documentation, /\.deploy-maintenance\.lock/);
  assert.match(documentation, /current.*five.*previous.*7 days/is);
  assert.match(documentation, /arcadeplatform-ws-.*arcadeplatform-infra-.*48 hours/is);
  assert.match(documentation, /owner-approved read-only review[\s\S]*systemctl enable --now arcadeplatform-vps-maintenance\.timer/);
  assert.match(documentation, /docker ps -a/);
  assert.match(documentation, /docker system df -v/);
  assert.match(documentation, /runner state.*process\/PID state.*local\s+Postgres\/cache ownership/is);
  assert.match(documentation, /before any separately approved exact cleanup/is);
  assert.match(documentation, /(?:broad prune|prune).*?(?:broad kill|kill)|(?:broad kill|kill).*?(?:broad prune|prune)/is);
  assert.match(documentation, /recovery backups, secrets,/i);
  assert.match(documentation, /\.env.*active services.*outside the cleanup boundary/is);
});

test('all relevant validation entry points run both maintenance tests', () => {
  const registrations = [
    'scripts/test-all.mjs',
    '.github/workflows/infra-vps.yml',
    '.github/workflows/ws-pr-checks.yml',
    '.github/workflows/ws-deploy.yml',
    '.github/workflows/ws-server-deploy.yml',
  ].map((file) => read(file));

  for (const source of registrations) {
    assert.match(source, /ws-tests\/vps-maintenance\.behavior\.test\.mjs/);
    assert.match(source, /ws-tests\/vps-maintenance\.installation\.guard\.test\.mjs/);
  }
});
