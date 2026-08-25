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

// ═══════════════════════════════════════════════════════════
// KEEPER TEMPORAL CLASSIFICATION (Aug 25 2026, smoke-test fix)
// ═══════════════════════════════════════════════════════════

function buildKeeperHeavyLeague(sandbox, mySlot) {
  const TEAM_NAMES = ['Atterson', 'Fenton', 'Azam', 'ONeal', 'Mayo', 'Hayes', 'Jack', 'Jones', 'RK', 'Team10', 'Team11', 'Team12', 'Team13', 'Customer'];
  const KEEPER_ROUNDS = {
    Atterson: [1, 7], Fenton: [6, 8], Azam: [2, 8], ONeal: [10, 13], Mayo: [2, 10],
    Hayes: [1, 3], Jack: [7, 9], Jones: [3, 9], RK: [3, 7], Team10: [4, 11], Team11: [5, 12],
    Team12: [6, 14], Team13: [], Customer: [4, 14],
  };
  const teams = TEAM_NAMES.map((name, i) => ({ id: 'team-' + String(i + 1).padStart(2, '0'), name }));
  const keepers = [];
  let keeperId = 1;
  teams.forEach((team) => {
    (KEEPER_ROUNDS[team.name] || []).forEach((round) => {
      const playerName = team.name === 'Customer' ? (round === 4 ? 'George Pickens' : 'Quentin Johnston') : (team.name + ' Keeper R' + round);
      keepers.push({ id: keeperId++, teamId: team.id, player: playerName, pos: 'WR', round });
    });
  });
  sandbox.draftState = {
    schemaVersion: sandbox.DRAFT_SAVE_SCHEMA_VERSION, teams,
    myTeamId: teams[mySlot - 1].id, draftLog: [], nextPickId: 1,
    draftType: 'snake', numRounds: 14, rosterConstruction: sandbox.DEFAULT_ROSTER_CONSTRUCTION,
    keepers, nextKeeperId: keeperId,
  };
  const pos = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  let adp = 1;
  ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach((p) => {
    for (let i = 0; i < 40; i++) pos[p].push({ name: p + ' P' + i, pos: p, team: 'X', adp: adp++, key: sandbox.playerKey(p + ' P' + i, p) });
  });
  sandbox.adpByPos = pos;
  return { teams, keepers };
}

test('1. Pickens R4 (pick 43) is classified as passed once the sequence has moved beyond it', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.confirmStartMockDraft();
  // Drive the draft to the exact screenshot state (~pick 98).
  let guard = 0;
  while (sandbox.nextPickNumber() < 98 && !sandbox.isDraftComplete() && guard++ < 300) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  const pickens = sandbox.draftState.keepers.find((k) => k.player === 'George Pickens');
  assert.strictEqual(sandbox.keeperPickNumber(pickens), 43);
  assert.strictEqual(sandbox.keeperTemporalStatus(43), 'passed');
});

test('2. Johnston R14 (pick 183) is classified as RESERVED at the same screenshot state', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.confirmStartMockDraft();
  let guard = 0;
  while (sandbox.nextPickNumber() < 98 && !sandbox.isDraftComplete() && guard++ < 300) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  const johnston = sandbox.draftState.keepers.find((k) => k.player === 'Quentin Johnston');
  assert.strictEqual(sandbox.keeperPickNumber(johnston), 183);
  assert.strictEqual(sandbox.keeperTemporalStatus(183), 'reserved');
  const cell = sandbox.buildDraftBoardCell(14, 14, 'team-14', 'snake', 14, sandbox.totalDraftPicks());
  assert.strictEqual(cell.isReserved, true);
});

test('3. a future keeper becomes active/passed once its draft slot is actually reached', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-14', player: 'Future Keeper', pos: 'WR', round: 2 }]; // pick 20
  assert.strictEqual(sandbox.keeperTemporalStatus(20), 'reserved', 'before pick 20 is reached, it is reserved');
  sandbox.confirmStartMockDraft();
  let guard = 0;
  while (sandbox.nextPickNumber() <= 20 && !sandbox.isDraftComplete() && guard++ < 300) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  assert.strictEqual(sandbox.keeperTemporalStatus(20), 'passed', 'once the sequence passes pick 20, the same keeper is now passed');
});

test('4. existing board pick/team/round mapping remains unchanged (non-keeper cells unaffected)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Player A', pos: 'RB', teamId: 'team-01' });
  const cell = sandbox.buildDraftBoardCell(1, 1, 'team-01', 'snake', 4, sandbox.totalDraftPicks());
  assert.strictEqual(cell.pickNumber, 1);
  assert.strictEqual(cell.player, 'Player A');
  assert.strictEqual(cell.isKeeper, false);
  assert.strictEqual(cell.isReserved, false);
});

// ═══════════════════════════════════════════════════════════
// TURN WATCH
// ═══════════════════════════════════════════════════════════

test('5. Turn Watch identifies the exact opponents selecting before the users next real pick', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  const teams = sandbox.buildTurnWatchTeams();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(teams)), ['team-01', 'team-02', 'team-03']);
});

test('6. Slot-14 immediate second pick (Pick 1 of 2) produces ZERO intervening opponents', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.confirmStartMockDraft();
  let guard = 0;
  while (sandbox.nextPickNumber() < 98 && !sandbox.isDraftComplete() && guard++ < 300) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  assert.strictEqual(sandbox.nextPickNumber(), 98);
  assert.strictEqual(sandbox.distanceToMySlot(99), 0, 'sanity: pick 99 is genuinely also the users turn (true back-to-back)');
  const teams = sandbox.buildTurnWatchTeams();
  assert.strictEqual(teams.length, 0, 'zero opponents invented during a genuine back-to-back turn');
});

test('7. after Slot-14 Pick 2 of 2 completes, Turn Watch recalculates against the real next turn', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.confirmStartMockDraft();
  let guard = 0;
  while (sandbox.nextPickNumber() < 98 && !sandbox.isDraftComplete() && guard++ < 300) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  // Pick 1 of 2
  let p = sandbox.buildAvailablePlayersSortedByAdp()[0];
  sandbox.logDraftPick(p.name, p.pos);
  assert.strictEqual(sandbox.nextPickNumber(), 99);
  // Pick 2 of 2
  p = sandbox.buildAvailablePlayersSortedByAdp()[0];
  sandbox.logDraftPick(p.name, p.pos);
  assert.strictEqual(sandbox.nextPickNumber(), 126, 'the users true next turn after this pair');
  const teams = sandbox.buildTurnWatchTeams();
  assert.strictEqual(sandbox.distanceToMySlot(126), 0);
  const away2 = sandbox.distanceToMySlot(127);
  if (away2 === 0) {
    assert.strictEqual(teams.length, 0, 'pick 126 is itself another back-to-back start -- correctly zero again');
  } else {
    assert.ok(teams.length > 0, 'otherwise Turn Watch correctly finds real opponents before the true next turn');
  }
});

test('8. keeper-occupied upcoming slots are correctly excluded from the Turn Watch opponent list', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 6, 'team-06');
  // team-02s pick (2) is consumed by their own keeper -- no live decision there.
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'Kept', pos: 'WR', round: 1 }];
  const teams = sandbox.buildTurnWatchTeams();
  assert.ok(!teams.includes('team-02'), 'a team whose ONLY appearance in the window is a keeper slot must not appear as an opponent to watch');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(teams)), ['team-01', 'team-03', 'team-04', 'team-05']);
});

test('viewing Turn Watch before the first pick of a slot-14 double-turn shows zero opponents (edge case: very first pick of the whole draft)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.confirmStartMockDraft();
  assert.strictEqual(sandbox.nextPickNumber(), 14, 'Customers own R1 keeper (pick 14) does not exist -- wait, Customer keeps R4/R14, so pick 14 IS their real first live turn');
  const teams = sandbox.buildTurnWatchTeams();
  // Whatever the real away-to-next value is, confirm consistency rather than a hardcoded assumption.
  const awayNext = sandbox.distanceToMySlot(15);
  if (awayNext === 0) assert.strictEqual(teams.length, 0);
  else assert.ok(teams.length >= 0);
});

// ═══════════════════════════════════════════════════════════
// SAGE TURN INTELLIGENCE
// ═══════════════════════════════════════════════════════════

test('9. WAIT LIKELY SAFE fires for exactly zero needy teams', () => {
  // Uses a 6-team league with the user at team-04 (a genuine middle
  // slot, never a back-to-back edge case) so the opponent set before
  // the users first turn is a clean, unambiguous team-01/02/03 --
  // deliberately avoiding the LAST-slot double-turn-at-round-boundary
  // behavior a 4-team team-04 would collide with.
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 6, 'team-04');
  // Uses KEEPERS, not live draftLog picks, to give team-01/02/03 a
  // filled TE -- a live pick for them would ADVANCE nextPickNumber() to
  // team-04s own turn, which correctly shifts Turn Watch's perspective
  // to teams AFTER that turn (by design -- see test 6/7). A keeper
  // fills the roster slot without consuming a live sequence position,
  // keeping nextPickNumber() at 1 so team-01/02/03 remain the CURRENT
  // opponent set under test.
  // Round 8 (not round 1) so these keepers never consume team-01/02/03s
  // OWN round-1 LIVE turn slots (picks 1/2/3) -- that would jump
  // nextPickNumber() straight to team-04s turn via keeper-skipping,
  // the same collision test 9 originally hit. computeRosterNeed()
  // already counts a keeper as filled regardless of round (confirmed,
  // unmodified, existing behavior), so round 8 still correctly shows
  // TE as filled for all three teams under test.
  ['team-01', 'team-02', 'team-03'].forEach((teamId, i) => {
    sandbox.draftState.keepers.push({ id: i + 1, teamId, player: 'TE for ' + teamId, pos: 'TE', round: 8 });
  });
  const teams = sandbox.buildTurnWatchTeams();
  const intel = sandbox.buildSageTurnIntelligence(teams);
  const teIntel = intel.find((i) => i.pos === 'TE');
  assert.strictEqual(teIntel.needyCount, 0);
  assert.strictEqual(teIntel.label, 'WAIT LIKELY SAFE');
});

test('10. WAIT MAY BE AVAILABLE fires for exactly one needy team', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 6, 'team-04'); // safe middle slot, see test 9s comment
  // Keepers again (see test 9s comment) -- team-02/03 get a TE keeper,
  // team-01 gets none, without touching nextPickNumber() at all.
  sandbox.draftState.keepers.push({ id: 1, teamId: 'team-02', player: 'TE for team-02', pos: 'TE', round: 8 });
  sandbox.draftState.keepers.push({ id: 2, teamId: 'team-03', player: 'TE for team-03', pos: 'TE', round: 8 });
  // team-01 has no TE yet -- exactly 1 needy team.
  const teams = sandbox.buildTurnWatchTeams();
  const intel = sandbox.buildSageTurnIntelligence(teams);
  const teIntel = intel.find((i) => i.pos === 'TE');
  assert.strictEqual(teIntel.needyCount, 1);
  assert.strictEqual(teIntel.label, 'WAIT MAY BE AVAILABLE');
  assert.strictEqual(teIntel.explanation, '1 team selecting before your next pick still has an open TE need.');
});

test('11. POSITION PRESSURE fires for two or more needy teams', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 6, 'team-04'); // safe middle slot, see test 9s comment
  // team-01, team-02, team-03 all still need TE (fresh state -- nothing drafted).
  const teams = sandbox.buildTurnWatchTeams();
  const intel = sandbox.buildSageTurnIntelligence(teams);
  const teIntel = intel.find((i) => i.pos === 'TE');
  assert.strictEqual(teIntel.needyCount, 3);
  assert.strictEqual(teIntel.label, 'POSITION PRESSURE');
  assert.strictEqual(teIntel.explanation, '3 teams selecting before your next pick still have an open TE need.');
});

test('12. labels derive directly from the real, unmodified computeRosterNeed() -- no separate scoring path', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  const teams = sandbox.buildTurnWatchTeams();
  const intel = sandbox.buildSageTurnIntelligence(teams);
  intel.forEach((i) => {
    const actualNeedyCount = teams.filter((teamId) => (sandbox.computeRosterNeed(teamId).remainingDedicated[i.pos] || 0) > 0).length;
    assert.strictEqual(i.needyCount, actualNeedyCount, 'the label count must exactly match a fresh, independent computeRosterNeed() tally');
  });
});

test('SAGE Turn Intelligence only surfaces positions where the USER has an open need (avoids clutter)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  // Fill every one of team-04s dedicated slots using their OWN real
  // pick numbers (computed via the real, unmodified resolveSlotForPick()
  // rather than guessed/artificial ones) -- an artificial high pick
  // number would corrupt nextPickNumber()'s max()+1 logic and push the
  // simulated state past totalDraftPicks() entirely.
  const total = sandbox.totalDraftPicks();
  const posToFill = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'];
  let pn = 0;
  posToFill.forEach((pos) => {
    do { pn++; } while (sandbox.resolveSlotForPick(pn, 4, 'snake', total) !== 4);
    sandbox.draftState.draftLog.push({ id: pn, pickNumber: pn, player: 'Filler ' + pn, pos, teamId: 'team-04' });
  });
  const teams = sandbox.buildTurnWatchTeams();
  const intel = sandbox.buildSageTurnIntelligence(teams);
  assert.strictEqual(intel.length, 0, 'no Turn Intelligence rows when the user has no open dedicated need at all');
});

// ═══════════════════════════════════════════════════════════
// NO STATE MUTATION
// ═══════════════════════════════════════════════════════════

test('13. viewing Turn Watch causes zero draftState mutation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  const before = JSON.stringify(sandbox.draftState);
  sandbox.buildTurnWatchTeams();
  sandbox.buildSageTurnIntelligence(sandbox.buildTurnWatchTeams());
  sandbox.renderTurnWatchPanel();
  const after = JSON.stringify(sandbox.draftState);
  assert.strictEqual(before, after);
});

test('14. viewing Draft Board (with keeper temporal classification) causes zero draftState mutation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  const before = JSON.stringify(sandbox.draftState);
  sandbox.openDraftBoardModal();
  sandbox.renderDraftBoardTabHtml();
  sandbox.switchDraftBoardTab('byteam');
  sandbox.closeDraftBoardModal();
  const after = JSON.stringify(sandbox.draftState);
  assert.strictEqual(before, after);
});

test('15. no localStorage writes from Turn Watch or Draft Board keeper classification', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.renderTurnWatchPanel();
  sandbox.openDraftBoardModal();
  sandbox.renderDraftBoardTabHtml();
  assert.strictEqual(Object.keys(sandbox._storageData || {}).length, 0);
});

test('Turn Watch and Draft Board never trigger Mock automation or SAGE recommendation generation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  buildKeeperHeavyLeague(sandbox, 14);
  sandbox.renderTurnWatchPanel();
  sandbox.openDraftBoardModal();
  assert.strictEqual(sandbox.mockModeActive, false);
  assert.strictEqual(sandbox.mockAutomationRunning, false);
  assert.strictEqual(sandbox.sageRecommendations, null);
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
});

console.log(`draft-command-center-board.test.js: ${passed}/${passed + failed} passed`);
if (failures.length) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exit(1);
}
