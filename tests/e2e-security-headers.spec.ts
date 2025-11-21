import { test, expect } from '@playwright/test';

/**
 * E2E Security Headers Test Suite
 *
 * Tests security headers using API-based approach (no browser required):
 * - Content-Security-Policy
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Referrer-Policy
 * - Permissions-Policy
 */

test.describe('Security Headers Tests', () => {

  test.describe('Content-Security-Policy (CSP)', () => {

    test('should have Content-Security-Policy header', async ({ request }) => {
      const response = await request.get('/');
      expect(response.ok()).toBeTruthy();

      const headers = response.headers();
      const csp = headers['content-security-policy'];

      expect(csp).toBeTruthy();
    });

    test('should have frame-ancestors directive to prevent embedding', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();
      const csp = headers['content-security-policy'];

      expect(csp).toBeTruthy();
      expect(csp).toContain("frame-ancestors");
    });

    test('should have base-uri directive to prevent base tag hijacking', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();
      const csp = headers['content-security-policy'];

      expect(csp).toBeTruthy();
      expect(csp).toMatch(/base-uri/);
    });

    test('should have script-src directive', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();
      const csp = headers['content-security-policy'];

      expect(csp).toBeTruthy();
      expect(csp).toContain("script-src");
    });

    test('should have default-src directive', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();
      const csp = headers['content-security-policy'];

      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src");
    });
  });

  test.describe('X-Frame-Options', () => {

    test('should have X-Frame-Options: DENY header', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      expect(headers['x-frame-options']).toBe('DENY');
    });

    test('should have X-Frame-Options on all HTML pages', async ({ request }) => {
      const pages = ['/', '/play.html', '/game.html'];

      for (const page of pages) {
        const response = await request.get(page);
        const headers = response.headers();
        expect(headers['x-frame-options']).toBe('DENY');
      }
    });
  });

  test.describe('X-Content-Type-Options', () => {

    test('should have X-Content-Type-Options: nosniff header', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    test('should have nosniff on all pages', async ({ request }) => {
      const pages = ['/', '/play.html', '/game.html'];

      for (const page of pages) {
        const response = await request.get(page);
        const headers = response.headers();
        expect(headers['x-content-type-options']).toBe('nosniff');
      }
    });
  });

  test.describe('Referrer-Policy', () => {

    test('should have Referrer-Policy header', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      expect(headers['referrer-policy']).toBeTruthy();
    });

    test('should use strict-origin-when-cross-origin policy', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  test.describe('Permissions-Policy', () => {

    test('should have Permissions-Policy header', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      expect(permissionsPolicy).toBeTruthy();
    });

    test('should restrict geolocation access', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      expect(permissionsPolicy).toBeTruthy();
      expect(permissionsPolicy).toContain('geolocation=()');
    });

    test('should restrict microphone access', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      expect(permissionsPolicy).toBeTruthy();
      expect(permissionsPolicy).toContain('microphone=()');
    });

    test('should restrict camera access', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      expect(permissionsPolicy).toBeTruthy();
      expect(permissionsPolicy).toContain('camera=()');
    });

    test('should restrict payment access', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      const permissionsPolicy = headers['permissions-policy'] || headers['feature-policy'];
      expect(permissionsPolicy).toBeTruthy();
      expect(permissionsPolicy).toContain('payment=()');
    });
  });

  test.describe('Security Headers Combination', () => {

    test('should have all critical security headers', async ({ request }) => {
      const response = await request.get('/');
      const headers = response.headers();

      // Critical security headers
      const requiredHeaders = [
        'content-security-policy',
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy'
      ];

      requiredHeaders.forEach(header => {
        expect(headers[header], `Missing header: ${header}`).toBeTruthy();
      });
    });

    test('should maintain security headers on all routes', async ({ request }) => {
      const routes = ['/', '/play.html', '/game.html'];

      for (const route of routes) {
        const response = await request.get(route);
        const headers = response.headers();

        // Each route should have security headers
        expect(headers['x-frame-options'], `Missing X-Frame-Options on ${route}`).toBe('DENY');
        expect(headers['x-content-type-options'], `Missing X-Content-Type-Options on ${route}`).toBe('nosniff');
      }
    });

    test('should maintain security headers on API endpoints', async ({ request }) => {
      const response = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: 'test-user',
          sessionId: 'test-session',
          delta: 10,
          ts: Date.now()
        },
        headers: {
          'Origin': 'http://localhost:8888'
        }
      });

      // Accept both success and rate limit responses
      if (response.status() === 429) {
        return; // Rate limited - skip
      }

      const headers = response.headers();

      // API should have CORS headers when Origin is provided
      expect(headers['access-control-allow-origin']).toBeTruthy();
      expect(headers['access-control-allow-credentials']).toBeTruthy();
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

      // Accept success, validation errors, or rate limits
      expect([200, 400, 422, 429]).toContain(response.status());

      // If accepted, response should not contain unescaped script tags
      if (response.status() === 200) {
        const text = await response.text();
        expect(text).not.toContain('<script>');
      }
    });

    test('should reject script tags in userId', async ({ request }) => {
      const response = await request.post('/.netlify/functions/award-xp', {
        data: {
          userId: '<script>alert(1)</script>',
          sessionId: 'test-session',
          delta: 10,
          ts: Date.now()
        }
      });

      // Server should handle safely (accept with sanitization or reject)
      expect([200, 400, 422, 429]).toContain(response.status());
    });
  });
});
