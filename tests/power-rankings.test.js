'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'power-rankings.html'), 'utf8');

function extractFunction(name, endMarker) {
  const start = html.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  if (endMarker) {
    const end = html.indexOf(endMarker, start);
    assert(end > start, 'missing end marker for ' + name);
    return html.slice(start, end);
  }
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

const context = { console };
vm.createContext(context);
vm.runInContext([
  extractFunction('escapeHtml', '// MANUAL ROSTER FOUNDATION'),
  extractFunction('computePowerRankings', '// PERSONA COMMENTARY'),
  extractFunction('buildRealLeagueFromEspn', '// REAL CBS LEAGUE ADAPTER'),
  extractFunction('buildRealLeagueFromCbs', 'function connectMock')
].join('\n'), context);

function espnLeague(overrides = {}) {
  return {
    scoringPeriodId: 3,
    status: { currentScoringPeriod: 3, currentMatchupPeriod: 3 },
    settings: {
      name: 'Half League',
      scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }] }
    },
    teams: [
      { id: 1, name: 'One', record: { overall: { wins: 1, losses: 1, ties: 0 } } },
      { id: 2, name: 'Two', record: { overall: { wins: 1, losses: 1, ties: 0 } } }
    ],
    schedule: [
      { matchupPeriodId: 1, winner: 'HOME', home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 90 } },
      { matchupPeriodId: 2, winner: 'AWAY', home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 110 } },
      { matchupPeriodId: 3, winner: 'UNDECIDED', home: { teamId: 1, totalPoints: 17 }, away: { teamId: 2, totalPoints: 21 } },
      { matchupPeriodId: 14, winner: 'UNDECIDED', home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } }
    ],
    ...overrides
  };
}

{
  const league = context.buildRealLeagueFromEspn(espnLeague());
  assert.strictEqual(league.scoring, 'Half PPR');
  assert.strictEqual(league.week, 2, 'week must reflect completed games, not future schedule');
  assert.deepStrictEqual(Array.from(league.teams[0].weeklyScores), [0, 100], 'completed zero score is valid; live score is excluded');
  assert.strictEqual(league.matchups.length, 1, 'only the current matchup slate is exposed');
  assert.strictEqual(league.matchups[0].teamA, 'One');
}

{
  const raw = espnLeague({
    scoringPeriodId: 2,
    status: { currentScoringPeriod: 2, currentMatchupPeriod: 2 }
  });
  raw.schedule.splice(1, 0, {
    matchupPeriodId: 1,
    winner: 'AWAY',
    home: { teamId: 1, totalPoints: 0 },
    away: { teamId: 2, totalPoints: 90 }
  });
  const league = context.buildRealLeagueFromEspn(raw);
  assert.deepStrictEqual(Array.from(league.teams[0].weeklyScores), [0, 100], 'doubleheader rows must not duplicate a weekly score');
}

{
  const raw = espnLeague({
    scoringPeriodId: 1,
    status: { currentScoringPeriod: 1, currentMatchupPeriod: 1 },
    schedule: [{ matchupPeriodId: 1, winner: 'UNDECIDED', home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } }]
  });
  const league = context.buildRealLeagueFromEspn(raw);
  assert(league, 'a valid connected preseason league must not fall back to fictional teams');
  assert.strictEqual(league.performanceAvailable, false);
  assert.strictEqual(league.week, 0);
}

{
  const rankings = context.computePowerRankings({ teams: [
    { name: 'A', wins: 2, losses: 0, ties: 0, weeklyScores: [], seasonAvgOverride: 120 },
    { name: 'B', wins: 0, losses: 2, ties: 0, weeklyScores: [], seasonAvgOverride: 100 }
  ] });
  assert.strictEqual(rankings[0].formDelta, null);
  assert(Math.abs(rankings[0].powerWeights.record - 0.5625) < 0.00001);
  assert(Math.abs(rankings[0].powerWeights.scoring - 0.4375) < 0.00001);
  assert.strictEqual(rankings[0].powerWeights.form, 0);
}

{
  const early = context.computePowerRankings({ teams: [
    { name: 'A', wins: 2, losses: 1, ties: 0, weeklyScores: [100, 110, 120] },
    { name: 'B', wins: 1, losses: 2, ties: 0, weeklyScores: [90, 95, 100] }
  ] });
  assert.strictEqual(early[0].formDelta, null, 'form must not activate before a preceding baseline exists');

  const mature = context.computePowerRankings({ teams: [
    { name: 'A', wins: 3, losses: 1, ties: 0, weeklyScores: [80, 100, 110, 120] },
    { name: 'B', wins: 1, losses: 3, ties: 0, weeklyScores: [120, 100, 90, 80] }
  ] });
  const a = mature.find((team) => team.name === 'A');
  assert.strictEqual(a.last3Avg, 110);
  assert.strictEqual(a.formDelta, 30, 'form compares recent weeks with the preceding baseline');
  assert.strictEqual(a.powerWeights.form, 0.20);
}

assert.strictEqual(context.escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');

console.log('power-rankings tests passed');
