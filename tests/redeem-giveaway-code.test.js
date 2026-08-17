// tests/redeem-giveaway-code.test.js
//
// Regression coverage for the Aug 17 2026 email-bound giveaway
// redemption rewrite of netlify/functions/redeem-giveaway-code.js.
//
// Three layers:
//   1. Pure-function tests (signing, cookie building, email format)
//   2. True handler-level tests: @netlify/blobs mocked (same
//      Module._resolveFilename technique already proven in
//      opportunity-intel-sample.test.js), exercising the REAL
//      exports.handler end-to-end -- not a reimplementation of its
//      logic.
//   3. A genuine cross-file interoperability test: a cookie signed by
//      THIS file's real signSession() is verified through
//      verify-session.js's own real, unmodified exported
//      verifySession() -- proving actual compatibility, not just
//      that both files independently claim to use the same scheme.
//
// Run: node tests/redeem-giveaway-code.test.js

const assert = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}

// ─────────────────────────────────────────────────────────
// Mock @netlify/blobs BEFORE the first require of the module under
// test -- requiring the real module first and mocking only on a
// second require silently fails on this Node version due to an
// internal per-parent module-resolution cache (documented in
// opportunity-intel-sample.test.js, same fix applied here).
// ─────────────────────────────────────────────────────────
const blobStores = {};

function installBlobsMock() {
  const fakeModulePath = path.join(__dirname, '__fake_netlify_blobs_giveaway__.js');
  require.cache[fakeModulePath] = {
    id: fakeModulePath,
    filename: fakeModulePath,
    loaded: true,
    exports: {
      connectLambda: () => {},
      getStore: ({ name }) => {
        if (!blobStores[name]) blobStores[name] = {};
        const store = blobStores[name];
        return {
          get: async (key) => (key in store ? store[key] : null),
          setJSON: async (key, value) => {
            store[key] = JSON.parse(JSON.stringify(value));
          },
        };
      },
    },
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@netlify/blobs') return fakeModulePath;
    return originalResolve.call(this, request, ...rest);
  };
  return originalResolve;
}

const originalResolve = installBlobsMock();
const redeemModule = require('../netlify/functions/redeem-giveaway-code.js');
Module._resolveFilename = originalResolve; // safe to restore -- module already loaded/cached

const verifySessionModule = require('../netlify/functions/verify-session.js');

function resetStores() {
  Object.keys(blobStores).forEach((k) => delete blobStores[k]);
}

const TEST_SECRET = 'test-cookie-signing-secret-do-not-use-in-prod';

function seedCode(code, overrides) {
  blobStores['giveaway-codes'] = blobStores['giveaway-codes'] || {};
  blobStores['giveaway-codes']['code:' + code] = Object.assign(
    { code, campaign: 'aug2026-launch', status: 'unclaimed' },
    overrides || {}
  );
}

function makeEvent(bodyObj, method) {
  return { httpMethod: method || 'POST', body: JSON.stringify(bodyObj || {}) };
}

function extractCookieValue(setCookieHeader) {
  // "sanctum_session=<value>; Path=/; ..." -> "<value>"
  const match = /^sanctum_session=([^;]+)/.exec(setCookieHeader || '');
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────
// 1. PURE FUNCTIONS
// ─────────────────────────────────────────────────────────
const T = redeemModule._test;

test('COOKIE_NAME and SESSION_DURATION_MS match oauth-callback.js exactly', () => {
  assert.strictEqual(T.COOKIE_NAME, 'sanctum_session');
  assert.strictEqual(T.SESSION_DURATION_MS, 30 * 24 * 60 * 60 * 1000);
});
test('isPlausibleEmail accepts a normal email', () => {
  assert.strictEqual(T.isPlausibleEmail('winner@example.com'), true);
});
test('isPlausibleEmail rejects missing @ or missing domain dot', () => {
  assert.strictEqual(T.isPlausibleEmail('not-an-email'), false);
  assert.strictEqual(T.isPlausibleEmail('missing@domain'), false);
  assert.strictEqual(T.isPlausibleEmail(''), false);
  assert.strictEqual(T.isPlausibleEmail(null), false);
});
test('signSession produces a base64url payload + "." + signature', () => {
  const token = T.signSession({ fullAccess: true, exp: 123 }, TEST_SECRET);
  const parts = token.split('.');
  assert.strictEqual(parts.length, 2);
  assert.ok(!/[+/=]/.test(token), 'must be base64url, not raw base64 (no +, /, or = characters)');
});
test('signSession is deterministic for the same payload+secret', () => {
  const a = T.signSession({ fullAccess: true, exp: 999 }, TEST_SECRET);
  const b = T.signSession({ fullAccess: true, exp: 999 }, TEST_SECRET);
  assert.strictEqual(a, b);
});
test('buildSessionCookieHeader sets fullAccess:true, HttpOnly, Secure, SameSite=Lax, Path=/', () => {
  const header = T.buildSessionCookieHeader(TEST_SECRET, new Date());
  assert.ok(header.startsWith('sanctum_session='));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('Secure'));
  assert.ok(header.includes('SameSite=Lax'));
  assert.ok(header.includes('Path=/'));
  assert.ok(header.includes('Max-Age=' + Math.floor(T.SESSION_DURATION_MS / 1000)));
});

// ─────────────────────────────────────────────────────────
// 2. HANDLER-LEVEL TESTS (real exports.handler, mocked Blobs)
// ─────────────────────────────────────────────────────────
async function runHandlerTests() {
  await testAsync('missing COOKIE_SIGNING_SECRET fails closed with 500, no store write at all', async () => {
    resetStores();
    seedCode('SANCTUM-AAAAAAAA');
    delete process.env.COOKIE_SIGNING_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-AAAAAAAA', email: 'a@b.com' }));
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(
      blobStores['giveaway-codes']['code:SANCTUM-AAAAAAAA'].status,
      'unclaimed',
      'the code must NOT be consumed if the server cannot actually issue a cookie'
    );
  });

  await testAsync('GIVEAWAY_ADMIN_KEY is never read or required by this endpoint', async () => {
    resetStores();
    seedCode('SANCTUM-BBBBBBBB');
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    delete process.env.GIVEAWAY_ADMIN_KEY; // deliberately unset -- must still work
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-BBBBBBBB', email: 'winner@example.com' }));
    assert.strictEqual(res.statusCode, 200);
  });

  await testAsync('unknown code -> 404, no cookie', async () => {
    resetStores();
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-ZZZZZZZZ', email: 'a@b.com' }));
    assert.strictEqual(res.statusCode, 404);
    assert.ok(!res.headers['Set-Cookie']);
  });

  await testAsync('first claim: unclaimed code + missing email -> 400, code stays unclaimed', async () => {
    resetStores();
    seedCode('SANCTUM-CCCCCCCC');
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-CCCCCCCC' }));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(blobStores['giveaway-codes']['code:SANCTUM-CCCCCCCC'].status, 'unclaimed');
  });

  await testAsync('first claim: unclaimed code + malformed email -> 400, code stays unclaimed', async () => {
    resetStores();
    seedCode('SANCTUM-DDDDDDDD');
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-DDDDDDDD', email: 'not-an-email' }));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(blobStores['giveaway-codes']['code:SANCTUM-DDDDDDDD'].status, 'unclaimed');
  });

  await testAsync('first claim: unclaimed code + valid email -> 200, cookie set, claimed+claimedByEmail stored', async () => {
    resetStores();
    seedCode('SANCTUM-EEEEEEEE');
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'sanctum-eeeeeeee', email: '  Winner@Example.com  ' }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.success, true);
    assert.ok(res.headers['Set-Cookie'].startsWith('sanctum_session='));
    const stored = blobStores['giveaway-codes']['code:SANCTUM-EEEEEEEE'];
    assert.strictEqual(stored.status, 'claimed');
    assert.strictEqual(stored.claimedByEmail, 'Winner@Example.com'); // stored as submitted (trimmed), original casing preserved
    assert.ok(stored.claimedAt);
  });

  await testAsync('error responses never mention GIVEAWAY_ADMIN_KEY or any implementation detail', async () => {
    resetStores();
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-NOTREAL1', email: 'a@b.com' }));
    const body = JSON.parse(res.body);
    assert.ok(!/GIVEAWAY_ADMIN_KEY/i.test(JSON.stringify(body)));
    assert.ok(!/blob/i.test(JSON.stringify(body)));
  });

  await testAsync('already-claimed code + matching email (case-insensitive) -> 200, fresh cookie, access restored', async () => {
    resetStores();
    seedCode('SANCTUM-FFFFFFFF', { status: 'claimed', claimedByEmail: 'Winner@Example.com', claimedAt: '2026-08-01T00:00:00.000Z' });
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-FFFFFFFF', email: 'winner@example.com' }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.success, true);
    assert.ok(res.headers['Set-Cookie'], 'a fresh cookie must be issued on restoration, not just a bare success message');
    const stored = blobStores['giveaway-codes']['code:SANCTUM-FFFFFFFF'];
    assert.strictEqual(stored.claimedAt, '2026-08-01T00:00:00.000Z', 'original claim timestamp is preserved, not overwritten');
  });

  await testAsync('already-claimed code + different email -> 403, no cookie, no mutation', async () => {
    resetStores();
    seedCode('SANCTUM-GGGGGGGG', { status: 'claimed', claimedByEmail: 'winner@example.com', claimedAt: '2026-08-01T00:00:00.000Z' });
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const before = JSON.parse(JSON.stringify(blobStores['giveaway-codes']['code:SANCTUM-GGGGGGGG']));
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-GGGGGGGG', email: 'someone-else@example.com' }));
    assert.strictEqual(res.statusCode, 403);
    assert.ok(!res.headers['Set-Cookie']);
    assert.deepStrictEqual(blobStores['giveaway-codes']['code:SANCTUM-GGGGGGGG'], before, 'record must be completely untouched on a rejected restoration attempt');
  });

  await testAsync('already-claimed code + missing email -> 403 (cannot verify identity without one)', async () => {
    resetStores();
    seedCode('SANCTUM-HHHHHHHH', { status: 'claimed', claimedByEmail: 'winner@example.com' });
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-HHHHHHHH' }));
    assert.strictEqual(res.statusCode, 403);
  });

  await testAsync('the 403 rejection never leaks the actual stored email', async () => {
    resetStores();
    seedCode('SANCTUM-IIIIIIII', { status: 'claimed', claimedByEmail: 'secret-winner@example.com' });
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-IIIIIIII', email: 'wrong@example.com' }));
    assert.ok(!res.body.includes('secret-winner@example.com'));
  });

  await testAsync('non-POST method -> 405', async () => {
    const res = await redeemModule.handler(makeEvent({}, 'GET'));
    assert.strictEqual(res.statusCode, 405);
  });

  await testAsync('malformed JSON body -> 400, no crash', async () => {
    const res = await redeemModule.handler({ httpMethod: 'POST', body: '{not json' });
    assert.strictEqual(res.statusCode, 400);
  });

  // ───────────────────────────────────────────────────────
  // 3. REAL CROSS-FILE INTEROPERABILITY TEST
  // ───────────────────────────────────────────────────────
  await testAsync('a cookie issued by THIS endpoint verifies as valid through the REAL verify-session.js', async () => {
    resetStores();
    seedCode('SANCTUM-JJJJJJJJ');
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;

    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-JJJJJJJJ', email: 'interop@example.com' }));
    const cookieValue = extractCookieValue(res.headers['Set-Cookie']);
    assert.ok(cookieValue, 'a cookie value must have been issued');

    // Run it through verify-session.js's OWN real, unmodified exported
    // verifySession() -- not a reimplementation of the check.
    const payload = verifySessionModule._test.verifySession(cookieValue, TEST_SECRET);
    assert.ok(payload, 'verify-session.js must accept a cookie issued by redeem-giveaway-code.js');
    assert.strictEqual(payload.fullAccess, true);
    assert.ok(payload.exp > Date.now(), 'expiration must be in the future');
  });

  await testAsync('the same real verify-session.js correctly REJECTS a cookie signed with the wrong secret', async () => {
    resetStores();
    seedCode('SANCTUM-KKKKKKKK');
    process.env.COOKIE_SIGNING_SECRET = TEST_SECRET;
    const res = await redeemModule.handler(makeEvent({ code: 'SANCTUM-KKKKKKKK', email: 'a@b.com' }));
    const cookieValue = extractCookieValue(res.headers['Set-Cookie']);

    const payload = verifySessionModule._test.verifySession(cookieValue, 'a-completely-different-secret');
    assert.strictEqual(payload, null, 'a cookie must not validate against the wrong secret');
  });
}

runHandlerTests().then(() => {
  delete process.env.COOKIE_SIGNING_SECRET;
  delete process.env.GIVEAWAY_ADMIN_KEY;
  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  if (failed) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
});
