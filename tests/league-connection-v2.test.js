const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function loadLeagueConnection(initialState) {
  const store = new Map();
  if (initialState !== undefined) {
    store.set('innerSanctum_leagueConnections', JSON.stringify(initialState));
  }

  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };

  const sandbox = {
    window: {},
    localStorage,
    console,
    Date,
    JSON,
    Set,
    Map,
    Object,
    Array,
    String,
    Number,
    Boolean,
    encodeURIComponent,
    decodeURIComponent,
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'league-connection.js'),
    'utf8'
  );
  vm.runInContext(source, sandbox);

  return {
    api: sandbox.window.LeagueConnection,
    readRaw() {
      const raw = store.get('innerSanctum_leagueConnections');
      return raw ? JSON.parse(raw) : null;
    },
  };
}

(function testLegacyMigration() {
  const legacy = {
    activeProvider: 'espn',
    connections: {
      espn: {
        leagueId: '1094040685',
        league: { id: '1094040685', name: 'Los Angeles Pro H2H Points PPR League' },
        readOnly: true,
      },
      cbs: {
        leagueId: '55',
        leagueName: 'CBS League',
        teamId: '7',
        teamName: 'CBS Team',
      },
    },
  };

  const { api, readRaw } = loadLeagueConnection(legacy);
  const active = api.getActiveConnection();

  assert.strictEqual(api.SCHEMA_VERSION, 2);
  assert.strictEqual(active.provider, 'espn');
  assert.strictEqual(active.leagueId, '1094040685');
  assert.strictEqual(api.getAllConnections().length, 2);
  assert.strictEqual(readRaw().schemaVersion, 2);
  assert.ok(readRaw().activeConnectionId);
})();

(function testMultipleLeaguesSameProviderCoexist() {
  const { api } = loadLeagueConnection();

  const first = api.connect('espn', {
    leagueId: '100',
    leagueName: 'League One',
  });
  const second = api.connect('espn', {
    leagueId: '200',
    leagueName: 'League Two',
  });

  assert.notStrictEqual(first.connectionId, second.connectionId);
  assert.strictEqual(api.getConnectionsByProvider('espn').length, 2);
  assert.strictEqual(api.getActiveConnection().leagueId, '200');

  api.setActiveConnection(first.connectionId);
  assert.strictEqual(api.getActiveConnection().leagueId, '100');
  assert.strictEqual(api.getActiveProvider(), 'espn');
})();

(function testProviderCompatibilityMethods() {
  const { api } = loadLeagueConnection();

  api.connect('espn', { leagueId: '100', leagueName: 'One' });
  api.connect('cbs', { leagueId: '300', leagueName: 'CBS', teamId: '9', teamName: 'Nine' });

  const legacyMap = api.getConnections();
  assert.ok(legacyMap.espn);
  assert.ok(legacyMap.cbs);
  assert.strictEqual(api.isConnected('espn'), true);
  assert.strictEqual(api.isConnected('yahoo'), false);
  assert.strictEqual(api.getConnection('cbs').teamName, 'Nine');
})();

(function testUnresolvedLeagueUpgradesToSelectedTeam() {
  const { api } = loadLeagueConnection();

  const unresolved = api.connect('espn', {
    leagueId: '400',
    leagueName: 'Upgrade League',
  });

  const resolved = api.updateConnection(unresolved.connectionId, {
    leagueId: '400',
    leagueName: 'Upgrade League',
    teamId: '14',
    teamName: 'Selected Team',
    roster: [{ name: 'Quarterback One', position: 'QB', team: 'CIN' }],
  });

  assert.notStrictEqual(resolved.connectionId, unresolved.connectionId);
  assert.strictEqual(api.getAllConnections().length, 1);
  assert.strictEqual(api.getActiveConnection().teamName, 'Selected Team');
  assert.strictEqual(api.getActiveConnection().roster.length, 1);
})();

(function testIncompleteRefreshPreservesResolvedTeamContext() {
  const { api } = loadLeagueConnection();

  const unresolved = api.connect('espn', {
    leagueId: '700',
    leagueName: 'Refresh League',
    league: { id: '700', name: 'Refresh League', teams: [] },
  });

  const resolved = api.updateConnection(unresolved.connectionId, {
    teamId: '8',
    teamName: 'Resolved Team',
    team: { id: '8', name: 'Resolved Team' },
    roster: [{ name: 'Player One', position: 'RB', team: 'DET' }],
    scoringFormat: 'half-ppr',
    lineupConstruction: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 6 },
    teamCount: 10,
  });

  const refreshedLeague = {
    id: '700',
    name: 'Refresh League',
    teams: [{ id: 8, name: 'Resolved Team' }],
  };

  const refreshed = api.connect('espn', {
    leagueId: '700',
    leagueName: 'Refresh League',
    league: refreshedLeague,
    teamId: null,
    teamName: null,
    team: null,
    roster: [],
    scoringFormat: null,
    lineupConstruction: null,
    teamCount: null,
  });

  assert.strictEqual(refreshed.connectionId, resolved.connectionId);
  assert.strictEqual(api.getAllConnections().length, 1);
  assert.strictEqual(refreshed.teamId, '8');
  assert.strictEqual(refreshed.teamName, 'Resolved Team');
  assert.strictEqual(refreshed.roster.length, 1);
  assert.strictEqual(refreshed.scoringFormat, 'half-ppr');
  assert.strictEqual(
    JSON.stringify(refreshed.lineupConstruction),
    JSON.stringify({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 6 })
  );
  assert.strictEqual(refreshed.teamCount, 10);
  assert.strictEqual(JSON.stringify(refreshed.league), JSON.stringify(refreshedLeague));
})();

(function testTeamIdRepairsFromTeamSpecificV2Key() {
  const state = {
    schemaVersion: 2,
    activeConnectionId: 'espn:800:6',
    connections: {
      'espn:800:6': {
        connectionId: 'espn:800:6',
        provider: 'espn',
        leagueId: '800',
        leagueName: 'Repair League',
        teamId: null,
        teamName: 'Repair Team',
        roster: [{ name: 'Player Two', position: 'WR', team: 'DAL' }],
        scoringFormat: 'half-ppr',
      },
    },
  };

  const { api } = loadLeagueConnection(state);
  const active = api.getActiveConnection();

  assert.strictEqual(active.connectionId, 'espn:800:6');
  assert.strictEqual(active.teamId, '6');
  assert.strictEqual(active.teamName, 'Repair Team');
  assert.strictEqual(active.roster.length, 1);
  assert.strictEqual(active.scoringFormat, 'half-ppr');
})();

(function testSecretsNeverPersist() {
  const { api, readRaw } = loadLeagueConnection();

  api.connect('espn', {
    leagueId: '500',
    espn_s2: 'secret-a',
    SWID: 'secret-b',
    nested: {
      authorization: 'Bearer secret',
      safe: 'yes',
    },
  });

  const raw = JSON.stringify(readRaw());
  assert.strictEqual(raw.includes('secret-a'), false);
  assert.strictEqual(raw.includes('secret-b'), false);
  assert.strictEqual(raw.includes('Bearer secret'), false);
  assert.strictEqual(raw.includes('"safe":"yes"'), true);
})();

(function testDisconnectOnlySelectedLeague() {
  const { api } = loadLeagueConnection();

  const one = api.connect('espn', { leagueId: '1', leagueName: 'One' });
  api.connect('espn', { leagueId: '2', leagueName: 'Two' });
  api.setActiveConnection(one.connectionId);
  api.disconnect('espn');

  assert.strictEqual(api.getConnectionsByProvider('espn').length, 1);
  assert.strictEqual(api.getConnectionsByProvider('espn')[0].leagueId, '2');
})();

console.log('league-connection-v2.test.js passed');