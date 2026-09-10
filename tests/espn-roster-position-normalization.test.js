'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const teamContextPath = path.join(__dirname, '..', 'team-context.js');
const playerIdentityPath = path.join(__dirname, '..', 'player-identity.js');

const source = fs.readFileSync(teamContextPath, 'utf8');
const match = source.match(/const ESPN_POSITION_BY_ID\s*=\s*(\{[^;]+\});/);
assert(match, 'team-context must define ESPN_POSITION_BY_ID');

const positionById = Function('return (' + match[1] + ');')();

assert.strictEqual(positionById[1], 'QB', 'ESPN defaultPositionId 1 must map to QB');
assert.strictEqual(positionById[2], 'RB', 'ESPN defaultPositionId 2 must map to RB');
assert.strictEqual(positionById[3], 'WR', 'ESPN defaultPositionId 3 must map to WR');
assert.strictEqual(positionById[4], 'TE', 'ESPN defaultPositionId 4 must map to TE');
assert.strictEqual(positionById[5], 'K', 'ESPN defaultPositionId 5 must map to K');
assert.strictEqual(positionById[16], 'D/ST', 'ESPN defaultPositionId 16 must map to D/ST');

assert.strictEqual(positionById[0], undefined, 'lineup-slot QB id 0 must not be reused as a defaultPositionId');
assert.strictEqual(positionById[6], undefined, 'lineup-slot TE id 6 must not be reused as a defaultPositionId');
assert.strictEqual(positionById[17], undefined, 'lineup-slot K id 17 must not be reused as a defaultPositionId');

assert(
  source.includes('TE:get(6)') && source.includes('QB:get(0)') && source.includes('K:get(17)'),
  'lineup construction must continue using ESPN lineup-slot IDs, which are separate from defaultPositionId values'
);

const PlayerIdentity = require(playerIdentityPath);
const rankingRows = [
  { name: 'Sam LaPorta', pos: 'TE' },
  { name: 'Jake Ferguson', pos: 'TE' }
];

assert.strictEqual(
  PlayerIdentity.resolveRosterPlayer({ name: 'Sam LaPorta', position: positionById[4] }, rankingRows).name,
  'Sam LaPorta',
  'ESPN TE default position must remain position-compatible with Weekly TE rows'
);
assert.strictEqual(
  PlayerIdentity.resolveRosterPlayer({ name: 'Jake Ferguson', position: positionById[4] }, rankingRows).name,
  'Jake Ferguson',
  'ESPN bench TE default position must remain position-compatible with Weekly TE rows'
);

console.log('PASS ESPN roster position normalization: default-position IDs stay distinct from lineup-slot IDs');
