'use strict';

const assert = require('node:assert/strict');
const Module = require('module');
const { verify } = require('../scripts/verify-player-availability');
const { completeCache, stateKey, jobsForWeek } = require('../netlify/functions/_weekly-refresh-recovery');
const RealDate = Date;
const now = RealDate.parse('2026-11-25T01:06:50Z');
const hour = 3600000;
const job = jobsForWeek(2026, 12).find(row => row.store === 'player-data');
const key = stateKey(job);
const players = Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [i, { longName: 'Player ' + i }]));
let cache, state, revision, calls, fail;

const getStore = ({ name }) => name === 'player-data' ? {
  get: async () => cache
} : name === 'weekly-sage-refresh-status' ? {
  getWithMetadata: async () => state ? { data: structuredClone(state), etag: String(revision) } : null,
  setJSON: async (recordKey, value, options = {}) => {
    assert.equal(recordKey, key);
    if ((options.onlyIfNew && state) || (options.onlyIfMatch && options.onlyIfMatch !== String(revision))) return { modified: false };
    state = structuredClone(value);
    revision++;
    return { modified: true };
  }
} : { get: async () => null };

const originalLoad = Module._load;
Module._load = function (id, parent, ...args) {
  if (id === '@netlify/blobs') return { connectLambda() {}, getStore };
  if (id === './refresh-player-data' && parent.filename.endsWith('/recover-player-availability.js')) return {
    handler: async () => {
      calls++;
      if (fail) return { statusCode: 502, body: JSON.stringify({ error: 'Provider unavailable; previous cache preserved.' }) };
      cache = { ...cache, updatedAt: new RealDate(now).toISOString() };
      return { statusCode: 200, body: JSON.stringify({ cached: true }) };
    }
  };
  return originalLoad.call(this, id, parent, ...args);
};
const { handler } = require('../netlify/functions/recover-player-availability');
Module._load = originalLoad;

function reset(age) {
  cache = { updatedAt: new RealDate(now - age).toISOString(), availabilityMode: 'tank01-full-player-list-v1', teamsSucceeded: 32, teamsFailed: 0, players };
  state = null; revision = 0; calls = 0; fail = false;
}

(async () => {
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  try {
    reset(6 * hour - 1);
    assert.equal(JSON.parse((await handler({})).body).skipped, true);
    assert.equal(calls, 0, 'recent evidence must not spend another provider call');

    reset(6 * hour);
    assert.equal(completeCache(cache, job, now), true, 'customer readiness remains eight hours');
    assert.equal(verify(cache, now).players, 1100);
    await Promise.all(Array.from({ length: 8 }, () => handler({})));
    assert.equal(calls, 1, 'concurrent proactive deliveries share the existing lease');
    assert.equal(cache.updatedAt, new RealDate(now).toISOString());

    reset(7 * hour);
    const preserved = cache;
    fail = true;
    assert.equal((await handler({})).statusCode, 502);
    assert.equal(cache, preserved, 'failed proactive work must preserve usable evidence');
    assert.equal(verify(cache, now).players, 1100, 'provider failure does not prematurely expire healthy evidence');
    await handler({});
    assert.equal(calls, 1, 'failed proactive work retains retry backoff');

    reset(7 * hour);
    state = { day: '2026-11-25', status: 'ready', attempts: 4, leaseUntil: 0, retryAfter: 0 };
    await handler({});
    assert.equal(calls, 0, 'existing daily attempt cap remains enforced');

    reset(8 * hour);
    assert.equal(completeCache(cache, job, now), false);
    assert.throws(() => verify(cache, now), 'the health threshold must not be relaxed');
    console.log('PASS proactive availability refresh before expiry, healthy-cache preservation, deduplication, backoff, daily cap and unchanged eight-hour health limit.');
  } finally { global.Date = RealDate; }
})().catch(error => { console.error(error); process.exitCode = 1; });
