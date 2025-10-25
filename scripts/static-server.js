#!/usr/bin/env node
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

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-cache' }, headers));
  if (body instanceof Buffer || typeof body === 'string') {
    res.end(body);
  } else {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new url.URL(req.url || '/', `http://${req.headers.host || host}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.endsWith('/')) {
      pathname = path.join(pathname, 'index.html');
    }

    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
      send(res, 403, 'Forbidden');
      return;
    }

    let data;
    try {
      data = await fs.promises.readFile(filePath);
    } catch (err) {
      send(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || 'application/octet-stream';
    send(res, 200, data, { 'Content-Type': type });
  } catch (err) {
    send(res, 500, 'Server error');
  }
});

function closeAndExit() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', closeAndExit);
process.on('SIGTERM', closeAndExit);

server.listen(port, host, () => {
  console.log(`Static server running at http://${host}:${port}`);
});
