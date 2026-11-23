import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const topbarSource = await readFile(path.join(repoRoot, 'js', 'topbar.js'), 'utf8');
const xpCoreSource = await readFile(path.join(repoRoot, 'js', 'xp', 'core.js'), 'utf8');
const formatSource = await readFile(path.join(repoRoot, 'js', 'core', 'number-format.js'), 'utf8');
const accountHtml = await readFile(path.join(repoRoot, 'account.html'), 'utf8');
const adminHtml = await readFile(path.join(repoRoot, 'admin.html'), 'utf8');
const favoritesHtml = await readFile(path.join(repoRoot, 'favorites.html'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const recentlyPlayedHtml = await readFile(path.join(repoRoot, 'recently-played.html'), 'utf8');
const aboutEnHtml = await readFile(path.join(repoRoot, 'about.en.html'), 'utf8');
const aboutPlHtml = await readFile(path.join(repoRoot, 'about.pl.html'), 'utf8');
const licensesHtml = await readFile(path.join(repoRoot, 'about', 'licenses.html'), 'utf8');
const termsEnHtml = await readFile(path.join(repoRoot, 'legal', 'terms.en.html'), 'utf8');
const termsPlHtml = await readFile(path.join(repoRoot, 'legal', 'terms.pl.html'), 'utf8');
const privacyEnHtml = await readFile(path.join(repoRoot, 'legal', 'privacy.en.html'), 'utf8');
const privacyPlHtml = await readFile(path.join(repoRoot, 'legal', 'privacy.pl.html'), 'utf8');
const xpHtml = await readFile(path.join(repoRoot, 'xp.html'), 'utf8');
let playHtml = null;
try {
  playHtml = await readFile(path.join(repoRoot, 'play.html'), 'utf8');
} catch (_err) {
  playHtml = null;
}
const gameHtml = await readFile(path.join(repoRoot, 'game.html'), 'utf8');
const gameCatsHtml = await readFile(path.join(repoRoot, 'game_cats.html'), 'utf8');
const gameTrexHtml = await readFile(path.join(repoRoot, 'game_trex.html'), 'utf8');
const pokerIndex = await readFile(path.join(repoRoot, 'poker', 'index.html'), 'utf8');
const pokerTable = await readFile(path.join(repoRoot, 'poker', 'table-v2.html'), 'utf8');
const portalCss = await readFile(path.join(repoRoot, 'css', 'portal.css'), 'utf8');
const gameCss = await readFile(path.join(repoRoot, 'css', 'game.css'), 'utf8');
const xpHtmlFiles = [
  accountHtml,
  adminHtml,
  indexHtml,
  gameHtml,
  gameTrexHtml,
  pokerIndex,
  pokerTable,
  playHtml || '',
  xpHtml,
];

test('topbar ensures chip badge creation when missing', () => {
  assert.match(topbarSource, /CHIP_BADGE_HREF\s*=\s*['"]\/account\.html#chipPanel['"]/);
  assert.match(topbarSource, /ensureChipBadge/);
  assert.match(topbarSource, /badge\.id\s*=\s*['"]chipBadge['"]/);
  assert.match(topbarSource, /amount\.id\s*=\s*['"]chipBadgeAmount['"]/);
  assert.match(topbarSource, /bonus\.id\s*=\s*['"]welcomeBonusTopbarBadge['"]/);
  assert.match(topbarSource, /fetchWelcomeBonusStatus/);
  assert.match(topbarSource, /refreshWelcomeBonusBadge/);
  assert.match(topbarSource, /badge\.hidden\s*=\s*true/);
  assert.match(topbarSource, /if\s*\(!isAuthed\(\)\)/);
  assert.match(topbarSource, /CH:\s/);
  assert.ok(!topbarSource.includes('options.show'));
  assert.ok(!topbarSource.includes('_user || _session'));
  assert.ok(!topbarSource.includes('ensureChipsClientLoaded'));
  assert.ok(!topbarSource.includes('chipsClientScript'));
  assert.match(topbarSource, /setAuthDataset\(['"]out['"]\)/);
  assert.match(topbarSource, /badge\.hidden\s*=\s*!isAuthed\(\)/);
  assert.match(topbarSource, /__topbarBooted/);
  assert.match(topbarSource, /welcomeBonusRequestGeneration/);
  assert.match(topbarSource, /invalidateWelcomeBonusBadge/);
  assert.match(topbarSource, /pageTransition/);
  assert.match(topbarSource, /if\s*\(!event\.defaultPrevented\)\s*show\(\)/);
  assert.doesNotMatch(topbarSource, /event\.preventDefault\(\)/);
  assert.doesNotMatch(topbarSource, /location\.assign\(/);
  assert.doesNotMatch(topbarSource, /addEventListener\(['"]click['"][\s\S]{0,500},\s*true\s*\)/);
  assert.match(portalCss, /\.page-transition/);
  [accountHtml, favoritesHtml, recentlyPlayedHtml, xpHtml].forEach((content) => {
    assert.match(content, /id="pageBoot"/);
    assert.match(content, /\.page-boot__shell/);
    assert.match(content, /animation:page-boot-failsafe \.2s ease 3s forwards/);
    assert.match(content, /@keyframes page-boot-failsafe\{to\{opacity:0;visibility:hidden;pointer-events:none\}\}/);
    assert.ok(content.indexOf('.page-boot{') < content.indexOf('css/portal.css'));
    assert.ok(content.indexOf('id="pageBoot"') < content.indexOf('class="topbar"'));
  });
  assert.match(topbarSource, /pageBoot\.hidden\s*=\s*true/);
});

test('topbar pages load topbar script', () => {
  const topbarScript = /\/?js\/topbar\.js/;
  assert.match(indexHtml, topbarScript);
  assert.match(accountHtml, topbarScript);
  if (playHtml) assert.match(playHtml, topbarScript);
  assert.match(gameHtml, topbarScript);
  assert.match(gameTrexHtml, topbarScript);
  assert.match(pokerIndex, topbarScript);
  assert.doesNotMatch(pokerTable, topbarScript);
});

test('root pages use relative topbar and format scripts', () => {
  const relativeTopbar = /src="js\/topbar\.js"/;
  const relativeFormat = /src="js\/core\/number-format\.js"/;
  const relativeChips = /src="js\/chips\/client\.js"/;
  const absoluteTopbar = /src="\/js\/topbar\.js"/;
  const absoluteFormat = /src="\/js\/core\/number-format\.js"/;
  const absoluteChips = /src="\/js\/chips\/client\.js"/;
  const rootPages = [
    accountHtml,
    adminHtml,
    indexHtml,
    gameHtml,
    gameCatsHtml,
    gameTrexHtml,
    favoritesHtml,
    recentlyPlayedHtml,
    aboutEnHtml,
    aboutPlHtml,
    xpHtml,
    playHtml || '',
  ];
  rootPages.forEach((content) => {
    if (!content) return;
    assert.match(content, relativeTopbar);
    assert.match(content, relativeFormat);
    assert.match(content, relativeChips);
    assert.ok(!absoluteTopbar.test(content));
    assert.ok(!absoluteFormat.test(content));
    assert.ok(!absoluteChips.test(content));
  });
  assert.match(accountHtml, /src="js\/chips\/client\.js"/);
  assert.match(pokerIndex, absoluteTopbar);
  assert.match(pokerIndex, absoluteFormat);
  assert.match(pokerIndex, absoluteChips);
  assert.doesNotMatch(pokerTable, absoluteTopbar);
  assert.doesNotMatch(pokerTable, absoluteFormat);
  assert.doesNotMatch(pokerTable, absoluteChips);
});

test('topbar scripts load once per page', () => {
  const scripts = [
    /src="js\/topbar\.js"/g,
    /src="js\/core\/number-format\.js"/g,
    /src="js\/chips\/client\.js"/g,
  ];
  const rootPages = [
    accountHtml,
    adminHtml,
    indexHtml,
    gameHtml,
    gameCatsHtml,
    gameTrexHtml,
    favoritesHtml,
    recentlyPlayedHtml,
    aboutEnHtml,
    aboutPlHtml,
    xpHtml,
    playHtml || '',
  ];
  rootPages.forEach((content) => {
    if (!content) return;
    scripts.forEach((pattern) => {
      const matches = content.match(pattern) || [];
      assert.equal(matches.length, 1);
    });
  });
  const pokerScripts = [
    /src="\/js\/topbar\.js"/g,
    /src="\/js\/core\/number-format\.js"/g,
    /src="\/js\/chips\/client\.js"/g,
  ];
  [pokerIndex].forEach((content) => {
    pokerScripts.forEach((pattern) => {
      const matches = content.match(pattern) || [];
      assert.equal(matches.length, 1);
    });
  });
  pokerScripts.forEach((pattern) => {
    const matches = pokerTable.match(pattern) || [];
    assert.equal(matches.length, 0);
  });
});

test('nested legal pages use absolute chips/topbar dependencies', () => {
  const nestedPages = [
    licensesHtml,
    termsEnHtml,
    termsPlHtml,
    privacyEnHtml,
    privacyPlHtml,
  ];
  const absoluteChips = /src="\/js\/chips\/client\.js"/g;
  const absoluteFormat = /src="\/js\/core\/number-format\.js"/g;
  const absoluteTopbar = /src="\/js\/topbar\.js"/g;
  const absoluteSupabaseClient = /src="\/js\/auth\/supabaseClient\.js"/g;
  const nestedRelativeDependency = /src="(?:\.\.\/)?js\/(chips\/client|core\/number-format|topbar|auth\/supabaseClient)\.js"/;
  nestedPages.forEach((content) => {
    assert.equal((content.match(absoluteChips) || []).length, 1);
    assert.equal((content.match(absoluteFormat) || []).length, 1);
    assert.equal((content.match(absoluteTopbar) || []).length, 1);
    assert.equal((content.match(absoluteSupabaseClient) || []).length, 1);
    assert.ok(!nestedRelativeDependency.test(content));
    const supabaseIndex = content.indexOf('/js/auth/supabaseClient.js');
    const chipsIndex = content.indexOf('/js/chips/client.js');
    const formatIndex = content.indexOf('/js/core/number-format.js');
    const topbarIndex = content.indexOf('/js/topbar.js');
    assert.ok(supabaseIndex > -1);
    assert.ok(chipsIndex > -1);
    assert.ok(formatIndex > -1);
    assert.ok(topbarIndex > -1);
    assert.ok(supabaseIndex < topbarIndex);
    assert.ok(chipsIndex < topbarIndex);
    assert.ok(formatIndex < topbarIndex);
  });
});

test('chip badge is only provided by topbar', () => {
  assert.ok(!accountHtml.includes('id="chipBadge"'));
  assert.ok(!adminHtml.includes('id="chipBadge"'));
});

test('chip badge styles only live in portal css', () => {
  assert.match(portalCss, /\.chip-pill/);
  assert.match(portalCss, /\.welcome-bonus-badge/);
  assert.match(portalCss, /--topbar-offset/);
  assert.match(portalCss, /safe-area-inset-top/);
  assert.match(portalCss, /html\[data-auth="in"\]\s*#chipBadge/);
  assert.match(portalCss, /html\[data-auth="out"\]\s*#chipBadge/);
  assert.ok(!gameCss.includes('.chip-pill'));
});

test('game pages load portal css for topbar styles', () => {
  assert.match(gameHtml, /css\/portal\.css/);
  assert.match(gameCatsHtml, /css\/portal\.css/);
  assert.match(gameTrexHtml, /css\/portal\.css/);
  if (playHtml) assert.match(playHtml, /css\/portal\.css/);
});

test('compact number formatting helpers exist', () => {
  assert.match(topbarSource, /ArcadeFormat/);
  assert.match(formatSource, /formatCompactNumber/);
  assert.ok(!topbarSource.includes('formatCompactNumber'));
  assert.ok(!xpCoreSource.includes('formatCompactNumber'));
});

test('xp badge placeholders are compact', () => {
  xpHtmlFiles.forEach((content) => {
    if (!content) return;
    assert.ok(!content.includes('Syncing XP'));
    assert.match(content, /xp-badge__label[^>]*>\s*XP\s*</);
  });
});

test('poker pages place xp badge inside topbar', () => {
  assert.match(pokerIndex, /topbar-right[\s\S]*id="xpBadge"/);
  assert.doesNotMatch(pokerTable, /topbar-right[\s\S]*id="xpBadge"/);
  assert.match(pokerTable, /id="xpBadge"/);
});

test('poker pages boot the XP renderer after loading the XP core', () => {
  for (const content of [pokerIndex, pokerTable]) {
    assert.match(content, /src="\/js\/xp\.js"/);
    assert.ok(content.indexOf('/js/xp/core.js') < content.indexOf('/js/xp.js'));
  }
});

async function topbarProfileFixture(options) {
  const vm = await import('node:vm');
  const opts = typeof options === 'function' ? { respond: options } : (options || {});
  let user = { id: 'user-a' }, callback, profileReads = 0;
  const topbar = opts.topbar || {
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
  };
  const label = { textContent: '' };
  const menuName = { textContent: '' };
  const docListeners = {};
  const stubNode = () => ({ attributes: {}, addEventListener() {}, setAttribute(k, v) { this.attributes[k] = String(v); }, classList: { add() {}, remove() {}, toggle() {} } });
  const shell = opts.withAvatarShell ? stubNode() : null;
  const button = opts.withAvatarShell ? stubNode() : null;
  const document = {
    readyState: 'complete',
    getElementById: (id) => {
      if (id === 'avatarLabel') return label;
      if (id === 'avatarMenuName') return menuName;
      if (id === 'avatarShell') return shell;
      if (id === 'avatarButton') return button;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: (sel) => sel === '.topbar' ? [topbar] : [],
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    documentElement: { dataset: {} },
  };
  const window = {
    document,
    location: { origin: 'https://arcade.test', protocol: 'https:', search: '', hash: '' },
    SUPABASE_CONFIG: { SUPABASE_URL: 'https://stage.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    supabase: {
      createClient: () => ({
        auth: {
          getSession() { return Promise.resolve({ data: { session: user ? { user, access_token: 'test-token' } : null } }); },
          onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
        },
      }),
    },
  };
  if (!opts.withoutProfileClient) {
    window.ProfileClient = {
      clear() {},
      getMe: async () => {
        profileReads++;
        if (typeof opts.respond === 'function') return opts.respond();
        return { displayName: 'Player', avatar: { variant: 'wizard-indigo' } };
      },
    };
  }
  const fetchImpl = opts.fetch || (async () => ({ ok: true, json: async () => ({ displayName: 'Player' }) }));
  window.fetch = fetchImpl;
  vm.runInNewContext(await readFile(path.join(repoRoot, 'js', 'auth', 'supabaseClient.js'), 'utf8'), {
    window,
    document,
    fetch: fetchImpl,
    Promise,
    console,
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  return {
    flush,
    topbar,
    get profileReads() { return profileReads; },
    get renderedName() { return menuName.textContent || label.textContent; },
    dispatch(type, detail) { (docListeners[type] || []).forEach((fn) => fn({ type, detail })); },
    emit(event, next = user) {
      user = next;
      callback(event, user ? { user } : null);
    },
  };
}

test('topbar skips profile refresh on same-user auth event after a published profile', async () => {
  const f = await topbarProfileFixture();
  assert.equal(f.profileReads, 1);
  f.emit('TOKEN_REFRESHED');
  await f.flush();
  f.emit('SIGNED_IN');
  await f.flush();
  assert.equal(f.profileReads, 1, 'same-user events must not trigger new ProfileClient.getMe');
});

test('topbar profile read failure clears the mark so next same-user event retries', async () => {
  let shouldFail = true;
  const f = await topbarProfileFixture(() => {
    if (shouldFail) throw new Error('profile_network_error');
    return { displayName: 'Player' };
  });
  assert.equal(f.profileReads, 1);
  shouldFail = false;
  f.emit('TOKEN_REFRESHED');
  await f.flush();
  assert.equal(f.profileReads, 2, 'subsequent event after failure must retry profile read');
});

test('topbar reads profile again after user change', async () => {
  const f = await topbarProfileFixture();
  assert.equal(f.profileReads, 1);
  f.emit('SIGNED_IN', { id: 'user-b' });
  await f.flush();
  assert.equal(f.profileReads, 2, 'user change must trigger new profile read');
});

test('topbar late failure of user A after user B profile confirmed does not clear B mark or change UI state', async () => {
  let rejectA;
  const holdA = new Promise((_, reject) => { rejectA = reject; });
  let readCount = 0;
  const f = await topbarProfileFixture(() => {
    readCount++;
    if (readCount === 1) {
      return holdA;
    }
    return { displayName: 'User B' };
  });
  assert.equal(f.profileReads, 1);

  f.emit('SIGNED_IN', { id: 'user-b' });
  await f.flush();
  assert.equal(f.profileReads, 2);
  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'ready');

  rejectA(new Error('user_a_network_failure'));
  await f.flush();

  f.emit('TOKEN_REFRESHED', { id: 'user-b' });
  await f.flush();
  assert.equal(f.profileReads, 2, 'late failure of user A must not clear user B confirmation mark');
  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'ready', 'user B UI state must remain ready after late failure of user A');
});

test('topbar without ProfileClient does not suppress profile fetch on same-user event', async () => {
  let fallbackFetches = 0;
  const f = await topbarProfileFixture({
    withoutProfileClient: true,
    fetch: async () => {
      fallbackFetches++;
      return {
        ok: true,
        json: async () => ({ displayName: 'Legal User' }),
      };
    },
  });
  assert.equal(fallbackFetches, 1, 'initial user load performs fallback fetch');

  f.emit('TOKEN_REFRESHED');
  await f.flush();
  assert.equal(fallbackFetches, 2, 'same-user event without ProfileClient must re-fetch profile');
});

test('topbar A -> sign-out -> A race without UserUiState does not clear mark or overwrite profile on late resolution', async () => {
  let releaseA1, rejectA1;
  const holdA1 = new Promise((resolve, reject) => { releaseA1 = resolve; rejectA1 = reject; });
  let readCount = 0;

  const f = await topbarProfileFixture({
    respond: () => {
      readCount++;
      if (readCount === 1) return holdA1;
      return { displayName: 'User A Fresh' };
    },
  });
  assert.equal(f.profileReads, 1);

  // Sign out
  f.emit('SIGNED_OUT', null);
  await f.flush();

  // Sign in as user A again (session 2)
  f.emit('SIGNED_IN', { id: 'user-a' });
  await f.flush();
  assert.equal(f.profileReads, 2);
  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'ready');

  // Late rejection of session 1 read: must not clear user A mark and UI state must stay ready
  rejectA1(new Error('read_1_aborted'));
  await f.flush();

  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'ready', 'state must stay ready after late rejection of session 1 read');

  // Then a same-user event makes no new read
  f.emit('TOKEN_REFRESHED', { id: 'user-a' });
  await f.flush();
  assert.equal(f.profileReads, 2, 'same-user event after session 2 confirmation must not make a new read');
});

test('topbar A -> sign-out -> A race without UserUiState: late success does not overwrite fresh profile', async () => {
  let releaseA1;
  const holdA1 = new Promise((resolve) => { releaseA1 = resolve; });
  let readCount = 0;

  const f = await topbarProfileFixture({
    respond: () => {
      readCount++;
      if (readCount === 1) return holdA1;
      return { displayName: 'User A Fresh' };
    },
  });
  assert.equal(f.profileReads, 1);

  // Sign out
  f.emit('SIGNED_OUT', null);
  await f.flush();

  // Sign in as user A again (session 2)
  f.emit('SIGNED_IN', { id: 'user-a' });
  await f.flush();
  assert.equal(f.profileReads, 2);
  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'ready');
  assert.equal(f.renderedName, 'User A Fresh');

  // Late resolution of session 1 read: must not overwrite fresh profile
  releaseA1({ displayName: 'Old A' });
  await f.flush();
  assert.equal(f.renderedName, 'User A Fresh', 'late resolution must not overwrite rendered name');

  // Mark must still be from second session, same-user event makes no new read
  f.emit('TOKEN_REFRESHED', { id: 'user-a' });
  await f.flush();
  assert.equal(f.profileReads, 2, 'same-user event must not make a new read');
  assert.equal(f.renderedName, 'User A Fresh', 'rendered name must stay User A Fresh');
});

test('topbar without ProfileClient: late fallback success renders because only user-id check applies', async () => {
  let releaseA1;
  const holdA1 = new Promise((resolve) => { releaseA1 = resolve; });
  let fetchCount = 0;

  const f = await topbarProfileFixture({
    withoutProfileClient: true,
    fetch: async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await holdA1;
        return { ok: true, json: async () => ({ displayName: 'User A Overwritten' }) };
      }
      return { ok: true, json: async () => ({ displayName: 'User A Fresh' }) };
    },
  });

  // Sign out
  f.emit('SIGNED_OUT', null);
  await f.flush();

  // Sign in as user A again (session 2)
  f.emit('SIGNED_IN', { id: 'user-a' });
  await f.flush();
  assert.equal(f.renderedName, 'User A Fresh');

  // Late resolution of session 1 read: with no ProfileClient, old main behaviour renders
  releaseA1();
  await f.flush();
  assert.equal(f.renderedName, 'User A Overwritten', 'without ProfileClient, old main behaviour renders late response');
});

test('topbar without ProfileClient: late fallback failure keeps the main handling', async () => {
  let releaseA1;
  const holdA1 = new Promise((resolve) => { releaseA1 = resolve; });
  let fetchCount = 0;
  const f = await topbarProfileFixture({
    withoutProfileClient: true,
    fetch: async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await holdA1;
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ displayName: 'User A Fresh' }) };
    },
  });
  f.emit('SIGNED_OUT', null);
  await f.flush();
  f.emit('SIGNED_IN', { id: 'user-a' });
  await f.flush();
  assert.equal(f.renderedName, 'User A Fresh');
  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'ready');
  // Unchanged fallback: a late failure of the same user id still updates the presentation, as on main.
  releaseA1();
  await f.flush();
  assert.equal(f.topbar.getAttribute('data-user-ui-state'), 'loading');
});

test('topbar shows the saved profile after profile:updated and keeps it on the next same-user event', async () => {
  const f = await topbarProfileFixture({ withAvatarShell: true, respond: () => ({ displayName: 'User A Before' }) });
  assert.equal(f.renderedName, 'User A Before');
  const readsBefore = f.profileReads;
  // A profile write announces the saved profile (ProfileClient.updateMe / avatar save paths).
  f.dispatch('profile:updated', { displayName: 'User A Saved' });
  await f.flush();
  assert.equal(f.renderedName, 'User A Saved', 'the saved profile must replace the confirmed one');
  f.emit('TOKEN_REFRESHED');
  await f.flush();
  assert.equal(f.profileReads, readsBefore, 'a same-user event after a published save must not read again');
  assert.equal(f.renderedName, 'User A Saved', 'the next same-user event must keep the saved profile, not an older one');
});
