const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('weekly-roster-identity.js', 'utf8');

let appendedScripts = [];
let timers = [];

const document = {
  readyState: 'complete',
  head: {
    appendChild(node) {
      appendedScripts.push(node);
    }
  },
  createElement(tag) {
    return {
      tagName: tag,
      attrs: {},
      setAttribute(name, value) { this.attrs[name] = value; }
    };
  },
  querySelector(selector) {
    if (selector === 'script[data-inner-sanctum-weekly-lineup-polish]') {
      return appendedScripts.find((node) => node.attrs && node.attrs['data-inner-sanctum-weekly-lineup-polish']) || null;
    }
    return null;
  },
  addEventListener() {}
};

const windowObj = {
  location: { pathname: '/weekly' },
  PlayerIdentity: {
    resolveRosterNames() { return ['Travis Etienne Jr.']; }
  },
  LeagueConnection: {
    getActiveConnection() {
      return { roster: [{ name: 'Travis Etienne', position: 'RB' }] };
    }
  },
  state: { myRosterNames: ['Travis Etienne'], connectedRosterNames: ['Travis Etienne'] },
  getAllRows() { return [{ name: 'Travis Etienne Jr.', pos: 'RB' }]; },
  renderTable() {},
  loadWeeklyRankings() {},
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearTimeout() {},
  addEventListener() {}
};

const context = { window: windowObj, document, console, Array, Set };
vm.createContext(context);
vm.runInContext(source, context);

assert.strictEqual(appendedScripts.length, 1, 'Weekly page should append exactly one lineup-polish script');
assert.strictEqual(appendedScripts[0].src, '/weekly-lineup-polish.js');
assert.strictEqual(appendedScripts[0].attrs['data-inner-sanctum-weekly-lineup-polish'], '1');

// Re-evaluating should not append another copy because the script marker exists.
vm.runInContext(source, context);
assert.strictEqual(appendedScripts.length, 1, 'Lineup-polish loader should be idempotent');

// Non-Weekly pages must not load the polish script.
appendedScripts = [];
timers = [];
windowObj.location.pathname = '/draft-command';
vm.runInContext(source, context);
assert.strictEqual(appendedScripts.length, 0, 'Non-Weekly page must not load lineup polish');

console.log('weekly-lineup-polish-loader.test.js passed');
