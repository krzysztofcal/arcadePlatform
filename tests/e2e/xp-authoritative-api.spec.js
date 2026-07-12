const { test, expect } = require('@playwright/test');

const ENDPOINT = '/.netlify/functions/calculate-xp';

test.describe('authoritative XP API security contract', () => {
  test('removed award-xp endpoint returns not found', async ({ request }) => {
    const response = await request.post('/.netlify/functions/award-xp', {
      data: { anonId: 'removed-endpoint', operation: 'status' },
    });
    expect(response.status()).toBe(404);
  });

  test('invalid bearer is rejected without anonymous fallback', async ({ request }) => {
    const response = await request.post(ENDPOINT, {
      headers: { Authorization: 'Bearer invalid-token' },
      data: { anonId: 'invalid-token-fallback', operation: 'status' },
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe('unauthorized');
  });

  test('status is read-only and does not generate a session', async ({ request }) => {
    const response = await request.post(ENDPOINT, {
      data: { anonId: `status-${Date.now()}`, operation: 'status' },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('statusOnly');
    expect(payload.sessionId).toBeUndefined();
    expect(payload.awarded).toBe(0);
    expect(payload.totalLifetime).toBeGreaterThanOrEqual(0);
    expect(payload.remaining).toBeGreaterThanOrEqual(0);
  });

  test('authoritative endpoint enforces CORS', async ({ request }) => {
    const response = await request.post(ENDPOINT, {
      headers: { Origin: 'https://malicious-site.example' },
      data: { anonId: 'cors-user', operation: 'status' },
    });
    expect(response.status()).toBe(403);
  });

  test('guest XP survives navigation from a game to the XP page', async ({ request, page }) => {
    const anonId = `guest-navigation-${Date.now()}`;
    const now = Date.now();
    const awardResponse = await request.post(ENDPOINT, {
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
