const assert = require('assert');
const {
  expectedSeasonForDate,
  validateSnapshot
} = require('../netlify/functions/get-risers-fallers.js');

function validSnapshot(overrides = {}) {
  return {
    computedAt: '2026-09-16T12:00:00.000Z',
    season: '2026',
    currentWeek: 2,
    previousWeek: 1,
    risers: [],
    fallers: [],
    ...overrides
  };
}

const sundayOfWeek2 = new Date('2026-09-20T17:00:00.000Z');

assert.strictEqual(expectedSeasonForDate(sundayOfWeek2), '2026');

assert.deepStrictEqual(
  validateSnapshot(validSnapshot(), sundayOfWeek2),
  { valid: true, expectedSeason: '2026' }
);

const priorSeason = validateSnapshot(
  validSnapshot({
    season: '2025',
    computedAt: '2026-07-14T18:49:35.235Z'
  }),
  sundayOfWeek2
);
assert.strictEqual(priorSeason.valid, false);
assert.strictEqual(priorSeason.status, 'StaleData');
assert.strictEqual(priorSeason.expectedSeason, '2026');
assert.strictEqual(priorSeason.snapshotSeason, '2025');

const expired = validateSnapshot(
  validSnapshot({ computedAt: '2026-09-01T12:00:00.000Z' }),
  sundayOfWeek2
);
assert.strictEqual(expired.valid, false);
assert.strictEqual(expired.status, 'StaleData');

const malformed = validateSnapshot(
  validSnapshot({ currentWeek: 1, previousWeek: 2 }),
  sundayOfWeek2
);
assert.strictEqual(malformed.valid, false);
assert.strictEqual(malformed.status, 'InvalidData');

const missing = validateSnapshot(null, sundayOfWeek2);
assert.strictEqual(missing.valid, false);
assert.strictEqual(missing.status, 'NoData');

console.log('get-risers-fallers-freshness.test.js passed');
