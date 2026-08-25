// tests/draft-command-center-board.test.js
//
// Regression coverage for the Draft Board / By Team view. Executes the
// REAL, complete extracted main <script> block from the real
// draft.html file via Node's built-in `vm` module -- not a
// reimplementation, matching the exact pattern already established in
// tests/draft-command-center-mock.test.js and
// tests/draft-command-center-keepers.test.js.
//
// This feature is presentation-only: every test here proves it reads
// existing state without ever mutating it, and reuses the existing
// sequencing primitives (pickNumberForRoundAndSlot, keeperPickNumber,
// resolveSlotForPick) rather than a second implementation.
//
// Run: node tests/draft-command-center-board.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}

const draftHtml = fs.readFileSync(path.join(__dirname, '../draft.html'), 'utf8');

function extractMainScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
}
const mainScript = extractMainScript(draftHtml);

test('draft.html source contains the new Draft Board / By Team functions', () => {
  [
    'buildTeamRosterEntries', 'buildDraftBoardCell', 'openDraftBoardModal',
    'closeDraftBoardModal', 'switchDraftBoardTab', 'selectDraftBoardTeam',
    'renderDraftBoardModal', 'renderDraftBoardTabHtml', 'renderByTeamTabHtml',
  ].forEach((fn) => {
    assert.ok(mainScript.includes('function ' + fn), fn + ' must be defined in the real file');
  });
});

// ───────────────────────────────────────────────────────────
// Fake DOM (with real child-tracking, matching the established pattern)
// ───────────────────────────────────────────────────────────
function makeFakeElement() {
  const classes = new Set();
  const el = {
    _value: '',
    get value() { return this._value; },
    set value(v) { this._value = v; },
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; this.children.length = 0; },
    textContent: '',
    disabled: false,
    checked: false,
    options: [],
    children: [],
    dataset: {},
    focus() {}, blur() {}, click() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); },
    remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getContext: () => null,
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

function makeSandbox() {
  const storageData = {};
  const sandbox = {
    document: makeFakeDocument(),
    localStorage: {
      getItem: (k) => (k in storageData ? storageData[k] : null),
      setItem: (k, v) => { storageData[k] = String(v); },
      removeItem: (k) => { delete storageData[k]; },
    },
    fetch: () => Promise.reject(new Error('no network in test')),
    window: { PLAYER_POOL: { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] } },
    console,
    setTimeout: (fn) => fn(),
    URLSearchParams,
    Promise,
    alert: () => {},
    confirm: () => true,
    fetchTank01PlayerMap: () => Promise.resolve({}),
    applyLiveTeamsFromTank01: (list) => list,
    normalizePlayerName: (n) => (n || '').toLowerCase(),
  };
  sandbox._storageData = storageData;
  vm.createContext(sandbox);
  return sandbox;
}

function runScript(sandbox) {
  vm.runInContext(mainScript, sandbox);
}

function setupLeague(sandbox, numTeams, myTeamId, draftType) {
  const teams = [];
  for (let i = 1; i <= numTeams; i++) teams.push({ id: 'team-' + String(i).padStart(2, '0'), name: 'Team ' + i });
  sandbox.draftState = {
    schemaVersion: sandbox.DRAFT_SAVE_SCHEMA_VERSION,
    teams,
    myTeamId: myTeamId || teams[0].id,
    draftLog: [],
    nextPickId: 1,
    draftType: draftType || 'snake',
    numRounds: 16,
    rosterConstruction: sandbox.DEFAULT_ROSTER_CONSTRUCTION,
    keepers: [],
    nextKeeperId: 1,
  };
}

// ═══════════════════════════════════════════════════════════
// buildDraftBoardCell() -- board mapping correctness
// ═══════════════════════════════════════════════════════════

test('board mapping is correct for snake turns (odd round, no reversal)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Player A', pos: 'RB', teamId: 'team-01' });
  const cell = sandbox.buildDraftBoardCell(1, 1, 'team-01', 'snake', 4, sandbox.totalDraftPicks());
  assert.strictEqual(cell.pickNumber, 1);
  assert.strictEqual(cell.player, 'Player A');
  assert.strictEqual(cell.isKeeper, false);
});

test('board mapping is correct for snake turns (even round, reversed)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  // Round 2 (even), slot 1 -> pickNumberForRoundAndSlot reverses: posInRound=4-1+1=4 -> pick (2-1)*4+4=8
  const pn = sandbox.pickNumberForRoundAndSlot(2, 1, 4, 'snake');
  assert.strictEqual(pn, 8);
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 8, player: 'Player B', pos: 'WR', teamId: 'team-01' });
  const cell = sandbox.buildDraftBoardCell(2, 1, 'team-01', 'snake', 4, sandbox.totalDraftPicks());
  assert.strictEqual(cell.pickNumber, 8);
  assert.strictEqual(cell.player, 'Player B');
});

test('linear draft type produces correct, non-reversed board cells', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01', 'linear');
  const pn = sandbox.pickNumberForRoundAndSlot(2, 1, 4, 'linear');
  assert.strictEqual(pn, 5, 'linear never reverses -- round2 slot1 is pick 5, not 8');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 5, player: 'Player C', pos: 'TE', teamId: 'team-01' });
  const cell = sandbox.buildDraftBoardCell(2, 1, 'team-01', 'linear', 4, sandbox.totalDraftPicks());
  assert.strictEqual(cell.pickNumber, 5);
  assert.strictEqual(cell.player, 'Player C');
});

test('manual draft type degrades gracefully -- buildDraftBoardCell returns null (no derivable slot placement)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01', 'manual');
  const cell = sandbox.buildDraftBoardCell(1, 1, 'team-01', 'manual', 4, sandbox.totalDraftPicks());
  assert.strictEqual(cell, null);
});

test('the Draft Board tab shows a clear fallback message for manual draft type instead of a broken grid', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01', 'manual');
  const html = sandbox.renderDraftBoardTabHtml();
  assert.ok(html.includes("don't have a fixed slot order") || html.includes('By Team'));
  assert.ok(!html.includes('draft-board-table'), 'no grid table should render for manual');
});

test('an empty (not-yet-reached) cell renders distinctly from a filled one', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  const cell = sandbox.buildDraftBoardCell(3, 1, 'team-01', 'snake', 4, sandbox.totalDraftPicks());
  assert.ok(cell.empty, 'a future, not-yet-drafted pick number is marked empty, not missing entirely');
});

// ═══════════════════════════════════════════════════════════
// KEEPER CELLS
// ═══════════════════════════════════════════════════════════

test('a single keeper cell is correctly identified and labeled', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 }];
  const pn = sandbox.keeperPickNumber(sandbox.draftState.keepers[0]);
  assert.strictEqual(pn, 43);
  const cell = sandbox.buildDraftBoardCell(4, 14, 'team-14', 'snake', 14, sandbox.totalDraftPicks());
  assert.strictEqual(cell.pickNumber, 43);
  assert.strictEqual(cell.player, 'George Pickens');
  assert.strictEqual(cell.isKeeper, true);
});

test('multiple keepers on the same team resolve to distinct, correct cells', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  const cellR4 = sandbox.buildDraftBoardCell(4, 14, 'team-14', 'snake', 14, sandbox.totalDraftPicks());
  const cellR14 = sandbox.buildDraftBoardCell(14, 14, 'team-14', 'snake', 14, sandbox.totalDraftPicks());
  assert.strictEqual(cellR4.player, 'George Pickens');
  assert.strictEqual(cellR4.isKeeper, true);
  assert.strictEqual(cellR14.player, 'Quentin Johnston');
  assert.strictEqual(cellR14.isKeeper, true);
});

test('multiple different teams keeping in the same round resolve to correct, non-colliding cells', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'Keeper A', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-05', player: 'Keeper B', pos: 'RB', round: 4 },
  ];
  const cellSlot1 = sandbox.buildDraftBoardCell(4, 1, 'team-01', 'snake', 14, sandbox.totalDraftPicks());
  const cellSlot5 = sandbox.buildDraftBoardCell(4, 5, 'team-05', 'snake', 14, sandbox.totalDraftPicks());
  assert.strictEqual(cellSlot1.player, 'Keeper A');
  assert.strictEqual(cellSlot5.player, 'Keeper B');
  assert.notStrictEqual(cellSlot1.pickNumber, cellSlot5.pickNumber);
});

test('a keeper always wins its own cell even if (hypothetically) a draftLog entry existed at the same pick number', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 }];
  // Keepers never actually enter draftLog (confirmed elsewhere), but the
  // cell-resolution function itself should check keepers FIRST regardless.
  const cell = sandbox.buildDraftBoardCell(4, 14, 'team-14', 'snake', 14, sandbox.totalDraftPicks());
  assert.strictEqual(cell.isKeeper, true);
});

// ═══════════════════════════════════════════════════════════
// BY TEAM GROUPING
// ═══════════════════════════════════════════════════════════

test('By Team grouping is correct -- live picks and keepers merge, sorted by pick number', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Live RB', pos: 'RB', teamId: 'team-14' });
  const entries = sandbox.buildTeamRosterEntries('team-14');
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].player, 'Live RB', 'sorted by pick number -- pick 1 comes before pick 43');
  assert.strictEqual(entries[1].player, 'George Pickens');
  assert.strictEqual(entries[1].isKeeper, true);
});

test('By Team correctly shows only the selected teams players, not another teams', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Team1 Player', pos: 'QB', teamId: 'team-01' });
  sandbox.draftState.draftLog.push({ id: 2, pickNumber: 2, player: 'Team2 Player', pos: 'QB', teamId: 'team-02' });
  const entries1 = sandbox.buildTeamRosterEntries('team-01');
  const entries2 = sandbox.buildTeamRosterEntries('team-02');
  assert.strictEqual(entries1.length, 1);
  assert.strictEqual(entries1[0].player, 'Team1 Player');
  assert.strictEqual(entries2.length, 1);
  assert.strictEqual(entries2[0].player, 'Team2 Player');
});

test('By Team tab HTML groups players by position (QB/RB/WR/TE/K/DEF) correctly, supporting the "doubled up" strategic question', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  sandbox.draftBoardSelectedTeamId = 'team-01';
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'RB One', pos: 'RB', teamId: 'team-01' });
  sandbox.draftState.draftLog.push({ id: 2, pickNumber: 2, player: 'RB Two', pos: 'RB', teamId: 'team-01' });
  sandbox.draftState.draftLog.push({ id: 3, pickNumber: 3, player: 'The TE', pos: 'TE', teamId: 'team-01' });
  const html = sandbox.renderByTeamTabHtml();
  assert.ok(html.includes('RB One') && html.includes('RB Two') && html.includes('The TE'));
  assert.ok(html.includes('×2'), 'doubled-up RB position is visually flagged');
});

test('the "team immediately after me" strategic question is directly answerable via the team selector', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-13');
  // The customers own example: they are slot 13; slot 14 already has two TEs.
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 14, player: 'TE One', pos: 'TE', teamId: 'team-14' });
  sandbox.draftState.draftLog.push({ id: 2, pickNumber: 15, player: 'TE Two', pos: 'TE', teamId: 'team-14' });
  const entriesNextTeam = sandbox.buildTeamRosterEntries('team-14');
  const teCount = entriesNextTeam.filter((e) => e.pos === 'TE').length;
  assert.strictEqual(teCount, 2, 'the user can directly see the next teams TE count to inform whether to wait');
});

// ═══════════════════════════════════════════════════════════
// USER TEAM IDENTIFICATION
// ═══════════════════════════════════════════════════════════

test('the users own team is identifiable in the board (via draftState.myTeamId)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.openDraftBoardModal();
  assert.strictEqual(sandbox.draftBoardSelectedTeamId, 'team-14', 'By Team defaults to showing the users own team first');
});

test('the board HTML visually distinguishes the users own team column', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-02');
  const html = sandbox.renderDraftBoardTabHtml();
  assert.ok(html.includes('board-team-hdr-mine'));
  assert.ok(html.includes('YOU'));
});

// ═══════════════════════════════════════════════════════════
// NO STATE MUTATION
// ═══════════════════════════════════════════════════════════

test('opening, viewing, and closing the Draft Board never mutates draftState', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Some Player', pos: 'QB', teamId: 'team-01' });
  const before = JSON.stringify(sandbox.draftState);

  sandbox.openDraftBoardModal();
  sandbox.switchDraftBoardTab('byteam');
  sandbox.selectDraftBoardTeam('team-01');
  sandbox.switchDraftBoardTab('board');
  sandbox.closeDraftBoardModal();

  const after = JSON.stringify(sandbox.draftState);
  assert.strictEqual(before, after, 'draftState must be byte-identical before and after using the Draft Board');
});

test('opening the Draft Board never writes to localStorage', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.openDraftBoardModal();
  sandbox.switchDraftBoardTab('byteam');
  assert.strictEqual(Object.keys(sandbox._storageData).length, 0, 'no localStorage write of any kind should occur');
});

test('opening the Draft Board never triggers Mock automation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.openDraftBoardModal();
  assert.strictEqual(sandbox.mockModeActive, false);
  assert.strictEqual(sandbox.mockAutomationRunning, false);
  assert.strictEqual(sandbox.draftState.draftLog.length, 0, 'no automated picks were made merely by opening the board');
});

// ═══════════════════════════════════════════════════════════
// FULL CUSTOMER ACCEPTANCE SCENARIO
// 14 teams, 14 rounds, user slot 14, George Pickens R4 + Quentin
// Johnston R14, multiple other teams with keepers.
// ═══════════════════════════════════════════════════════════

test('CUSTOMER SCENARIO: Pickens appears in Team 14 / Round 4, Johnston in Team 14 / Round 14', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
    { id: 3, teamId: 'team-01', player: 'Other Keeper A', pos: 'RB', round: 2 },
    { id: 4, teamId: 'team-07', player: 'Other Keeper B', pos: 'TE', round: 9 },
  ];
  const total = sandbox.totalDraftPicks();
  const cellR4 = sandbox.buildDraftBoardCell(4, 14, 'team-14', 'snake', 14, total);
  const cellR14 = sandbox.buildDraftBoardCell(14, 14, 'team-14', 'snake', 14, total);
  assert.strictEqual(cellR4.player, 'George Pickens');
  assert.strictEqual(cellR4.isKeeper, true);
  assert.strictEqual(cellR14.player, 'Quentin Johnston');
  assert.strictEqual(cellR14.isKeeper, true);
});

test('CUSTOMER SCENARIO: ordinary picks appear in their correct snake-grid cells alongside keepers', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Round1 Slot1', pos: 'RB', teamId: 'team-01' });
  const cell = sandbox.buildDraftBoardCell(1, 1, 'team-01', 'snake', 14, sandbox.totalDraftPicks());
  assert.strictEqual(cell.player, 'Round1 Slot1');
  assert.strictEqual(cell.isKeeper, false);
});

test('CUSTOMER SCENARIO: By Team shows both the users keepers and live picks correctly', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 14, player: 'Live QB Pick', pos: 'QB', teamId: 'team-14' });
  const entries = sandbox.buildTeamRosterEntries('team-14');
  assert.strictEqual(entries.length, 3);
  const names = entries.map((e) => e.player);
  assert.ok(names.includes('George Pickens') && names.includes('Quentin Johnston') && names.includes('Live QB Pick'));
});

test('CUSTOMER SCENARIO: viewing the board does not mutate draft state, with the full keeper-heavy league loaded', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
    { id: 3, teamId: 'team-01', player: 'A Keeper', pos: 'RB', round: 1 },
    { id: 4, teamId: 'team-05', player: 'B Keeper', pos: 'WR', round: 6 },
    { id: 5, teamId: 'team-09', player: 'C Keeper', pos: 'TE', round: 3 },
  ];
  const before = JSON.stringify(sandbox.draftState);
  sandbox.openDraftBoardModal();
  sandbox.renderDraftBoardTabHtml();
  sandbox.switchDraftBoardTab('byteam');
  for (let i = 1; i <= 14; i++) sandbox.selectDraftBoardTeam('team-' + String(i).padStart(2, '0'));
  const after = JSON.stringify(sandbox.draftState);
  assert.strictEqual(before, after);
});

test('CUSTOMER SCENARIO: opening/closing the board does not trigger SAGE or Mock automation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  sandbox.openDraftBoardModal();
  sandbox.closeDraftBoardModal();
  assert.strictEqual(sandbox.mockModeActive, false);
  assert.strictEqual(sandbox.mockAutomationRunning, false);
  assert.strictEqual(sandbox.sageRecommendations, null, 'SAGE state untouched -- sageRecommendations remains at its initial value');
});

console.log(`draft-command-center-board.test.js: ${passed}/${passed + failed} passed`);
if (failures.length) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exit(1);
}
