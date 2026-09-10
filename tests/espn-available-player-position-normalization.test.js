'use strict';

const assert = require('assert');
const {
  _test: {
    normalizeEspnAvailablePlayers,
    ESPN_DEFAULT_POSITION_BY_ID
  }
} = require('../netlify/functions/espn-league.js');

function freeAgent(id, defaultPositionId, name) {
  return {
    player: {
      id,
      fullName: name,
      defaultPositionId,
      proTeamId: null
    }
  };
}

// The defaultPositionId map must use ESPN's real player default-position
// IDs, not ESPN's separate lineup-slot IDs.
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[1], 'QB');
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[2], 'RB');
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[3], 'WR');
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[4], 'TE');
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[5], 'K');
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[16], 'D/ST');

// Lineup-slot IDs (0 for QB, 6 for TE, 17 for K) must NOT be reused here.
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[0], undefined);
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[6], undefined);
assert.strictEqual(ESPN_DEFAULT_POSITION_BY_ID[17], undefined);

const rawData = {
  players: [
    freeAgent(1, 1, 'Free Agent QB'),
    freeAgent(2, 2, 'Free Agent RB'),
    freeAgent(3, 3, 'Free Agent WR'),
    freeAgent(4, 4, 'Free Agent TE'),
    freeAgent(5, 5, 'Free Agent K'),
    freeAgent(6, 16, 'Free Agent DST')
  ]
};

const normalized = normalizeEspnAvailablePlayers(rawData, 1);
const byId = {};
normalized.forEach(function (player) {
  byId[player.providerPlayerId] = player;
});

assert.strictEqual(byId['1'].position, 'QB');
assert.strictEqual(byId['2'].position, 'RB');
assert.strictEqual(byId['3'].position, 'WR');
assert.strictEqual(byId['4'].position, 'TE', 'a defaultPositionId of 4 must normalize to TE, not WR');
assert.strictEqual(byId['5'].position, 'K');
assert.strictEqual(byId['6'].position, 'D/ST');

// QB/WR/K specifically must be non-null and distinct from each other and
// from TE -- this was silently broken before the fix (defaultPositionId
// values 1, 3, and 5 had no entry in the old map at all).
assert.notStrictEqual(byId['1'].position, null);
assert.notStrictEqual(byId['3'].position, null);
assert.notStrictEqual(byId['5'].position, null);
assert.notStrictEqual(byId['4'].position, byId['3'].position);

console.log('espn-available-player-position-normalization.test.js passed');