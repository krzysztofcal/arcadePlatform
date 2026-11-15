const { test, expect } = require('@playwright/test');

async function blockOptionalThirdPartyScripts(page) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('https://pagead2.googlesyndication.com/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
}

async function addMockNetlifyDrawer(page) {
  await page.evaluate(() => {
    const drawer = document.createElement('div');
    drawer.dataset.netlifyDeployId = 'test-deploy';
    drawer.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:48px;z-index:2147483647';
    const frame = document.createElement('iframe');
    frame.src = 'https://app.netlify.com/cdp/';
    frame.style.cssText = 'width:100%;height:48px;border:0';
    drawer.appendChild(frame);
    document.body.appendChild(drawer);
  });
  await expect(page.locator('html')).toHaveClass(/netlify-drawer-active/);
}

test('Klaro consent buttons dismiss the notice and persist the decision', async ({ page, context }) => {
  await blockOptionalThirdPartyScripts(page);
  await context.clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await addMockNetlifyDrawer(page);

  const notice = page.locator('#klaro-cookie-notice');
  await expect(notice).toBeVisible();
  await expect.poll(async () => { const box = await notice.boundingBox(); return Math.round(page.viewportSize().height - box.y - box.height); }).toBeGreaterThanOrEqual(48);
  await notice.locator('button.cm-btn-success').click();
  await expect(notice).toHaveCount(0);
  await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === 'arcade_consent')).toBe(true);
});

async function footerLinkClearance(page, obstacleSelector) {
  return page.evaluate((selector) => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const obstacle = document.querySelector(selector);
    const links = Array.from(document.querySelectorAll('.site-footer a')).filter((link) => link.getClientRects().length > 0);
    if (!obstacle || !links.length) return -1;
    const top = obstacle.getBoundingClientRect().top;
    return Math.round(Math.min.apply(null, links.map((link) => top - link.getBoundingClientRect().bottom)));
  }, obstacleSelector);
}

test('footer navigation remains clickable after consent is resolved', async ({ page, context }) => {
  await blockOptionalThirdPartyScripts(page);
  await context.addCookies([{ name: 'arcade_consent', value: encodeURIComponent(JSON.stringify({ googleAnalytics: false, googleAds: false })), domain: '127.0.0.1', path: '/' }]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await addMockNetlifyDrawer(page);

  // Static footer: at the end of the page every footer link must sit above the Netlify drawer.
  await expect.poll(() => footerLinkClearance(page, '[data-netlify-deploy-id]')).toBeGreaterThanOrEqual(0);
  await page.locator('.site-footer a[href="about.en.html"]').click();
  await expect(page).toHaveURL(/\/about\.en\.html$/);

  // URL commit can precede parsing/deferred scripts; settle the new document before resizing.
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await addMockNetlifyDrawer(page);
  await expect.poll(async () => { const box = await page.locator('.mobile-bottom-nav').boundingBox(); return Math.round(page.viewportSize().height - box.y - box.height); }).toBeGreaterThanOrEqual(48);
  await expect.poll(() => footerLinkClearance(page, '.mobile-bottom-nav')).toBeGreaterThanOrEqual(0);
  await page.locator('a[href="/poker/"]:visible').first().click();
  await expect(page).toHaveURL(/\/poker\/$/);
});
