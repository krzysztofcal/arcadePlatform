import assert from 'node:assert/strict';
import { nextUtcMidnightMs, utcDayKey } from '../netlify/functions/_shared/time-utils.mjs';

const HOUR_MS = 60 * 60 * 1000;

function runCase(nowIso, expectedDayKey) {
  const nowMs = Date.parse(nowIso);
  const nextResetMs = nextUtcMidnightMs(nowMs);

  assert(nextResetMs > nowMs, 'nextReset must be in the future');
  assert(nextResetMs - nowMs <= 24 * HOUR_MS, 'nextReset must be <= 24h from now');
  assert.equal(utcDayKey(nowMs), expectedDayKey, 'dayKey must use UTC date');
}

runCase('2026-02-12T10:15:00.000Z', '2026-02-12');
runCase('2026-03-29T23:59:59.000Z', '2026-03-29');
runCase('2026-10-25T00:30:00.000Z', '2026-10-25');

console.log('xp-caps nextReset UTC invariant tests passed');
