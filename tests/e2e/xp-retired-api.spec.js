const { test, expect } = require('@playwright/test');

const LEGACY_ENDPOINT = '/.netlify/functions/award-xp';
const CALCULATE_ENDPOINT = '/.netlify/functions/calculate-xp';

test.describe('retired XP API security contract', () => {
  test('legacy client delta returns 410 without an award', async ({ request }) => {
    const response = await request.post(LEGACY_ENDPOINT, {
      data: { userId: `legacy-${Date.now()}`, sessionId: 'legacy-session', delta: 300, ts: Date.now() },
    });
    expect(response.status()).toBe(410);
    const payload = await response.json();
    expect(payload.error).toBe('legacy_award_retired');
    expect(payload.awarded).toBeUndefined();
  });

  test('invalid bearer is rejected before the retirement response', async ({ request }) => {
    const response = await request.post(LEGACY_ENDPOINT, {
      headers: { Authorization: 'Bearer invalid-token' },
      data: { userId: 'legacy-invalid-token', sessionId: 'legacy-session', delta: 10, ts: Date.now() },
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe('unauthorized');
  });

  test('legacy status remains read-only and does not generate a session', async ({ request }) => {
    const response = await request.post(LEGACY_ENDPOINT, {
      data: { userId: `legacy-status-${Date.now()}`, statusOnly: true },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('statusOnly');
    expect(payload.sessionId).toBeUndefined();
    expect(payload.awarded).toBe(0);
  });

  test('retired endpoint still enforces CORS', async ({ request }) => {
    const response = await request.post(LEGACY_ENDPOINT, {
      headers: { Origin: 'https://malicious-site.example' },
      data: { userId: 'cors-user', delta: 10 },
    });
    expect(response.status()).toBe(403);
  });

  test('authoritative status returns canonical response fields', async ({ request }) => {
    const response = await request.post(CALCULATE_ENDPOINT, {
      data: { anonId: `status-${Date.now()}`, operation: 'status' },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('statusOnly');
    expect(payload.totalLifetime).toBeGreaterThanOrEqual(0);
    expect(payload.remaining).toBeGreaterThanOrEqual(0);
  });

  test('guest XP survives navigation from a game to the XP page', async ({ request, page }) => {
    const anonId = `guest-navigation-${Date.now()}`;
    const now = Date.now();
    const awardResponse = await request.post(CALCULATE_ENDPOINT, {
      data: {
        anonId,
        sessionId: `guest-session-${now}`,
        operation: 'award',
        gameId: '2048',
        windowStart: now - 10_000,
        windowEnd: now,
        visibilitySeconds: 10,
        inputEvents: 8,
        gameplayActions: 1,
        scoreDelta: 256,
      },
    });
    expect(awardResponse.status()).toBe(200);
    const award = await awardResponse.json();
    expect(award.totalLifetime).toBeGreaterThan(0);

    await page.addInitScript((id) => localStorage.setItem('kcswh:userId', id), anonId);
    await page.goto('/xp.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#xpTotal')).toHaveText(String(award.totalLifetime), { timeout: 10_000 });
    await expect(page.locator('#xpBadge .xp-badge__label')).toContainText(`${award.totalLifetime} XP`);
  });
});
