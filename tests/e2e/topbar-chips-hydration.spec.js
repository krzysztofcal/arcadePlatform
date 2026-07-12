const { test, expect } = require('@playwright/test');

const USER_ID = 'chips-hydration-user';
const CACHE_KEY = `kcswh:user-ui:chips:v1:${USER_ID}`;

async function mockAuthenticatedSession(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/js/auth/supabase-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://stage-test.supabase.co', SUPABASE_ANON_KEY: 'test-key' };
      var currentAuthUser = { id: '${USER_ID}', email: 'private@example.test' };
      var authStateCallback = null;
      window.__switchAuthUser = function(userId){
        currentAuthUser = { id: userId, email: 'private@example.test' };
        if (authStateCallback) authStateCallback('SIGNED_IN', { access_token: 'test-token', user: currentAuthUser });
      };
      window.supabase = { createClient: function(){ return { auth: {
        getSession: function(){ return Promise.resolve({ data: { session: { access_token: 'test-token', user: currentAuthUser } } }); },
        onAuthStateChange: function(callback){ authStateCallback = callback; return { data: { subscription: { unsubscribe: function(){} } } }; },
        signOut: function(){ return Promise.resolve(); }
      } }; } };
    `,
  }));
  await page.route('**/.netlify/functions/profile-me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ displayName: 'Chips Player', avatar: { type: 'default', variant: 'orbit-green' } }) }));
  await page.route('**/.netlify/functions/welcome-bonus', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ eligible: false, alreadyClaimed: true }) }));
}

async function seedCachedBalance(page, balance) {
  await page.addInitScript(({ key, userId, value }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, userId, confirmedAt: Date.now(), value: { balance: value } }));
    window.__chipFrames = [];
    function sample(){
      const amount = document.getElementById('chipBadgeAmount');
      if (amount) window.__chipFrames.push({ text: amount.textContent.trim(), visibility: getComputedStyle(amount).visibility });
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }, { key: CACHE_KEY, userId: USER_ID, value: balance });
}

test('hydrates chips before revalidation and refreshes after a transaction event', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await seedCachedBalance(page, 896);
  let releaseBalance;
  let serverBalance = 950;
  let requests = 0;
  const balanceGate = new Promise((resolve) => { releaseBalance = resolve; });
  await page.route('**/.netlify/functions/chips-balance', async (route) => {
    requests += 1;
    if (requests === 1) await balanceGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: serverBalance }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const amount = page.locator('#chipBadgeAmount');
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-chips-state', 'hydrated');
  await expect(amount).toHaveText('896');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const visible = await page.evaluate(() => window.__chipFrames.filter((frame) => frame.visibility === 'visible').map((frame) => frame.text));
  expect(visible[0]).toBe('896');
  expect(visible.includes('')).toBe(false);

  releaseBalance();
  await expect(amount).toHaveText('950');
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).value.balance, CACHE_KEY)).toBe(950);

  serverBalance = 1000;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('chips:tx-complete', { detail: { ok: true } })));
  await expect(amount).toHaveText('1k');
  await expect.poll(() => requests).toBe(2);
});

test('retains cached chips when balance revalidation fails', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await seedCachedBalance(page, 896);
  await page.route('**/.netlify/functions/chips-balance', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error' }) }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#chipBadgeAmount')).toHaveText('896');
  await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-chips-state', 'stale');
  await expect(page.locator('#chipBadgeAmount')).toHaveCSS('visibility', 'visible');
});

test('hides account A chips during a direct signed-in switch to account B', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await seedCachedBalance(page, 896);
  let releaseLateA;
  let releaseB;
  const lateAGate = new Promise((resolve) => { releaseLateA = resolve; });
  const bGate = new Promise((resolve) => { releaseB = resolve; });
  let requests = 0;
  await page.route('**/.netlify/functions/chips-balance', async (route) => {
    const requestNo = ++requests;
    if (requestNo === 2) await lateAGate;
    if (requestNo === 3) await bGate;
    const balance = requestNo === 1 ? 896 : (requestNo === 2 ? 777 : 950);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const amount = page.locator('#chipBadgeAmount');
  await expect(amount).toHaveText('896');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('chips:tx-complete', { detail: { ok: true } })));
  await expect.poll(() => requests).toBe(2);

  await page.evaluate(() => window.__switchAuthUser('chips-user-b'));
  await expect.poll(() => requests).toBe(3);
  await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-chips-state', 'loading');
  await expect(amount).toHaveCSS('visibility', 'hidden');
  await expect(amount).not.toHaveText('896');

  releaseLateA();
  await page.waitForTimeout(100);
  await expect(amount).toHaveCSS('visibility', 'hidden');
  expect(await page.evaluate(() => localStorage.getItem('kcswh:user-ui:chips:v1:chips-user-b'))).toBeNull();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).value.balance, CACHE_KEY)).toBe(896);

  releaseB();
  await expect(amount).toHaveText('950');
  await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-chips-state', 'ready');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kcswh:user-ui:chips:v1:chips-user-b')).value.balance)).toBe(950);
});
