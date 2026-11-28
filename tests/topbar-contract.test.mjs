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
  // poker/table-v2.html has its own live topbar without the XP badge.
  assert.doesNotMatch(pokerTable, /\bid\s*=\s*["']?xpBadge\b/);
});

test('poker pages boot the XP renderer after loading the XP core', () => {
  for (const content of [pokerIndex]) {
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
    readyState: opts.readyState || 'complete',
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
  if (opts.chipsClient) {
    window.ChipsClient = opts.chipsClient;
  }
  if (opts.userUiState) {
    window.UserUiState = opts.userUiState;
  }
  if (!opts.withoutProfileClient) {
    window.ProfileClient = {
      clear() {},
      getMe: async (force, getMeOpts) => {
        profileReads++;
        if (typeof opts.respond === 'function') return opts.respond(force, getMeOpts);
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
    window,
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

test('topbar with ProfileClient and ChipsClient issues includePoker read and strips balance and poker', async () => {
  const getMeCalls = [];
  const published = [];
  const f = await topbarProfileFixture({
    chipsClient: { fetchBalance() {} },
    userUiState: {
      isCurrent: () => true,
      publish: (userId, slice, val) => { published.push({ userId, slice, val }); },
      markSliceApplied: () => {},
      hydrate: () => ({ generation: 1, profile: null }),
    },
    respond: (force, options) => {
      getMeCalls.push({ force, options });
      return { displayName: 'Player With Poker', balance: 1250, poker: { inPoker: true, tables: [] }, avatar: { variant: 'wizard-indigo' } };
    },
  });
  assert.equal(getMeCalls.length, 1);
  assert.equal(getMeCalls[0].force, false);
  assert.equal(getMeCalls[0].options?.includePoker, true);
  assert.equal(f.renderedName, 'Player With Poker');
  assert.equal(published.length, 1);
  assert.equal(published[0].slice, 'profile');
  assert.equal('balance' in published[0].val, false);
  assert.equal('poker' in published[0].val, false);
  assert.equal(published[0].val.displayName, 'Player With Poker');
});

test('topbar with ProfileClient falls back to plain getMe() if includePoker read rejects', async () => {
  const getMeCalls = [];
  const published = [];
  let shouldFailPoker = true;
  const f = await topbarProfileFixture({
    chipsClient: { fetchBalance() {} },
    userUiState: {
      isCurrent: () => true,
      publish: (userId, slice, val) => { published.push({ userId, slice, val }); },
      markSliceApplied: () => {},
      hydrate: () => ({ generation: 1, profile: null }),
    },
    respond: (force, options) => {
      getMeCalls.push({ force, options });
      if (options && options.includePoker && shouldFailPoker) {
        throw new Error('include_poker_balance_error');
      }
      return { displayName: 'Player Avatar Fallback', avatar: { variant: 'wizard-indigo' } };
    },
  });
  assert.equal(getMeCalls.length, 2);
  assert.equal(getMeCalls[0].force, false);
  assert.equal(getMeCalls[0].options?.includePoker, true);
  assert.equal(getMeCalls[1].options, undefined);
  assert.equal(f.renderedName, 'Player Avatar Fallback');
  assert.equal(published.length, 1);
  assert.equal('balance' in published[0].val, false);
  assert.equal('poker' in published[0].val, false);
});

test('topbar without ProfileClient shares raw in-flight reads for same user and session generation', async () => {
  let releaseRaw;
  const holdRaw = new Promise((resolve) => { releaseRaw = resolve; });
  let rawFetches = 0;
  const f = await topbarProfileFixture({
    withoutProfileClient: true,
    fetch: async () => {
      rawFetches++;
      await holdRaw;
      return { ok: true, json: async () => ({ displayName: 'User Shared Raw' }) };
    },
  });
  f.emit('INITIAL_SESSION');
  f.emit('TOKEN_REFRESHED');
  await f.flush();
  assert.equal(rawFetches, 1, 'concurrent same-user reads in the same generation must share one fetch');
  releaseRaw();
  await f.flush();
  assert.equal(f.renderedName, 'User Shared Raw');
});

test('ProfileClient present, ChipsClient absent before DOMContentLoaded and present after issues exactly one includePoker read', async () => {
  const getMeCalls = [];
  const f = await topbarProfileFixture({
    readyState: 'interactive',
    respond: (force, options) => {
      getMeCalls.push({ force, options });
      return { displayName: 'Player With Late Chips', avatar: { variant: 'wizard-indigo' } };
    },
  });
  await f.flush();
  assert.equal(getMeCalls.length, 0, 'must not call getMe before DOMContentLoaded when ChipsClient is absent');
  f.window.ChipsClient = { fetchBalance() {} };
  f.dispatch('DOMContentLoaded');
  await f.flush();
  assert.equal(getMeCalls.length, 1, 'must issue exactly one getMe call after DOMContentLoaded');
  assert.equal(getMeCalls[0].force, false);
  assert.equal(getMeCalls[0].options?.includePoker, true);
  assert.equal(f.renderedName, 'Player With Late Chips');
});

test('stale session during includePoker rejection does not call fallback getMe', async () => {
  const getMeCalls = [];
  let rejectPoker;
  const holdPoker = new Promise((_, reject) => { rejectPoker = reject; });
  const f = await topbarProfileFixture({
    chipsClient: { fetchBalance() {} },
    respond: (force, options) => {
      getMeCalls.push({ force, options });
      if (options && options.includePoker) {
        return holdPoker;
      }
      return { displayName: 'Fallback Player' };
    },
  });
  f.emit('SIGNED_OUT', null);
  await f.flush();
  rejectPoker(new Error('include_poker_failed'));
  await f.flush();
  assert.equal(getMeCalls.length, 1, 'stale session must not issue fallback getMe()');
});

test('includePoker getMe rejects, fallback getMe pending: second refreshProfile shares confirmation attempt and renders once', async () => {
  const getMeCalls = [];
  let releaseFallback;
  const holdFallback = new Promise((resolve) => { releaseFallback = resolve; });
  const f = await topbarProfileFixture({
    chipsClient: { fetchBalance() {} },
    respond: (force, options) => {
      getMeCalls.push({ force, options });
      if (options && options.includePoker) {
        return Promise.reject(new Error('include_poker_failed'));
      }
      return holdFallback;
    },
  });

  await f.flush();
  assert.equal(getMeCalls.length, 2, 'must issue includePoker and fallback getMe');
  assert.equal(getMeCalls[0].options?.includePoker, true);
  assert.equal(getMeCalls[1].options, undefined);
  assert.notEqual(f.renderedName, 'Fallback Player', 'profile must not render before fallback resolves');

  f.emit('TOKEN_REFRESHED');
  await f.flush();
  assert.equal(getMeCalls.length, 2, 'must not issue a second includePoker or second fallback getMe');

  releaseFallback({ displayName: 'Fallback Player' });
  await f.flush();
  assert.equal(f.renderedName, 'Fallback Player', 'profile must render once fallback resolves');
});

test('topbar refreshChipBadge snapshot rejects with server error, fetchBalance resolves 900 -> CH badge shows 900 and exactly one fetchBalance call', async () => {
  const elements = {};
  const listeners = {};
  const doc = {
    readyState: 'complete',
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
      if (sel === '.topbar') return doc.topbarEl;
      if (sel === '#sbToggle') return null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.topbar') return [doc.topbarEl];
      if (sel === '#sbToggle') return [];
      return [];
    },
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        classList: { add() {}, remove() {}, contains: () => false },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k]; },
        hasAttribute: () => false,
        appendChild(child) {
          this.children.push(child);
          if (child.id) elements[child.id] = child;
          return child;
        },
        insertBefore(child) {
          this.children.push(child);
          if (child.id) elements[child.id] = child;
          return child;
        },
        children: [],
        querySelector: (s) => {
          if (s === '#chipBadgeAmount') return elements['chipBadgeAmount'] || null;
          if (s === '#welcomeBonusTopbarBadge') return elements['welcomeBonusTopbarBadge'] || null;
          if (s === '#chipBadgePoker') return elements['chipBadgePoker'] || null;
          if (s === '.chip-badge__label') return null;
          return null;
        },
      };
      return el;
    },
    createTextNode: (text) => ({ text }),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: (event) => {
      const type = typeof event === 'string' ? event : (event && event.type);
      (listeners[type] || []).forEach((fn) => fn(typeof event === 'string' ? { type } : event));
    },
    documentElement: { dataset: {} },
  };
  const topbarEl = doc.createElement('div');
  doc.topbarEl = topbarEl;
  const topbarRight = doc.createElement('div');
  topbarRight.className = 'topbar-right';
  topbarEl.appendChild(topbarRight);

  let fetchBalanceCalls = 0;
  let snapshotCalls = 0;
  const win = {
    document: doc,
    ProfileClient: {
      getMe: async () => ({ displayName: 'Player' }),
    },
    ChipsClient: {
      fetchTopbarSnapshot: async () => {
        snapshotCalls++;
        const err = new Error('profile_me_500');
        err.status = 500;
        throw err;
      },
      fetchBalance: async () => {
        fetchBalanceCalls++;
        return { balance: 900 };
      },
    },
    SupabaseAuth: {
      getCurrentUser: async () => ({ id: 'user-1' }),
      onAuthChange: (cb) => { win.authCb = cb; },
    },
    UserUiState: {
      getActiveContext: () => ({ userId: 'user-1', generation: 1 }),
      isCurrent: () => true,
      markActiveSliceApplied: () => {},
    },
    ArcadeFormat: {
      formatCompactNumber: (val) => String(val),
    },
  };
  win.window = win;

  const vm = await import('node:vm');
  vm.runInNewContext(topbarSource, {
    window: win,
    document: doc,
    CustomEvent: class { constructor(t, opts) { this.type = t; this.detail = opts?.detail; } },
    setTimeout,
    clearTimeout,
    Promise,
    Number,
    String,
    Math,
    Array,
    Date,
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (fetchBalanceCalls > 0) break;
  }

  assert.equal(snapshotCalls, 1, 'fetchTopbarSnapshot must be called first');
  assert.equal(fetchBalanceCalls, 1, 'fetchBalance must be called exactly once after snapshot failure');
  const amountEl = elements['chipBadgeAmount'];
  assert.ok(amountEl, 'chipBadgeAmount element must exist');
  assert.equal(amountEl.textContent, '900', 'CH badge must show 900');
});

async function setupTopbarHarness(options = {}) {
  const elements = {};
  const listeners = {};
  const doc = {
    readyState: 'complete',
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
      if (sel === '.topbar') return doc.topbarEl;
      if (sel === '#sbToggle') return null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.topbar') return [doc.topbarEl];
      if (sel === '#sbToggle') return [];
      return [];
    },
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        classList: { add() {}, remove() {}, contains: () => false },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k]; },
        hasAttribute: () => false,
        appendChild(child) {
          this.children.push(child);
          if (child.id) elements[child.id] = child;
          return child;
        },
        insertBefore(child) {
          this.children.push(child);
          if (child.id) elements[child.id] = child;
          return child;
        },
        children: [],
        querySelector: (s) => {
          if (s === '#chipBadgeAmount') return elements['chipBadgeAmount'] || null;
          if (s === '#welcomeBonusTopbarBadge') return elements['welcomeBonusTopbarBadge'] || null;
          if (s === '#chipBadgePoker') return elements['chipBadgePoker'] || null;
          if (s === '.chip-badge__label') return null;
          return null;
        },
      };
      return el;
    },
    createTextNode: (text) => ({ text }),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: (event) => {
      const type = typeof event === 'string' ? event : (event && event.type);
      (listeners[type] || []).forEach((fn) => fn(typeof event === 'string' ? { type } : event));
    },
    documentElement: { dataset: {} },
  };
  const topbarEl = doc.createElement('div');
  doc.topbarEl = topbarEl;
  const topbarRight = doc.createElement('div');
  topbarRight.className = 'topbar-right';
  topbarEl.appendChild(topbarRight);

  const win = {
    document: doc,
    ProfileClient: options.profileClient !== undefined ? options.profileClient : {
      getMe: async () => ({ displayName: 'Player' }),
    },
    ChipsClient: options.chipsClient || {
      fetchBalance: async () => ({ balance: 100 }),
    },
    SupabaseAuth: options.supabaseAuth || {
      getCurrentUser: async () => (typeof options.user === 'function' ? options.user() : (options.user !== undefined ? options.user : { id: 'user-1' })),
      onAuthChange: (cb) => { win.authCb = cb; },
    },
    UserUiState: options.userUiState || {
      getActiveContext: () => ({ userId: 'user-1', generation: 1 }),
      isCurrent: () => true,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => null,
    },
    ArcadeFormat: {
      formatCompactNumber: (val) => String(val),
    },
  };
  win.window = win;

  const vm = await import('node:vm');
  vm.runInNewContext(topbarSource, {
    window: win,
    document: doc,
    CustomEvent: class { constructor(t, opts) { this.type = t; this.detail = opts?.detail; } },
    setTimeout,
    clearTimeout,
    Promise,
    Number,
    String,
    Math,
    Array,
    Date,
  });

  return { elements, doc, win };
}

test('topbar: not_authenticated rejection from fetchWelcomeBonusStatus does not hide CH badge or sign out', async () => {
  let bonusCalls = 0;
  let balanceCalls = 0;
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        return { balance: 900 };
      },
      fetchWelcomeBonusStatus: async () => {
        bonusCalls++;
        throw notAuthErr;
      },
    },
    profileClient: null,
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (bonusCalls > 0 && balanceCalls > 0) break;
  }

  assert.equal(bonusCalls, 1, 'fetchWelcomeBonusStatus must be called');
  assert.ok(balanceCalls >= 1, 'fetchBalance must be called');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'auth state must remain signed in');
  assert.equal(harness.elements['chipBadge'].hidden, false, 'CH badge must not be hidden');
  assert.equal(harness.elements['chipBadgeAmount'].textContent, '900', 'CH badge must show balance');
  assert.equal(harness.elements['welcomeBonusTopbarBadge'].hidden, true, 'welcome bonus badge must hide on error');
});

test('topbar: not_authenticated rejection from CH read does not change auth state to SIGNED_OUT (retains cached badge)', async () => {
  let balanceCalls = 0;
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        throw notAuthErr;
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    profileClient: null,
    userUiState: {
      getActiveContext: () => ({ userId: 'user-1', generation: 1 }),
      isCurrent: () => true,
      markActiveSliceApplied: () => {},
      readActiveSlice: (slice) => (slice === 'chips' ? { balance: 350 } : null),
    },
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls > 0) break;
  }

  assert.ok(balanceCalls >= 1, 'fetchBalance must be called');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'auth state must remain signed in');
  assert.equal(harness.elements['chipBadge'].hidden, false, 'CH badge must retain cached value and stay visible');
  assert.equal(harness.elements['chipBadgeAmount'].textContent, '350', 'CH badge must show cached balance');
});

test('topbar: not_authenticated rejection from CH read without cached value hides badge but does not change auth state to SIGNED_OUT', async () => {
  let balanceCalls = 0;
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        throw notAuthErr;
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    profileClient: null,
    userUiState: {
      getActiveContext: () => ({ userId: 'user-1', generation: 1 }),
      isCurrent: () => true,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => null,
    },
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls > 0) break;
  }

  assert.ok(balanceCalls >= 1, 'fetchBalance must be called');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'auth state must remain signed in');
  assert.equal(harness.elements['chipBadge'].hidden, true, 'CH badge without cache must be hidden locally');
});

test('topbar: snapshot path not_authenticated does not change auth state to SIGNED_OUT', async () => {
  let snapshotCalls = 0;
  let balanceCalls = 0;
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: async () => {
        snapshotCalls++;
        throw notAuthErr;
      },
      fetchBalance: async () => {
        balanceCalls++;
        throw notAuthErr;
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    profileClient: {
      getMe: async () => ({ displayName: 'Player' }),
    },
    userUiState: {
      getActiveContext: () => ({ userId: 'user-1', generation: 1 }),
      isCurrent: () => true,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => null,
    },
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (snapshotCalls > 0 && balanceCalls > 0) break;
  }

  assert.equal(snapshotCalls, 1, 'fetchTopbarSnapshot must be called');
  assert.equal(balanceCalls, 1, 'fallback fetchBalance must be called');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'auth state must remain signed in');
});

test('topbar: (d) not_authenticated + getCurrentUser returns a user -> no SIGNED_OUT', async () => {
  let balanceCalls = 0;
  let getCurrentUserCalls = 0;
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        throw notAuthErr;
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    user: () => {
      getCurrentUserCalls++;
      return { id: 'user-d' };
    },
    profileClient: null,
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls > 0 && getCurrentUserCalls >= 2) break;
  }

  assert.ok(balanceCalls >= 1, 'fetchBalance must be called');
  assert.ok(getCurrentUserCalls >= 2, 'getCurrentUser must be called on initial auth and on not_authenticated error');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'auth state must remain signed in when getCurrentUser returns a user');
});

test('topbar: (e) not_authenticated + getCurrentUser returns null -> SIGNED_OUT and badges hidden', async () => {
  let balanceCalls = 0;
  let getCurrentUserCalls = 0;
  let currentUserResponse = { id: 'user-e' };
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        // Switch getCurrentUser to return null when not_authenticated occurs
        currentUserResponse = null;
        throw notAuthErr;
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    user: () => {
      getCurrentUserCalls++;
      return currentUserResponse;
    },
    profileClient: null,
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls > 0 && getCurrentUserCalls >= 2) break;
  }

  assert.ok(balanceCalls >= 1, 'fetchBalance must be called');
  assert.ok(getCurrentUserCalls >= 2, 'getCurrentUser must be checked to confirm sign-out');
  assert.equal(harness.doc.documentElement.dataset.auth, 'out', 'auth state must transition to SIGNED_OUT when getCurrentUser confirms null');
  assert.equal(harness.elements['chipBadge'].hidden, true, 'CH badge must be hidden after SIGNED_OUT');
  assert.equal(harness.elements['welcomeBonusTopbarBadge'].hidden, true, 'welcome bonus badge must be hidden after SIGNED_OUT');
});

test('topbar: (f) hidden CH badge becomes visible after a later successful balance render while signed in', async () => {
  let balanceCalls = 0;
  let returnFailure = true;

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        if (returnFailure) {
          const err = new Error('network_error');
          err.status = 500;
          throw err;
        }
        return { balance: 1250 };
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    user: { id: 'user-f' },
    profileClient: null,
    userUiState: {
      getActiveContext: () => ({ userId: 'user-f', generation: 1 }),
      isCurrent: () => true,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => null,
    },
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls > 0) break;
  }

  assert.equal(balanceCalls, 1, 'initial fetchBalance must have failed');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'top bar remains signed in');
  assert.equal(harness.elements['chipBadge'].hidden, true, 'CH badge must be hidden after failure without cached slice');

  // Now a later successful read occurs
  returnFailure = false;
  harness.doc.dispatchEvent('ui:visible');

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls >= 2 && !harness.elements['chipBadge'].hidden) break;
  }

  assert.equal(balanceCalls, 2, 'second fetchBalance must have completed');
  assert.equal(harness.elements['chipBadge'].hidden, false, 'hidden CH badge must become visible after later successful balance render');
  assert.equal(harness.elements['chipBadgeAmount'].textContent, '1250', 'CH badge text must show new balance');
});

test('topbar: (j) a stale not_authenticated (generation changed) does not hide the CH badge', async () => {
  let balanceCalls = 0;
  let rejectPending;
  const pendingPromise = new Promise((_, reject) => { rejectPending = reject; });
  let currentGen = 1;
  const notAuthErr = new Error('not_authenticated');
  notAuthErr.code = 'not_authenticated';

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => {
        balanceCalls++;
        if (balanceCalls === 1) {
          return { balance: 500 };
        }
        return pendingPromise;
      },
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    user: { id: 'user-j' },
    profileClient: null,
    userUiState: {
      getActiveContext: () => ({ userId: 'user-j', generation: currentGen }),
      isCurrent: (uid, gen) => uid === 'user-j' && gen === currentGen,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => ({ balance: 500 }),
    },
  });

  // Wait for initial render to complete with visible badge
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls >= 1 && !harness.elements['chipBadge'].hidden) break;
  }
  assert.equal(harness.elements['chipBadge'].hidden, false, 'CH badge must start visible');
  assert.equal(harness.elements['chipBadgeAmount'].textContent, '500');

  // Trigger second balance request that stays pending
  harness.doc.dispatchEvent('ui:visible');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (balanceCalls >= 2) break;
  }
  assert.equal(balanceCalls, 2, 'second balance read must be in flight');

  // Now advance context generation so request 2 becomes stale
  currentGen = 2;

  // Now request 2 rejects with not_authenticated
  rejectPending(notAuthErr);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
  }

  // Stale rejection must be ignored; CH badge must NOT be hidden
  assert.equal(harness.elements['chipBadge'].hidden, false, 'stale not_authenticated must not hide CH badge');
  assert.equal(harness.elements['chipBadgeAmount'].textContent, '500', 'stale not_authenticated must not clear CH badge amount');
  assert.equal(harness.doc.documentElement.dataset.auth, 'in', 'top bar must remain signed in');
});

test('topbar: (l) stale chip read failure does not clear the Poker badge', async () => {
  let snapshotCalls = 0;
  let rejectPending;
  const pendingPromise = new Promise((_, reject) => { rejectPending = reject; });
  let currentGen = 1;
  const errFailed = new Error('network_failure');

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: async () => {
        snapshotCalls++;
        if (snapshotCalls === 1) {
          return { balance: 500, poker: { inPoker: true, tables: [{ stack: 200 }] } };
        }
        return pendingPromise;
      },
      fetchBalance: async () => ({ balance: 500 }),
      fetchWelcomeBonusStatus: async () => ({ eligible: false }),
    },
    profileClient: {
      getMe: async () => ({ displayName: 'Player' }),
    },
    user: { id: 'user-l' },
    userUiState: {
      getActiveContext: () => ({ userId: 'user-l', generation: currentGen }),
      isCurrent: (uid, gen) => uid === 'user-l' && gen === currentGen,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => null,
    },
  });

  // Wait for initial render to complete with visible Poker badge
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (snapshotCalls >= 1 && !harness.elements['chipBadgePoker']?.hidden) break;
  }

  assert.equal(harness.elements['chipBadgePoker'].hidden, false, 'Poker badge must start visible');
  assert.equal(harness.elements['chipBadgePoker'].textContent, ' · Poker: 200 CH');

  // Trigger a second chip read that stays pending
  harness.doc.dispatchEvent('ui:visible');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (snapshotCalls >= 2) break;
  }
  assert.equal(snapshotCalls, 2, 'second snapshot read must be in flight');

  // Now advance generation so the in-flight read becomes stale
  currentGen = 2;

  // Reject the pending read
  rejectPending(errFailed);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
  }

  // Stale failure must not clear Poker badge
  assert.equal(harness.elements['chipBadgePoker'].hidden, false, 'stale chip read failure must not hide Poker badge');
  assert.equal(harness.elements['chipBadgePoker'].textContent, ' · Poker: 200 CH', 'stale chip read failure must not clear Poker badge content');
});

test('topbar: (m) welcome-bonus read in flight for A, switch to B -> B read runs after A settles and stale A failure does not hide B badge', async () => {
  let bonusCalls = 0;
  let rejectA;
  const pendingA = new Promise((_, reject) => { rejectA = reject; });
  let currentUser = { id: 'user-a' };
  let currentGen = 1;

  const harness = await setupTopbarHarness({
    chipsClient: {
      fetchTopbarSnapshot: null,
      fetchBalance: async () => ({ balance: 100 }),
      fetchWelcomeBonusStatus: async () => {
        bonusCalls++;
        if (bonusCalls === 1) {
          return pendingA;
        }
        return { eligible: true, amount: 500 };
      },
    },
    user: () => currentUser,
    profileClient: null,
    userUiState: {
      getActiveContext: () => ({ userId: currentUser.id, generation: currentGen }),
      isCurrent: (uid, gen) => uid === currentUser.id && gen === currentGen,
      markActiveSliceApplied: () => {},
      readActiveSlice: () => null,
    },
  });

  // Wait for user A's welcome bonus read to be in flight
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (bonusCalls >= 1) break;
  }
  assert.equal(bonusCalls, 1, 'user A welcome bonus read must be in flight');

  // Switch to user B via onAuthChange callback
  currentUser = { id: 'user-b' };
  currentGen = 2;
  harness.win.authCb('SIGNED_IN', currentUser, { user: currentUser });

  // A's read is still in flight, so refreshWelcomeBonusBadge queued B's refresh
  // Now A's read rejects with an error
  rejectA(new Error('stale_user_a_error'));

  // Wait for A to settle and B's read to run and settle
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setImmediate(r));
    if (bonusCalls >= 2 && !harness.elements['welcomeBonusTopbarBadge']?.hidden) break;
  }

  assert.equal(bonusCalls, 2, "user B's read must run after A settles");
  assert.equal(harness.elements['welcomeBonusTopbarBadge'].hidden, false, "user B's welcome bonus badge must be visible");
  assert.equal(harness.elements['welcomeBonusTopbarBadge'].textContent, '+500', "user B's welcome bonus badge amount must be +500");
});
