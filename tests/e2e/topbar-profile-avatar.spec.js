const { test, expect } = require('@playwright/test');

const AVATAR_URL = 'https://stage-test.supabase.co/storage/v1/object/public/profile-avatars/smoke.webp';
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
}

const profile = () => ({
  handle: 'avatar-player',
  displayName: 'Avatar Player',
  bio: '',
  avatar: { type: 'uploaded', variant: 'fox-blue', url: AVATAR_URL },
  handleCanCustomize: false,
});

test.describe('authenticated topbar profile avatar', () => {
  for (const path of PAGES) {
    test(`renders uploaded avatar on ${path}`, async ({ page }) => {
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
      await expect(avatar).toHaveClass(/profile-avatar--uploaded/);
      await expect(avatar).toHaveCSS('background-image', `url("${AVATAR_URL}")`);
      await expect(avatar).toHaveText('');
      await expect(menuAvatar).toHaveClass(/profile-avatar--uploaded/);
      await expect(menuAvatar).toHaveCSS('background-image', `url("${AVATAR_URL}")`);
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
            uploaded: node.classList.contains('profile-avatar--uploaded'),
          });
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#avatarInitials')).toHaveClass(/profile-avatar--uploaded/);
    await page.goto('/games-open/2048/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-profile-state', 'hydrated');
    await expect(page.locator('#avatarInitials')).toHaveClass(/profile-avatar--uploaded/);
    await expect(page.locator('#avatarInitials')).toHaveCSS('background-image', `url("${AVATAR_URL}")`);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await page.evaluate(() => window.__avatarFrames);
    assertNoVisibleInitials(frames);
    releaseProfile();
    await expect(page.locator('.topbar')).toHaveAttribute('data-user-ui-profile-state', 'ready');
  });
});

function assertNoVisibleInitials(frames) {
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    const transparent = frame.color === 'rgba(0, 0, 0, 0)';
    expect(frame.text && !transparent, JSON.stringify(frame)).toBeFalsy();
  }
}
