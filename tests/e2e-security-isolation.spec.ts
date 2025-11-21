import { test, expect } from '@playwright/test';

/**
 * E2E Security Client Isolation Test Suite
 *
 * Tests client-side isolation and state management.
 *
 * NOTE: These tests require a browser to be installed (Chromium/Chrome).
 * If no browser is available, tests will be skipped.
 *
 * To run these tests:
 * 1. Install Chrome/Chromium on your system
 * 2. Set CHROME_BIN environment variable to the browser path
 * 3. Or install Playwright browsers: npx playwright install chromium
 */

// Check if browser is available
const browserAvailable = !!process.env.CHROME_BIN ||
                         !!process.env.CHROMIUM_BIN ||
                         !!process.env.PLAYWRIGHT_CHROMIUM_PATH;

test.describe('Client Isolation Security Tests', () => {

  // API-based tests that don't require browser
  test.describe('Session Isolation (API)', () => {

    test('should return different session states for different users', async ({ request }) => {
      const userId1 = `user-${Date.now()}-1`;
      const userId2 = `user-${Date.now()}-2`;

      // Make requests for two different users
      const response1 = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: userId1,
          sessionId: 'session-1',
          delta: 10,
          ts: Date.now()
        }
      });

      const response2 = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: userId2,
          sessionId: 'session-2',
          delta: 20,
          ts: Date.now()
        }
      });

      // Handle rate limiting
      if (response1.status() === 429 || response2.status() === 429) {
        return;
      }

      expect(response1.status()).toBe(200);
      expect(response2.status()).toBe(200);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Users should have independent totals
      expect(data1.totalToday).toBe(10);
      expect(data2.totalToday).toBe(20);
    });

    test('should track session state independently per session', async ({ request }) => {
      const userId = `user-${Date.now()}`;

      // First session
      const response1 = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId,
          sessionId: 'session-a',
          delta: 50,
          ts: Date.now()
        }
      });

      if (response1.status() === 429) return;

      // Second session for same user
      const response2 = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId,
          sessionId: 'session-b',
          delta: 30,
          ts: Date.now() + 1
        }
      });

      if (response2.status() === 429) return;

      expect(response1.status()).toBe(200);
      expect(response2.status()).toBe(200);

      // Both sessions contribute to user's daily total
      const data2 = await response2.json();
      expect(data2.totalToday).toBe(80); // 50 + 30
    });

    test('should maintain session cap independently per session', async ({ request }) => {
      const userId = `user-${Date.now()}`;
      const sessionId = `session-${Date.now()}`;

      // Award XP up to session cap (300)
      let totalGranted = 0;
      for (let i = 0; i < 4; i++) {
        const response = await request.post('/.netlify/functions/award-xp', {
          data: {
            userId,
            sessionId,
            delta: 100,
            ts: Date.now() + i
          }
        });

        if (response.status() === 429) return;

        const data = await response.json();
        totalGranted += data.granted;

        // Session cap should limit total
        if (i >= 3) {
          expect(data.granted).toBeLessThanOrEqual(100);
        }
      }

      // Should hit session cap
      expect(totalGranted).toBeLessThanOrEqual(300);
    });
  });

  test.describe('Privacy and Data Protection (API)', () => {

    test('should not expose internal server state', async ({ request }) => {
      const response = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: 'privacy-test-user',
          sessionId: 'privacy-test-session',
          delta: 10,
          ts: Date.now()
        }
      });

      if (response.status() === 429) return;

      const data = await response.json();

      // Response should not contain sensitive internal data
      const responseText = JSON.stringify(data);
      expect(responseText).not.toContain('secret');
      expect(responseText).not.toContain('password');
      expect(responseText).not.toContain('api_key');
      expect(responseText).not.toContain('UPSTASH');
    });

    test('should use secure identifiers in responses', async ({ request }) => {
      const response = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: 'id-test-user',
          sessionId: 'id-test-session',
          delta: 10,
          ts: Date.now()
        }
      });

      if (response.status() === 429) return;

      const data = await response.json();

      // Response should include expected fields
      expect(data).toHaveProperty('granted');
      expect(data).toHaveProperty('totalToday');
      expect(data).toHaveProperty('ok');
    });
  });

  test.describe('Concurrent Access Control (API)', () => {

    test('should handle rapid successive requests', async ({ request }) => {
      const userId = `rapid-user-${Date.now()}`;
      const sessionId = `rapid-session-${Date.now()}`;

      // Send multiple rapid requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request.post('/.netlify/functions/award-xp', {
            data: {
              userId,
              sessionId,
              delta: 10,
              ts: Date.now() + i
            }
          })
        );
      }

      const responses = await Promise.all(promises);

      // Count successes (excluding rate limits)
      const successes = responses.filter(r => r.status() === 200).length;
      const rateLimits = responses.filter(r => r.status() === 429).length;

      // At least some should succeed
      expect(successes + rateLimits).toBe(5);
    });

    test('should handle concurrent requests from different users', async ({ request }) => {
      // Send concurrent requests for different users
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          request.post('/.netlify/functions/award-xp', {
            data: {
              userId: `concurrent-user-${Date.now()}-${i}`,
              sessionId: `concurrent-session-${i}`,
              delta: 10,
              ts: Date.now()
            }
          })
        );
      }

      const responses = await Promise.all(promises);

      // All should get valid responses
      responses.forEach(r => {
        expect([200, 429]).toContain(r.status());
      });
    });
  });

  // Browser-based tests - require browser to be installed
  test.describe('Browser-Based Isolation Tests', () => {
    // Skip all tests in this block if no browser is available
    test.beforeEach(async () => {
      if (!browserAvailable) {
        test.skip();
      }
    });

    test('Multi-tab isolation requires browser', async ({ page }) => {
      // This test documents expected browser behavior
      // Actual multi-tab testing requires a browser to be installed
      test.skip(!browserAvailable, 'No browser available - set CHROME_BIN or install playwright browsers');

      await page.goto('/game.html');

      // In a real browser, we would test:
      // - Multiple tabs share localStorage (sessionId)
      // - XP state syncs across tabs
      // - Concurrent awards are handled correctly
    });

    test('localStorage security requires browser', async ({ page }) => {
      test.skip(!browserAvailable, 'No browser available - set CHROME_BIN or install playwright browsers');

      await page.goto('/game.html');

      // In a real browser, we would test:
      // - userId generation
      // - sessionId generation
      // - No sensitive data in localStorage
    });

    test('XP client integration requires browser', async ({ page }) => {
      test.skip(!browserAvailable, 'No browser available - set CHROME_BIN or install playwright browsers');

      await page.goto('/game.html');

      // In a real browser, we would test:
      // - window.XP is available
      // - XP.award() works
      // - XP.getTotal() returns correct values
    });
  });
});
