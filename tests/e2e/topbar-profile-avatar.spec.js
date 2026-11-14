const { test, expect } = require('@playwright/test');

const AVATAR_URL = '/assets/avatars/arcade/fox-blue.webp';
const PAGES = ['/', '/games-open/2048/'];

async function mockAuthenticatedSession(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: '',
  }));
  await page.route('**/js/auth/supabase-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://stage-test.supabase.co', SUPABASE_ANON_KEY: 'test-key' };
      window.supabase = { createClient: function(){ return { auth: {
        getSession: function(){ return Promise.resolve({ data: { session: { access_token: 'test-token', user: { id: 'avatar-user', email: 'private@example.test' } } } }); },
        onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
        signOut: function(){ return Promise.resolve(); }
      } }; } };
    `,
  }));
  await page.route('**/.netlify/functions/chips-balance', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance: 896 }),
  }));
}

const profile = () => ({
  handle: 'avatar-player',
  displayName: 'Avatar Player',
  bio: '',
  avatar: { type: 'default', variant: 'fox-blue' },
  handleCanCustomize: false,
});

test.describe('authenticated topbar profile avatar', () => {
  for (const path of PAGES) {
    test(`renders Arcade catalog avatar on ${path}`, async ({ page }) => {
      await mockAuthenticatedSession(page);
      let profileRequests = 0;
      await page.route('**/.netlify/functions/profile-me', (route) => {
        profileRequests += 1;
        return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(profile()),
        });
      });

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const avatar = page.locator('#avatarInitials');
      const menuAvatar = page.locator('#avatarMenuInitials');
      await expect.poll(() => profileRequests).toBeGreaterThan(0);
      await expect(avatar).toHaveAttribute('data-avatar-variant', 'fox-blue');
      await expect(avatar).toHaveCSS('background-image', `url("${new URL(AVATAR_URL, page.url()).href}")`);
      await expect(avatar).toHaveText('');
      await expect(menuAvatar).toHaveAttribute('data-avatar-variant', 'fox-blue');
      await expect(menuAvatar).toHaveCSS('background-image', `url("${new URL(AVATAR_URL, page.url()).href}")`);
      await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-chips-state', 'ready');
      await expect(page.locator('#chipBadgeAmount')).toHaveText('896');
    });
  }

  test('hydrates the cached avatar before delayed revalidation without a visible initials frame', async ({ page }) => {
    await mockAuthenticatedSession(page);
    let requests = 0;
    let releaseProfile;
    const profileGate = new Promise((resolve) => { releaseProfile = resolve; });
    await page.route('**/.netlify/functions/profile-me', async (route) => {
      requests += 1;
      if (requests > 1) await profileGate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile()) });
    });
    let delayAvatar = false;
    let releaseAvatar;
    const avatarGate = new Promise(resolve => { releaseAvatar = resolve; });
    await page.route('**' + AVATAR_URL, async route => {
      if (delayAvatar) await avatarGate;
      await route.continue();
    });
    await page.addInitScript(() => {
      window.__avatarFrames = [];
      function sample(){
        const node = document.getElementById('avatarInitials');
        const bar = document.querySelector('.topbar');
        if (node && bar){
          const style = getComputedStyle(node);
          window.__avatarFrames.push({
            state: bar.getAttribute('data-user-ui-state'),
            text: node.textContent.trim(),
            color: style.color,
            variant: node.dataset.avatarVariant,
          });
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#avatarInitials')).toHaveAttribute('data-avatar-variant', 'fox-blue');
    await expect(page.locator('#avatarInitials')).toHaveCSS('background-image', `url("${new URL(AVATAR_URL, page.url()).href}")`);
    delayAvatar = true;
    await page.goto('/games-open/2048/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-profile-state', 'hydrated');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assertNoVisibleInitials(await page.evaluate(() => window.__avatarFrames));
    releaseAvatar();
    await expect(page.locator('#avatarInitials')).toHaveAttribute('data-avatar-variant', 'fox-blue');
    await expect(page.locator('#avatarInitials')).toHaveCSS('background-image', `url("${new URL(AVATAR_URL, page.url()).href}")`);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await page.evaluate(() => window.__avatarFrames);
    assertNoVisibleInitials(frames);
    releaseProfile();
    await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-profile-state', 'ready');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assertNoVisibleInitials(await page.evaluate(() => window.__avatarFrames));
  });
});

function assertNoVisibleInitials(frames) {
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    const transparent = frame.color === 'rgba(0, 0, 0, 0)';
    expect(frame.text && !transparent, JSON.stringify(frame)).toBeFalsy();
  }
}
