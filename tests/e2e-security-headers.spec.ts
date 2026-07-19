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

    test('should allow the Netlify Deploy Preview toolbar frame', async ({ request }) => {
      const response = await request.get('/');
      const csp = response.headers()['content-security-policy'];

      expect(csp).toBeTruthy();
      expect(csp).toMatch(/frame-src[^;]*https:\/\/app\.netlify\.com/);
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

    test('should keep portal pages denied and game documents same-origin frameable', async ({ request }) => {
      const pages = [
        { path: '/', expected: 'DENY' },
        { path: '/play.html', expected: 'DENY' },
        { path: '/game.html', expected: 'SAMEORIGIN' },
      ];

      for (const page of pages) {
        const response = await request.get(page.path);
        const headers = response.headers();
        expect(headers['x-frame-options']).toBe(page.expected);
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
      const routes = [
        { path: '/', expectedFramePolicy: 'DENY' },
        { path: '/play.html', expectedFramePolicy: 'DENY' },
        { path: '/game.html', expectedFramePolicy: 'SAMEORIGIN' },
      ];

      for (const route of routes) {
        const response = await request.get(route.path);
        const headers = response.headers();

        // Each route should have security headers
        expect(headers['x-frame-options'], `Missing X-Frame-Options on ${route.path}`).toBe(route.expectedFramePolicy);
        expect(headers['x-content-type-options'], `Missing X-Content-Type-Options on ${route.path}`).toBe('nosniff');
      }
    });

    test('should maintain security headers on API endpoints', async ({ request }) => {
      const response = await request.post('/.netlify/functions/calculate-xp', {
        data: {
          anonId: 'test-user',
          operation: 'status'
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

      const response = await request.post('/.netlify/functions/calculate-xp', {
        data: {
          anonId: xssPayload,
          operation: 'status',
          metadata: {
            name: xssPayload,
            description: xssPayload
          }
        }
      });

      expect(response.status()).toBe(400);
      expect(await response.text()).not.toContain('<script>');
    });

    test('should reject script tags in userId', async ({ request }) => {
      const response = await request.post('/.netlify/functions/calculate-xp', {
        data: {
          anonId: '<script>alert(1)</script>',
          operation: 'status'
        }
      });

      expect(response.status()).toBe(400);
    });
  });
});
