'use strict';

// tests/connection-handoff.test.js
//
// Phase 1 (mobile league-connect): security and behavior of
// netlify/functions/connection-handoff.js, run against an in-memory Blobs
// store with real ETag / conditional-write semantics.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createFakeBlobs, loadFunctionWithFakeBlobs } = require('./helpers/fake-netlify-blobs');

const ROOT = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'connect-golden');
const STORE = 'connection-handoffs';
const LIMITS = 'connection-handoff-limits';

// Real finished LeagueConnection records, as recorded from production in Phase 0.
const CBS_RECORD = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'cbs-receiver.golden.json'), 'utf8'))
  .observations.firstSync.storedConnection;
const ESPN_RECORD = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'espn-delivery.golden.json'), 'utf8'))
  .observations.firstDelivery.storedConnection;

const clone = (v) => JSON.parse(JSON.stringify(v));

function setup() {
  const fake = createFakeBlobs();
  const fn = loadFunctionWithFakeBlobs('netlify/functions/connection-handoff.js', fake);
  return { fake, fn };
}

async function call(fn, body, opts = {}) {
  const res = await fn.handler({
    httpMethod: opts.method || 'POST',
    headers: {
      origin: opts.origin === undefined ? 'https://theinnersanctum.xyz' : opts.origin,
      'x-nf-client-connection-ip': opts.ip || '203.0.113.7'
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

async function withNow(ms, fn) {
  const realNow = Date.now;
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = realNow; }
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

(async function run() {
  await test('valid CBS record: create -> claim returns the same record', async () => {
    const { fn } = setup();
    const created = await call(fn, { action: 'create', record: CBS_RECORD });
    assert.strictEqual(created.status, 200);
    assert.match(created.body.code, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Date.parse(created.body.expiresAt) > Date.now());
    const claimed = await call(fn, { action: 'claim', code: created.body.code });
    assert.strictEqual(claimed.status, 200);
    assert.deepStrictEqual(claimed.body.record, CBS_RECORD);
  });

  await test('valid ESPN record: create -> claim returns the same record', async () => {
    const { fn } = setup();
    const created = await call(fn, { action: 'create', record: ESPN_RECORD });
    const claimed = await call(fn, { action: 'claim', code: created.body.code });
    assert.strictEqual(claimed.status, 200);
    assert.deepStrictEqual(claimed.body.record, ESPN_RECORD);
  });

  await test('second claim fails and the entry is gone', async () => {
    const { fn, fake } = setup();
    const { body } = await call(fn, { action: 'create', record: CBS_RECORD });
    assert.strictEqual((await call(fn, { action: 'claim', code: body.code })).status, 200);
    const again = await call(fn, { action: 'claim', code: body.code });
    assert.strictEqual(again.status, 410);
    assert.ok(!again.body.record);
    assert.deepStrictEqual(fake.keys(STORE), []);
  });

  await test('concurrent claims: exactly one succeeds', async () => {
    const { fn } = setup();
    const { body } = await call(fn, { action: 'create', record: ESPN_RECORD });
    const results = await Promise.all([
      call(fn, { action: 'claim', code: body.code }),
      call(fn, { action: 'claim', code: body.code }),
      call(fn, { action: 'claim', code: body.code })
    ]);
    assert.deepStrictEqual(results.map((r) => r.status).sort(), [200, 410, 410]);
  });

  await test('expired handoff fails, is deleted, and unknown/used/expired look identical', async () => {
    const { fn, fake } = setup();
    const start = Date.parse('2026-09-26T18:00:00Z');
    const created = await withNow(start, () => call(fn, { action: 'create', record: CBS_RECORD }));
    assert.strictEqual(created.body.expiresAt, new Date(start + 10 * 60 * 1000).toISOString());
    const stillValid = await withNow(start + 9 * 60 * 1000, () => call(fn, { action: 'create', record: CBS_RECORD }));
    assert.strictEqual(stillValid.status, 200);
    const expired = await withNow(start + 10 * 60 * 1000 + 1, () => call(fn, { action: 'claim', code: created.body.code }));
    assert.strictEqual(expired.status, 410);
    assert.ok(!fake.keys(STORE).includes(fn._internals.hashCode(created.body.code)), 'expired entry deleted');
    const unknown = await call(fn, { action: 'claim', code: crypto.randomBytes(32).toString('base64url') });
    assert.deepStrictEqual(unknown.body, expired.body, 'no oracle between unknown and expired');
  });

  await test('invalid provider fails', async () => {
    const { fn, fake } = setup();
    for (const provider of ['sleeper', 'yahoo', 'fanduel', '', null, '__proto__']) {
      const res = await call(fn, { action: 'create', record: { ...clone(CBS_RECORD), provider } });
      assert.strictEqual(res.status, 400, 'provider ' + provider);
    }
    assert.deepStrictEqual(fake.keys(STORE), []);
  });

  await test('missing leagueId / missing teamId / non-array roster fail', async () => {
    const { fn, fake } = setup();
    const noLeague = clone(CBS_RECORD); delete noLeague.leagueId;
    const blankLeague = { ...clone(CBS_RECORD), leagueId: '  ' };
    const noTeam = clone(ESPN_RECORD); delete noTeam.teamId;
    const badRoster = { ...clone(CBS_RECORD), roster: { 0: 'x' } };
    const noRecord = undefined;
    for (const record of [noLeague, blankLeague, noTeam, badRoster, noRecord, [], 'text']) {
      assert.strictEqual((await call(fn, { action: 'create', record })).status, 400);
    }
    assert.deepStrictEqual(fake.keys(STORE), []);
  });

  await test('oversized payload fails with 413 and stores nothing', async () => {
    const { fn, fake } = setup();
    const huge = { ...clone(CBS_RECORD), padding: 'x'.repeat(fn._internals.MAX_BODY_BYTES) };
    const res = await call(fn, { action: 'create', record: huge });
    assert.strictEqual(res.status, 413);
    assert.deepStrictEqual(fake.keys(STORE), []);
  });

  await test('excessive nesting is rejected', async () => {
    const { fn } = setup();
    let deep = {};
    const root = deep;
    for (let i = 0; i < 80; i += 1) { deep.child = {}; deep = deep.child; }
    const res = await call(fn, { action: 'create', record: { ...clone(CBS_RECORD), nested: root } });
    assert.strictEqual(res.status, 400);
  });

  await test('credential-like keys are stripped recursively (stored and returned), linkToken included', async () => {
    const { fn, fake } = setup();
    const dirty = clone(ESPN_RECORD);
    Object.assign(dirty, {
      espn_s2: 'AEB-secret', SWID: '{GUID}', cookie: 'a=b', Authorization: 'Bearer x',
      linkToken: 'chatgpt-link-token', Link_Token: 'variant', 'link-token': 'variant2',
      chatgptLinkToken: 'x', syncToken: 'x', accessToken: 'x', apiKey: 'x', client_secret: 'x'
    });
    dirty.league = { ...dirty.league, session: 'x', deep: [{ password: 'p', ok: 1, nested: { cbsToken: 't', keep: true } }] };
    dirty.roster = dirty.roster.map((p, i) => (i === 0 ? { ...p, oauth_token: 'x' } : p));

    const created = await call(fn, { action: 'create', record: dirty });
    assert.strictEqual(created.status, 200);
    const stored = fake.raw(STORE, fake.keys(STORE)[0]);
    const claimed = await call(fn, { action: 'claim', code: created.body.code });
    for (const text of [stored, JSON.stringify(claimed.body)]) {
      ['AEB-secret', '{GUID}', 'a=b', 'Bearer x', 'chatgpt-link-token', 'variant', '"p"', '"t"'].forEach((needle) => {
        assert.ok(!text.includes(needle), 'leaked ' + needle);
      });
    }
    const r = claimed.body.record;
    ['espn_s2', 'SWID', 'cookie', 'Authorization', 'linkToken', 'Link_Token', 'link-token', 'chatgptLinkToken',
      'syncToken', 'accessToken', 'apiKey', 'client_secret'].forEach((k) => assert.ok(!(k in r), k));
    assert.ok(!('session' in r.league));
    assert.deepStrictEqual(r.league.deep, [{ ok: 1, nested: { keep: true } }]);
    assert.ok(!('oauth_token' in r.roster[0]));
  });

  await test('blocked keys cover league-connection.js and league-snapshot.js exactly (difference documented)', async () => {
    const { fn } = setup();
    const setFrom = (file, marker) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const start = src.indexOf(marker);
      const block = src.slice(start, src.indexOf(']', start));
      return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    };
    const lc = setFrom('league-connection.js', 'const BLOCKED_KEYS = new Set([');
    const ls = setFrom('netlify/functions/league-snapshot.js', 'const BLOCKED_KEYS =');
    assert.ok(lc.length >= 20 && ls.length >= 20, 'parsed both lists');
    [...lc, ...ls].forEach((key) => assert.ok(fn._internals.isBlockedKey(key), 'handoff must block ' + key));
    // Documented, current difference: league-snapshot.js blocks six OAuth/API
    // keys that league-connection.js does not. The handoff blocks the union.
    assert.deepStrictEqual(ls.filter((k) => !lc.includes(k)).sort(),
      ['apiKey', 'api_key', 'clientSecret', 'client_secret', 'oauthToken', 'oauth_token'].sort());
    assert.deepStrictEqual(lc.filter((k) => !ls.includes(k)), []);
  });

  await test('raw secret is never used as a Blob key (only its SHA-256)', async () => {
    const { fn, fake } = setup();
    const { body } = await call(fn, { action: 'create', record: CBS_RECORD });
    const expectedKey = crypto.createHash('sha256').update(body.code).digest('hex');
    assert.deepStrictEqual(fake.keys(STORE), [expectedKey]);
    await call(fn, { action: 'claim', code: body.code });
    fake.log.forEach((entry) => assert.ok(!String(entry.key).includes(body.code), 'raw code touched storage'));
    assert.ok(!fake.raw(STORE, expectedKey) || !fake.raw(STORE, expectedKey).includes(body.code));
  });

  await test('malformed secrets fail safely without storage lookups', async () => {
    const { fn, fake } = setup();
    const bad = ['', 'abc', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '!', '../../etc/passwd', 12345, null, { $gt: '' }, ['x']];
    for (const code of bad) {
      const res = await call(fn, { action: 'claim', code });
      assert.strictEqual(res.status, 400);
      assert.ok(!res.body.record);
    }
    assert.ok(!fake.log.some((e) => e.store === STORE), 'no handoff-store access for malformed codes');
    assert.strictEqual((await call(fn, '{not json')).status, 400);
    assert.strictEqual((await call(fn, { action: 'nope' })).status, 400);
  });

  await test('guessing is bounded per client; other clients are unaffected; IPs are not stored raw', async () => {
    const { fn, fake } = setup();
    const limit = fn._internals.FAILED_CLAIM_LIMIT;
    const real = await call(fn, { action: 'create', record: CBS_RECORD }, { ip: '198.51.100.9' });
    for (let i = 0; i < limit; i += 1) {
      const guess = crypto.randomBytes(32).toString('base64url');
      assert.strictEqual((await call(fn, { action: 'claim', code: guess }, { ip: '203.0.113.66' })).status, 410);
    }
    const blocked = await call(fn, { action: 'claim', code: real.body.code }, { ip: '203.0.113.66' });
    assert.strictEqual(blocked.status, 429, 'locked out even with a real code');
    assert.ok(fake.keys(STORE).length === 1, 'the locked-out attempt did not consume the handoff');
    const legit = await call(fn, { action: 'claim', code: real.body.code }, { ip: '198.51.100.9' });
    assert.strictEqual(legit.status, 200);
    fake.keys(LIMITS).forEach((k) => assert.ok(!k.includes('203.0.113.66') && !k.includes('198.51.100.9')));
  });

  await test('create is rate-limited per client', async () => {
    const { fn } = setup();
    for (let i = 0; i < fn._internals.CREATE_LIMIT; i += 1) {
      assert.strictEqual((await call(fn, { action: 'create', record: CBS_RECORD }, { ip: '192.0.2.1' })).status, 200);
    }
    assert.strictEqual((await call(fn, { action: 'create', record: CBS_RECORD }, { ip: '192.0.2.1' })).status, 429);
    assert.strictEqual((await call(fn, { action: 'create', record: CBS_RECORD }, { ip: '192.0.2.2' })).status, 200);
  });

  await test('only POST from allowed origins; responses are never cached', async () => {
    const { fn } = setup();
    assert.strictEqual((await call(fn, {}, { method: 'GET' })).status, 405);
    assert.strictEqual((await call(fn, { action: 'create', record: CBS_RECORD }, { origin: 'https://evil.example' })).status, 403);
    const www = await call(fn, { action: 'create', record: CBS_RECORD }, { origin: 'https://www.theinnersanctum.xyz' });
    assert.strictEqual(www.status, 200);
    assert.strictEqual(www.headers['Cache-Control'], 'no-store');
    assert.strictEqual(www.headers['Referrer-Policy'], 'no-referrer');
  });

  console.log('connection-handoff.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
