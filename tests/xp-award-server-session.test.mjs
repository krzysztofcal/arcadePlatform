import assert from 'node:assert/strict';

process.env.XP_DAILY_SECRET = 'test-secret-for-sessions-32chars!';
process.env.XP_DEBUG = '1';
process.env.XP_KEY_NS = 'test:server-session';
process.env.XP_RATE_LIMIT_ENABLED = '0';
process.env.XP_SESSION_RATE_LIMIT_ENABLED = '0';

// Import modules once to share the same memory store
const { handler: startSession, verifySessionToken } = await import('../netlify/functions/start-session.mjs');
const { handler: awardXp } = await import('../netlify/functions/award-xp.mjs');

async function startValidSession(userId, headers = {}) {
  const res = await startSession({
    httpMethod: 'POST',
    headers: {
      'user-agent': 'Mozilla/5.0 Test Browser',
      'accept-language': 'en-US',
      'accept-encoding': 'gzip, deflate',
      ...headers,
    },
    body: JSON.stringify({ userId }),
  });
  if (res.statusCode !== 200) {
    throw new Error(`Failed to start session: ${res.statusCode} - ${res.body}`);
  }
  return JSON.parse(res.body);
}

// Generate unique user IDs to avoid state conflicts between tests
let testCounter = 0;
function uniqueUserId(prefix) {
  return `${prefix}-${++testCounter}-${Date.now()}`;
}

(async () => {
  console.log('Running XP award server session tests...');

  // Test 1: XP award without server session (warn mode)
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '0';
    process.env.XP_SERVER_SESSION_WARN_MODE = '1';

    const userId = uniqueUserId('warn');
    const res = await awardXp({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        userId,
        sessionId: 'session-warn',
        delta: 10,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 200, 'Warn mode should allow requests without token');
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    console.log('  [PASS] Warn mode allows requests without session token');
  }

  // Test 2: XP award without server session (enforce mode)
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('enforce');
    const res = await awardXp({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        userId,
        sessionId: 'session-enforce',
        delta: 10,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 401, 'Enforce mode should reject requests without token');
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, 'invalid_session');
    assert.equal(payload.requiresNewSession, true);
    console.log('  [PASS] Enforce mode rejects requests without session token');
  }

  // Test 3: XP award with valid server session (enforce mode)
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('valid');
    const sessionData = await startValidSession(userId);

    const res = await awardXp({
      httpMethod: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 Test Browser',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        userId,
        sessionId: sessionData.sessionId,
        sessionToken: sessionData.sessionToken,
        delta: 25,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 200, 'Valid session should be accepted');
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.granted, 25);
    console.log('  [PASS] Valid session token accepted');
  }

  // Test 4: XP award with wrong user in session token
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const originalUser = uniqueUserId('original');
    const sessionData = await startValidSession(originalUser);

    const res = await awardXp({
      httpMethod: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 Test Browser',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        userId: 'different-user', // Different user than token was created for
        sessionId: sessionData.sessionId,
        sessionToken: sessionData.sessionToken,
        delta: 10,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 401, 'Mismatched user should be rejected');
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, 'invalid_session');
    console.log('  [PASS] User mismatch in token detected');
  }

  // Test 5: XP award with tampered session token
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('tampered');
    const sessionData = await startValidSession(userId);
    const tamperedToken = sessionData.sessionToken.replace(/.$/, 'X'); // Modify last char

    const res = await awardXp({
      httpMethod: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 Test Browser',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        userId,
        sessionId: sessionData.sessionId,
        sessionToken: tamperedToken,
        delta: 10,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 401, 'Tampered token should be rejected');
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, 'invalid_session');
    console.log('  [PASS] Tampered session token rejected');
  }

  // Test 6: XP award from different browser (fingerprint mismatch - anti-hijacking)
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('hijack');
    const sessionData = await startValidSession(userId);

    // Try to use the token from a different "browser"
    const res = await awardXp({
      httpMethod: 'POST',
      headers: {
        'user-agent': 'Different Browser/1.0', // Different browser
        'accept-language': 'fr-FR',
        'accept-encoding': 'br',
      },
      body: JSON.stringify({
        userId,
        sessionId: sessionData.sessionId,
        sessionToken: sessionData.sessionToken,
        delta: 10,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 401, 'Different browser fingerprint should be rejected');
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, 'invalid_session');
    console.log('  [PASS] Session hijacking attempt detected (fingerprint mismatch)');
  }

  // Test 7: Session token via header instead of body
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('header');
    const sessionData = await startValidSession(userId);

    const res = await awardXp({
      httpMethod: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 Test Browser',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip, deflate',
        'x-session-token': sessionData.sessionToken, // Via header
      },
      body: JSON.stringify({
        userId,
        sessionId: sessionData.sessionId,
        delta: 15,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 200, 'Token in header should work');
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.granted, 15);
    console.log('  [PASS] Session token via header accepted');
  }

  // Test 8: statusOnly requests should bypass session validation
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '1';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('status');
    const res = await awardXp({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        userId,
        sessionId: 'session-status',
        statusOnly: true,
      }),
    });

    assert.equal(res.statusCode, 200, 'statusOnly should bypass session validation');
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'statusOnly');
    console.log('  [PASS] statusOnly requests bypass session validation');
  }

  // Test 9: Disabled session validation (default behavior)
  {
    process.env.XP_REQUIRE_SERVER_SESSION = '0';
    process.env.XP_SERVER_SESSION_WARN_MODE = '0';

    const userId = uniqueUserId('disabled');
    const res = await awardXp({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        userId,
        sessionId: 'session-disabled',
        delta: 20,
        ts: Date.now(),
      }),
    });

    assert.equal(res.statusCode, 200, 'Disabled validation should allow all requests');
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.granted, 20);
    console.log('  [PASS] Disabled session validation works');
  }

  console.log('\nAll XP award server session tests passed!');
})();
