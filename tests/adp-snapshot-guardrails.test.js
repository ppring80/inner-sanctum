'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const { normalizeScoring } = require('../netlify/functions/adp.js');
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

console.log('14 ADP snapshot guardrail assertions passed, 0 failed.');
