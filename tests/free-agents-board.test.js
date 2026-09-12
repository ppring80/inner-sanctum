// tests/free-agents-board.test.js
//
// Regression coverage for the Free Agents decision board, extracted from
// Dispatches' former "Available For You" tab. Executes the REAL, complete
// extracted main <script> block from the real free-agents.html file via
// Node's built-in `vm` module -- not a reimplementation -- matching the
// exact pattern already established in tests/draft-command-center-board.test.js
// and tests/weekly-lineup-polish-loader.test.js.
//
// This feature is presentation-only: every test here proves the moved
// rendering/filtering/sorting functions behave exactly as they did inside
// Dispatches, reusing the same reference data shape produced by
// netlify/functions/waiver-recommendations.js (untouched by this PR).
//
// Run: node tests/free-agents-board.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(name + ' :: ' + (err && err.message ? err.message : err));
  }
}
async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(name + ' :: ' + (err && err.message ? err.message : err));
  }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'free-agents.html'), 'utf8');

function extractMainScript(source) {
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
}
const mainScript = extractMainScript(html);

test('free-agents.html source defines the real, moved board functions', () => {
  [
    'renderWaivers', 'renderDecisionBoard', 'rowHtml', 'sortRows', 'positionMatch',
    'setPositionFilter', 'setBoardSort', 'toggleDetail', 'rosterImpactCell', 'trendCell',
  ].forEach((fn) => {
    assert.ok(mainScript.includes('function ' + fn), fn + ' must be defined in the real file');
  });
  assert.ok(!mainScript.includes('Available For You'), 'the old product name must not appear on the extracted page');
  assert.ok(mainScript.includes("p==='K'?'PK':p"), 'kicker filter should display PK while retaining internal K identity');
});

function makeFakeElement() {
  const classes = new Set();
  const el = {
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => { if (on === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; },
    textContent: '',
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
  };
  return el;
}

function makeFakeDocument() {
  const elements = {};
  return {
    getElementById: (id) => {
      if (!elements[id]) elements[id] = makeFakeElement();
      return elements[id];
    },
    createElement: () => makeFakeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    _elements: elements,
  };
}

function makeSandbox({ connection, recommendationPayload, fetchError } = {}) {
  const doc = makeFakeDocument();
  const sandbox = {
    document: doc,
    window: {
      LeagueConnection: {
        getActiveConnection: () => connection || null,
      },
      addEventListener() {},
    },
    console,
    fetch: async () => {
      if (fetchError) throw fetchError;
      return { ok: true, json: async () => recommendationPayload };
    },
    escapeHtml: undefined,
    setTimeout: (fn) => { fn(); return 1; },
    addEventListener() {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function runScript(sandbox) {
  vm.runInContext(mainScript, sandbox);
}

function flush(times = 20) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) p = p.then(() => {});
  return p;
}

function connection() {
  return {
    provider: 'espn',
    leagueName: 'Test League',
    league: { name: 'Test League', scoringPeriodId: 3 },
  };
}

function player({ name, position, team, verdict, sagePositionRank, projectedPoints, trendDirection, reasons, swapFor, percentOwned }) {
  return {
    providerPlayerId: name.replace(/\s+/g, '-').toLowerCase(),
    name,
    position,
    team,
    verdict,
    availabilityStatus: 'AVAILABLE',
    providerProjectedPoints: projectedPoints,
    percentOwned: percentOwned == null ? 12 : percentOwned,
    swapFor: swapFor || null,
    decision: {
      reasons: reasons || [],
      evidence: {
        sage: { position, positionRank: sagePositionRank, recommendation: 'consider' },
        trend: trendDirection ? { direction: trendDirection } : null,
        rosterImpact: swapFor ? { classification: 'UPGRADE', weakestComparable: swapFor } : { classification: 'UNKNOWN' },
      },
    },
  };
}

const samplePlayers = [
  player({ name: 'Watch WR', position: 'WR', team: 'NE', verdict: 'WATCH', sagePositionRank: 30, projectedPoints: 8.1, trendDirection: 'RISER' }),
  player({
    name: 'Add Now RB', position: 'RB', team: 'KC', verdict: 'ADD_NOW', sagePositionRank: 18, projectedPoints: 12.4, trendDirection: 'RISER',
    reasons: ['Lead back after starter injury', 'Volume trending up three straight weeks'],
    swapFor: { name: 'Bench RB', position: 'RB', sage: { position: 'RB', positionRank: 34 } },
  }),
  player({ name: 'Stash QB', position: 'QB', team: 'BUF', verdict: 'STASH', sagePositionRank: 22, projectedPoints: 15.2, trendDirection: null }),
  player({ name: 'Pass TE', position: 'TE', team: 'SF', verdict: 'PASS', sagePositionRank: 40, projectedPoints: 4.0, trendDirection: 'FALLER' }),
];

const samplePayload = {
  week: 3,
  recommendations: samplePlayers,
  summary: { addNow: 1, stash: 1, watch: 1, review: 0, pass: 1 },
};

(async function run() {
  await asyncTest('board renders one row per provider recommendation', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();
    const boardBody = sandbox.document._elements.boardBody;
    assert.ok(boardBody, 'boardBody element should exist after rendering');
    samplePlayers.forEach((p) => {
      assert.ok(boardBody.innerHTML.includes(p.name), 'row for ' + p.name + ' should be rendered');
    });
    const rowCount = (boardBody.innerHTML.match(/onclick="toggleDetail\(/g) || []).length;
    assert.strictEqual(rowCount, samplePlayers.length, 'exactly one clickable player row per recommendation, no duplicates/drops');
  });

  await asyncTest('Best For Me (verdict priority) is the default board order', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();
    assert.strictEqual(sandbox.boardSort, 'best', 'boardSort must default to best');
    const html2 = sandbox.document._elements.boardBody.innerHTML;
    const order = ['Add Now RB', 'Stash QB', 'Watch WR', 'Pass TE'].map((n) => html2.indexOf(n));
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i - 1] < order[i], 'expected ' + order + ' to be strictly increasing (ADD_NOW first, PASS last)');
    }
  });

  await asyncTest('position filter narrows the board to the selected position only', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();

    sandbox.setPositionFilter('RB');
    const filtered = sandbox.document._elements.boardBody.innerHTML;
    assert.ok(filtered.includes('Add Now RB'), 'RB filter should keep the RB');
    assert.ok(!filtered.includes('Watch WR'), 'RB filter should exclude the WR');
    assert.ok(!filtered.includes('Stash QB'), 'RB filter should exclude the QB');
    assert.ok(!filtered.includes('Pass TE'), 'RB filter should exclude the TE');

    sandbox.setPositionFilter('ALL');
    const restored = sandbox.document._elements.boardBody.innerHTML;
    samplePlayers.forEach((p) => assert.ok(restored.includes(p.name), 'ALL filter should restore ' + p.name));
  });

  await asyncTest('changing sort to Weekly SAGE reorders the board by position rank', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();

    sandbox.setBoardSort('sage');
    const sageHtml = sandbox.document._elements.boardBody.innerHTML;
    const order = ['Add Now RB', 'Stash QB', 'Watch WR', 'Pass TE'].map((n) => sageHtml.indexOf(n));
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i - 1] < order[i], 'Weekly SAGE sort should be ascending by position rank');
    }

    sandbox.setBoardSort('projection');
    const projHtml = sandbox.document._elements.boardBody.innerHTML;
    const projOrder = ['Stash QB', 'Add Now RB', 'Watch WR', 'Pass TE'].map((n) => projHtml.indexOf(n));
    for (let i = 1; i < projOrder.length; i += 1) {
      assert.ok(projOrder[i - 1] < projOrder[i], 'Projected Points sort should be descending by projection');
    }
  });

  await asyncTest('expandable evidence row toggles open and closed', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();

    const boardBody = sandbox.document._elements.boardBody.innerHTML;
    const idMatch = boardBody.match(/toggleDetail\('([^']+)'\)/);
    assert.ok(idMatch, 'a row should carry a toggleDetail(...) handler with a real row id');
    const rowId = idMatch[1];

    const detailEl = sandbox.document.getElementById('detail-' + rowId);
    assert.strictEqual(detailEl.classList.contains('open'), false, 'detail row should start closed');

    sandbox.toggleDetail(rowId);
    assert.strictEqual(detailEl.classList.contains('open'), true, 'first toggle should open the evidence row');

    sandbox.toggleDetail(rowId);
    assert.strictEqual(detailEl.classList.contains('open'), false, 'second toggle should close it again');

    assert.ok(boardBody.includes('Add Add Now RB → replace Bench RB'), 'ADD NOW swap guidance should be preserved in the row markup');
  });

  console.log('');
  console.log('free-agents-board.test.js: ' + passed + '/' + (passed + failed) + ' passed');
  if (failed > 0) {
    failures.forEach((f) => console.error('FAIL:', f));
    process.exitCode = 1;
  }
})();
