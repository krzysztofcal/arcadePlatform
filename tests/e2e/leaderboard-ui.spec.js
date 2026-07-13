const { test, expect } = require('@playwright/test');

const USER_ID = '00000000-0000-4000-8000-000000000099';

async function mockShell(page){
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/js/vendor/klaro/klaro.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/js/auth/supabase-config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://stage-test.supabase.co', SUPABASE_ANON_KEY: 'test-key' };
    window.supabase = { createClient: function(){ return { auth: {
      getSession: function(){ return Promise.resolve({ data: { session: { access_token: 'leaderboard-token', user: { id: '${USER_ID}', email: 'private@example.test' } } } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signOut: function(){ return Promise.resolve(); }
    } }; } };
  ` }));
  await page.route('**/.netlify/functions/profile-me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ displayName: 'Ranked Player', avatar: { type: 'default', variant: 'fox-blue' } }) }));
  await page.route('**/.netlify/functions/calculate-xp', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'statusOnly', totalLifetime: 450 }) }));
  await page.route('**/.netlify/functions/chips-balance', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { balance: 125 } }) }));
  await page.route('**/.netlify/functions/bonus-campaigns**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ campaigns: [] }) }));
}

function row(rank, handle, displayName, xp, level, variant){
  return { rank, handle, displayName, avatar: { type: 'default', variant: variant || 'fox-blue' }, xp, level, profileUrl: `/u/${handle}` };
}

test('renders podium, dense rows, outside-page position and period navigation', async ({ page }) => {
  await mockShell(page);
  const requests = [];
  await page.route('**/.netlify/functions/xp-leaderboard?**', (route) => {
    const url = new URL(route.request().url());
    requests.push({ period: url.searchParams.get('period'), page: url.searchParams.get('page') });
    const period = url.searchParams.get('period');
    const pageNumber = Number(url.searchParams.get('page'));
    if (period === 'today') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ period, periodKey: '2026-07-13', nextResetAt: Date.parse('2026-07-14T01:00:00Z'), page: 1, limit: 25, hasMore: false, rows: [] }) });
    const rows = pageNumber === 2
      ? [row(26, 'page-two-player', 'Page Two Player', 40, 2, 'orbit-green')]
      : [row(1, 'alpha-ace', 'Alpha Ace', 900, 6, 'comet-blue'), row(2, 'beta-bolt', 'Beta Bolt', 700, 5, 'falcon-orange'), row(2, 'cosmic-comet', 'Cosmic Comet', 700, 5, 'nova-purple'), row(4, 'delta-dash', 'Delta Dash', 500, 4, 'panda-pink')];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ period, periodKey: 'all_time', nextResetAt: null, page: pageNumber, limit: 25, hasMore: pageNumber === 1, rows }) });
  });
  await page.route('**/.netlify/functions/xp-leaderboard-me?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ period: 'all_time', periodKey: 'all_time', nextResetAt: null, me: row(42, 'ranked-player', 'Ranked Player', 450, 4, 'fox-blue') }) }));

  await page.goto('/leaderboard.html?period=all_time', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#leaderboardResults')).toBeVisible();
  await expect(page.locator('#leaderboardPodium > li')).toHaveCount(3);
  await expect(page.locator('#leaderboardList > li')).toHaveCount(1);
  await expect(page.locator('#leaderboardPodium > li').first()).toContainText('#1');
  await expect(page.locator('#leaderboardMe')).toBeVisible();
  await expect(page.locator('#leaderboardMe')).toContainText('#42');
  await expect(page.locator('#leaderboardMe a')).toHaveAttribute('href', '/u/ranked-player');
  await expect(page.locator('#xpBadge .xp-badge__label')).toHaveText('Lvl 4, 450 XP');
  await page.locator('.site-footer [data-lang="pl"]').click();
  await expect(page.locator('#leaderboardTitle')).toHaveText('Ranking XP');
  await expect(page.locator('#leaderboardPageNumber')).toHaveText('Strona 1');
  await page.locator('.site-footer [data-lang="en"]').click();
  await expect(page.locator('#leaderboardTitle')).toHaveText('XP Leaderboard');

  await page.locator('#leaderboardNext').click();
  await expect(page.locator('#leaderboardList')).toContainText('Page Two Player');
  await expect(page.locator('#leaderboardPageNumber')).toHaveText('Page 2');
  expect(requests.some((request) => request.page === '2')).toBe(true);

  await page.locator('[data-period="today"]').click();
  await expect(page.locator('#leaderboardStateTitle')).toHaveText('The ranking is warming up');
  await expect(page).toHaveURL(/period=today/);
  expect(requests.some((request) => request.period === 'today' && request.page === '1')).toBe(true);
});

test('shows a retryable rate-limit state without provisional score rows', async ({ page }) => {
  await mockShell(page);
  await page.route('**/.netlify/functions/xp-leaderboard?**', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limit_exceeded' }) }));
  await page.route('**/.netlify/functions/xp-leaderboard-me?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ me: null }) }));
  await page.goto('/leaderboard.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#leaderboardStateTitle')).toHaveText('Please wait a moment');
  await expect(page.locator('#leaderboardResults')).toBeHidden();
  await expect(page.locator('#leaderboardPodium > li')).toHaveCount(0);
  await expect(page.locator('#leaderboardRetry')).toBeVisible();
});
