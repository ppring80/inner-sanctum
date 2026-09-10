const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('weekly-roster-identity.js', 'utf8');

let rendered = 0;
let lineupFieldsRendered = 0;
let timers = [];

const document = {
  readyState: 'complete',
  head: { appendChild() {} },
  createElement() { return { setAttribute() {} }; },
  querySelector() { return {}; },
  addEventListener() {}
};

const windowObj = {
  location: { pathname: '/weekly' },
  PlayerIdentity: {
    resolveRosterNames() {
      return [
        'Patrick Mahomes', 'Saquon Barkley', 'Chase Brown', 'Malik Nabers',
        'Terry McLaurin', 'Tyler Warren', 'Travis Etienne Jr.', 'Chris Godwin Jr.',
        'Eddy Pineiro', 'NE'
      ];
    }
  },
  LeagueConnection: {
    getActiveConnection() {
      return {
        roster: [{ name: 'Patrick Mahomes', position: 'QB' }],
        lineupConstruction: {
          QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2,
          SUPERFLEX: 0, K: 1, DEF: 1, BENCH: 4
        }
      };
    }
  },
  state: {
    myRosterNames: ['Patrick Mahomes'],
    connectedRosterNames: ['Patrick Mahomes'],
    lineupConstruction: {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1,
      SUPERFLEX: 0, K: 1, DEF: 1, BENCH: 6
    }
  },
  getAllRows() {
    return [{ name: 'Patrick Mahomes', pos: 'QB' }];
  },
  renderTable() { rendered += 1; },
  renderLineupFields() { lineupFieldsRendered += 1; },
  loadWeeklyRankings() {},
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearTimeout() {},
  addEventListener() {}
};

const context = { window: windowObj, document, console, Array, Number };
vm.createContext(context);
vm.runInContext(source, context);

assert.strictEqual(typeof windowObj.applyWeeklyRosterIdentity, 'function');
assert.strictEqual(typeof windowObj.applyConnectedLineupConstruction, 'function');

const applied = windowObj.applyWeeklyRosterIdentity();
assert.strictEqual(applied, true);
assert.strictEqual(windowObj.state.lineupConstruction.FLEX, 2, 'Connected league must override the one-FLEX default with two FLEX starters');
assert.strictEqual(windowObj.state.lineupConstruction.QB, 1);
assert.strictEqual(windowObj.state.lineupConstruction.RB, 2);
assert.strictEqual(windowObj.state.lineupConstruction.WR, 2);
assert.strictEqual(windowObj.state.lineupConstruction.TE, 1);
assert.strictEqual(windowObj.state.lineupConstruction.K, 1);
assert.strictEqual(windowObj.state.lineupConstruction.DEF, 1);
assert.strictEqual(lineupFieldsRendered, 1, 'Lineup setup UI should refresh after connected construction is applied');
assert.ok(rendered >= 1, 'Weekly table should rerender after identity/lineup context is applied');

// SFLEX alias should normalize into SUPERFLEX when providers use that key.
windowObj.applyConnectedLineupConstruction({
  lineupConstruction: {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1,
    SFLEX: 1, K: 1, DEF: 1, BENCH: 5
  }
});
assert.strictEqual(windowObj.state.lineupConstruction.SUPERFLEX, 1);

console.log('weekly-connected-lineup-construction.test.js passed');