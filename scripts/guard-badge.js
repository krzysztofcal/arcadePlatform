#!/usr/bin/env node
const { execSync } = require('node:child_process');

const out = execSync(`grep -Rn '<a[^>]*id="xpBadge"[^>]*class="[^"]*\\bxp-badge\\b' .`, { stdio: 'pipe' }).toString();
if (!out.trim()) {
  console.error('❌ No badge anchors found.');
  process.exit(1);
}

const straySpan = execSync(`bash -lc "grep -Rn '<span[^>]*id=\\"xpBadge\\"' . || true"`).toString().trim();
const dupId = execSync(`bash -lc "grep -Rn 'id=\\"xpBadge\\"[^>]*id=\\"xpBadge\\"' . || true"`).toString().trim();

if (straySpan) {
  console.error('❌ Stray span with id=xpBadge:\n' + straySpan);
  process.exit(1);
}
if (dupId) {
  console.error('❌ Duplicate id=xpBadge attributes:\n' + dupId);
  process.exit(1);
}

console.log('✅ Badge id discipline OK.');
