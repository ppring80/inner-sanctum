const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractConstObject(source, name) {
  const match = source.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\{[\\s\\S]*?\\});'));
  assert(match, 'Could not locate ' + name);
  return vm.runInNewContext('(' + match[1] + ')');
}

const EXPECTED_ESPN_TEAM_BY_ID = {
  0: null,
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WSH',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU'
};

const teamContextPath = path.join(__dirname, '..', 'team-context.js');
const espnLeaguePath = path.join(__dirname, '..', 'netlify', 'functions', 'espn-league.js');
const teamContextSource = fs.readFileSync(teamContextPath, 'utf8');
const espnLeagueSource = fs.readFileSync(espnLeaguePath, 'utf8');

const browserTeamMap = extractConstObject(teamContextSource, 'ESPN_TEAM_BY_ID');
const backendTeamMap = extractConstObject(espnLeagueSource, 'NFL_TEAM_BY_ID');

const expectedIds = Object.keys(EXPECTED_ESPN_TEAM_BY_ID).sort((a, b) => Number(a) - Number(b));
const browserIds = Object.keys(browserTeamMap).sort((a, b) => Number(a) - Number(b));
const backendIds = Object.keys(backendTeamMap).sort((a, b) => Number(a) - Number(b));

assert(JSON.stringify(browserIds) === JSON.stringify(expectedIds), 'Browser ESPN team map must contain exactly the supported NFL team IDs');
assert(JSON.stringify(backendIds) === JSON.stringify(expectedIds), 'Backend ESPN team map must contain exactly the supported NFL team IDs');

expectedIds.forEach((id) => {
  assert(browserTeamMap[id] === EXPECTED_ESPN_TEAM_BY_ID[id], 'Browser ESPN team ID ' + id + ' should map to ' + EXPECTED_ESPN_TEAM_BY_ID[id]);
  assert(backendTeamMap[id] === EXPECTED_ESPN_TEAM_BY_ID[id], 'Backend ESPN team ID ' + id + ' should map to ' + EXPECTED_ESPN_TEAM_BY_ID[id]);
  assert(browserTeamMap[id] === backendTeamMap[id], 'Browser/backend ESPN team maps must agree for team ID ' + id);
});

const canonicalCodes = expectedIds
  .filter((id) => EXPECTED_ESPN_TEAM_BY_ID[id])
  .map((id) => EXPECTED_ESPN_TEAM_BY_ID[id]);

assert(canonicalCodes.length === 32, 'Expected exactly 32 NFL defense identities');
assert(new Set(canonicalCodes).size === 32, 'Each NFL defense must have a unique canonical identity');

const normalizeMatch = teamContextSource.match(/function normalizeEspnRoster\(team, league\) \{[\s\S]*?\n  \}\n\n  function repairActiveEspnDefenseIdentity/);
assert(normalizeMatch, 'Could not locate normalizeEspnRoster in team-context.js');
const normalizeSource = normalizeMatch[0].replace(/\n\n  function repairActiveEspnDefenseIdentity$/, '');

const context = {
  ESPN_POSITION_BY_ID: extractConstObject(teamContextSource, 'ESPN_POSITION_BY_ID'),
  ESPN_TEAM_BY_ID: browserTeamMap,
  numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  findEspnProjection() { return 0; }
};

vm.createContext(context);
vm.runInContext(normalizeSource + '\nthis.normalizeEspnRoster = normalizeEspnRoster;', context);

const defenseEntries = expectedIds
  .filter((id) => EXPECTED_ESPN_TEAM_BY_ID[id])
  .map((id, index) => ({
    playerPoolEntry: {
      player: {
        id: 1000 + index,
        fullName: 'Provider Defense ' + id,
        defaultPositionId: 16,
        proTeamId: Number(id)
      }
    }
  }));

const normalizedDefenses = context.normalizeEspnRoster(
  { roster: { entries: defenseEntries } },
  { scoringPeriodId: 1 }
);

assert(normalizedDefenses.length === 32, 'All 32 ESPN defenses should survive roster normalization');

normalizedDefenses.forEach((defense, index) => {
  const expectedCode = EXPECTED_ESPN_TEAM_BY_ID[String(defenseEntries[index].playerPoolEntry.player.proTeamId)];
  assert(defense.position === 'D/ST', 'Defense position must remain D/ST in ESPN roster normalization');
  assert(defense.name === expectedCode, 'Defense should canonicalize to ' + expectedCode);
  assert(defense.team === expectedCode, 'Defense team code should be ' + expectedCode);
  assert(defense.nflTeam === expectedCode, 'Defense nflTeam should be ' + expectedCode);
  assert(defense.displayName === 'Provider Defense ' + defenseEntries[index].playerPoolEntry.player.proTeamId, 'Provider display name must be preserved');
});

const qb = context.normalizeEspnRoster({
  roster: {
    entries: [{
      playerPoolEntry: {
        player: {
          id: 1,
          fullName: 'Joe Burrow',
          defaultPositionId: 0,
          proTeamId: 4
        }
      }
    }]
  }
}, { scoringPeriodId: 1 })[0];

assert(qb.name === 'Joe Burrow', 'Non-defense player names must remain unchanged');
assert(qb.displayName === 'Joe Burrow', 'Non-defense display name must remain unchanged');

const unknownDefense = context.normalizeEspnRoster({
  roster: {
    entries: [{
      playerPoolEntry: {
        player: {
          id: 3,
          fullName: 'Unknown Defense',
          defaultPositionId: 16,
          proTeamId: 999
        }
      }
    }]
  }
}, { scoringPeriodId: 1 })[0];

assert(unknownDefense.name === 'Unknown Defense', 'Unknown defense team IDs must fall back to provider display name rather than inventing an identity');

console.log('team-context-defense-identity.test.js passed: all 32 NFL defenses protected');