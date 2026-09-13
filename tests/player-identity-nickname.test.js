'use strict';

const assert = require('assert');
const identity = require('../player-identity.js');

function row(name, position) {
  return { name, position };
}

function candidate(name, position) {
  return { name, position };
}

const pairs = [
  ['Cam Little', 'Cameron Little'],
  ['Josh Allen', 'Joshua Allen'],
  ['Mike Evans', 'Michael Evans'],
  ['Matt Gay', 'Matthew Gay'],
  ['Chris Boswell', 'Christopher Boswell']
];

pairs.forEach(([shortName, formalName]) => {
  const forward = identity.resolveRosterPlayer(candidate(shortName, 'K'), [row(formalName, 'K')]);
  assert(forward, `${shortName} should match ${formalName}`);
  assert.strictEqual(forward.name, formalName);

  const reverse = identity.resolveRosterPlayer(candidate(formalName, 'K'), [row(shortName, 'K')]);
  assert(reverse, `${formalName} should match ${shortName}`);
  assert.strictEqual(reverse.name, shortName);
});

// Position remains a hard safety boundary.
assert.strictEqual(
  identity.resolveRosterPlayer(candidate('Cam Little', 'K'), [row('Cameron Little', 'WR')]),
  null
);

// Last name remains a hard identity boundary.
assert.strictEqual(
  identity.resolveRosterPlayer(candidate('Cam Little', 'K'), [row('Cameron Dicker', 'K')]),
  null
);

// Never guess when more than one nickname-equivalent row is eligible.
assert.strictEqual(
  identity.resolveRosterPlayer(candidate('Cam Little', 'K'), [
    row('Cameron Little', 'K'),
    row('Cameron Little Jr.', 'K')
  ]),
  null
);

// Unrelated first names do not become fuzzy matches.
assert.strictEqual(
  identity.resolveRosterPlayer(candidate('Pat Smith', 'K'), [row('Patrick Smith', 'K')]),
  null
);

// Existing initial + last-name fallback remains intact.
const abbreviated = identity.resolveRosterPlayer(candidate('C. Little', 'K'), [row('Cameron Little', 'K')]);
assert(abbreviated);
assert.strictEqual(abbreviated.name, 'Cameron Little');

console.log('player-identity nickname regression tests passed');
