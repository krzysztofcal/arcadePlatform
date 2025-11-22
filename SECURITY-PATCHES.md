# Emergency Security Patches

**Date:** 2025-11-19
**Status:** Applied
**Severity:** CRITICAL

## Overview

This document describes the emergency security patches applied to address critical vulnerabilities in the XP reward system and frontend code.

## Patches Applied

### 1. CORS Wildcard Vulnerability (CRITICAL) ✅

**File:** `netlify/functions/award-xp.mjs`
**Lines:** 206-233, 244-256, 178-199

**Problem:**
- CORS headers defaulted to wildcard `"*"` when origin was not in whitelist
- Allowed ANY website to call the XP award endpoint
- Enabled CSRF attacks and unauthorized access

**Fix:**
- **Reject cross-origin requests** from non-whitelisted origins with HTTP 403
- **Validation happens BEFORE any side effects** (rate limiting, session registration, XP awarding)
- **Allow same-origin requests** (no Origin header present)
- Return explicit error for blocked origins: `{ error: "forbidden", message: "origin_not_allowed" }`
- Applied to both OPTIONS preflight and POST requests
- **Defense in depth:** Dual validation at handler entry + response generation

**CORS Behavior:**
According to CORS spec, the `Origin` header is only present for cross-origin requests:
- **No Origin header:** Same-origin or local request → Allow
- **Origin header present:** Cross-origin request → Enforce whitelist
- **Origin in whitelist:** Allow with CORS headers
- **Origin not in whitelist:** Reject with HTTP 403 **immediately before any mutations**

**Critical Security Fix:**
Initial implementation validated CORS only when generating responses, allowing blocked origins to trigger rate limiting, session registration, and XP awarding before receiving 403. Now CORS validation is the **first check** in the handler, preventing all side effects for blocked origins.

**Configuration:**
Set allowed origins via environment variable:
```bash
XP_CORS_ALLOW="https://play.kcswh.pl,http://localhost:4173"
```

---

### 2. Rate Limiting (CRITICAL) ✅

**File:** `netlify/functions/award-xp.mjs`
**Lines:** 114-117, 228-295, 419-439

**Problem:**
- No rate limiting on XP award endpoint
- Attackers could flood the endpoint with requests
- Enabled XP farming through automation
- Risk of DoS attacks

**Fix:**
- Implemented dual-layer rate limiting:
  - **Per User:** Max 10 requests/minute per userId
  - **Per IP:** Max 20 requests/minute per IP address
- Uses Redis with sliding window (1-minute buckets)
- Returns HTTP 429 with `Retry-After: 60` header when exceeded
- Extracts IP from `X-Forwarded-For` or `X-Real-IP` headers

**Configuration:**
```bash
XP_RATE_LIMIT_USER_PER_MIN=10    # Default: 10
XP_RATE_LIMIT_IP_PER_MIN=20      # Default: 20
XP_RATE_LIMIT_ENABLED=1          # Default: enabled (set to 0 to disable)
```

**Response when rate limited:**
```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests from user",
  "retryAfter": 60
}
```

---

### 3. Session Registration & Validation (HIGH) ✅

**File:** `netlify/functions/award-xp.mjs`
**Lines:** 230-256, 509-510, 548-563

**Problem:**
- No validation that sessions are legitimate
- Attackers could fabricate sessionIds
- No tracking of active sessions

**Fix:**
- Auto-register sessions when:
  - `statusOnly=true` (session start/check)
  - `delta=0` (session initialization)
  - First XP-bearing request (backward compatibility)
- Sessions stored in Redis with 7-day TTL
- Validates sessions before accepting XP deltas (currently auto-registers for compatibility)
- Logs unregistered sessions in debug mode

**Future Enhancement:**
Can be made strict by rejecting unregistered sessions instead of auto-registering:
```javascript
if (!registered) {
  return respond(403, { error: "session_not_registered" }, { totals });
}
```

---

### 4. Server Session Enforcement (HIGH) ✅

**File:** `netlify/functions/award-xp.mjs`
**Lines:** 526-599

**Problem:**
- Session tokens not validated against server-side state
- Potential for session hijacking
- No fingerprint validation for anti-replay protection

**Fix:**
- Implemented server-side session token validation with HMAC signatures
- Browser fingerprint validation prevents token theft/replay
- Redis-backed session store with TTL
- Two-phase rollout capability (warn mode → enforce mode)

**Validation Checks:**
1. HMAC signature verification on session tokens
2. User ID matches token claims
3. Browser fingerprint matches stored value
4. Session exists and is valid in Redis
5. Suspicious activity logging for potential hijacking attempts

**Configuration:**
```bash
# Phase 1 - Monitoring (start here)
XP_SERVER_SESSION_WARN_MODE=1   # Log failures but allow requests
XP_REQUIRE_SERVER_SESSION=0

# Phase 2 - Enforcement (after verification)
XP_SERVER_SESSION_WARN_MODE=0
XP_REQUIRE_SERVER_SESSION=1     # Reject requests without valid tokens
```

**Response when enforcement rejects:**
```json
{
  "error": "invalid_session",
  "message": "session_validation_failed",
  "requiresNewSession": true
}
```

**Rollout Procedure:**
1. Deploy with `XP_SERVER_SESSION_WARN_MODE=1` to monitor
2. Review logs for `[XP] Session validation failed (warn mode)` entries
3. After confirming minimal legitimate failures, enable enforcement
4. Set `XP_REQUIRE_SERVER_SESSION=1` and disable warn mode

See `netlify.toml` for complete environment variable documentation.

---

### 5. XSS Prevention in frame.js (CRITICAL) ✅

**File:** `js/frame.js`
**Lines:** 509-530

**Problem:**
- Used `innerHTML` to concatenate user-controlled data
- Query parameters could inject malicious HTML/JavaScript
- Vulnerable code:
  ```javascript
  frameBox.innerHTML = '<div class="emptyState"><p>' + text + '</p>';
  ```

**Fix:**
- Replaced `innerHTML` concatenation with safe DOM manipulation
- Uses `createElement()` and `textContent` (no HTML interpretation)
- Prevents script injection through query parameters

**Before:**
```javascript
let inner = '<div class="emptyState"><p>' + text + '</p>';
if (linkHref){
  inner += '<p><a class="emptyStateLink" href="' + linkHref + '">' + linkLabel + '</a></p>';
}
frameBox.innerHTML = inner;
```

**After:**
```javascript
const emptyStateDiv = document.createElement('div');
emptyStateDiv.className = 'emptyState';

const textPara = document.createElement('p');
textPara.textContent = text; // Safe - no HTML interpretation
emptyStateDiv.appendChild(textPara);

if (linkHref){
  const linkPara = document.createElement('p');
  const link = document.createElement('a');
  link.className = 'emptyStateLink';
  link.href = linkHref;
  link.textContent = linkLabel; // Safe
  linkPara.appendChild(link);
  emptyStateDiv.appendChild(linkPara);
}
frameBox.appendChild(emptyStateDiv);
```

---

## Impact Assessment

### Before Patches
- ❌ Any website could call XP endpoint (CORS wildcard)
- ❌ No rate limiting (DoS vulnerable)
- ❌ XSS injection possible through query params
- ❌ No session validation
- **Risk Level:** CRITICAL

### After Patches
- ✅ Only whitelisted origins can access endpoint
- ✅ Rate limited (10 req/min per user, 20/min per IP)
- ✅ XSS vulnerability patched
- ✅ Sessions tracked and validated
- ✅ Server-side session token enforcement available (HMAC-signed, fingerprint-validated)
- **Risk Level:** LOW-MEDIUM (when session enforcement enabled)

---

## Remaining Security Considerations

### Anonymous Play Trade-offs
Since the platform supports anonymous play (no user accounts), some security limitations remain:

1. **Client-controlled XP deltas**: Client still calculates and sends XP values
   - Mitigated by: Daily caps, session caps, delta caps, rate limiting
   - Future: Move XP calculation server-side

2. **Session ID predictability**: While using `crypto.randomUUID()`, client generates IDs
   - Mitigated by: Session registration, rate limiting
   - Future: Server-generated session tokens with HMAC

3. **No request signing**: Requests not cryptographically signed
   - Mitigated by: CORS whitelist, rate limiting, session validation
   - Future: Implement challenge-response authentication

### Recommended Next Steps
1. **Monitoring:** Add alerting for rate limit violations and unusual patterns
2. **Logging:** Track failed authentication attempts and blocked origins
3. **Testing:** Implement E2E tests for security scenarios
4. **Documentation:** Update API docs with security requirements

---

## Configuration Summary

### Required Environment Variables
```bash
# Existing
XP_DAILY_SECRET=<32+ char secret>  # Required for cookie signing

# CORS (Required)
XP_CORS_ALLOW="https://play.kcswh.pl,http://localhost:4173"

# Rate Limiting (Optional - defaults shown)
XP_RATE_LIMIT_USER_PER_MIN=10
XP_RATE_LIMIT_IP_PER_MIN=20
XP_RATE_LIMIT_ENABLED=1

# Cookie Security (Recommended)
XP_COOKIE_SECURE=1  # Force HTTPS-only cookies

# Server Session Enforcement (Production Rollout)
# Phase 1 - Monitoring
XP_SERVER_SESSION_WARN_MODE=1   # Start with warn mode to monitor
# Phase 2 - Enforcement (after verification)
# XP_REQUIRE_SERVER_SESSION=1   # Enable after confirming warn mode success
```

### Local Development
For local testing, add localhost to CORS whitelist:
```bash
XP_CORS_ALLOW="http://localhost:4173,http://localhost:8888"
```

---

## Testing

### Manual Testing
1. **CORS Test:** Try accessing endpoint from unauthorized origin (should get 403)
2. **Rate Limit Test:** Make 11+ requests in 1 minute (should get 429)
3. **XSS Test:** Add query params with HTML/JS (should render as text, not execute)
4. **Session Test:** Send XP delta without statusOnly first (should auto-register)

### Automated Testing
Add E2E tests for:
- CORS rejection
- Rate limiting thresholds
- Session lifecycle
- XSS injection attempts

---

## Rollback Procedure

If issues arise, rollback by reverting these files:
```bash
git checkout HEAD~1 netlify/functions/award-xp.mjs js/frame.js
```

---

## Credits

Patches implemented based on comprehensive security audit identifying:
- 7 critical vulnerabilities
- 4 high-severity issues
- 5 medium-severity issues

**Audit Date:** 2025-11-19
**Implementation Date:** 2025-11-19
