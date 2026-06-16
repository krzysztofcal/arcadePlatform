const message = [
  'tools/_shared/poker-e2e-http.mjs is retired.',
  'Poker gameplay runtime is WS-only, and HTTP gameplay endpoints are retired stubs returning 410.',
  'Use WS runtime coverage and WS manual flows instead of HTTP poker tooling.'
].join(' ');

process.stderr.write(message + '\n');
process.exit(1);
