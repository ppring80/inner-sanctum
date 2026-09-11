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

function fakeRow({ id, linkText, rowText, cells = [] }) {
  const link = {
    href: `https://widebodies.football.cbssports.com/players/playerpage/${id}`,
    textContent: linkText,
    getAttribute: () => `/players/playerpage/${id}`,
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

  const rows = [
    fakeRow({
      id: '12345',
      linkText: 'Jared Goff',
      rowText: 'Jared Goff QB-DET @ CHI 82%',
      cells: ['Add', 'Jared Goff QB-DET', '@ CHI', '82%'],
    }),
    fakeRow({
      id: '23456',
      linkText: 'Malik Willis QB-MIA',
      rowText: 'Malik Willis QB-MIA vs NE 14%',
      cells: ['Add', 'Malik Willis QB-MIA', 'vs NE', '14%'],
    }),
  ];

  const doc = {
    body: { textContent: 'PLAYER STATUS FREE AGENTS FREE AGENTS CBS AVERAGE PROJECTIONS' },
    querySelectorAll: (selector) => selector === 'tr' ? rows : [],
  };

  const players = collector.parse(doc);
  assert.strictEqual(players.length, 2);
  assert.strictEqual(players[0].name, 'Jared Goff');
  assert.strictEqual(players[0].availabilityStatus, 'FREE_AGENT');
  assert.strictEqual(players[0].position, 'QB');
  assert.strictEqual(players[0].team, 'DET');
  assert.strictEqual(players[0].percentOwned, 82);
  assert.strictEqual(players[1].name, 'Malik Willis');

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
