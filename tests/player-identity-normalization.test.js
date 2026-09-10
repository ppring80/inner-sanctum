'use strict';

const assert = require('assert');
const PlayerIdentity = require('../player-identity.js');

assert.strictEqual(
  PlayerIdentity.canonicalNameKey('Travis Etienne Jr.'),
  PlayerIdentity.canonicalNameKey('Travis Etienne'),
  'Jr suffix should not prevent canonical identity matching'
);

assert.strictEqual(
  PlayerIdentity.canonicalNameKey('Chris Godwin Jr.'),
  PlayerIdentity.canonicalNameKey('Chris Godwin'),
  'Godwin suffix mismatch should normalize'
);

assert.strictEqual(
  PlayerIdentity.canonicalNameKey("D'Andre Swift"),
  PlayerIdentity.canonicalNameKey('D’Andre Swift'),
  'apostrophe variants should normalize'
);

assert.strictEqual(
  PlayerIdentity.canonicalNameKey('José Ramírez III'),
  PlayerIdentity.canonicalNameKey('Jose Ramirez'),
  'accents and terminal generational suffixes should normalize'
);

const weeklyRows = [
  { name: 'Travis Etienne Jr.', pos: 'RB', team: 'JAX' },
  { name: 'Chris Godwin Jr.', pos: 'WR', team: 'TB' },
  { name: 'Joe Burrow', pos: 'QB', team: 'CIN' },
  { name: 'Javonte Williams', pos: 'RB', team: 'DAL' },
  { name: 'James Williams', pos: 'RB', team: 'MIA' },
  { name: 'NE', pos: 'DEF', team: 'NE' }
];

let resolved = PlayerIdentity.resolveRosterNames([
  { name: 'Travis Etienne', position: 'RB' },
  { name: 'Chris Godwin', position: 'WR' },
  { name: 'Joe Burrow', position: 'QB' },
  { name: 'NE', position: 'DST' }
], weeklyRows);

assert.deepStrictEqual(
  resolved,
  ['Travis Etienne Jr.', 'Chris Godwin Jr.', 'Joe Burrow', 'NE'],
  'full provider names should resolve to Weekly canonical row names'
);

resolved = PlayerIdentity.resolveRosterNames([
  { name: 'T. Etienne', position: 'RB' },
  { name: 'C. Godwin', position: 'WR' }
], weeklyRows);

assert.deepStrictEqual(
  resolved,
  ['Travis Etienne Jr.', 'Chris Godwin Jr.'],
  'unique initial+last provider abbreviations should resolve safely'
);

resolved = PlayerIdentity.resolveRosterNames([
  { name: 'J. Williams', position: 'RB' }
], weeklyRows);

assert.deepStrictEqual(
  resolved,
  [],
  'ambiguous initial+last matches must not guess'
);

resolved = PlayerIdentity.resolveRosterNames([
  { name: 'C. Godwin', position: 'RB' }
], weeklyRows);

assert.deepStrictEqual(
  resolved,
  [],
  'position mismatch must block abbreviated fallback'
);

console.log('player-identity-normalization.test.js passed');
