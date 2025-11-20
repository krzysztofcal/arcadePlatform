# Remaining Security Issues

**Date:** 2025-11-20 (Updated)
**Audit Reference:** PR #108 identified 7 critical, 4 high, 5 medium severity issues
**Fixed (Initial):** 4 issues (CORS, Rate Limiting, Session Validation, XSS in frame.js)
**Fixed (2025-11-20):** 5 additional issues (XSS in games, Cookie Secure flag, Redirect validation, CSP headers, SRI documentation)
**Remaining:** 0 critical, 3 high, 3 medium

---

## Recently Fixed (2025-11-20)

### ✅ CRITICAL #1: Content-Security-Policy (COMPLETED)
- **Status:** Implemented in PR #110
- **Files:** `_headers` with SHA-256 hashes for all inline scripts
- **Result:** XSS protection, clickjacking prevention, MIME sniffing protection

### ✅ CRITICAL #2: XSS via innerHTML in Games (COMPLETED)
- **Status:** Fixed in all 3 game files
- **Files:**
  - `games-open/tetris/script.js:382-402`
  - `games-open/2048/script.js:168-193`
  - `games-open/pacman/script.js:453-473`
- **Fix:** Replaced `innerHTML` with safe DOM manipulation (`createElement()` + `textContent`)
- **Result:** Eliminated XSS injection vectors in game overlays

### ✅ CRITICAL #3: Cookie Secure Flag (COMPLETED)
- **Status:** Fixed to default secure in production
- **File:** `netlify/functions/award-xp.mjs:180-183`
- **Fix:** Changed from opt-in to opt-out - defaults to Secure in production
- **Result:** Session cookies now protected from HTTP interception by default

### ✅ HIGH #5: Open Redirect Validation (COMPLETED)
- **Status:** Enhanced with explicit hostname whitelist
- **File:** `js/core/game-utils.js:27-72`
- **Fix:** Added `isSafeRedirectUrl()` with whitelist validation
- **Result:** Redirects restricted to whitelisted domains (play.kcswh.pl, localhost)

### ✅ MEDIUM #10: Subresource Integrity (SRI) (DOCUMENTED)
- **Status:** Documented limitation
- **Reason:** Third-party scripts (Cookiebot, GTM) are frequently updated by providers
- **Mitigation:** CSP restricts script sources to trusted domains only
- **Result:** Practical security approach without breaking functionality

---

## Priority Action Plan

### Phase 1: Critical Security Headers (Week 1)
**Priority:** CRITICAL
**Effort:** Low
**Impact:** High

1. **Add Content-Security-Policy headers** (`_headers` file)
2. **Enforce Secure cookie flag** (default to Secure in production)
3. **Add X-Frame-Options, X-Content-Type-Options** headers

**Files to modify:**
- `_headers`
- `netlify/functions/award-xp.mjs`

---

### Phase 2: XSS Prevention (Week 1-2)
**Priority:** CRITICAL
**Effort:** Medium
**Impact:** High

Fix innerHTML usage in game files:
1. `games-open/tetris/script.js:384`
2. `games-open/2048/script.js:172`
3. `games-open/pacman/script.js:455`

**Action:** Replace `innerHTML` with safe DOM manipulation

---

### Phase 3: Input Validation & Redirects (Week 2)
**Priority:** HIGH
**Effort:** Low
**Impact:** Medium

1. **Validate redirect URLs** (whitelist approach)
2. **Add input sanitization** for user-controlled data

**Files to modify:**
- `js/frame.js`
- `js/core/PortalApp.js`

---

### Phase 4: Storage Encryption (Week 3)
**Priority:** HIGH
**Effort:** Medium
**Impact:** Medium

1. **Encrypt localStorage/sessionStorage data**
2. **Implement SecureStorage wrapper**

**New file:** `js/core/SecureStorage.js`

---

### Phase 5: Server-Side Session Tokens (Week 3-4)
**Priority:** HIGH
**Effort:** High
**Impact:** High

1. **Create session generation endpoint**
2. **Implement HMAC validation**
3. **Update client to request server tokens**

**New file:** `netlify/functions/start-session.mjs`

---

### Phase 6: Monitoring & Logging (Week 4)
**Priority:** MEDIUM
**Effort:** Medium
**Impact:** Medium

1. **Add security event logging**
2. **Set up alerting for violations**
3. **Integrate with monitoring service**

---

### Phase 7: Request Signing (Week 5)
**Priority:** MEDIUM
**Effort:** Medium
**Impact:** Medium

1. **Implement HMAC request signing**
2. **Add signature validation**
3. **Update client to sign requests**

---

### Phase 8: Testing & Documentation (Week 5-6)
**Priority:** MEDIUM
**Effort:** Medium
**Impact:** Low

1. **Add E2E security tests**
2. **Create SECURITY.md**
3. **Update API documentation**
4. **Add SRI to third-party scripts**

---

## Detailed Issue Breakdown

### ✅ CRITICAL #1: Missing Content-Security-Policy (FIXED)

**File:** `_headers`
**Risk:** XSS attacks, data exfiltration, clickjacking
**Impact:** Could allow attackers to inject malicious scripts
**Status:** COMPLETED in PR #110

**Current State:**
```
/*
  Permissions-Policy: clipboard-write=(self)
```

**Required Fix:**
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://consent.cookiebot.com https://www.googletagmanager.com 'sha256-HASH1' 'sha256-HASH2'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.netlify.app; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: clipboard-write=(self), geolocation=(), microphone=(), camera=()
```

**Steps:**
1. Generate SHA-256 hashes for inline scripts
2. Update `_headers` with CSP policy
3. Test all pages to ensure nothing breaks
4. Monitor CSP violation reports

---

### ✅ CRITICAL #2: XSS via innerHTML (FIXED)

**Files:**
- `games-open/tetris/script.js:382-402` ✅
- `games-open/2048/script.js:168-193` ✅
- `games-open/pacman/script.js:453-473` ✅

**Risk:** Malicious HTML/JavaScript injection through game data
**Impact:** Could steal user data, hijack sessions
**Status:** COMPLETED 2025-11-20

**Vulnerable Code:**
```javascript
// games-open/tetris/script.js:384
overlay.innerHTML = `<div>${title}</div><div style="font-size:1rem; margin-top:0.5rem; color: rgba(203,213,255,0.7);">${subtitle}</div>`;
```

**Secure Fix:**
```javascript
// Clear overlay
overlay.innerHTML = '';

// Create title element
const titleDiv = document.createElement('div');
titleDiv.textContent = title; // Safe - no HTML interpretation
overlay.appendChild(titleDiv);

// Create subtitle element
if (subtitle) {
  const subtitleDiv = document.createElement('div');
  subtitleDiv.style.fontSize = '1rem';
  subtitleDiv.style.marginTop = '0.5rem';
  subtitleDiv.style.color = 'rgba(203,213,255,0.7)';
  subtitleDiv.textContent = subtitle; // Safe
  overlay.appendChild(subtitleDiv);
}
```

---

### ✅ CRITICAL #3: Cookie Secure Flag Not Enforced (FIXED)

**File:** `netlify/functions/award-xp.mjs:180-183` ✅
**Risk:** Session hijacking over HTTP
**Impact:** Cookies transmitted in plaintext
**Status:** COMPLETED 2025-11-20

**Current Code:**
```javascript
const secureAttr = process.env.XP_COOKIE_SECURE === "1" ? "; Secure" : "";
```

**Issue:** Defaults to insecure if environment variable not set

**Secure Fix:**
```javascript
// Default to Secure in production, allow override for local dev
const isProduction = process.env.CONTEXT === "production" || process.env.NODE_ENV === "production";
const secureFlag = process.env.XP_COOKIE_SECURE !== "0"; // Opt-out instead of opt-in
const secureAttr = (secureFlag || isProduction) ? "; Secure" : "";
```

**Environment Variables:**
```bash
# Production (default: Secure)
# No change needed - defaults to Secure

# Local Development (opt-out)
XP_COOKIE_SECURE=0
```

---

### 🟠 HIGH #4: Client-Controlled XP Calculations

**File:** `js/xp/core.js`, `js/xp/scoring.js`
**Risk:** XP value manipulation
**Impact:** Users can inflate their XP

**Current Mitigation:**
- Daily cap (3000 XP)
- Session cap (300 XP)
- Delta cap (300 XP per request)
- Rate limiting (10 req/min)

**Remaining Gap:**
- Client still calculates XP amounts
- Server only validates caps, not correctness

**Long-term Fix:**
Server-side XP calculation based on game events:

```javascript
// netlify/functions/validate-game-event.mjs
export async function handler(event) {
  const { gameId, eventType, eventData } = JSON.parse(event.body);

  // Game-specific validation logic
  const xpAmount = calculateXPForEvent(gameId, eventType, eventData);

  // Award XP server-side
  const result = await awardXP(userId, sessionId, xpAmount);

  return { statusCode: 200, body: JSON.stringify(result) };
}

function calculateXPForEvent(gameId, eventType, data) {
  const gameRules = {
    'tetris': {
      'line_clear': (lines) => lines * 10,
      'level_up': (level) => level * 50
    },
    '2048': {
      'tile_merge': (value) => value / 10,
      'score_milestone': (score) => Math.floor(score / 1000) * 20
    }
  };

  const rule = gameRules[gameId]?.[eventType];
  return rule ? rule(data) : 0;
}
```

**Implementation Phases:**
1. **Phase 1:** Keep current system, add server-side event validation
2. **Phase 2:** Games send events instead of XP deltas
3. **Phase 3:** Remove client-side XP calculation entirely

---

### ✅ HIGH #5: Open Redirect Validation (FIXED)

**File:** `js/core/game-utils.js:27-72` ✅
**Risk:** Phishing attacks via malicious redirects
**Impact:** Users redirected to attacker-controlled sites
**Status:** COMPLETED 2025-11-20 - Enhanced with explicit whitelist

**Vulnerable Code:**
```javascript
location.replace(safeUrl.toString());
```

**Issue:** `safeUrl` validation may be insufficient

**Secure Fix:**
```javascript
function isSafeRedirectUrl(url, baseUrl = location.origin) {
  try {
    const parsed = new URL(url, baseUrl);

    // Whitelist of allowed hostnames
    const allowedHosts = [
      'play.kcswh.pl',
      'localhost',
      '127.0.0.1'
    ];

    // Must be HTTPS in production (or HTTP for localhost)
    const isLocalhost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    const validProtocol = parsed.protocol === 'https:' || (isLocalhost && parsed.protocol === 'http:');

    return allowedHosts.includes(parsed.hostname) && validProtocol;
  } catch {
    return false;
  }
}

// Usage
if (isSafeRedirectUrl(targetUrl)) {
  location.replace(targetUrl);
} else {
  console.error('Unsafe redirect blocked:', targetUrl);
  location.replace('/'); // Fallback to home
}
```

---

### 🟠 HIGH #6: localStorage/sessionStorage Without Encryption

**Risk:** Sensitive data readable by XSS or browser extensions
**Impact:** User data, session info exposed

**Current Usage:** 16 instances found

**Secure Fix:**
Create encrypted storage wrapper:

```javascript
// js/core/SecureStorage.js
export class SecureStorage {
  constructor(secret) {
    this.secret = secret;
  }

  async encrypt(plaintext) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const key = await this.deriveKey(this.secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encrypted) {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const key = await this.deriveKey(this.secret);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  }

  async deriveKey(secret) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('kcswh-arcade-v1'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async setItem(key, value) {
    const encrypted = await this.encrypt(JSON.stringify(value));
    localStorage.setItem(key, encrypted);
  }

  async getItem(key) {
    const encrypted = localStorage.getItem(key);
    if (!encrypted) return null;

    try {
      const decrypted = await this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch (err) {
      console.error('Decryption failed:', err);
      return null;
    }
  }

  removeItem(key) {
    localStorage.removeItem(key);
  }
}

// Usage
const storage = new SecureStorage(userSecret);
await storage.setItem('xp:state', { totalXP: 1000, level: 5 });
const state = await storage.getItem('xp:state');
```

---

### 🟠 HIGH #7: Session ID Predictability

**Risk:** Session hijacking if UUID weak or predictable
**Impact:** Attackers could guess valid session IDs

**Current Implementation:**
```javascript
// Client-side
const sessionId = crypto.randomUUID();
```

**Issues:**
- Client-controlled
- No server validation
- No signature/HMAC

**Secure Fix:**
Server-generated session tokens with HMAC:

```javascript
// netlify/functions/start-session.mjs
import crypto from 'node:crypto';

const SESSION_SECRET = process.env.XP_SESSION_SECRET;

export async function handler(event) {
  // Generate secure session ID
  const sessionId = crypto.randomUUID();

  // Create HMAC signature
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(sessionId);
  const signature = hmac.digest('hex');

  // Store in Redis with TTL
  await store.setex(
    `session:${sessionId}`,
    7 * 24 * 60 * 60, // 7 days
    JSON.stringify({
      created: Date.now(),
      signature
    })
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sessionId,
      signature,
      expiresIn: 7 * 24 * 60 * 60
    })
  };
}
```

```javascript
// Client-side (js/xp/core.js)
async function startSession(gameId) {
  // Request server-generated session
  const response = await fetch('/.netlify/functions/start-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId })
  });

  const { sessionId, signature } = await response.json();

  // Store session info
  state.sessionId = sessionId;
  state.sessionSignature = signature;

  // ... continue XP initialization
}
```

```javascript
// Server validation (award-xp.mjs)
function validateSession(sessionId, signature) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(sessionId);
  const expectedSignature = hmac.digest('hex');

  return signature === expectedSignature;
}

// In handler
if (!validateSession(sessionId, requestSignature)) {
  return respond(403, { error: 'invalid_session_signature' });
}
```

---

## Medium Priority Issues

### 🟡 MEDIUM #8: No Monitoring/Alerting

**Recommendation:** Add security event monitoring

**Implementation:**
```javascript
// netlify/functions/_middleware.mjs
export async function onRequest(context) {
  const start = Date.now();
  const response = await context.next();
  const duration = Date.now() - start;

  // Log security events
  if (response.status === 429) {
    await logSecurityEvent({
      type: 'rate_limit_exceeded',
      ip: context.ip,
      path: context.url.pathname,
      timestamp: Date.now()
    });
  }

  if (response.status === 403) {
    await logSecurityEvent({
      type: 'forbidden_access',
      ip: context.ip,
      origin: context.request.headers.get('origin'),
      timestamp: Date.now()
    });
  }

  return response;
}
```

---

### 🟡 MEDIUM #9: No Request Signing

**Recommendation:** Implement HMAC request signing

**Implementation:**
```javascript
// Client-side
async function signedRequest(url, payload) {
  const timestamp = Date.now();
  const message = JSON.stringify({ ...payload, timestamp });

  // Generate HMAC (using session secret)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );

  const hexSignature = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': hexSignature,
      'X-Timestamp': timestamp.toString()
    },
    body: message
  });
}
```

---

### 🟡 MEDIUM #10: Missing Subresource Integrity (SRI) (DOCUMENTED)

**Files:** All HTML pages loading third-party scripts
**Status:** Limitation documented - Not practical for dynamic third-party scripts
**Mitigation:** CSP restricts script sources + HTTPS-only loading

**Fix:**
```html
<!-- Before -->
<script src="https://consent.cookiebot.com/uc.js"
        data-cbid="c76249cb-52a7-4dba-adbf-da79fe8a6276">
</script>

<!-- After -->
<script src="https://consent.cookiebot.com/uc.js"
        data-cbid="c76249cb-52a7-4dba-adbf-da79fe8a6276"
        integrity="sha384-HASH"
        crossorigin="anonymous">
</script>
```

**Generate SRI hashes:**
```bash
curl https://consent.cookiebot.com/uc.js | \
  openssl dgst -sha384 -binary | \
  openssl base64 -A
```

---

### 🟡 MEDIUM #11: No E2E Security Tests

**Recommendation:** Add security test suite

**Implementation:**
```javascript
// tests/e2e-security.spec.js
import { test, expect } from '@playwright/test';

test.describe('Security Tests', () => {
  test('blocks XSS in query parameters', async ({ page }) => {
    await page.goto('/?title=<script>alert(1)</script>');
    const hasAlert = await page.evaluate(() => {
      return window.hasOwnProperty('alert');
    });
    expect(hasAlert).toBe(false);
  });

  test('enforces rate limiting', async ({ request }) => {
    const userId = 'test-user';
    const requests = [];

    for (let i = 0; i < 12; i++) {
      requests.push(
        request.post('/.netlify/functions/award-xp', {
          data: { userId, delta: 10 }
        })
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status() === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  test('rejects unauthorized CORS origins', async ({ request }) => {
    const response = await request.post('/.netlify/functions/award-xp', {
      headers: { 'Origin': 'https://evil.com' },
      data: { userId: 'test', delta: 10 }
    });
    expect(response.status()).toBe(403);
  });
});
```

---

### 🟡 MEDIUM #12: Documentation Gaps

**Recommendation:** Create comprehensive security documentation

**Files to create:**
1. `SECURITY.md` - Security policy and reporting
2. `docs/security-guidelines.md` - Development security guidelines
3. Update `README.md` with security best practices

**Example SECURITY.md:**
```markdown
# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

**DO NOT** open a public issue for security vulnerabilities.

Email security@kcswh.pl with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours.

## Security Best Practices

### For Contributors

1. **Never commit secrets** - Use environment variables
2. **Validate all inputs** - Sanitize user data
3. **Use safe APIs** - Prefer `textContent` over `innerHTML`
4. **Test security** - Add E2E security tests
5. **Follow CSP** - No inline scripts without hash

### For Deployments

1. **Set environment variables:**
   - `XP_CORS_ALLOW` - Whitelist origins
   - `XP_COOKIE_SECURE=1` - Force HTTPS cookies
   - `XP_DAILY_SECRET` - Strong secret (32+ chars)

2. **Enable security headers** - Configured in `_headers`

3. **Monitor logs** - Watch for rate limit violations

## Known Limitations

- Anonymous play requires client-sent XP values
- Daily/session caps mitigate abuse
- Server-side XP calculation planned for future release
```

---

## Implementation Checklist

### Week 1: Critical Headers & XSS

- [ ] Update `_headers` with CSP, X-Frame-Options, etc.
- [ ] Generate SHA-256 hashes for inline scripts
- [ ] Enforce Secure cookie flag in production
- [ ] Fix innerHTML in `games-open/tetris/script.js`
- [ ] Fix innerHTML in `games-open/2048/script.js`
- [ ] Fix innerHTML in `games-open/pacman/script.js`
- [ ] Test all pages with new CSP
- [ ] Deploy to staging
- [ ] Verify no breakage

### Week 2: Input Validation

- [ ] Implement `isSafeRedirectUrl()` function
- [ ] Update all `location.replace()` calls
- [ ] Add input sanitization helpers
- [ ] Update frame.js redirect logic
- [ ] Add tests for redirect validation

### Week 3: Storage & Sessions

- [ ] Create `SecureStorage` class
- [ ] Migrate localStorage usage to encrypted storage
- [ ] Create `/start-session` endpoint
- [ ] Implement HMAC session signing
- [ ] Update client to use server tokens
- [ ] Add session validation tests

### Week 4: Monitoring

- [ ] Set up error tracking (Sentry)
- [ ] Add security event logging
- [ ] Create monitoring dashboard
- [ ] Configure alerting rules
- [ ] Document monitoring procedures

### Week 5: Request Signing & Testing

- [ ] Implement request HMAC signing
- [ ] Update server to verify signatures
- [ ] Add SRI to third-party scripts
- [ ] Create E2E security test suite
- [ ] Run full security audit

### Week 6: Documentation

- [ ] Create `SECURITY.md`
- [ ] Write `docs/security-guidelines.md`
- [ ] Update `README.md`
- [ ] Document all security features
- [ ] Create runbook for incidents

---

## Success Metrics

After completing all fixes:

- ✅ CSP violations: 0
- ✅ XSS vulnerabilities: 0
- ✅ Insecure cookies: 0
- ✅ Unvalidated redirects: 0
- ✅ Plaintext storage: 0
- ✅ Security test coverage: >80%
- ✅ All OWASP Top 10 mitigated

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CSP Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Cookie Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#security)
- [SRI](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
