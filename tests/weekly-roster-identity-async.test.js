'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'weekly-roster-identity.js'),
  'utf8'
);

let rows = [];
let renderCount = 0;
let loadCount = 0;
let timerId = 0;
const timers = [];
const listeners = {};

const state = {
  myRosterNames: ['Travis Etienne'],
  connectedRosterNames: ['Travis Etienne']
};

const context = {
  console,
  location: { pathname: '/weekly' },
  state,
  PlayerIdentity: {
    resolveRosterNames(roster, rankingRows) {
      assert.strictEqual(roster.length, 1);
      assert.strictEqual(rankingRows.length, 1);
      return ['Travis Etienne Jr.'];
    }
  },
  LeagueConnection: {
    getActiveConnection() {
      return { roster: [{ name: 'Travis Etienne', position: 'RB' }] };
    }
  },
  getAllRows() {
    return rows;
  },
  renderTable() {
    renderCount += 1;
  },
  loadWeeklyRankings() {
    loadCount += 1;
  },
  document: {
    readyState: 'complete',
    addEventListener() {}
  },
  addEventListener(type, handler) {
    listeners[type] = handler;
  },
  setTimeout(handler) {
    const id = ++timerId;
    timers.push({ id, handler });
    return id;
  },
  clearTimeout(id) {
    const index = timers.findIndex(function (timer) { return timer.id === id; });
    if (index !== -1) timers.splice(index, 1);
  }
};
context.window = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'weekly-roster-identity.js' });

assert.strictEqual(
  state.myRosterNames[0],
  'Travis Etienne',
  'identity must not guess before ranking rows exist'
);
assert.ok(timers.length > 0, 'initial load should schedule a retry');

rows = [{ name: 'Travis Etienne Jr.', position: 'RB' }];
timers.shift().handler();

assert.strictEqual(state.myRosterNames[0], 'Travis Etienne Jr.');
assert.strictEqual(state.connectedRosterNames[0], 'Travis Etienne Jr.');
assert.strictEqual(renderCount, 1, 'successful correction should rerender Weekly');

rows = [];
context.loadWeeklyRankings();
assert.strictEqual(loadCount, 1, 'wrapped loader must still call the original loader');
assert.ok(timers.length > 0, 'future rankings reload should restart identity retries');

rows = [{ name: 'Travis Etienne Jr.', position: 'RB' }];
timers.shift().handler();
assert.strictEqual(renderCount, 2, 'identity should reapply after a future rankings reload');

console.log('weekly roster identity async regression: PASS');
