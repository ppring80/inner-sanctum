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
// Dispatches, reusing the reference data shape produced by
// netlify/functions/waiver-recommendations.js while accepting the expanded data contract.
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

test('Free Agents repairs connected team context before loading waivers', () => {
  assert.ok(html.includes('<script src="/team-context.js"></script>'));
  assert.ok(html.includes("document.addEventListener('DOMContentLoaded',loadWaivers,{once:true})"));
  assert.ok(html.indexOf('<script src="/team-context.js"></script>') < html.indexOf('loadWaivers,{once:true}'));
});

function extractMainScript(source) {
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
}
const mainScript = extractMainScript(html);

test('free-agents.html source defines the real, moved board functions', () => {
  [
    'renderWaivers', 'renderDecisionBoard', 'rowHtml', 'sortRows', 'positionMatch',
    'setPositionFilter', 'setBoardSort', 'toggleDetail', 'rosterImpactCell', 'trendCell',
    'faabCell', 'ensureFaabHeader', 'usableProjection', 'recommendedMatch',
  ].forEach((fn) => {
    assert.ok(mainScript.includes('function ' + fn), fn + ' must be defined in the real file');
  });
  assert.ok(!mainScript.includes('Available For You'), 'the old product name must not appear on the extracted page');
  assert.ok(mainScript.includes("p==='K'?'PK':p"), 'kicker filter should display PK while retaining internal K identity');
});

test('table typography remains readable', () => {
  assert.match(html, /\.decision-board th\{[^}]*font-size:10px/);
  assert.match(html, /\.decision-board td\{[^}]*font-size:14px/);
  assert.match(html, /\.player-name\{[^}]*font-size:15px/);
  assert.match(html, /\.decision-sub\{[^}]*font-size:10px/);
});

test('week rollover fallback is disclosed instead of presenting stale SAGE as current', () => {
  assert.ok(mainScript.includes('sageFallbackUsed===true'));
  assert.ok(mainScript.includes("SAGE Week '+escapeHtml(sageSource)+' is shown temporarily"));
  assert.ok(mainScript.includes("' · SAGE W'+escapeHtml(sageSource)+' FALLBACK'"));
});

test('upstream Weekly SAGE outage keeps the provider board visible in degraded mode', () => {
  assert.ok(mainScript.includes('sageUnavailable===true'));
  assert.ok(mainScript.includes('WEEKLY SAGE UPDATING'));
  assert.ok(mainScript.includes('Provider board available'));
  assert.ok(mainScript.includes('Players remain visible using provider and opportunity evidence'));
});

test('provider projection fallback is labeled honestly in the table', () => {
  assert.ok(mainScript.includes('providerProjectionFallbackUsed===true'));
  assert.ok(mainScript.includes("?'Projection Rank':'Weekly SAGE'"));
});

test('bench upgrades and FAAB guidance are visible customer evidence', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const item = {
    verdict: 'STASH',
    faab: { valuePct: 2, recommendedPct: 3, aggressivePct: 5 },
    decision: {
      evidence: {
        rosterImpact: {
          classification: 'SIMILAR',
          comparisonType: 'starting-lineup',
          candidateStarts: false,
          depthComparison: {
            classification: 'UPGRADE',
            weakestComparable: { name: 'Weak Bench RB' }
          }
        }
      }
    }
  };

  assert.ok(sandbox.rosterImpactCell(item).includes('Bench Upgrade'));
  assert.ok(sandbox.rosterImpactCell(item).includes('Weak Bench RB'));
  assert.ok(sandbox.faabCell(item).includes('3%'));
  assert.ok(sandbox.faabCell(item).includes('Value 2% · Aggressive 5%'));

  const watch = { ...item, verdict: 'WATCH' };
  assert.ok(sandbox.rosterImpactCell(watch).includes('Depth Option'));
  assert.ok(sandbox.rosterImpactCell(watch).includes('role not proven'));
});

test('primary board labels implement the agreed visible data contract', () => {
  ['<th>Player</th>', '<th>Matchup</th>', '<th>Available</th>', '<th>Weekly SAGE</th>',
   '<th>Proj</th>', '<th>Opportunity</th>', '<th>Roster Impact</th>', '<th>Decision</th>']
    .forEach((label) => assert.ok(html.includes(label), label + ' must be present'));
  assert.ok(mainScript.includes("total available"), 'filtered counts must distinguish shown players from the full pool');
  assert.ok(mainScript.includes("No current signal"), 'missing optional evidence must be explicit');
  assert.ok(mainScript.includes('RB/WR/TE workload only'), 'QB/K/DEF must disclose that workload opportunity is not applicable');
});

test('QB, kicker, and defense opportunity cells are explicitly not applicable', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  ['QB', 'K', 'DEF'].forEach((position) => {
    const cell = sandbox.trendCell({ position });
    assert.ok(cell.includes('Not applicable'));
    assert.ok(cell.includes('RB/WR/TE workload only'));
  });
});

test('Week 1 workload is shown without fabricating a directional trend', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  sandbox.waiverData = { week: 2 };
  const html = sandbox.trendCell({
    position: 'RB',
    opportunity: {
      volumeTier: 'high-volume',
      lastGameOpportunities: 22,
      lastGameCarries: 18,
      lastGameTargets: 4,
      gamesSampled: 1
    }
  });
  assert.ok(html.includes('High volume'));
  assert.ok(html.includes('22 opportunities'));
  assert.ok(html.includes('18 carries'));
  assert.ok(html.includes('4 targets'));
  assert.ok(!html.includes('Rising'), 'one completed game must not be labeled a trend');
});

test('projection and ownership read the real nested decision evidence contract', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const nested = { decision: { evidence: { providerProjectedPoints: 17.25, percentOwned: 41 } } };
  assert.strictEqual(sandbox.projectionPoints(nested), '17.3');
  assert.strictEqual(sandbox.rosteredPercent(nested), 41);
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
    recommended: ['ADD_NOW', 'STASH', 'WATCH'].includes(verdict),
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

// Ordered exactly as the real backend (waiver-recommendations.js
// buildCustomerRecommendations/bestForMeCompare) now delivers "Best For
// Me": ADD_NOW, STASH, WATCH, PASS. free-agents.html's own 'best' sort
// is a stable pass-through of whatever order the server computed (see
// tests/free-agents-ranking.test.js for the ranking logic itself), so
// this fixture reflects a realistic already-ranked payload rather than
// an arbitrary input order.
const samplePlayers = [
  player({
    name: 'Add Now RB', position: 'RB', team: 'KC', verdict: 'ADD_NOW', sagePositionRank: 18, projectedPoints: 12.4, trendDirection: 'RISER',
    reasons: ['Lead back after starter injury', 'Volume trending up three straight weeks'],
    swapFor: { name: 'Bench RB', position: 'RB', sage: { position: 'RB', positionRank: 34 } },
  }),
  player({ name: 'Stash QB', position: 'QB', team: 'BUF', verdict: 'STASH', sagePositionRank: 22, projectedPoints: 15.2, trendDirection: null }),
  player({ name: 'Watch WR', position: 'WR', team: 'NE', verdict: 'WATCH', sagePositionRank: 30, projectedPoints: 8.1, trendDirection: 'RISER' }),
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
    sandbox.setBoardScope('all');
    const boardBody = sandbox.document._elements.boardBody;
    assert.ok(boardBody, 'boardBody element should exist after rendering');
    samplePlayers.forEach((p) => {
      assert.ok(boardBody.innerHTML.includes(p.name), 'row for ' + p.name + ' should be rendered');
    });
    const rowCount = (boardBody.innerHTML.match(/onclick="toggleDetail\(/g) || []).length;
    assert.strictEqual(rowCount, samplePlayers.length, 'exactly one clickable player row per recommendation, no duplicates/drops');
  });

  await asyncTest('Best For Me preserves the server-computed roster-impact order (ADD_NOW, STASH, WATCH, PASS)', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();
    sandbox.setBoardScope('all');
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
    assert.strictEqual(
      sandbox.document._elements.boardCount.textContent,
      '1 recommended shown · 4 total available',
      'filtered count should distinguish shown rows from the complete provider pool'
    );

    sandbox.setPositionFilter('ALL');
    sandbox.setBoardScope('all');
    const restored = sandbox.document._elements.boardBody.innerHTML;
    samplePlayers.forEach((p) => assert.ok(restored.includes(p.name), 'ALL filter should restore ' + p.name));
  });

  await asyncTest('recommended scope suppresses stale zero-evidence names while All Available preserves them', async () => {
    const stale = player({ name: 'Retired Placeholder', position: 'QB', team: 'FA', verdict: 'REVIEW', projectedPoints: 0 });
    stale.decision.evidence.sage = null;
    stale.decision.evidence.trend = null;
    stale.identity = { sageMatched: false };
    const payload = {
      week: 3,
      recommendations: [samplePlayers[0], stale],
      summary: { addNow: 1, stash: 0, watch: 0, review: 1, pass: 0 }
    };
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: payload });
    runScript(sandbox);
    await flush();

    assert.ok(sandbox.document._elements.boardBody.innerHTML.includes('Add Now RB'));
    assert.ok(!sandbox.document._elements.boardBody.innerHTML.includes('Retired Placeholder'));
    sandbox.setBoardScope('all');
    assert.ok(sandbox.document._elements.boardBody.innerHTML.includes('Retired Placeholder'));
  });

  await asyncTest('Recommended scope follows the server evidence decision only', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    assert.strictEqual(sandbox.recommendedMatch(player({ name: 'Depth RB', position: 'RB', team: 'LV', verdict: 'REVIEW', projectedPoints: 0.5 })), false);
    assert.strictEqual(sandbox.recommendedMatch(player({ name: 'Usable RB', position: 'RB', team: 'LV', verdict: 'REVIEW', projectedPoints: 6.1 })), false);
    const qualified = player({ name: 'Qualified RB', position: 'RB', team: 'LV', verdict: 'WATCH', projectedPoints: 6.1 });
    qualified.recommended = true;
    assert.strictEqual(sandbox.recommendedMatch(qualified), true);
    assert.strictEqual(sandbox.recommendedMatch(player({ name: 'Passing QB', position: 'QB', team: 'DET', verdict: 'PASS', projectedPoints: 24.2 })), false);
  });

  await asyncTest('client does not recreate evidence rules from raw workload', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    const fringe = player({ name: 'Fringe WR', position: 'WR', team: 'HOU', verdict: 'REVIEW', projectedPoints: 0 });
    fringe.opportunity = { lastGameOpportunities: 5, lastGameTargets: 5 };
    assert.strictEqual(sandbox.recommendedMatch(fringe), false);
    fringe.recommended = true;
    assert.strictEqual(sandbox.recommendedMatch(fringe), true);
  });

  await asyncTest('no-action state explains why FAAB remains blank', async () => {
    const payload = {
      week: 3,
      recommendations: [samplePlayers[3]],
      summary: { addNow: 0, stash: 0, watch: 0, review: 0, pass: 1 }
    };
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: payload });
    runScript(sandbox);
    await flush();
    const shell = sandbox.document._elements.waiverRoot.innerHTML;
    assert.ok(shell.includes('No forced move'));
    assert.ok(shell.includes('FAAB stays blank until a player earns an actionable grade'));
  });

  await asyncTest('changing sort to Weekly SAGE reorders the board by position rank', async () => {
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: samplePayload });
    runScript(sandbox);
    await flush();
    sandbox.setBoardScope('all');

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

  await asyncTest('every sort produces its exact advertised order for same-position players', async () => {
    const rows = [
      player({ name: 'Zulu WR', position: 'WR', team: 'SF', verdict: 'REVIEW', sagePositionRank: 30, projectedPoints: 6, trendDirection: 'FALLER', percentOwned: 20 }),
      player({ name: 'Alpha WR', position: 'WR', team: 'NYJ', verdict: 'STASH', sagePositionRank: 8, projectedPoints: 10, trendDirection: null, percentOwned: 40 }),
      player({ name: 'Mike WR', position: 'WR', team: 'GB', verdict: 'REVIEW', sagePositionRank: 16, projectedPoints: 14, trendDirection: 'RISER', percentOwned: 80 })
    ];
    rows[0].opportunity = { lastGameOpportunities: 12 };
    rows[1].opportunity = { lastGameOpportunities: 8 };
    rows[2].opportunity = { lastGameOpportunities: 5 };
    const payload = {
      week: 2,
      recommendations: rows,
      summary: { addNow: 0, stash: 1, watch: 0, review: 2, pass: 0 },
      metadata: { providerProjectionFallbackUsed: true }
    };
    const sandbox = makeSandbox({ connection: connection(), recommendationPayload: payload });
    runScript(sandbox);
    await flush();
    sandbox.setBoardScope('all');

    const assertOrder = (sort, names) => {
      sandbox.setBoardSort(sort);
      const rendered = sandbox.document._elements.boardBody.innerHTML;
      const indexes = names.map((name) => rendered.indexOf(name));
      indexes.forEach((index) => assert.ok(index >= 0, sort + ' must retain every row'));
      for (let i = 1; i < indexes.length; i += 1) {
        assert.ok(indexes[i - 1] < indexes[i], sort + ' rendered the wrong order: ' + names.join(', '));
      }
    };

    assertOrder('best', ['Zulu WR', 'Alpha WR', 'Mike WR']);
    assertOrder('sage', ['Alpha WR', 'Mike WR', 'Zulu WR']);
    assertOrder('projection', ['Mike WR', 'Alpha WR', 'Zulu WR']);
    assertOrder('trend', ['Mike WR', 'Alpha WR', 'Zulu WR']);
    assertOrder('rostered', ['Mike WR', 'Alpha WR', 'Zulu WR']);
    assertOrder('alpha', ['Alpha WR', 'Mike WR', 'Zulu WR']);
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
