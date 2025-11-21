import assert from 'node:assert/strict';

process.env.XP_DAILY_SECRET = 'test-secret-for-sessions-32chars!';

async function createHandler(ns = 'test:session') {
  process.env.XP_DEBUG = '1';
  process.env.XP_KEY_NS = ns;
  process.env.XP_SESSION_RATE_LIMIT_ENABLED = '0'; // Disable rate limiting for tests
  const { handler, verifySessionToken, validateServerSession } = await import('../netlify/functions/start-session.mjs?ns=' + ns);
  return { handler, verifySessionToken, validateServerSession };
}

(async () => {
  console.log('Running start-session tests...');

  const { handler, verifySessionToken, validateServerSession } = await createHandler();

  // Test 1: OPTIONS request for CORS preflight
  const options = await handler({
    httpMethod: 'OPTIONS',
    headers: { origin: 'https://test.netlify.app' }
  });
  assert.equal(options.statusCode, 204, 'OPTIONS should return 204');
  assert.ok(options.headers['access-control-allow-origin'], 'Should include CORS headers');
  console.log('  [PASS] OPTIONS preflight');

  // Test 2: GET method should be rejected
  const getReq = await handler({
    httpMethod: 'GET',
    headers: {}
  });
  assert.equal(getReq.statusCode, 405, 'GET should return 405');
  console.log('  [PASS] GET method rejected');

  // Test 3: Missing userId should return error
  const missingUser = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({}),
  });
  assert.equal(missingUser.statusCode, 400, 'Missing userId should return 400');
  const missingUserPayload = JSON.parse(missingUser.body);
  assert.equal(missingUserPayload.error, 'missing_user_id');
  console.log('  [PASS] Missing userId rejected');

  // Test 4: Valid session creation
  const validSession = await handler({
    httpMethod: 'POST',
    headers: {
      'user-agent': 'Mozilla/5.0 Test Browser',
      'accept-language': 'en-US',
      'accept-encoding': 'gzip, deflate',
    },
    body: JSON.stringify({ userId: 'test-user-123' }),
  });
  assert.equal(validSession.statusCode, 200, 'Valid request should return 200');
  const sessionPayload = JSON.parse(validSession.body);
  assert.equal(sessionPayload.ok, true, 'Response should have ok: true');
  assert.ok(sessionPayload.sessionId, 'Should return sessionId');
  assert.ok(sessionPayload.sessionToken, 'Should return sessionToken');
  assert.ok(sessionPayload.expiresIn > 0, 'Should return expiresIn');
  assert.ok(sessionPayload.createdAt > 0, 'Should return createdAt');
  console.log('  [PASS] Valid session creation');

  // Test 5: Session token signature verification
  const secret = process.env.XP_DAILY_SECRET;
  const tokenResult = verifySessionToken(sessionPayload.sessionToken, secret);
  assert.equal(tokenResult.valid, true, 'Token should be valid');
  assert.equal(tokenResult.userId, 'test-user-123', 'Token should contain correct userId');
  assert.equal(tokenResult.sessionId, sessionPayload.sessionId, 'Token should contain correct sessionId');
  assert.ok(tokenResult.fingerprint, 'Token should contain fingerprint');
  console.log('  [PASS] Token signature verification');

  // Test 6: Invalid token verification (malformed - missing signature)
  const malformedToken = verifySessionToken('just_payload_no_dot', secret);
  assert.equal(malformedToken.valid, false, 'Malformed token should fail');
  assert.equal(malformedToken.reason, 'malformed_token', 'Should return malformed_token reason');
  console.log('  [PASS] Malformed token rejected');

  // Test 6b: Invalid token with bad signature
  const invalidToken = verifySessionToken('invalid.token', secret);
  assert.equal(invalidToken.valid, false, 'Invalid token should fail');
  assert.equal(invalidToken.reason, 'invalid_signature', 'Should return proper error reason');
  console.log('  [PASS] Invalid token rejected');

  // Test 7: Tampered token signature
  const [payload, sig] = sessionPayload.sessionToken.split('.');
  const tamperedToken = `${payload}.tampered_signature`;
  const tamperedResult = verifySessionToken(tamperedToken, secret);
  assert.equal(tamperedResult.valid, false, 'Tampered token should fail');
  assert.equal(tamperedResult.reason, 'invalid_signature', 'Should detect signature mismatch');
  console.log('  [PASS] Tampered signature rejected');

  // Test 8: Wrong secret verification
  const wrongSecretResult = verifySessionToken(sessionPayload.sessionToken, 'wrong-secret');
  assert.equal(wrongSecretResult.valid, false, 'Wrong secret should fail');
  assert.equal(wrongSecretResult.reason, 'invalid_signature', 'Should detect wrong secret');
  console.log('  [PASS] Wrong secret rejected');

  // Test 9: Server session validation (requires Redis, may fail in memory-only mode)
  const validationResult = await validateServerSession({
    sessionId: sessionPayload.sessionId,
    userId: 'test-user-123',
    fingerprint: tokenResult.fingerprint,
  });
  assert.equal(validationResult.valid, true, 'Session should be valid in store');
  console.log('  [PASS] Server session validation');

  // Test 10: User mismatch detection
  const userMismatch = await validateServerSession({
    sessionId: sessionPayload.sessionId,
    userId: 'different-user',
    fingerprint: tokenResult.fingerprint,
  });
  assert.equal(userMismatch.valid, false, 'Wrong user should fail');
  assert.equal(userMismatch.reason, 'user_mismatch');
  console.log('  [PASS] User mismatch detected');

  // Test 11: Fingerprint mismatch detection (anti-hijacking)
  const fpMismatch = await validateServerSession({
    sessionId: sessionPayload.sessionId,
    userId: 'test-user-123',
    fingerprint: 'different_fingerprint',
  });
  assert.equal(fpMismatch.valid, false, 'Wrong fingerprint should fail');
  assert.equal(fpMismatch.reason, 'fingerprint_mismatch');
  assert.equal(fpMismatch.suspicious, true, 'Should flag as suspicious');
  console.log('  [PASS] Fingerprint mismatch detected (anti-hijacking)');

  // Test 12: Non-existent session
  const nonExistent = await validateServerSession({
    sessionId: 'non-existent-session-id',
    userId: 'test-user-123',
    fingerprint: tokenResult.fingerprint,
  });
  assert.equal(nonExistent.valid, false, 'Non-existent session should fail');
  assert.equal(nonExistent.reason, 'session_not_found');
  console.log('  [PASS] Non-existent session rejected');

  // Test 13: Different browsers get different fingerprints
  const session2 = await handler({
    httpMethod: 'POST',
    headers: {
      'user-agent': 'Different Browser/1.0',
      'accept-language': 'fr-FR',
      'accept-encoding': 'br',
    },
    body: JSON.stringify({ userId: 'test-user-123' }),
  });
  assert.equal(session2.statusCode, 200);
  const session2Payload = JSON.parse(session2.body);
  const token2Result = verifySessionToken(session2Payload.sessionToken, secret);
  assert.notEqual(tokenResult.fingerprint, token2Result.fingerprint, 'Different browsers should have different fingerprints');
  console.log('  [PASS] Different browsers get different fingerprints');

  // Test 14: CORS rejection for non-whitelisted origins
  process.env.XP_CORS_ALLOW = 'https://allowed.example.com';
  const { handler: corsHandler } = await createHandler('test:session:cors');
  const corsBlocked = await corsHandler({
    httpMethod: 'POST',
    headers: { origin: 'https://blocked.example.com' },
    body: JSON.stringify({ userId: 'test-user' }),
  });
  assert.equal(corsBlocked.statusCode, 403, 'Non-whitelisted origin should be blocked');
  const corsPayload = JSON.parse(corsBlocked.body);
  assert.equal(corsPayload.error, 'forbidden');
  console.log('  [PASS] CORS rejection works');

  console.log('\nAll start-session tests passed!');
})();
