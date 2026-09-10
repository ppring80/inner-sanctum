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

const cbsConnection = {
  provider: 'cbs',
  roster: [{ name: 'Patrick Mahomes', position: 'QB' }],
  settings: {
    roster: {
      statusLimits: {
        Active: { min: 10, max: 10 },
        Reserve: { min: 4, max: 4 }
      },
      positions: {
        QB: { activeMin: 1, activeMax: 1, rosterTotal: null },
        RB: { activeMin: 2, activeMax: 4, rosterTotal: null },
        WR: { activeMin: 2, activeMax: 4, rosterTotal: null },
        TE: { activeMin: 1, activeMax: 3, rosterTotal: null },
        'RB-WR-TE': { activeMin: 2, activeMax: 2, rosterTotal: null },
        K: { activeMin: 1, activeMax: 1, rosterTotal: null },
        'D/ST': { activeMin: 1, activeMax: 1, rosterTotal: null }
      }
    }
  }
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
      return cbsConnection;
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

const context = { window: windowObj, document, console, Array, Number, Object, String, Math, RegExp };
vm.createContext(context);
vm.runInContext(source, context);

assert.strictEqual(typeof windowObj.applyWeeklyRosterIdentity, 'function');
assert.strictEqual(typeof windowObj.applyConnectedLineupConstruction, 'function');
assert.strictEqual(typeof windowObj.deriveCbsLineupConstruction, 'function');

const derived = windowObj.deriveCbsLineupConstruction(cbsConnection);
assert.ok(derived, 'CBS settings should derive a normalized lineup construction');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(derived)),
  { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 0, K: 1, DEF: 1, BENCH: 4 },
  'CBS composite RB-WR-TE rule should normalize to two FLEX starters'
);

const applied = windowObj.applyWeeklyRosterIdentity();
assert.strictEqual(applied, true);
assert.strictEqual(windowObj.state.lineupConstruction.FLEX, 2, 'Real CBS settings must override the one-FLEX Weekly default with two FLEX starters');
assert.strictEqual(windowObj.state.lineupConstruction.QB, 1);
assert.strictEqual(windowObj.state.lineupConstruction.RB, 2);
assert.strictEqual(windowObj.state.lineupConstruction.WR, 2);
assert.strictEqual(windowObj.state.lineupConstruction.TE, 1);
assert.strictEqual(windowObj.state.lineupConstruction.K, 1);
assert.strictEqual(windowObj.state.lineupConstruction.DEF, 1);
assert.strictEqual(windowObj.state.lineupConstruction.BENCH, 4);
assert.strictEqual(lineupFieldsRendered, 1, 'Lineup setup UI should refresh after connected construction is applied');
assert.ok(rendered >= 1, 'Weekly table should rerender after identity/lineup context is applied');

// CBS without an explicit composite row can still derive FLEX from the Active total.
const inferredFlex = windowObj.deriveCbsLineupConstruction({
  provider: 'cbs',
  settings: {
    roster: {
      statusLimits: { Active: { min: 10, max: 10 } },
      positions: {
        QB: { activeMin: 1 }, RB: { activeMin: 2 }, WR: { activeMin: 2 }, TE: { activeMin: 1 },
        K: { activeMin: 1 }, DEF: { activeMin: 1 }
      }
    }
  }
});
assert.strictEqual(inferredFlex.FLEX, 2);

// A normalized provider shape still works and SFLEX aliases into SUPERFLEX.
windowObj.applyConnectedLineupConstruction({
  provider: 'espn',
  lineupConstruction: {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1,
    SFLEX: 1, K: 1, DEF: 1, BENCH: 5
  }
});
assert.strictEqual(windowObj.state.lineupConstruction.SUPERFLEX, 1);

// CBS composite rows identify SUPERFLEX when QB is included.
const superflex = windowObj.deriveCbsLineupConstruction({
  provider: 'cbs',
  settings: {
    roster: {
      statusLimits: { Active: { min: 10, max: 10 } },
      positions: {
        QB: { activeMin: 1 }, RB: { activeMin: 2 }, WR: { activeMin: 2 }, TE: { activeMin: 1 },
        K: { activeMin: 1 }, DEF: { activeMin: 1 }, 'QB-RB-WR-TE': { activeMin: 2 }
      }
    }
  }
});
assert.strictEqual(superflex.SUPERFLEX, 2);
assert.strictEqual(superflex.FLEX, 0);

console.log('weekly-connected-lineup-construction.test.js passed');