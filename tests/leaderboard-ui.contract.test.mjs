import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, controller, badge, sidebar, i18n, css] = await Promise.all([
  read('leaderboard.html'),
  read('js/leaderboard-page.js'),
  read('js/xp/badge-display.js'),
  read('js/core/sidebar-model.js'),
  read('js/i18n.js'),
  read('css/leaderboard.css'),
]);

test('leaderboard page uses the shared shell without gameplay XP modules', () => {
  assert.match(html, /id="leaderboardTitle"/);
  assert.match(html, /id="leaderboardPodium"/);
  assert.match(html, /id="leaderboardList"/);
  assert.match(html, /id="leaderboardMe"/);
  assert.match(html, /id="leaderboardPageEmpty"/);
  assert.match(html, /data-period="today"/);
  assert.match(html, /data-period="week"/);
  assert.match(html, /data-period="all_time"/);
  assert.match(html, /src="\/js\/leaderboard-page\.js"/);
  assert.match(html, /src="\/js\/xp\/badge-display\.js"/);
  assert.doesNotMatch(html, /src="\/js\/xp\/(?:core|combo|scoring)\.js"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i);
  for (const asset of html.matchAll(/(?:src|href)="((?:css|js)\/[^"?#]+|\.?\.\/[^"?#]+)"/g)) {
    assert.fail(`leaderboard asset must be root-absolute: ${asset[1]}`);
  }
});

test('leaderboard UI keeps a public/auth cache boundary and safe DOM projection', () => {
  assert.match(controller, /\.netlify\/functions\/xp-leaderboard['"]/);
  assert.match(controller, /\.netlify\/functions\/xp-leaderboard-me['"]/);
  assert.match(controller, /credentials:\s*'omit'/);
  assert.match(controller, /Authorization:\s*'Bearer '\s*\+\s*token/);
  assert.match(controller, /error\.status\s*===\s*429/);
  assert.match(controller, /error\.status\s*===\s*404/);
  assert.match(controller, /showState\('empty'\)/);
  assert.match(controller, /state\.page\s*===\s*1\s*&&\s*!state\.hasMore/);
  assert.match(controller, /renderEmptyPage\(data, me\)/);
  assert.match(controller, /document\.createElement/);
  assert.doesNotMatch(controller, /innerHTML/);
  assert.match(controller, /new Set\(rows\.map/);
  assert.match(controller, /nodes\.me\.hidden\s*=\s*!me\s*\|\|\s*loadedHandles\.has/);
  assert.match(controller, /state\.meGeneration\s*\+=\s*1/);
  assert.match(controller, /generation\s*!==\s*state\.meGeneration/);
});

test('leaderboard row validation rejects unsafe public projection values', () => {
  const document = { readyState: 'loading', addEventListener() {} };
  const window = { document, location: { search: '' } };
  window.window = window;
  vm.runInNewContext(controller, { window, document, URLSearchParams, Intl, Date, Number, Set, AbortController, Promise });
  const normalize = window.LeaderboardPage.normalizeRow;
  assert.equal(normalize({ rank: 1, handle: 'safe-player', displayName: 'Safe Player', xp: 300, level: 3, avatar: { type: 'default', variant: 'fox-blue' } }).profileUrl, '/u/safe-player');
  assert.equal(normalize({ rank: 1, handle: '../admin', displayName: 'Unsafe', xp: 300, level: 3 }), null);
  assert.equal(normalize({ rank: 1, handle: 'safe-player', displayName: 'Unsafe', xp: -1, level: 3 }), null);
  assert.equal(normalize({ rank: 1, handle: 'safe-player', displayName: 'Unsafe', xp: 3, level: 0 }), null);
});

test('light XP badge adapter supports status hydration without gameplay lifecycle', () => {
  assert.match(badge, /refreshFromServerStatus/);
  assert.match(badge, /resetIdentityCache/);
  assert.match(badge, /getSnapshot/);
  assert.doesNotMatch(badge, /startSession|postWindow|reportGameAction|inputEvents|scorePulse/);
  assert.doesNotMatch(badge, /console\.(?:log|debug|warn|error)/);
});

test('sidebar, localization and responsive styles expose the complete leaderboard surface', () => {
  assert.match(sidebar, /id:\s*'leaderboard'[\s\S]*href:\s*'\/leaderboard\.html'/);
  for (const key of ['leaderboardPageTitle', 'leaderboardToday', 'leaderboardWeek', 'leaderboardAllTime', 'leaderboardWarmupTitle', 'leaderboardPageEmptyTitle', 'leaderboardPageEmptyText', 'leaderboardRateLimitTitle', 'leaderboardYourPosition']) {
    assert.match(i18n, new RegExp(`${key}:\\s*\\{\\s*en:[\\s\\S]*?pl:`));
  }
  assert.match(css, /\.leaderboard-podium/);
  assert.match(css, /\.leaderboard-entry--me/);
  assert.match(css, /@media \(max-width:820px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
