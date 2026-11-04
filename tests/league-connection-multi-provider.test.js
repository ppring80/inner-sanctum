'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'league-connection.js'), 'utf8');

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

function loadLeagueConnection() {
  const sandbox = {
    console,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    encodeURIComponent,
    decodeURIComponent,
    localStorage: makeStorage(),
    window: {
      dispatchEvent() {}
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'league-connection.js' });
  return sandbox.window.LeagueConnection;
}

function league(id, name, teamId, teamName, marker) {
  return {
    leagueId: id,
    leagueName: name,
    teamId,
    teamName,
    roster: [{ name: marker || teamName, position: 'QB', nflTeam: 'BUF' }],
    readOnly: true
  };
}

const connections = loadLeagueConnection();

const cbsA = connections.connect('cbs', league('widebodies', 'WIDE BODIES', '1', 'Vanilla Gorilla', 'Josh Allen'));
assert.strictEqual(connections.getConnectionsByProvider('cbs').length, 1, 'first CBS league should create one connection');
assert.strictEqual(connections.getActiveConnection().connectionId, cbsA.connectionId, 'first CBS league should be active');

connections.update('cbs', league('widebodies', 'WIDE BODIES', '1', 'Vanilla Gorilla', 'Lamar Jackson'));
assert.strictEqual(connections.getConnectionsByProvider('cbs').length, 1, 'refreshing the same CBS league must not duplicate it');
assert.strictEqual(connections.getActiveConnection().roster[0].name, 'Lamar Jackson', 'same-league refresh should update the existing connection');

const cbsB = connections.update('cbs', league('secondleague', 'SECOND LEAGUE', '4', 'Team Two', 'Joe Burrow'));
const cbsConnections = connections.getConnectionsByProvider('cbs');
assert.strictEqual(cbsConnections.length, 2, 'connecting a second CBS league must preserve the first league');
assert.ok(cbsConnections.some((item) => item.leagueId === 'widebodies' && item.teamId === '1'), 'original CBS league/team must remain stored');
assert.ok(cbsConnections.some((item) => item.leagueId === 'secondleague' && item.teamId === '4'), 'second CBS league/team must be stored');
assert.strictEqual(connections.getActiveConnection().connectionId, cbsB.connectionId, 'newly connected CBS league should become active');

connections.setActiveConnection(cbsA.connectionId);
assert.strictEqual(connections.getActiveConnection().leagueId, 'widebodies', 'customer must be able to switch back to the first CBS league without reconnecting');

const espnA = connections.connect('espn', league('100', 'ESPN ONE', '7', 'ESPN Team One', 'Bijan Robinson'));
assert.strictEqual(connections.getConnectionsByProvider('espn').length, 1, 'first ESPN league should create one connection');

const espnB = connections.update('espn', league('200', 'ESPN TWO', '9', 'ESPN Team Two', 'Justin Jefferson'));
const espnConnections = connections.getConnectionsByProvider('espn');
assert.strictEqual(espnConnections.length, 2, 'connecting a second ESPN league must preserve the first league');
assert.ok(espnConnections.some((item) => item.connectionId === espnA.connectionId), 'original ESPN league must remain stored');
assert.ok(espnConnections.some((item) => item.connectionId === espnB.connectionId), 'second ESPN league must be stored');
assert.strictEqual(connections.getActiveConnection().connectionId, espnB.connectionId, 'newly connected ESPN league should become active');

assert.strictEqual(connections.getAllConnections().length, 4, 'CBS and ESPN multi-league connections should coexist');

console.log('league-connection multi-provider regression tests passed');
