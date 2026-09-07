const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourcePath = path.join(__dirname, '..', 'team-context.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const match = source.match(/function normalizeEspnRoster\(team, league\) \{[\s\S]*?\n  \}\n\n  function repairActiveEspnDefenseIdentity/);
assert(match, 'Could not locate normalizeEspnRoster in team-context.js');

const normalizeSource = match[0].replace(/\n\n  function repairActiveEspnDefenseIdentity$/, '');

const context = {
  ESPN_POSITION_BY_ID: { 0:'QB', 2:'RB', 4:'WR', 6:'TE', 16:'D/ST', 17:'K' },
  ESPN_TEAM_BY_ID: { 4:'CIN', 34:'HOU' },
  numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  findEspnProjection() { return 0; }
};

vm.createContext(context);
vm.runInContext(normalizeSource + '\nthis.normalizeEspnRoster = normalizeEspnRoster;', context);

const team = {
  roster: {
    entries: [
      {
        playerPoolEntry: {
          player: {
            id: 1,
            fullName: 'Joe Burrow',
            defaultPositionId: 0,
            proTeamId: 4
          }
        }
      },
      {
        playerPoolEntry: {
          player: {
            id: 2,
            fullName: 'Houston Texans',
            defaultPositionId: 16,
            proTeamId: 34
          }
        }
      }
    ]
  }
};

const roster = context.normalizeEspnRoster(team, { scoringPeriodId: 1 });
assert(roster.length === 2, 'Expected two normalized roster entries');

const qb = roster.find((player) => player.position === 'QB');
assert(qb, 'QB should remain in normalized roster');
assert(qb.name === 'Joe Burrow', 'Non-defense player names must remain unchanged');
assert(qb.displayName === 'Joe Burrow', 'Non-defense display name must remain unchanged');

const defense = roster.find((player) => player.position === 'D/ST');
assert(defense, 'Defense should remain in normalized roster');
assert(defense.name === 'HOU', 'ESPN defense canonical name must use NFL team code');
assert(defense.displayName === 'Houston Texans', 'ESPN provider defense display name must be preserved');
assert(defense.team === 'HOU', 'Defense team code must remain HOU');

const unknownDefense = context.normalizeEspnRoster({
  roster: {
    entries: [
      {
        playerPoolEntry: {
          player: {
            id: 3,
            fullName: 'Unknown Defense',
            defaultPositionId: 16,
            proTeamId: 999
          }
        }
      }
    ]
  }
}, { scoringPeriodId: 1 })[0];

assert(unknownDefense.name === 'Unknown Defense', 'Unknown defense team IDs must fall back to provider display name rather than inventing an identity');

console.log('team-context-defense-identity.test.js passed');