'use strict';

const assert = require('assert');
const path = require('path');

const core = require(path.join(__dirname, '..', 'fix-my-team-core.js'));

function run() {
  const context = core.buildFixMyTeamContext({
    provider: 'espn',
    leagueId: 'league-1',
    teamId: 'team-4',
    leagueState: 'IN_SEASON',
    providerAvailable: true,
    availabilitySource: 'espn-kona_player_info',
    roster: [
      { id: '1', name: 'Roster QB', position: 'QB', team: 'BUF', slot: 'QB' },
      { id: '2', name: 'Roster RB', position: 'RB', team: 'ATL', slot: 'RB' },
      { id: '3', name: 'Bench RB', position: 'RB', team: 'SEA', slot: 'BE' }
    ],
    availablePlayers: [
      { providerPlayerId: '100', name: 'Free Agent RB', position: 'RB', status: 'FREEAGENT' },
      { providerPlayerId: '101', name: 'Waiver WR', position: 'WR', status: 'WAIVERS' }
    ]
  });

  assert.strictEqual(context.rosterSize, 3);
  assert.deepStrictEqual(context.positionCounts, { QB: 1, RB: 2 });
  assert.strictEqual(context.transactionAdviceAllowed, true);
  assert.strictEqual(context.actionableAvailablePlayers.length, 2);

  const preDraft = core.buildFixMyTeamContext({
    provider: 'cbs',
    leagueState: 'PRE_DRAFT',
    providerAvailable: true,
    roster: [],
    availablePlayers: [{ name: 'CBS Pool Player', position: 'WR', status: 'FREE_AGENT' }]
  });

  assert.strictEqual(preDraft.transactionAdviceAllowed, false);
  assert.strictEqual(preDraft.transactionAdviceBlockedReason, 'LEAGUE_NOT_DRAFTED');
  assert.deepStrictEqual(preDraft.actionableAvailablePlayers, []);

  const unknown = core.buildFixMyTeamContext({
    provider: 'cbs',
    leagueState: 'UNKNOWN',
    providerAvailable: false,
    availabilityWarning: 'Authenticated availability evidence unavailable',
    roster: [{ name: 'Known Roster Player', position: 'TE' }]
  });

  assert.strictEqual(unknown.rosterSize, 1);
  assert.strictEqual(unknown.transactionAdviceAllowed, false);
  assert.strictEqual(unknown.transactionAdviceBlockedReason, 'PROVIDER_AVAILABILITY_UNCONFIRMED');
  assert.deepStrictEqual(unknown.actionableAvailablePlayers, []);

  console.log('PASS Fix My Team foundation: roster context is preserved while transaction advice stays availability-gated');
}

run();
