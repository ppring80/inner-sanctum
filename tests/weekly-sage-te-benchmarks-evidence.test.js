'use strict';

const assert = require('assert');
const {
  buildTeBenchmarks
} = require('../netlify/functions/weekly-sage-te-benchmarks.js');

function te({ playerID, targets, evidenceQualified }) {
  const player = {
    playerID,
    name: playerID,
    team: 'TST',
    currentTeam: 'TST',
    position: 'TE',
    gamesUsed: 2,
    weeksIncluded: [1, 2],
    role: {
      targetsPerGame: targets,
      receptionsPerGame: targets,
      carriesPerGame: 0,
      opportunitiesPerGame: targets,
      offensiveSnapPct: targets
    },
    production: {
      receivingYardsPerGame: targets,
      yardsPerTarget: targets,
      yardsPerReception: targets,
      catchRate: targets,
      receivingTDPerGame: 0,
      rushingYardsPerGame: 0,
      rushingTDPerGame: 0,
      scrimmageYardsPerGame: targets,
      totalTDPerGame: 0
    }
  };

  if (evidenceQualified !== undefined) {
    player.evidenceQualified = evidenceQualified;
  }

  return player;
}

function snapshot(population) {
  return {
    snapshotKey: '2026|3|reg|TE',
    nextStep: { ready: true },
    noLookAhead: { weeksQueried: [1, 2] },
    methodology: {
      minimumGames: 2,
      minimumTargetsPerGame: 2
    },
    populationSummary: {
      teCandidatesDiscovered: population.length,
      playerGameFailures: 0
    },
    population
  };
}

async function run() {
  const qualified = te({
    playerID: 'qualified',
    targets: 10,
    evidenceQualified: true
  });
  const legacy = te({
    playerID: 'legacy',
    targets: 5
  });
  const limited = te({
    playerID: 'limited',
    targets: 100,
    evidenceQualified: false
  });

  const result = await buildTeBenchmarks({
    baseUrl: 'https://example.test',
    season: '2026',
    targetWeek: 3,
    seasonType: 'reg',
    playerID: 'qualified',
    prebuiltSnapshot: snapshot([
      qualified,
      legacy,
      limited
    ])
  });

  assert.strictEqual(
    result.populationSummary.eligibleTEPopulation,
    2,
    'explicitly limited evidence must be excluded, while legacy records remain compatible'
  );
  assert.strictEqual(
    result.populationRanks.targetsPerGame.populationSize,
    2
  );

  const limitedResult =
    await buildTeBenchmarks({
      baseUrl: 'https://example.test',
      season: '2026',
      targetWeek: 3,
      seasonType: 'reg',
      playerID: 'limited',
      prebuiltSnapshot: snapshot([
        qualified,
        legacy,
        limited
      ])
    });

  assert.strictEqual(
    limitedResult.populationSummary.eligibleTEPopulation,
    2,
    'limited TE is scored against the qualified peer set without entering that peer set'
  );
  assert.strictEqual(
    limitedResult.player.playerID,
    'limited'
  );

  console.log('3 weekly-sage-te benchmark evidence tests passed, 0 failed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
