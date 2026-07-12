const { test, expect } = require('@playwright/test');

const USER_ID = 'xp-hydration-user';
const CACHE_KEY = `kcswh:user-ui:xp:v1:${USER_ID}`;

async function mockAuthenticatedSession(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/js/auth/supabase-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://stage-test.supabase.co', SUPABASE_ANON_KEY: 'test-key' };
      window.supabase = { createClient: function(){ return { auth: {
        getSession: function(){ return Promise.resolve({ data: { session: { access_token: 'test-token', user: { id: '${USER_ID}', email: 'private@example.test' } } } }); },
        onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
        signOut: function(){ return Promise.resolve(); }
      } }; } };
    `,
  }));
  await page.route('**/.netlify/functions/profile-me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ displayName: 'XP Player', avatar: { type: 'default', variant: 'fox-blue' } }),
  }));
}

test('hydrates confirmed XP without an award animation and revalidates in the background', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await page.addInitScript(({ key, userId }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      userId,
      confirmedAt: Date.now(),
      value: { totalLifetime: 300, level: 3 },
    }));
    window.__confirmedAwards = 0;
    window.addEventListener('xp:award-confirmed', () => { window.__confirmedAwards += 1; });
  }, { key: CACHE_KEY, userId: USER_ID });

  let releaseStatus;
  const statusGate = new Promise((resolve) => { releaseStatus = resolve; });
  await page.route('**/.netlify/functions/calculate-xp', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === 'status') {
      await statusGate;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'statusOnly', totalLifetime: 450, cap: 3000 }) });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected_award' }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const badge = page.locator('#xpBadge');
  await expect(badge.locator('.xp-badge__label')).toHaveText('Lvl 3, 300 XP');
  await expect(badge).not.toHaveClass(/xp-badge--bump/);
  expect(await page.evaluate(() => window.__confirmedAwards)).toBe(0);

  releaseStatus();
  await expect(badge.locator('.xp-badge__label')).toHaveText('Lvl 4, 450 XP');
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).value.totalLifetime, CACHE_KEY)).toBe(450);
  await expect(badge).not.toHaveClass(/xp-badge--bump/);
  expect(await page.evaluate(() => window.__confirmedAwards)).toBe(0);
});

test('keeps cached XP visible when status revalidation fails', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await page.addInitScript(({ key, userId }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      userId,
      confirmedAt: Date.now(),
      value: { totalLifetime: 300, level: 3 },
    }));
  }, { key: CACHE_KEY, userId: USER_ID });
  await page.route('**/.netlify/functions/calculate-xp', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'server_error' }),
  }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#xpBadge .xp-badge__label')).toHaveText('Lvl 3, 300 XP');
  await page.waitForTimeout(250);
  await expect(page.locator('#xpBadge .xp-badge__label')).toHaveText('Lvl 3, 300 XP');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).value.totalLifetime, CACHE_KEY)).toBe(300);
});
