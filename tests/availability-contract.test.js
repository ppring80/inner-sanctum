'use strict';

const assert = require('assert');
const path = require('path');

const contractPath = path.join(__dirname, '..', 'availability-contract.js');
const availability = require(contractPath);

function run() {
  const espn = availability.buildAvailabilityContext({
    provider: 'espn',
    leagueState: 'IN_SEASON',
    providerAvailable: true,
    source: 'espn-kona_player_info',
    availablePlayers: [
      {
        providerPlayerId: '123',
        name: 'Example Runner',
        position: 'RB',
        nflTeam: 'HOU',
        availabilityStatus: 'FREEAGENT',
        percentOwned: '17.5',
        projectedPoints: '10.2',
        scoringPeriodId: 1
      }
    ]
  });

  assert.strictEqual(espn.actionable, true);
  assert.strictEqual(espn.actionabilityReason, null);
  assert.strictEqual(espn.availablePlayers.length, 1);
  assert.strictEqual(espn.availablePlayers[0].availabilityStatus, 'FREE_AGENT');
  assert.strictEqual(espn.availablePlayers[0].actionable, true);
  assert.strictEqual(espn.availablePlayers[0].provider, 'espn');
  assert.strictEqual(espn.availablePlayers[0].percentOwned, 17.5);

  const preDraftCbs = availability.buildAvailabilityContext({
    provider: 'cbs',
    leagueState: 'PRE_DRAFT',
    providerAvailable: true,
    source: 'cbs-player-pool',
    availablePlayers: [
      {
        name: 'Example Quarterback',
        position: 'QB',
        availabilityStatus: 'FREE_AGENT'
      }
    ]
  });

  assert.strictEqual(preDraftCbs.actionable, false);
  assert.strictEqual(preDraftCbs.actionabilityReason, 'LEAGUE_NOT_DRAFTED');
  assert.strictEqual(preDraftCbs.availablePlayers[0].actionable, false);
  assert.strictEqual(preDraftCbs.availablePlayers[0].actionabilityReason, 'LEAGUE_NOT_DRAFTED');

  const unknown = availability.buildAvailabilityContext({
    provider: 'cbs',
    leagueState: 'UNKNOWN',
    providerAvailable: true,
    availablePlayers: [{ name: 'Unknown State Player', availabilityStatus: 'WAIVERS' }]
  });

  assert.strictEqual(unknown.actionable, false);
  assert.strictEqual(unknown.actionabilityReason, 'LEAGUE_STATE_UNCONFIRMED');

  const unavailable = availability.buildAvailabilityContext({
    provider: 'espn',
    leagueState: 'IN_SEASON',
    providerAvailable: false,
    warning: 'Provider request failed',
    availablePlayers: [{ name: 'Should Not Be Trusted' }]
  });

  assert.strictEqual(unavailable.actionable, false);
  assert.strictEqual(unavailable.actionabilityReason, 'PROVIDER_AVAILABILITY_UNCONFIRMED');
  assert.strictEqual(unavailable.availablePlayers[0].actionable, false);

  console.log('PASS availability contract: provider data is actionable only in a confirmed in-season league state');
}

run();
