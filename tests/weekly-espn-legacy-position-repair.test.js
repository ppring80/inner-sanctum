'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PlayerIdentity = require('../player-identity.js');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'weekly-roster-identity.js'),
  'utf8'
);

const window = {
  location: { pathname: '/weekly' },
  PlayerIdentity,
  state: { lineupConstruction: {}, myRosterNames: [], connectedRosterNames: [] },
  LeagueConnection: { getActiveConnection: function () { return null; } },
  getAllRows: function () { return []; },
  renderTable: function () {},
  setTimeout: function () { return 1; },
  clearTimeout: function () {},
  addEventListener: function () {}
};

const document = {
  readyState: 'complete',
  head: { appendChild: function () {} },
  createElement: function () {
    return { setAttribute: function () {} };
  },
  querySelector: function () {
    return {};
  }
};

vm.runInNewContext(source, { window, document, console });

assert.strictEqual(
  typeof window.resolveConnectedRosterNames,
  'function',
  'Weekly must expose the connected-roster resolver for regression coverage.'
);

const staleEspnRoster = [
  { name: 'Sam LaPorta', displayName: 'Sam LaPorta', position: 'WR' },
  { name: 'Jake Ferguson', displayName: 'Jake Ferguson', position: 'WR' }
];

const weeklyRows = [
  { name: 'Sam LaPorta', pos: 'TE' },
  { name: 'Jake Ferguson', pos: 'TE' }
];

const repaired = window.resolveConnectedRosterNames(
  { provider: 'espn' },
  staleEspnRoster,
  weeklyRows
);

assert.deepStrictEqual(
  Array.from(repaired),
  ['Sam LaPorta', 'Jake Ferguson'],
  'ESPN legacy position mismatches must not drop exact unique player names.'
);

const cbsUnchanged = window.resolveConnectedRosterNames(
  { provider: 'cbs' },
  staleEspnRoster,
  weeklyRows
);

assert.deepStrictEqual(
  Array.from(cbsUnchanged),
  [],
  'The exact-name position-mismatch repair must remain ESPN-only.'
);

const ambiguousRows = [
  { name: 'Sam LaPorta', pos: 'TE' },
  { name: 'Sam LaPorta', pos: 'WR' }
];

const ambiguous = window.resolveConnectedRosterNames(
  { provider: 'espn' },
  [{ name: 'Sam LaPorta', position: 'WR' }],
  ambiguousRows
);

assert.strictEqual(
  Array.from(ambiguous).length,
  1,
  'Normal position-safe resolution may resolve an exact matching WR row; repair must not add an ambiguous second row.'
);

console.log('PASS Weekly ESPN legacy position repair');
