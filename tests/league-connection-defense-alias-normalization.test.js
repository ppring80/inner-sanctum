'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(
  path.join(__dirname, '..', 'league-connection.js'),
  'utf8'
);

const storage = new Map();
const context = {
  window: {
    dispatchEvent() {}
  },
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  },
  CustomEvent: function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  },
  URL,
  Date,
  Set,
  Map,
  console
};

vm.createContext(context);
vm.runInContext(source, context);

const LeagueConnection = context.window.LeagueConnection;
assert(LeagueConnection, 'LeagueConnection should initialize');

function connectedDefense(provider, defense) {
  LeagueConnection.disconnectAll();
  LeagueConnection.connect(provider, {
    leagueId: provider + '-league',
    leagueName: provider + ' League',
    teamId: '1',
    teamName: 'Test Team',
    roster: [
      { name: 'Joe Burrow', position: 'QB', team: 'CIN' },
      defense
    ]
  });
  return LeagueConnection.getActiveConnection().roster;
}

[
  {
    label: 'ESPN full defense name',
    provider: 'espn',
    input: { name: 'Houston Texans D/ST', displayName: 'Houston Texans D/ST', position: 'D/ST', team: 'HOU' },
    expected: 'HOU'
  },
  {
    label: 'CBS New England provider abbreviation',
    provider: 'cbs',
    input: { name: 'New England Patriots', position: 'DST', nflTeam: 'NEP' },
    expected: 'NE'
  },
  {
    label: 'Jacksonville alternate abbreviation',
    provider: 'cbs',
    input: { name: 'Jacksonville Jaguars', position: 'DEF', team: 'JAC' },
    expected: 'JAX'
  },
  {
    label: 'Washington legacy abbreviation',
    provider: 'sleeper',
    input: { name: 'Washington Commanders', position: 'DEF', team: 'WAS' },
    expected: 'WSH'
  },
  {
    label: 'Las Vegas legacy abbreviation',
    provider: 'sleeper',
    input: { name: 'Las Vegas Raiders', position: 'DEF', team: 'OAK' },
    expected: 'LV'
  }
].forEach(function (testCase) {
  const roster = connectedDefense(testCase.provider, testCase.input);
  const qb = roster[0];
  const defense = roster[1];

  assert(qb.name === 'Joe Burrow', testCase.label + ': non-defense names must remain unchanged');
  assert(qb.team === 'CIN', testCase.label + ': non-defense teams must remain unchanged');
  assert(defense.name === testCase.expected, testCase.label + ': defense name should canonicalize to ' + testCase.expected);
  assert(defense.team === testCase.expected, testCase.label + ': defense team should canonicalize to ' + testCase.expected);
  assert(defense.nflTeam === testCase.expected, testCase.label + ': defense nflTeam should canonicalize to ' + testCase.expected);
});

// Existing persisted V2 connections must be repaired on read, so customers
// do not have to disconnect/reconnect a league just to recover their D/ST.
LeagueConnection.disconnectAll();
const persistedKey = LeagueConnection.STORAGE_KEY;
context.localStorage.setItem(persistedKey, JSON.stringify({
  schemaVersion: LeagueConnection.SCHEMA_VERSION,
  activeConnectionId: 'espn:legacy:3',
  connections: {
    'espn:legacy:3': {
      provider: 'espn',
      connectionId: 'espn:legacy:3',
      leagueId: 'legacy',
      leagueName: 'Legacy League',
      teamId: '3',
      teamName: 'Old School',
      roster: [
        { name: 'Houston Texans D/ST', position: 'D/ST', team: 'HOU' }
      ]
    }
  }
}));

const repaired = LeagueConnection.getActiveConnection();
assert(repaired.roster[0].name === 'HOU', 'Persisted ESPN defense should repair to HOU on read');
assert(repaired.roster[0].team === 'HOU', 'Persisted ESPN defense team should repair to HOU on read');

console.log('league-connection-defense-alias-normalization.test.js passed');
