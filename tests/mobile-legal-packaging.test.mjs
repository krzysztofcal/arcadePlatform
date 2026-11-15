import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const PRIVACY_A1_SHA256 = { pl: '706b8ab2855a8eb77c139ce22da5b3cfc1ebf28a1d5878febca385608bd366de', en: 'ba49aaefb9e8e441c87f24bc0cae0f4d1bba809e91e45441f0ce7646f8bcf759' };
const TERMS_A1_SHA256 = { pl: 'c16ae10d74f829875b9fa0f5e6d9b7cba058e1671b709eed2c7bb3d1b1e22479', en: '5ce77ceaf1f77dc854a1e5065d992b37d85fda2e6d8c872c19b2902a441cfc72' };
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
    const a3Dir = 'specs/1157-settled-data-retention/legal-candidate-a3/';
    const a3 = JSON.parse(await readFile(path.join(root, a3Dir, 'manifest.json'), 'utf8'));
    for (const [file, expectedHash] of Object.entries(a3.files)) {
      const page = `legal/${file}`;
      const source = await readFile(path.join(root, page), 'utf8');
      assert.equal(createHash('sha256').update(source).digest('hex'), expectedHash, `a3 hash mismatch: ${page}`);
      assert.equal(source, await readFile(path.join(root, a3Dir, file), 'utf8'), `a3 differs from accepted candidate: ${page}`);
      assert.ok(receipt.sourcePages.includes(page), `missing packaged ${page}`);
      const packaged = await readFile(path.join(fixture, 'mobile/poker/www', page), 'utf8');
      assert.equal(main(packaged), main(source), `packaging changed legal content: ${page}`);
      assert.equal(htmlText(main(packaged)), htmlText(main(source)));
      assert.match(packaged, /id="account-deletion"/);
      assert.match(packaged, /href="mailto:contact@kcswh\.pl"/);
    }
    assert.ok(!receipt.sourcePages.some(page => page.startsWith('legal/terms.') && page.includes(a3.candidateVersion)), 'a3 adds no Terms page');
    for (const lang of ['pl', 'en']) {
      for (const version of ['2026-10-26-a1', manifest.candidateVersion]) {
        for (const kind of ['terms', 'privacy']) assert.ok(receipt.sourcePages.includes(`legal/${kind}.${version}.${lang}.html`));
      }
      const alias = await readFile(path.join(root, `legal/privacy.${lang}.html`), 'utf8');
      assert.match(alias, /id="account-deletion"/);
      assert.match(alias, /href="mailto:contact@kcswh\.pl"/);
      // #1157: the active alias carries the accepted a3 text byte for byte; a1 stays immutable for past acceptances.
      const active = await readFile(path.join(root, `legal/privacy.${a3.candidateVersion}.${lang}.html`), 'utf8');
      const inner = html => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
      assert.equal(inner(alias), inner(active), 'active Privacy alias must equal the accepted a3 text');
      const legacy = await readFile(path.join(root, `legal/privacy.2026-10-26-a1.${lang}.html`), 'utf8');
      assert.equal(createHash('sha256').update(legacy).digest('hex'), PRIVACY_A1_SHA256[lang], 'Privacy a1 must stay immutable');
      // #1140: the active Terms alias carries the approved a2 text byte for byte; Terms a1 stays immutable for past acceptances.
      const terms = await readFile(path.join(root, `legal/terms.${lang}.html`), 'utf8');
      const termsA2 = await readFile(path.join(root, `legal/terms.${manifest.candidateVersion}.${lang}.html`), 'utf8');
      assert.equal(inner(terms), inner(termsA2), 'active Terms alias must equal the approved a2 text');
      const packagedTerms = await readFile(path.join(fixture, `mobile/poker/www/legal/terms.${lang}.html`), 'utf8');
      assert.equal(main(packagedTerms), main(terms), 'packaging changed the active Terms alias');
      const termsA1 = await readFile(path.join(root, `legal/terms.2026-10-26-a1.${lang}.html`), 'utf8');
      assert.equal(createHash('sha256').update(termsA1).digest('hex'), TERMS_A1_SHA256[lang], 'Terms a1 must stay immutable');
    }
    assert.equal(receipt.securityChecks.csp, 'PASS');
    assert.equal(receipt.securityChecks.sri, 'PASS');
    const account = await readFile(path.join(fixture, 'mobile/poker/www/account.html'), 'utf8');
    const deletionInfo = account.match(/<section\b[^>]*id="account-deletion"[^>]*>[\s\S]*?<\/section>/)?.[0];
    assert.ok(deletionInfo, 'existing Account must expose the external deletion-request entry point');
    assert.match(deletionInfo.match(/^<section[^>]*>/)[0], /\bhidden\b/);
    assert.ok(account.indexOf(deletionInfo) > account.indexOf('id="authForms"'), 'entry point stays after authForms; account-page resolves its WWW-only visibility');
    assert.match(deletionInfo, /Arcade Poker/);
    assert.match(deletionInfo, /href="#signinForm"/);
    assert.match(deletionInfo, /href="mailto:contact@kcswh\.pl"/);
    assert.match(account, /id="deleteAccountButton"/);
    const lobby = await readFile(path.join(fixture, 'mobile/poker/www/poker/index.html'), 'utf8');
    assert.doesNotMatch(lobby, /<nav class="shortcuts"/,'APK must not retain a second navigation source');
    for (const page of [account,lobby]) assert.match(page,/sidebar\.js/, 'Account and Lobby share the same navigation renderer');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
