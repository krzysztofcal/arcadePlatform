import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const legal = 'specs/1114-arcade-profiles-avatars/legal-drafts/';
const main = html => html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0];
const normalize = text => text.replace(/\s+/g, ' ').trim();
const htmlText = html => normalize(html.replace(/<\/(?:p|h[1-6]|li|th|td|tr)>/g, ' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
const markdownText = text => normalize(text.replace(/^\|[-| ]+\|\s*$/gm, '').replace(/^#{1,6} /gm, '').replace(/^- /gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\|/g, ' '));

test('approved legal content, both policy versions and deletion links survive the real web packager', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'arcade-legal-package-'));
  try {
    await cp(root, fixture, { recursive: true, filter: source => !path.relative(root, source).split(path.sep).some(part => ['.git', 'node_modules', 'www'].includes(part)) });
    // SDK execution is outside this packaging test. No dependency install or network.
    const vendor = path.join(fixture, 'mobile/poker/node_modules/@supabase/supabase-js/dist/umd');
    await mkdir(vendor, { recursive: true });
    await writeFile(path.join(vendor, 'supabase.js'), '/* inert SDK packaging fixture */');
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim();
    execFileSync(process.execPath, ['mobile/poker/package-web.mjs'], { cwd: fixture, env: { PATH: process.env.PATH, GIT_DIR: gitDir, GIT_WORK_TREE: fixture }, stdio: 'pipe' });
    const manifest = JSON.parse(await readFile(path.join(root, legal, 'manifest.json'), 'utf8'));
    const receipt = JSON.parse(await readFile(path.join(fixture, 'mobile/poker/www/build-receipt.json'), 'utf8'));
    for (const [file, expectedHash] of Object.entries(manifest.files)) {
      const md = await readFile(path.join(root, legal, file), 'utf8');
      assert.equal(createHash('sha256').update(md).digest('hex'), expectedHash);
      const [kind, lang] = file.split('.');
      const page = `legal/${kind}.${manifest.candidateVersion}.${lang}.html`;
      assert.ok(receipt.sourcePages.includes(page), `missing packaged ${page}`);
      const source = await readFile(path.join(root, page), 'utf8');
      const packaged = await readFile(path.join(fixture, 'mobile/poker/www', page), 'utf8');
      assert.equal(htmlText(main(source)), markdownText(md), `approved text mismatch: ${file}`);
      assert.equal(main(packaged), main(source), `packaging changed legal content: ${page}`);
      assert.match(packaged, /Arcade Hub/);
      if (kind === 'privacy') {
        assert.match(packaged, /id="account-deletion"/);
        assert.match(packaged, /href="mailto:contact@kcswh\.pl"/);
      }
    }
    for (const lang of ['pl', 'en']) {
      for (const version of ['2026-10-26-a1', manifest.candidateVersion]) {
        for (const kind of ['terms', 'privacy']) assert.ok(receipt.sourcePages.includes(`legal/${kind}.${version}.${lang}.html`));
      }
      const alias = await readFile(path.join(root, `legal/privacy.${lang}.html`), 'utf8');
      assert.match(alias, /id="account-deletion"/);
      const legacy = await readFile(path.join(root, `legal/privacy.2026-10-26-a1.${lang}.html`), 'utf8');
      assert.equal(htmlText(main(legacy)), htmlText(main(alias)), 'legacy Privacy must capture the current alias without editing its text');
    }
    assert.equal(receipt.securityChecks.csp, 'PASS');
    assert.equal(receipt.securityChecks.sri, 'PASS');
    const account = await readFile(path.join(fixture, 'mobile/poker/www/account.html'), 'utf8');
    const deletionInfo = account.match(/<section\b[^>]*id="account-deletion"[^>]*>[\s\S]*?<\/section>/)?.[0];
    assert.ok(deletionInfo, 'existing Account must expose the external deletion-request entry point');
    assert.match(deletionInfo.match(/^<section[^>]*>/)[0], /\bhidden\b/);
    assert.ok(account.indexOf(deletionInfo) < account.indexOf('id="authForms"'), 'entry point stays before sign-in; account-page resolves its WWW-only visibility');
    assert.match(deletionInfo, /Arcade Poker/);
    assert.match(deletionInfo, /href="#signinForm"/);
    assert.match(deletionInfo, /href="mailto:contact@kcswh\.pl"/);
    assert.match(account, /id="deleteAccountButton"/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
