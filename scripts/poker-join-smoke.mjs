const message = [
  'poker-join-smoke is retired.',
  'Poker table runtime is WS-only and HTTP gameplay join endpoints are retired (410).',
  'Use WS smoke/behavior coverage (tests/poker-ui-ws-*.behavior.test.mjs, ws-tests/*) instead.'
].join(' ');

process.stderr.write(message + '\n');
process.exit(1);
