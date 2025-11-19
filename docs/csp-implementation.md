# Content Security Policy Implementation

**Date:** 2025-11-19
**Related:** SECURITY-ISSUES.md Critical Issue #1

## Overview

Implemented comprehensive Content Security Policy (CSP) headers to protect against XSS attacks, clickjacking, and other code injection vulnerabilities.

## Changes Made

### 1. Security Headers Added (`_headers`)

Added the following security headers to all pages:

- **Content-Security-Policy:** Comprehensive policy with SHA-256 hashes for inline scripts
- **X-Frame-Options:** DENY (prevents clickjacking)
- **X-Content-Type-Options:** nosniff (prevents MIME sniffing)
- **Referrer-Policy:** strict-origin-when-cross-origin
- **Permissions-Policy:** Enhanced with additional restrictions

### 2. Inline Script Hashes

Generated SHA-256 hashes for all inline scripts to allow them under strict CSP:

| Script | Location | Hash |
|--------|----------|------|
| Dev mode badge | index.html:140-177 | `sha256-RxjC9yYMCxrDvdV2MRVGu3psi/rGesk5yo+xz8t0mTg=` |
| Cookie consent manager | index.html:179-206 | `sha256-b9iJTOPg44XsNt2+bPEvkfGsFVqaumQri2/zrB5sA2o=` |
| Game ID: game-shell | game.html:162 | `sha256-r2Com2yfQQJausYYBQrPxaAWCcsnq/DeXka9Een02Es=` |
| Game ID: cats | game_cats.html:162 | `sha256-7DqW5VpwTmlMgcPXCGjl28RbTrTtFBRbVNjzoXcX2ko=` |
| Game ID: t-rex | game_trex.html:162 / games/t-rex/index.html:50 | `sha256-Oqt8ODQWKmLkPiB2r9xrcowu+l+WYwZHfUCf9sDFFzs=` |
| Game ID: play-shell | play.html:207 | `sha256-hj8NYUFe4nbn60KAXU7N2GrsNT/k8E1xkdlLIoRL9XM=` |
| Game ID: 2048 | games-open/2048/index.html:185 | `sha256-0Wb+NgnHAGHhGh/6nFbkTiktnYSpz6EVA5IxiiUU8DQ=` |
| Game ID: pacman | games-open/pacman/index.html:190 | `sha256-nLjGeBvK8BQE0UTh0+74CPwdrKgQDVRFFVyOcYuMf7g=` |
| Game ID: tetris | games-open/tetris/index.html:197 | `sha256-Rnt3+nPKWPiw/qrDaU3o++VVHxBSkZ+c3jPI2wHLOOk=` |
| XP autoboot | game*.html, play.html, games-open/*/index.html | `sha256-SWcqpLVOMnXcdN/VcUKPlxZykeV9QrkVNrvQUD6SZJk=` |
| GA4 analytics | index.html (GA4) | `sha256-AO9B7DMlmWxTtLbca1rsS5u3qc7ZYy2nDO8OZbmZIU0=` |
| Game loader | play.html:48-186 | `sha256-BXGXBorW8mlhTPKDCok0aiBZOGWyKJ9NLbeCp3LDYBU=` |
| Message listener | play.html:189-204 | `sha256-abjvafYxRJPluYN0Kq7u5j4wpFnn454sy6KWSsP+FPA=` |
| Debug/admin unlock | about.en.html, about.pl.html:45-188 | `sha256-YCvyYCnuX5SrGntgepIszM19NUEVt76UAEw52WlkgFA=` |

### 3. CSP Directives

```
default-src 'self'
  - Only allow resources from same origin by default

script-src 'self' https://consent.cookiebot.com https://www.googletagmanager.com https://github.com [hashes]
  - Allow scripts from self, Cookiebot, Google Tag Manager, GitHub
  - Allow inline scripts only with matching SHA-256 hashes

style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
  - Allow styles from self and Google Fonts
  - Allow inline styles (required for dynamic styling)

font-src 'self' https://fonts.gstatic.com data:
  - Allow fonts from self, Google Fonts, and data URIs

img-src 'self' data: https://github.com https://www.googletagmanager.com
  - Allow images from self, data URIs, GitHub, GTM

connect-src 'self' https://*.netlify.app https://www.google-analytics.com
  - Allow API calls to self, Netlify functions, Google Analytics

frame-src 'self'
  - Only allow iframes from same origin

frame-ancestors 'none'
  - Prevent site from being embedded in iframes (clickjacking protection)

base-uri 'self'
  - Restrict base tag to same origin

form-action 'self'
  - Only allow form submissions to same origin

upgrade-insecure-requests
  - Automatically upgrade HTTP to HTTPS
```

## Testing

### Before Deployment

1. **Test locally:**
   ```bash
   # Start local dev server
   npm run dev

   # Check browser console for CSP violations
   # Should see no errors
   ```

2. **Validate CSP syntax:**
   ```bash
   # Use CSP Evaluator
   curl -X POST https://csp-evaluator.withgoogle.com/check \
     -d "csp=<your-csp-policy>"
   ```

3. **Test all pages:**
   - Index page (portal)
   - Game pages (game.html, game_cats.html, game_trex.html)
   - About pages
   - Legal pages
   - XP dashboard

### After Deployment

1. **Monitor CSP reports** (if report-uri configured)
2. **Check browser console** for violations
3. **Verify functionality:**
   - Analytics tracking works
   - Cookie consent works
   - XP system works
   - Games load correctly

## Common Issues & Solutions

### Issue: Script blocked by CSP

**Symptom:** Console error like:
```
Refused to execute inline script because it violates CSP directive
```

**Solution:**
1. Generate SHA-256 hash for the script
2. Add hash to `script-src` directive in `_headers`
3. Redeploy

**Generate hash:**
```bash
echo -n "your script content" | openssl dgst -sha256 -binary | openssl base64
```

### Issue: External resource blocked

**Symptom:** Image/font/script not loading

**Solution:**
Add domain to appropriate directive:
- Scripts: `script-src`
- Styles: `style-src`
- Fonts: `font-src`
- Images: `img-src`
- AJAX: `connect-src`

### Issue: Unsafe inline styles

**Current:** We allow `'unsafe-inline'` for styles due to dynamic styling needs.

**Future improvement:** Generate style hashes or use `nonce` attribute.

## Maintenance

### When Adding New Inline Scripts

1. **Add the script to HTML**
2. **Generate SHA-256 hash:**
   ```bash
   echo -n "script content" | openssl dgst -sha256 -binary | openssl base64
   ```
3. **Add hash to `_headers`:**
   ```
   script-src ... 'sha256-YOUR_HASH_HERE'
   ```
4. **Update this document** with new hash

### When Adding Third-Party Services

1. **Identify required domains** (check Network tab in DevTools)
2. **Add to appropriate directives** in `_headers`
3. **Test thoroughly**
4. **Document the change** here

## Security Improvements Achieved

✅ **Before:** Any inline script could execute (XSS vulnerable)
✅ **After:** Only whitelisted inline scripts allowed

✅ **Before:** Could load resources from any domain
✅ **After:** Strict whitelist of allowed domains

✅ **Before:** Site could be embedded in iframes
✅ **After:** Protected against clickjacking

✅ **Before:** No MIME sniffing protection
✅ **After:** X-Content-Type-Options prevents attacks

## References

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)

## Next Steps

1. ✅ Implement CSP headers (DONE)
2. ⏳ Monitor CSP violations in production
3. ⏳ Add CSP violation reporting endpoint
4. ⏳ Remove `'unsafe-inline'` from style-src (use hashes)
5. ⏳ Consider using nonce for dynamic scripts
