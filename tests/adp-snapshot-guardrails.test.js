'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const fs = require('fs');
const path = require('path');
const {
  normalizeScoring,
  validateCachedAdpRecord,
  ADP_STORE_NAME
} = require('../netlify/functions/adp.js');
const {
  validateAdpResult,
  snapshotRecord,
  SCORING_FORMATS,
  MAX_TANK01_CALLS_PER_RUN
} = require('../netlify/functions/refresh-adp-snapshot.js');

const validResult = {
  players: [
    { name: 'Player One', position: 'RB', team: null, adp: 12.3 },
    { name: 'Defense One', position: 'DEF', team: 'ABC', adp: 180 }
  ],
  meta: { source: 'tank01', adpType: 'PPR', adpDate: '2026-09-18' }
};

assert.deepStrictEqual(SCORING_FORMATS, ['ppr', 'half', 'standard']);
assert.strictEqual(MAX_TANK01_CALLS_PER_RUN, 3);
assert.ok(SCORING_FORMATS.length <= MAX_TANK01_CALLS_PER_RUN);

assert.strictEqual(normalizeScoring('ppr'), 'ppr');
assert.strictEqual(normalizeScoring('half'), 'half');
assert.strictEqual(normalizeScoring('half-ppr'), 'half');
assert.strictEqual(normalizeScoring('0.5PPR'), 'half');
assert.strictEqual(normalizeScoring('standard'), 'standard');

assert.deepStrictEqual(validateAdpResult(validResult, 'ppr'), []);
assert.ok(validateAdpResult({ players: [], meta: {} }, 'ppr').includes('ppr ADP population is empty.'));
assert.ok(
  validateAdpResult({ players: [{ name: '', position: 'RB', adp: 1 }], meta: {} }, 'ppr')
    .includes('ppr ADP contains 1 invalid player record(s).')
);

const record = snapshotRecord(validResult, 'half-ppr', '2026-09-19T00:00:00.000Z');
assert.strictEqual(record.evidenceType, 'tank01-adp-snapshot');
assert.strictEqual(record.scoring, 'half');
assert.strictEqual(record.directTank01Calls, 1);
assert.strictEqual(record.players.length, 2);

assert.strictEqual(ADP_STORE_NAME, 'adp-snapshot');
assert.strictEqual(validateCachedAdpRecord(record, 'half'), null);
assert.strictEqual(validateCachedAdpRecord(null, 'half'), 'ADP snapshot is missing.');
assert.strictEqual(
  validateCachedAdpRecord({ ...record, evidenceType: 'wrong' }, 'half'),
  'ADP snapshot evidence type is invalid.'
);
assert.strictEqual(
  validateCachedAdpRecord({ ...record, scoring: 'ppr' }, 'half'),
  'ADP snapshot scoring format does not match.'
);
assert.strictEqual(
  validateCachedAdpRecord({ ...record, players: [] }, 'half'),
  'ADP snapshot population is empty.'
);

const adpSource = fs.readFileSync(
  path.join(__dirname, '../netlify/functions/adp.js'),
  'utf8'
);
const handlerSource = adpSource.slice(adpSource.indexOf('exports.handler ='));
assert.ok(handlerSource.includes('store.get(`scoring:${scoring}`, { type: "json" })'));
assert.ok(!handlerSource.includes('fetchTank01Adp('));

console.log('22 ADP snapshot guardrail assertions passed, 0 failed.');
