const { existsSync } = require('node:fs');
const path = require('node:path');

const CANDIDATE_PATHS = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  process.env.CHROME_BIN,
  process.env.CHROMIUM_BIN,
  process.env.BROWSER_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function normalize(candidate) {
  if (!candidate) return null;
  const expanded = candidate.startsWith('~')
    ? path.join(process.env.HOME || '', candidate.slice(1))
    : candidate;
  return expanded;
}

function findSystemChromium() {
  for (const candidate of CANDIDATE_PATHS) {
    const normalized = normalize(candidate);
    if (normalized && existsSync(normalized)) {
      return normalized;
    }
  }
  return null;
}

module.exports = {
  findSystemChromium,
};
