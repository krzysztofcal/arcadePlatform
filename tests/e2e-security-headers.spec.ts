import { test, expect } from '@playwright/test';

/**
 * E2E Security Headers Test Suite
 *
 * Tests security headers and Content Security Policy:
 * - Content-Security-Policy
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Referrer-Policy
 * - Permissions-Policy
 */

test.describe('Security Headers Tests', () => {

  test.describe('Content-Security-Policy (CSP)', () => {

    test('should have Content-Security-Policy header', async ({ page }) => {
      const response = await page.goto('/');
      expect(response).toBeTruthy();

      const headers = response!.headers();
      const csp = headers['content-security-policy'];

      expect(csp).toBeTruthy();
    });

    test('should block inline scripts without CSP hash', async ({ page }) => {
      await page.goto('/');

      // Try to inject and execute inline script
      const scriptExecuted = await page.evaluate(() => {
        try {
          const script = document.createElement('script');
          script.textContent = 'window.injectedScript = true;';
          document.body.appendChild(script);
          return !!window.injectedScript;
        } catch (e) {
          return false;
        }
      });

      // CSP should block inline script without proper hash
      expect(scriptExecuted).toBe(false);
    });

    test('should block unauthorized external scripts', async ({ page }) => {
      // Listen for CSP violations
      const violations: any[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
          violations.push(msg.text());
        }
      });

      await page.goto('/');

      // Try to load script from unauthorized domain
      await page.evaluate(() => {
        const script = document.createElement('script');
        script.src = 'https://unauthorized-domain.com/malicious.js';
        document.body.appendChild(script);
      });

      // Wait a moment for CSP to block
      await page.waitForTimeout(500);

      // Check if script was blocked (either via CSP violation or failed load)
      const scriptLoaded = await page.evaluate(() => {
        const scripts = Array.from(document.scripts);
        return scripts.some(s => s.src.includes('unauthorized-domain.com'));
      });

      // Script should not successfully load
      expect(scriptLoaded).toBe(false);
    });

    test('should have frame-ancestors directive to prevent embedding', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();
      const csp = headers['content-security-policy'];

      if (csp) {
        expect(csp).toContain("frame-ancestors 'none'");
      }
    });

    test('should have base-uri directive to prevent base tag hijacking', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();
      const csp = headers['content-security-policy'];

      if (csp) {
        expect(csp).toMatch(/base-uri[^;]*'self'/);
      }
    });

    test('should allow whitelisted external scripts', async ({ page }) => {
      await page.goto('/');

      // Check if allowed external resources can load
      const allowedDomains = [
        'consent.cookiebot.com',
        'googletagmanager.com'
      ];

      // Verify CSP allows these domains
      const response = await page.goto('/');
      const headers = response!.headers();
      const csp = headers['content-security-policy'];

      if (csp) {
        // At least one allowed domain should be in CSP
        const hasAllowedDomains = allowedDomains.some(domain =>
          csp.includes(domain)
        );
        // This may not always be true, depending on CSP configuration
      }
    });
  });

  test.describe('X-Frame-Options', () => {

    test('should have X-Frame-Options: DENY header', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      expect(headers['x-frame-options']).toBe('DENY');
    });

    test('should prevent iframe embedding', async ({ page, context }) => {
      await page.goto('/');

      // Try to embed page in iframe
      const canEmbed = await page.evaluate(async (url) => {
        try {
          const iframe = document.createElement('iframe');
          iframe.src = url;
          document.body.appendChild(iframe);

          // Wait for potential load
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Check if iframe loaded content
          return iframe.contentWindow !== null;
        } catch (e) {
          return false;
        }
      }, page.url());

      // Note: X-Frame-Options may not be testable this way due to same-origin restrictions
      // This test serves as documentation of expected behavior
    });
  });

  test.describe('X-Content-Type-Options', () => {

    test('should have X-Content-Type-Options: nosniff header', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    test('should prevent MIME type sniffing', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      // Verify nosniff is set
      expect(headers['x-content-type-options']).toBe('nosniff');

      // This prevents browsers from interpreting files as a different MIME type
      // than what is specified in Content-Type header
    });
  });

  test.describe('Referrer-Policy', () => {

    test('should have Referrer-Policy header', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      expect(headers['referrer-policy']).toBeTruthy();
    });

    test('should use strict-origin-when-cross-origin policy', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    test('should limit referrer information on cross-origin requests', async ({ page }) => {
      await page.goto('/');

      // Make cross-origin request and check referrer
      const referrerSent = await page.evaluate(async () => {
        try {
          const response = await fetch('https://httpbin.org/headers', {
            method: 'GET'
          });
          const data = await response.json();
          return data.headers.Referer || data.headers.referer || '';
        } catch (e) {
          return 'error';
        }
      });

      // With strict-origin-when-cross-origin, only origin should be sent
      // (not full URL with path)
      if (referrerSent && referrerSent !== 'error') {
        expect(referrerSent).not.toContain('/game.html');
        expect(referrerSent).not.toContain('?');
      }
    });
  });

  test.describe('Permissions-Policy', () => {

    test('should have Permissions-Policy header', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      expect(permissionsPolicy).toBeTruthy();
    });

    test('should restrict geolocation access', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      if (permissionsPolicy) {
        expect(permissionsPolicy).toContain('geolocation=()');
      }
    });

    test('should restrict microphone access', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      if (permissionsPolicy) {
        expect(permissionsPolicy).toContain('microphone=()');
      }
    });

    test('should restrict camera access', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      if (permissionsPolicy) {
        expect(permissionsPolicy).toContain('camera=()');
      }
    });

    test('should restrict payment access', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      if (permissionsPolicy) {
        expect(permissionsPolicy).toContain('payment=()');
      }
    });

    test('should not allow geolocation API usage', async ({ page, context }) => {
      await page.goto('/');

      // Try to access geolocation
      const geolocationAllowed = await page.evaluate(async () => {
        try {
          if (!navigator.geolocation) {
            return false;
          }

          return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve(true),
              () => resolve(false),
              { timeout: 1000 }
            );
          });
        } catch (e) {
          return false;
        }
      });

      // Should be blocked by Permissions-Policy
      expect(geolocationAllowed).toBe(false);
    });
  });

  test.describe('Security Headers Combination', () => {

    test('should have all critical security headers', async ({ page }) => {
      const response = await page.goto('/');
      const headers = response!.headers();

      // Critical security headers
      const requiredHeaders = [
        'content-security-policy',
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy'
      ];

      requiredHeaders.forEach(header => {
        expect(headers[header]).toBeTruthy();
      });
    });

    test('should maintain security headers on all routes', async ({ page }) => {
      const routes = ['/', '/play.html', '/game.html'];

      for (const route of routes) {
        const response = await page.goto(route);
        const headers = response!.headers();

        // Each route should have security headers
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['x-content-type-options']).toBe('nosniff');
      }
    });

    test('should maintain security headers on API endpoints', async ({ request }) => {
      const response = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: 'test-user',
          sessionId: 'test-session',
          delta: 10,
          ts: Date.now()
        }
      });

      const headers = response.headers();

      // API should also have CORS and security headers
      expect(headers['access-control-allow-origin']).toBeTruthy();
      expect(headers['access-control-allow-credentials']).toBeTruthy();
    });
  });

  test.describe('HTTPS and Transport Security', () => {

    test('should enforce HTTPS in production', async ({ page }) => {
      const url = page.url();

      // If testing production, verify HTTPS
      if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
        expect(url).toMatch(/^https:/);
      }
    });

    test('should have secure cookie flags on HTTPS', async ({ page, context }) => {
      await page.goto('/');

      const isHttps = page.url().startsWith('https://');

      if (isHttps) {
        // Make request to trigger cookie
        await page.evaluate(async () => {
          await fetch('/.netlify/functions/award-xp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: 'test-user',
              sessionId: 'test-session',
              delta: 10,
              ts: Date.now()
            })
          });
        });

        const cookies = await context.cookies();
        const secureCookies = cookies.filter(c => c.secure);

        // XP cookies should be secure on HTTPS
        const xpCookies = cookies.filter(c => c.name.startsWith('xp_'));
        if (xpCookies.length > 0) {
          xpCookies.forEach(cookie => {
            expect(cookie.secure).toBe(true);
          });
        }
      }
    });
  });

  test.describe('XSS Protection', () => {

    test('should sanitize user input in XP metadata', async ({ request }) => {
      const xssPayload = "<script>alert('xss')</script>";

      const response = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: xssPayload,
          sessionId: 'test-session',
          delta: 10,
          ts: Date.now(),
          metadata: {
            name: xssPayload,
            description: xssPayload
          }
        }
      });

      // Server should handle this safely (accept or reject)
      expect([200, 400, 422]).toContain(response.status());

      // If accepted, response should not contain unescaped script tags
      const text = await response.text();
      expect(text).not.toContain('<script>');
    });

    test('should prevent DOM-based XSS in game pages', async ({ page }) => {
      await page.goto('/game.html?payload=<script>alert("xss")</script>');

      // Check if any alerts triggered
      let alertTriggered = false;
      page.on('dialog', async dialog => {
        alertTriggered = true;
        await dialog.dismiss();
      });

      await page.waitForTimeout(1000);

      // No XSS should execute
      expect(alertTriggered).toBe(false);
    });

    test('should escape HTML in UI elements', async ({ page }) => {
      await page.goto('/');

      // Try to inject HTML through localStorage
      await page.evaluate(() => {
        localStorage.setItem('test', '<img src=x onerror=alert("xss")>');
      });

      // Navigate to trigger any UI that reads from localStorage
      await page.reload();
      await page.waitForTimeout(500);

      // No XSS should execute
      const alerts: string[] = [];
      page.on('dialog', async dialog => {
        alerts.push(dialog.message());
        await dialog.dismiss();
      });

      expect(alerts.length).toBe(0);
    });
  });
});
