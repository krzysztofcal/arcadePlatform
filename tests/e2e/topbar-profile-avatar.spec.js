const { test, expect } = require('@playwright/test');

const AVATAR_URL = 'https://stage-test.supabase.co/storage/v1/object/public/profile-avatars/smoke.webp';
const PAGES = ['/', '/games-open/2048/'];

test.describe('authenticated topbar profile avatar', () => {
  for (const path of PAGES) {
    test(`renders uploaded avatar on ${path}`, async ({ page }) => {
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
      await page.route('**/.netlify/functions/profile-me', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          handle: 'avatar-player',
          displayName: 'Avatar Player',
          bio: '',
          avatar: { type: 'uploaded', variant: 'fox-blue', url: AVATAR_URL },
          handleCanCustomize: false,
        }),
      }));

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const avatar = page.locator('#avatarInitials');
      const menuAvatar = page.locator('#avatarMenuInitials');
      await expect(avatar).toHaveClass(/profile-avatar--uploaded/);
      await expect(avatar).toHaveCSS('background-image', `url("${AVATAR_URL}")`);
      await expect(avatar).toHaveText('');
      await expect(menuAvatar).toHaveClass(/profile-avatar--uploaded/);
      await expect(menuAvatar).toHaveCSS('background-image', `url("${AVATAR_URL}")`);
    });
  }
});
