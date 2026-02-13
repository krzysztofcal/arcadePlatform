import assert from 'node:assert/strict';
import { nextWarsawResetMs, warsawDayKey } from '../netlify/functions/_shared/time-utils.mjs';

const HOUR_MS = 60 * 60 * 1000;

function runCase(nowIso, expectedDayKey) {
  const nowMs = Date.parse(nowIso);
  const nextResetMs = nextWarsawResetMs(nowMs);

  assert(nextResetMs > nowMs, 'nextReset must be in the future');
  assert(nextResetMs - nowMs <= 25 * HOUR_MS, 'nextReset must be <= 25h from now (Warsaw DST-safe)');
  assert.equal(warsawDayKey(nowMs), expectedDayKey, 'dayKey must follow Warsaw 03:00 reset semantics');
}

// Winter: before 03:00 Warsaw belongs to previous day key
runCase('2026-02-12T01:15:00.000Z', '2026-02-11');

// DST start (last Sunday in March): around jump
runCase('2026-03-29T00:30:00.000Z', '2026-03-28');
runCase('2026-03-29T02:30:00.000Z', '2026-03-29');

// DST end (last Sunday in October): around overlap
runCase('2026-10-25T00:30:00.000Z', '2026-10-24');
runCase('2026-10-25T02:30:00.000Z', '2026-10-25');

console.log('xp-caps nextReset Warsaw invariant tests passed');
