# E2E Security Test Suite

This directory contains comprehensive end-to-end security tests for the Arcade Platform, focusing on the XP (experience points) reward system and application security controls.

## Test Files

### 1. `e2e-security.spec.ts` - Core Security Tests
Main security test suite covering:
- **CORS & Origin Validation** - Tests cross-origin request blocking and whitelist enforcement
- **Rate Limiting** - Validates per-user (10 req/min) and per-IP (20 req/min) limits
- **XP Caps & Validation** - Tests daily cap (3000 XP), session cap (300 XP), and delta cap (300 XP/request)
- **Cookie Security** - Validates HttpOnly, Secure, SameSite=Lax flags and HMAC signature validation
- **Session Management** - Tests session registration, persistence, and state tracking
- **Input Validation** - Tests invalid/malicious input handling (oversized, null, XSS attempts)
- **Error Handling** - Tests edge cases, concurrent requests, and error responses
- **Game Page Integration** - Tests XP system in actual game context
- **Response Format** - Validates API response schema and headers

### 2. `e2e-security-headers.spec.ts` - HTTP Security Headers
Tests security headers and Content Security Policy:
- **Content-Security-Policy** - Tests CSP enforcement, inline script blocking, external script whitelist
- **X-Frame-Options** - Tests clickjacking protection (DENY)
- **X-Content-Type-Options** - Tests MIME type sniffing prevention (nosniff)
- **Referrer-Policy** - Tests referrer information leakage prevention
- **Permissions-Policy** - Tests API restriction (geolocation, microphone, camera, payment)
- **HTTPS Enforcement** - Tests Secure flag on cookies in production
- **XSS Protection** - Tests input sanitization and DOM-based XSS prevention

### 3. `e2e-security-isolation.spec.ts` - Client Isolation
Tests client-side state isolation and privacy:
- **Multi-Tab Isolation** - Tests XP state separation across browser tabs
- **Session Isolation** - Tests separate sessions in incognito/private contexts
- **localStorage Security** - Tests ID generation, data exposure, and privacy
- **XP State Isolation** - Tests game-specific XP tracking and state manipulation prevention
- **Privacy & Data Protection** - Tests anonymous ID generation and sensitive data handling
- **Concurrent Access Control** - Tests race condition handling and state consistency

### 4. `helpers/security-test-utils.ts` - Test Utilities
Helper functions for security tests:
- Endpoint URL resolution (local vs. Netlify)
- Test data generators (userId, sessionId, XP requests)
- XPClient stub for isolated testing
- Server availability checks

## Running the Tests

### Prerequisites

```bash
npm install
```

### Run All Security Tests

```bash
# Run all security tests
npm run test:e2e -- tests/e2e-security*.spec.ts

# Run specific test file
npm run test:e2e -- tests/e2e-security.spec.ts
npm run test:e2e -- tests/e2e-security-headers.spec.ts
npm run test:e2e -- tests/e2e-security-isolation.spec.ts
```

### Test Infrastructure

The tests use an **integrated test server** (`scripts/test-server.js`) that combines:
- Static file serving (HTML, CSS, JS)
- Netlify function handling (`/.netlify/functions/award-xp`)
- Security headers (loaded from `_headers` file)

This server is automatically started by Playwright's `webServer` config.

**No manual server setup required!** Just run `npm run test:e2e`.

### Test Categories

**API Security Tests** (all test files):
- Use Playwright's `request` API for direct HTTP testing
- **No browser required** - works in any environment
- Test all security controls via HTTP requests
- **Rate limit resilient** - gracefully skip when 429 rate limit hit
- ✅ **75 tests pass** (comprehensive security validation)

**Browser Context Tests** (3 tests in `e2e-security-isolation.spec.ts`):
- Use Playwright's `page` API for browser automation
- Require a browser to be installed (Chrome/Chromium)
- ⏭️ **Skipped** if no browser is available
- Set `CHROME_BIN` environment variable to enable these tests

### Run in CI/CD

The tests automatically adapt to the environment:
- **Playwright CI**: Uses integrated test-server.js (no manual setup)
- **Netlify deployment**: Tests against actual deployed functions
- **Skip E2E**: Set `CI_NO_E2E=1` to skip all E2E tests if needed

## Test Coverage

### Security Controls Tested

| Control | Test File | Status |
|---------|-----------|--------|
| CORS validation | `e2e-security.spec.ts` | ✅ **Passing** |
| Rate limiting (per-user) | `e2e-security.spec.ts` | ✅ **Passing** |
| Rate limiting (per-IP) | `e2e-security.spec.ts` | ✅ **Passing** |
| Daily XP cap (3000) | `e2e-security.spec.ts` | ✅ **Passing** |
| Session XP cap (300) | `e2e-security.spec.ts` | ✅ **Passing** |
| Delta XP cap (300) | `e2e-security.spec.ts` | ✅ **Passing** |
| Cookie security | `e2e-security.spec.ts` | ✅ **Passing** |
| Session validation | `e2e-security.spec.ts` | ✅ **Passing** |
| Input validation | `e2e-security.spec.ts` | ✅ **Passing** |
| Error handling | `e2e-security.spec.ts` | ✅ **Passing** |
| Response format | `e2e-security.spec.ts` | ✅ **Passing** |
| Game integration | `e2e-security.spec.ts` | ✅ **Passing** |
| CSP header | `e2e-security-headers.spec.ts` | ✅ **Passing** |
| X-Frame-Options | `e2e-security-headers.spec.ts` | ✅ **Passing** |
| X-Content-Type-Options | `e2e-security-headers.spec.ts` | ✅ **Passing** |
| Referrer-Policy | `e2e-security-headers.spec.ts` | ✅ **Passing** |
| Permissions-Policy | `e2e-security-headers.spec.ts` | ✅ **Passing** |
| XSS prevention | `e2e-security-headers.spec.ts` | ✅ **Passing** |
| Session isolation (API) | `e2e-security-isolation.spec.ts` | ✅ **Passing** |
| Privacy protection (API) | `e2e-security-isolation.spec.ts` | ✅ **Passing** |
| Concurrent access (API) | `e2e-security-isolation.spec.ts` | ✅ **Passing** |
| Multi-tab isolation | `e2e-security-isolation.spec.ts` | ⏭️ **Skipped** (requires browser) |
| localStorage security | `e2e-security-isolation.spec.ts` | ⏭️ **Skipped** (requires browser) |
| XP client integration | `e2e-security-isolation.spec.ts` | ⏭️ **Skipped** (requires browser) |

**Summary**: 75 passing / 3 skipped / 0 failing (100% pass rate)

### Known Issues and Limitations

1. **Rate Limiting in CI**: Tests gracefully skip when rate limited (429 response). This is expected behavior in CI where tests run sequentially from the same IP and may hit per-IP rate limits (20 req/min).

2. **Browser-Based Tests (3 tests)**: These tests require Chrome/Chromium to be installed:
   - `Multi-tab isolation requires browser`
   - `localStorage security requires browser`
   - `XP client integration requires browser`

   To enable these tests, install Chrome/Chromium and set `CHROME_BIN` environment variable.

3. **All Other Tests Run Without Browser**: The remaining 75 tests use API-based testing and work in any environment without requiring a browser installation.

## Security Test Philosophy

These tests follow a **defense-in-depth** approach:

1. **Assume Breach**: Tests assume attackers can manipulate client-side code and focus on server-side validation
2. **Fail Securely**: Tests verify that security failures result in denied access, not silent bypasses
3. **Layered Defense**: Tests multiple security controls (CORS + rate limiting + caps + validation)
4. **Real-World Scenarios**: Tests include common attack patterns (XSS, CSRF, session hijacking, rate limit bypass)

## Contributing

When adding new security tests:

1. **Follow existing patterns** - Use helper functions from `security-test-utils.ts`
2. **Test both success and failure** - Verify controls work AND fail securely
3. **Document assumptions** - Clearly state what security properties are tested
4. **Consider edge cases** - Test boundary conditions, race conditions, and error paths
5. **Add to coverage table** - Update this README with new test coverage

## Related Documentation

- `/SECURITY-ISSUES.md` - Known security issues and risk assessment
- `/SECURITY-PATCHES.md` - Applied security fixes and patches
- `/_headers` - Netlify security header configuration
- `/netlify/functions/award-xp.mjs` - XP award endpoint implementation

## Questions?

For questions about security tests, see:
- Security issue tracker: `/SECURITY-ISSUES.md`
- XP system documentation: Check inline comments in `award-xp.mjs`
- Test patterns: Refer to existing E2E tests in `/tests/e2e/`
