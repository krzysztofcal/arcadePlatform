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

### Run with Netlify Function Server

For tests that require the actual award-xp endpoint:

**Terminal 1 - Start static server:**
```bash
node scripts/static-server.js
```

**Terminal 2 - Start function server:**
```bash
XP_DAILY_SECRET=test-secret XP_DEBUG=1 npm run serve:xp
```

**Terminal 3 - Run tests:**
```bash
XP_FUNCTION_PORT=8888 npx playwright test tests/e2e-security.spec.ts
```

### Run in CI/CD

The tests automatically adapt to the environment:
- **Local development**: Expects function server on port 8888
- **Netlify deployment**: Uses `.netlify/functions/award-xp` on same origin
- **CI/CD**: Set `CI_NO_E2E=1` to skip E2E tests if needed

## Test Coverage

### Security Controls Tested

| Control | Test File | Status |
|---------|-----------|--------|
| CORS validation | `e2e-security.spec.ts` | ✅ Comprehensive |
| Rate limiting (per-user) | `e2e-security.spec.ts` | ✅ Comprehensive |
| Rate limiting (per-IP) | `e2e-security.spec.ts` | ✅ Comprehensive |
| Daily XP cap (3000) | `e2e-security.spec.ts` | ✅ Comprehensive |
| Session XP cap (300) | `e2e-security.spec.ts` | ✅ Comprehensive |
| Delta XP cap (300) | `e2e-security.spec.ts` | ✅ Comprehensive |
| Cookie HttpOnly flag | `e2e-security.spec.ts` | ✅ Comprehensive |
| Cookie Secure flag | `e2e-security.spec.ts` | ✅ Comprehensive |
| Cookie SameSite=Lax | `e2e-security.spec.ts` | ✅ Comprehensive |
| Session validation | `e2e-security.spec.ts` | ✅ Comprehensive |
| Input validation | `e2e-security.spec.ts` | ✅ Comprehensive |
| CSP enforcement | `e2e-security-headers.spec.ts` | ✅ Comprehensive |
| X-Frame-Options | `e2e-security-headers.spec.ts` | ✅ Comprehensive |
| Referrer-Policy | `e2e-security-headers.spec.ts` | ✅ Comprehensive |
| Permissions-Policy | `e2e-security-headers.spec.ts` | ✅ Comprehensive |
| XSS prevention | `e2e-security-headers.spec.ts` | ✅ Comprehensive |
| Multi-tab isolation | `e2e-security-isolation.spec.ts` | ✅ Comprehensive |
| Session isolation | `e2e-security-isolation.spec.ts` | ✅ Comprehensive |
| localStorage security | `e2e-security-isolation.spec.ts` | ✅ Comprehensive |
| Privacy protection | `e2e-security-isolation.spec.ts` | ✅ Comprehensive |

### Known Issues and Limitations

1. **Function Server Dependency**: Core XP endpoint tests require the Netlify function server to be running separately. In local development, this requires manual setup.

2. **Rate Limit Reset**: Rate limit reset tests require waiting 60+ seconds for rate limit windows to expire. These tests have extended timeouts.

3. **Cookie Access**: Some cookie security tests are limited by browser security policies (e.g., HttpOnly cookies cannot be read by JavaScript, which is the expected behavior).

4. **CSP Testing**: CSP violation detection relies on console errors, which may vary across browsers.

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
