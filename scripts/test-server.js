#!/usr/bin/env node
/**
 * Integrated Test Server
 *
 * Combines static file serving with Netlify function handling and security headers
 * for use in E2E tests. This mimics the Netlify deployment environment locally.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Minimal set of security headers to enforce during tests
const defaultSecurityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://consent.cookiebot.com https://consentcdn.cookiebot.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()'
};

// Load security headers from _headers file
function loadSecurityHeaders() {
  const headersFile = path.join(root, '_headers');
  const headers = {};

  try {
    const content = fs.readFileSync(headersFile, 'utf-8');
    const lines = content.split('\n');
    let currentPath = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Path line (starts with /)
      if (trimmed.startsWith('/')) {
        currentPath = trimmed;
        if (!headers[currentPath]) {
          headers[currentPath] = {};
        }
      } else if (currentPath && trimmed.includes(':')) {
        // Header line
        const colonIndex = trimmed.indexOf(':');
        const headerName = trimmed.substring(0, colonIndex).trim();
        const headerValue = trimmed.substring(colonIndex + 1).trim();
        headers[currentPath][headerName] = headerValue;
      }
    }
  } catch (e) {
    console.warn('Warning: Could not load _headers file:', e.message);
  }

  // Ensure default security headers exist for test environment even if the
  // _headers file is missing or incomplete (e.g., when only static server
  // headers would be present).
  headers['/*'] = Object.assign({}, defaultSecurityHeaders, headers['/*']);

  return headers;
}

const securityHeaders = loadSecurityHeaders();

// Get headers for a specific path
function getHeadersForPath(pathname) {
  const headers = { 'Cache-Control': 'no-cache' };

  // Apply /* (all paths) headers first
  if (securityHeaders['/*']) {
    Object.assign(headers, securityHeaders['/*']);
  }

  // Apply specific path headers
  for (const [pattern, pathHeaders] of Object.entries(securityHeaders)) {
    if (pattern === '/*') continue;

    // Simple glob matching (supports /* and exact paths)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    if (regex.test(pathname)) {
      Object.assign(headers, pathHeaders);
    }
  }

  // In test mode, remove strict CSP that causes browser crashes
  // Keep other security headers for testing, but simplify CSP
  if (headers['Content-Security-Policy']) {
    // Simplify CSP for test environment while allowing required third-party assets.
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://consent.cookiebot.com https://consentcdn.cookiebot.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'";
  }

  return headers;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  if (body instanceof Buffer || typeof body === 'string') {
    res.end(body);
  } else {
    res.end();
  }
}

// Import and handle Netlify function (ESM)
let awardXpHandler = null;
const handlerPromise = (async () => {
  try {
    const module = await import('../netlify/functions/award-xp.mjs');
    awardXpHandler = module.handler || module.default?.handler;
  } catch (e) {
    console.warn('Warning: Could not load award-xp function:', e.message);
  }
})();

async function handleFunction(req, res) {
  // Wait for handler to be loaded if still loading
  await handlerPromise;

  if (!awardXpHandler) {
    send(res, 501, 'Function not implemented', { 'Content-Type': 'text/plain' });
    return;
  }

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(',') : value;
  }

  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    try {
      const result = await awardXpHandler({ httpMethod: 'OPTIONS', headers, body: '' });
      send(res, result.statusCode || 204, result.body || '', result.headers || {});
    } catch (e) {
      console.error('Function error (OPTIONS):', e);
      send(res, 500, 'Internal server error', { 'Content-Type': 'text/plain' });
    }
    return;
  }

  // Handle POST
  if (req.method !== 'POST') {
    send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const result = await awardXpHandler({ httpMethod: 'POST', headers, body });
      const responseHeaders = result.headers || {};

      // Ensure CORS headers are present
      if (!responseHeaders['Access-Control-Allow-Origin'] && headers.origin) {
        responseHeaders['Access-Control-Allow-Origin'] = headers.origin;
        responseHeaders['Access-Control-Allow-Credentials'] = 'true';
      }

      send(res, result.statusCode || 200, result.body || '', responseHeaders);
    } catch (e) {
      console.error('Function error:', e);
      send(res, 500, JSON.stringify({ error: 'Internal server error' }), {
        'Content-Type': 'application/json'
      });
    }
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new url.URL(req.url || '/', `http://${req.headers.host || host}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // Handle Netlify function endpoint
    if (pathname === '/.netlify/functions/award-xp') {
      await handleFunction(req, res);
      return;
    }

    // Handle static files
    if (pathname.endsWith('/')) {
      pathname = path.join(pathname, 'index.html');
    }

    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
      send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
      return;
    }

    let data;
    try {
      data = await fs.promises.readFile(filePath);
    } catch (err) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Get security headers for this path
    const headers = getHeadersForPath(pathname);
    headers['Content-Type'] = contentType;

    send(res, 200, data, headers);
  } catch (err) {
    console.error('Server error:', err);
    send(res, 500, 'Server error', { 'Content-Type': 'text/plain' });
  }
});

function closeAndExit() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', closeAndExit);
process.on('SIGTERM', closeAndExit);

server.listen(port, host, async () => {
  // Wait for handler to finish loading
  await handlerPromise;

  console.log(`Test server running at http://${host}:${port}`);
  console.log('  - Static files from:', root);
  console.log('  - Security headers:', Object.keys(securityHeaders).length > 0 ? 'enabled' : 'disabled');
  console.log('  - Netlify functions:', awardXpHandler ? 'enabled' : 'disabled');
});
