const message = [
  'tools/_shared/poker-e2e-cleanup.mjs is retired.',
  'It depended on HTTP poker gameplay endpoints (poker-leave), which are retired 410 stubs.',
  'Use WS-native cleanup/manual flows for table runtime checks.'
].join(' ');

process.stderr.write(message + '\n');
process.exit(1);
