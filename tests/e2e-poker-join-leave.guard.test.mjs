import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('tests/e2e-poker-join-leave.spec.ts', 'utf8');
const stateKeyMatches = source.match(/__POKER_TEST_STATE__/g) || [];

assert.match(source, /const POKER_TEST_STATE_KEY = '__POKER_TEST_STATE__';/, 'e2e join/leave spec should define one canonical poker test state key');
assert.equal(stateKeyMatches.length, 1, 'e2e join/leave spec should reference the raw poker test state key exactly once');
assert.match(source, /const readPokerTestState = \(page\) =>/, 'e2e join/leave spec should expose a shared poker test state reader');
assert.match(source, /const readPokerWsCreateMarker = \(page\) =>/, 'e2e join/leave spec should expose a shared ws create marker reader');
assert.match(source, /window\[stateKeyValue\] = testState;/, 'e2e join/leave spec should write mock state through the shared state key');
assert.match(source, /Object\.defineProperty\(createPokerWsClientMock, markerKeyValue, \{/, 'e2e join/leave spec should tag the mocked ws create function with a stable marker');
assert.match(source, /Object\.defineProperty\(pokerWsClientMock, 'create', \{/, 'e2e join/leave spec should lock the mocked ws create property');
assert.match(source, /await expect\(readPokerWsCreateMarker\(page\), 'WS mock create marker should survive table bootstrap'\)\.resolves\.toBe\(POKER_WS_CREATE_MARKER_VALUE\);/, 'e2e join/leave spec should assert the mocked ws create survives bootstrap');
assert.match(source, /const state = await readPokerTestState\(page\);/, 'e2e join/leave spec should read bootstrap state through the shared helper');
assert.match(source, /await readPokerTestState\(page\)\)\?\.joinPayloads\?\.length/, 'e2e join/leave spec should read join payloads through the shared helper');
assert.match(source, /const postJoinState = await readPokerTestState\(page\);/, 'e2e join/leave spec should read post-join state through the shared helper');
