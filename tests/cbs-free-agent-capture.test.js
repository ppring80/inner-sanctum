'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'cbs-extension', 'cbs-free-agent-capture.js'),
  'utf8'
);

function loadCollector() {
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
    fetch: async () => { throw new Error('not used in parser test'); },
    DOMParser: function () {},
  };

  vm.runInNewContext(source, context, { filename: 'cbs-free-agent-capture.js' });
  return window.CBSFreeAgentCapture;
}

function fakeRow({ id, linkText, playerCellText, rowText, cells = [] }) {
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
      ? cells.map((textContent) => ({ textContent }))
      : [],
  };
}

(function run() {
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
      cells: ['Add', 'Jared Goff QB-DET', '@ CHI', '82%'],
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

  const doc = {
    body: { textContent: 'PLAYER STATUS FREE AGENTS FREE AGENTS CBS AVERAGE PROJECTIONS' },
    querySelectorAll: (selector) => selector === 'tr' ? rows : [],
  };

  const players = collector.parse(doc);
  assert.strictEqual(players.length, 5);
  assert.strictEqual(players[0].name, 'Jared Goff');
  assert.strictEqual(players[0].availabilityStatus, 'FREE_AGENT');
  assert.strictEqual(players[0].position, 'QB');
  assert.strictEqual(players[0].team, 'DET');
  assert.strictEqual(players[0].percentOwned, 82);
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

  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /credentials:\s*"same-origin"/);
  assert.doesNotMatch(source, /document\.cookie|chrome\.cookies|Authorization\s*:/);

  console.log('CBS free-agent capture regression tests passed.');
})();
