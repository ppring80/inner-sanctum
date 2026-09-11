'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dispatches.html'), 'utf8');

(function run() {
  assert.match(source, /Best For Me/);
  assert.match(source, /Weekly SAGE/);
  assert.match(source, /Projected Points/);
  assert.match(source, /Roster Impact/);
  assert.match(source, /Decision/);

  ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'].forEach((position) => {
    assert.match(source, new RegExp("'" + position + "'"));
  });

  ['ADD_NOW', 'STASH', 'WATCH', 'REVIEW', 'PASS'].forEach((verdict) => {
    assert.match(source, new RegExp(verdict));
  });

  assert.match(source, /function renderDecisionBoard/);
  assert.match(source, /function setPositionFilter/);
  assert.match(source, /function setBoardSort/);
  assert.match(source, /function toggleDetail/);
  assert.match(source, /providerProjectedPoints/);
  assert.match(source, /Only provider-reported available players are considered/);

  console.log('Dispatches Available For You decision-board regression tests passed.');
})();
