'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'cbs-extension', 'cbs-free-agent-capture.js'),
  'utf8'
);

function loadCollector(overrides = {}) {
  const window = {
    CBSBrowserConnector: {
      captureAll: async () => ({
        league: { id: 'widebodies' },
        roster: [{ name: 'Roster Player' }],
        meta: { warnings: [] },
      }),
    },
  };

  const context = {
    window,
    location: { origin: 'https://widebodies.football.cbssports.com' },
    URL,
    console,
    fetch: overrides.fetch || (async () => { throw new Error('not used in parser test'); }),
    DOMParser: overrides.DOMParser || function () {},
  };

  vm.runInNewContext(source, context, { filename: 'cbs-free-agent-capture.js' });
  return window.CBSFreeAgentCapture;
}

function fakeRow({ id, linkText, playerCellText, rowText, cells = [], labels = [] }) {
  const playerCell = { textContent: playerCellText || linkText };
  const link = {
    href: `https://widebodies.football.cbssports.com/players/playerpage/${id}`,
    textContent: linkText,
    getAttribute: () => `/players/playerpage/${id}`,
    closest: (selector) => selector === 'td' ? playerCell : null,
  };

  return {
    textContent: rowText,
    querySelector: () => link,
    querySelectorAll: (selector) => selector === 'td'
      ? cells.map((textContent, index) => ({
        textContent,
        getAttribute: (name) => name === 'data-label' ? labels[index] || null : null,
      }))
      : [],
  };
}

function fakeDoc(rows, label = 'FREE AGENTS CBS AVERAGE PROJECTIONS') {
  return {
    body: { textContent: label },
    querySelectorAll: (selector) => selector === 'tr' ? rows : [],
  };
}

(async function run() {
  const collector = loadCollector();

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(collector.positionTeam('Jared Goff QB-DET'))),
    { position: 'QB', nflTeam: 'DET' }
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(collector.positionTeam('Kicker Name PK-SEA'))),
    { position: 'K', nflTeam: 'SEA' }
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(collector.positionTeam('Seattle DST-SEA'))),
    { position: 'DST', nflTeam: 'SEA' }
  );

  const rows = [
    fakeRow({
      id: '12345',
      linkText: 'Jared Goff',
      playerCellText: 'Jared Goff QB-DET',
      rowText: 'Jared Goff QB-DET @ CHI 82%',
      cells: ['Add', 'Jared Goff QB-DET', '@ CHI', '18.7', '82%'],
      labels: ['', 'Player', 'Matchup', 'Proj Pts', 'Owned'],
    }),
    fakeRow({
      id: '23456',
      linkText: 'Malik Willis QB-MIA',
      playerCellText: 'Malik Willis QB-MIA',
      rowText: 'Malik Willis QB-MIA vs NE 14%',
      cells: ['Add', 'Malik Willis QB-MIA', 'vs NE', '14%'],
    }),
    // Regression: unrelated row text contains a kicker-like token. Identity
    // must come from Kirk Cousins' own player cell and remain QB-ATL.
    fakeRow({
      id: '34567',
      linkText: 'Kirk Cousins',
      playerCellText: 'Kirk Cousins QB-ATL',
      rowText: 'Kirk Cousins QB-ATL K-TRK 3% trend',
      cells: ['Add', 'Kirk Cousins QB-ATL', 'K-TRK', '3%'],
    }),
    fakeRow({
      id: '45678',
      linkText: 'Jason Myers',
      playerCellText: 'Jason Myers K-SEA',
      rowText: 'Jason Myers K-SEA 12%',
      cells: ['Add', 'Jason Myers K-SEA', '12%'],
    }),
    fakeRow({
      id: '56789',
      linkText: 'Seattle',
      playerCellText: 'Seattle DST-SEA',
      rowText: 'Seattle DST-SEA 41%',
      cells: ['Add', 'Seattle DST-SEA', '41%'],
    }),
  ];

  const players = collector.parse(fakeDoc(rows, 'PLAYER STATUS FREE AGENTS FREE AGENTS CBS AVERAGE PROJECTIONS'));
  assert.strictEqual(players.length, 5);
  assert.strictEqual(players[0].name, 'Jared Goff');
  assert.strictEqual(players[0].availabilityStatus, 'FREE_AGENT');
  assert.strictEqual(players[0].position, 'QB');
  assert.strictEqual(players[0].team, 'DET');
  assert.strictEqual(players[0].percentOwned, 82);
  assert.strictEqual(players[0].projectedPoints, 18.7);
  assert.strictEqual(players[1].projectedPoints, null);
  assert.strictEqual(players[1].name, 'Malik Willis');
  assert.strictEqual(players[2].name, 'Kirk Cousins');
  assert.strictEqual(players[2].position, 'QB');
  assert.strictEqual(players[2].team, 'ATL');
  assert.strictEqual(players[3].position, 'K');
  assert.strictEqual(players[3].team, 'SEA');
  assert.strictEqual(players[4].position, 'DST');
  assert.strictEqual(players[4].team, 'SEA');

  const nonFreeAgentDoc = {
    body: { textContent: 'MY TEAM ROSTER' },
    querySelectorAll: () => rows,
  };
  assert.strictEqual(collector.parse(nonFreeAgentDoc).length, 0);

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(collector.specialistPaths)),
    [
      '/stats/stats-main/fa:K/week1:p/standard/projections',
      '/stats/stats-main/fa:DST/week1:p/standard/projections',
    ]
  );

  const baseRows = [
    fakeRow({ id: '100', linkText: 'Kirk Cousins', playerCellText: 'Kirk Cousins QB-ATL', cells: ['Kirk Cousins QB-ATL'] }),
    fakeRow({ id: '101', linkText: 'Bijan Robinson', playerCellText: 'Bijan Robinson RB-ATL', cells: ['Bijan Robinson RB-ATL'] }),
    fakeRow({ id: '102', linkText: 'Drake London', playerCellText: 'Drake London WR-ATL', cells: ['Drake London WR-ATL'] }),
    fakeRow({ id: '103', linkText: 'Kyle Pitts', playerCellText: 'Kyle Pitts TE-ATL', cells: ['Kyle Pitts TE-ATL'] }),
  ];
  const kickerRows = [
    fakeRow({ id: '200', linkText: 'Joey Slye', playerCellText: 'Joey Slye K-TEN', cells: ['Joey Slye K-TEN'] }),
    // Duplicate ID proves provider-id dedupe across pools.
    fakeRow({ id: '100', linkText: 'Kirk Cousins', playerCellText: 'Kirk Cousins QB-ATL', cells: ['Kirk Cousins QB-ATL'] }),
  ];
  const defenseRows = [
    fakeRow({ id: '300', linkText: 'Green Bay', playerCellText: 'Green Bay DST-GB', cells: ['Green Bay DST-GB'] }),
  ];

  const requested = [];
  const docsByMarker = {
    BASE: fakeDoc(baseRows),
    K: fakeDoc(kickerRows, 'PLAYER STATUS FREE AGENTS FREE AGENT KICKERS CBS AVERAGE PROJECTIONS'),
    DST: fakeDoc(defenseRows, 'PLAYER STATUS FREE AGENTS FREE AGENT DEFENSE/STS CBS AVERAGE PROJECTIONS'),
  };
  function TestDOMParser() {}
  TestDOMParser.prototype.parseFromString = function (text) {
    return docsByMarker[text];
  };

  const fetchingCollector = loadCollector({
    DOMParser: TestDOMParser,
    fetch: async (url, options) => {
      requested.push({ url, options });
      let marker = 'BASE';
      if (url.includes('/fa:K/')) marker = 'K';
      if (url.includes('/fa:DST/')) marker = 'DST';
      return { ok: true, status: 200, text: async () => marker };
    },
  });

  const fetched = await fetchingCollector.fetchPlayers();
  assert.strictEqual(requested.length, 3);
  assert.strictEqual(requested[0].url, 'https://widebodies.football.cbssports.com/stats/stats-main');
  assert.strictEqual(requested[1].url, 'https://widebodies.football.cbssports.com/stats/stats-main/fa:K/week1:p/standard/projections');
  assert.strictEqual(requested[2].url, 'https://widebodies.football.cbssports.com/stats/stats-main/fa:DST/week1:p/standard/projections');
  requested.forEach(({ options }) => {
    assert.strictEqual(options.method, 'GET');
    assert.strictEqual(options.credentials, 'same-origin');
  });

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(fetched.map((p) => p.position))),
    ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
  );
  assert.strictEqual(fetched.find((p) => p.name === 'Kirk Cousins').position, 'QB');
  assert.strictEqual(fetched.filter((p) => p.id === '100').length, 1);

  const joined = collector.addCapturedProjections(players, {
    playerProjectionsById: [{ cbsPlayerId: '23456', projectedPoints: 16.4 }],
    playerProjectionsByName: [{ name: 'Kirk Cousins', projectedPoints: 15.2 }],
  });
  assert.strictEqual(joined[0].projectedPoints, 18.7, 'table projection wins');
  assert.strictEqual(joined[1].projectedPoints, 16.4, 'CBS ID projection joins');
  assert.strictEqual(joined[2].projectedPoints, 15.2, 'normalized name projection joins');

  const degradedRequests = [];
  const degradedCollector = loadCollector({
    DOMParser: TestDOMParser,
    fetch: async (url) => {
      degradedRequests.push(url);
      if (url.includes('/fa:K/')) return { ok: false, status: 503, text: async () => '' };
      if (url.includes('/fa:DST/')) return { ok: true, status: 200, text: async () => 'DST' };
      return { ok: true, status: 200, text: async () => 'BASE' };
    },
  });
  const degraded = await degradedCollector.fetchPlayers();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(degraded.map((p) => p.position))),
    ['QB', 'RB', 'WR', 'TE', 'DST']
  );
  assert.strictEqual(degradedRequests.length, 3);

  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /credentials:\s*"same-origin"/);
  assert.doesNotMatch(source, /document\.cookie|chrome\.cookies|Authorization\s*:/);

  console.log('CBS free-agent capture regression tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
