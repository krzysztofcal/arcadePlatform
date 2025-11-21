/**
 * Security Test Utilities
 *
 * Helper functions and configurations for E2E security tests
 */

/**
 * Get the XP endpoint URL based on environment
 * In test environment, the function runs on a separate port
 */
export function getXPEndpoint(): string {
  // Check if we're running against a Netlify environment
  const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:4173';

  // If the base URL includes netlify, use the same base
  if (baseURL.includes('netlify')) {
    return `${baseURL}/.netlify/functions/award-xp`;
  }

  // For local testing, check if there's a dedicated function server
  const functionPort = process.env.XP_FUNCTION_PORT || '8888';
  return `http://127.0.0.1:${functionPort}/.netlify/functions/award-xp`;
}

/**
 * Generate a unique test user ID
 */
export function generateUserId(): string {
  return `test-user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generate a unique test session ID
 */
export function generateSessionId(): string {
  return `test-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Create a valid XP request payload
 */
export function createXPRequest(overrides: any = {}) {
  return {
    userId: generateUserId(),
    sessionId: generateSessionId(),
    delta: 10,
    ts: Date.now(),
    ...overrides
  };
}

/**
 * Wait helper for rate limiting tests
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if the XP function server is available
 */
export async function isXPServerAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createXPRequest())
    });
    return response.status !== 404;
  } catch (e) {
    return false;
  }
}

/**
 * XPClient stub for use in page context
 */
export function getXPClientStub() {
  return `(() => {
    const calls = [];
    const record = (method, args) => {
      calls.push({ method, args: Array.from(args) });
    };
    Object.defineProperty(window, '__xpCalls', {
      configurable: false,
      enumerable: false,
      get() { return calls; },
    });
    const stub = {
      postWindow: (...args) => {
        record('postWindow', args);
        return Promise.resolve({
          ok: true,
          status: 'ok',
          granted: args[0]?.delta || 0,
          totalToday: 0,
          remaining: 3000,
          nextReset: Date.now() + 86400000,
          dayKey: new Date().toISOString().split('T')[0]
        });
      },
      fetchStatus: (...args) => {
        record('fetchStatus', args);
        return Promise.resolve({
          ok: true,
          status: 'ok',
          totalToday: 0,
          remaining: 3000,
          cap: 3000,
          totalLifetime: 0
        });
      },
    };
    Object.defineProperty(window, 'XPClient', {
      configurable: true,
      enumerable: false,
      get() { return stub; },
      set() { /* ignore assignments; keep stub */ },
    });
  })();`;
}
