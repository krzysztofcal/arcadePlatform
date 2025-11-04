#!/usr/bin/env node
const { execSync } = require('node:child_process');

function grep(command) {
  try {
    return execSync(command, { stdio: 'pipe' }).toString().trim();
  } catch {
    return '';
  }
}

const badPageShow = grep(`grep -nR "addEventListener('pageshow'" js games games-open play.html | grep -v js/xp.js`);
const badPageHide = grep(`grep -nR "addEventListener('pagehide'" js games games-open play.html | grep -v js/xp.js`);
const badUnload = grep(`grep -nR "addEventListener('beforeunload'" js games games-open play.html | grep -v js/xp.js`);

if (badPageShow || badPageHide || badUnload) {
  console.error('❌ Lifecycle listeners found outside js/xp.js:\n', badPageShow, badPageHide, badUnload);
  process.exit(1);
}

console.log('✅ Lifecycle centralized in js/xp.js only.');
