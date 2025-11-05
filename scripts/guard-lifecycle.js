#!/usr/bin/env node
const { execSync } = require('node:child_process');

function grep(command) {
  try {
    return execSync(command, { stdio: 'pipe' }).toString().trim();
  } catch {
    return '';
  }
}

const LISTENER = ['add', 'EventListener'].join('');
const events = [
  ['page', 'show'],
  ['page', 'hide'],
  ['before', 'unload']
].map(parts => parts.join(''));

function buildQuery(event) {
  const search = `${LISTENER}('${event}'`;
  return `grep -nR "${search}" js games games-open play.html | grep -v js/xp.js`;
}

const [badPageShow, badPageHide, badUnload] = events.map(buildQuery).map(grep);

if (badPageShow || badPageHide || badUnload) {
  console.error('❌ Lifecycle listeners found outside js/xp.js:\n', badPageShow, badPageHide, badUnload);
  process.exit(1);
}

console.log('✅ Lifecycle centralized in js/xp.js only.');
