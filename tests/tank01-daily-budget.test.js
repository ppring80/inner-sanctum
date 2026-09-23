'use strict';

const assert = require('assert');
const {
  DEFAULT_DAILY_LIMIT,
  reserveTank01Calls,
  utcDay
} = require('../netlify/functions/_tank01-daily-budget.js');

function fakeStore() {
  let value = null;
  let version = 0;
  return {
    async getWithMetadata() {
      return value ? { data: JSON.parse(JSON.stringify(value)), etag: `v${version}` } : null;
    },
    async setJSON(key, next, options) {
      if (options.onlyIfNew && value) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== `v${version}`) return { modified: false };
      value = JSON.parse(JSON.stringify(next));
      version += 1;
      return { modified: true, etag: `v${version}` };
    },
    value: () => value
  };
}

(async () => {
  assert.strictEqual(utcDay(new Date('2026-09-23T23:59:59Z')), '2026-09-23');
  assert.strictEqual(DEFAULT_DAILY_LIMIT, 700);

  const store = fakeStore();
  const first = await reserveTank01Calls({}, { job: 'qb', calls: 101 }, {
    store, limit: 200, now: new Date('2026-09-23T10:00:00Z')
  });
  assert.strictEqual(first.allowed, true);
  assert.strictEqual(first.remaining, 99);

  const blocked = await reserveTank01Calls({}, { job: 'rb', calls: 129 }, {
    store, limit: 200, now: new Date('2026-09-23T10:05:00Z')
  });
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.reason, 'daily-limit');
  assert.strictEqual(store.value().reserved, 101);

  const killed = await reserveTank01Calls({}, { job: 'wr', calls: 129 }, {
    store, limit: 700, killSwitch: true, now: new Date('2026-09-23T10:10:00Z')
  });
  assert.strictEqual(killed.allowed, false);
  assert.strictEqual(killed.reason, 'kill-switch');

  console.log('Tank01 shared daily budget tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
