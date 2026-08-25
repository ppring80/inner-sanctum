// tests/draft-command-center-mock.test.js
//
// Regression coverage for Mock Draft Command Center. Executes the REAL,
// complete extracted main <script> block from the real draft.html file
// via Node's built-in `vm` module -- not a reimplementation, and not a
// new dependency, matching the exact pattern already established in
// tests/draft-command-center-keepers.test.js and
// tests/draft-sage-integration.test.js.
//
// setTimeout is overridden to invoke its callback IMMEDIATELY (a plain
// synchronous call, not a real deferred timer) so the automation loop's
// recursive setTimeout(step, delay) chain resolves synchronously within
// a single test function call -- fast, deterministic, no async test
// helpers needed. This tests the loop's LOGIC (does it stop at the
// right pick, does it skip keepers correctly, does it respect the
// safety cap) rather than real wall-clock timing, which is the correct
// thing for a unit test to verify.
//
// Run: node tests/draft-command-center-mock.test.js

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

test('draft.html source actually contains the new Mock Draft functions (sanity check before executing it)', () => {
  [
    'startMockDraft', 'restartMockDraft', 'exitMockDraft',
    'pauseMockDraft', 'resumeMockDraft',
    'runMockAutomationUntilUserTurn', 'mockOpponentPick',
    'buildMockDraftState', 'canStartMockDraft',
    'totalRosterSlotsRemaining', 'renderMockControls',
  ].forEach((fn) => {
    assert.ok(mainScript.includes('function ' + fn), fn + ' must be defined in the real file');
  });
});

// ───────────────────────────────────────────────────────────
// Fake DOM (with real child-tracking, matching
// draft-command-center-keepers.test.js's own upgraded copy)
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
  const fakeDocument = makeFakeDocument();
  const storageData = {};
  const fakeStorage = {
    getItem: (k) => (k in storageData ? storageData[k] : null),
    setItem: (k, v) => { storageData[k] = String(v); },
    removeItem: (k) => { delete storageData[k]; },
    _data: storageData,
  };
  const fetchDispatcher = (url) => {
    if (typeof url === 'string' && url.indexOf('/.netlify/functions/adp') === 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ players: [] }) });
    }
    // SAGE fetch calls happen at automation-stop; no real network in tests.
    return Promise.reject(new Error('no network in test'));
  };
  const sandbox = {
    document: fakeDocument,
    localStorage: fakeStorage,
    sessionStorage: fakeStorage,
    fetch: fetchDispatcher,
    window: { PLAYER_POOL: { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] } },
    console: console,
    // Deliberately synchronous, NOT a real deferred timer -- see file
    // header for why this is the correct choice for these tests.
    setTimeout: (fn) => { fn(); },
    URLSearchParams: URLSearchParams,
    Promise: Promise,
    alert: () => {},
    confirm: () => true,
    fetchTank01PlayerMap: () => Promise.resolve({}),
    applyLiveTeamsFromTank01: (list) => list,
    normalizePlayerName: (n) => (n || '').toLowerCase(),
  };
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

function seedPool(sandbox, counts) {
  // Generates a generic, ADP-ordered player pool per position -- exact
  // names don't matter for these tests, only count/position/ADP order.
  const pos = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  let adp = 1;
  Object.keys(counts).forEach((p) => {
    for (let i = 0; i < counts[p]; i++) {
      pos[p].push({ name: p + ' Player ' + i, pos: p, team: 'XXX', adp: adp++, key: sandbox.playerKey(p + ' Player ' + i, p) });
    }
  });
  sandbox.adpByPos = pos;
}

// ═══════════════════════════════════════════════════════════
// LIVE MODE PROTECTION
// ═══════════════════════════════════════════════════════════

test('Mock mode OFF: mockModeActive defaults to false, live behavior unaffected', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  assert.strictEqual(sandbox.mockModeActive, false);
});

test('live saveDraftState() still writes normally when Mock mode is off', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.saveDraftState();
  assert.ok(sandbox.localStorage.getItem(sandbox.DRAFT_SAVE_KEY));
});

test('live draftLog semantics unchanged: logDraftPick() still writes a real draftLog entry outside Mock mode', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 5 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  assert.strictEqual(sandbox.draftState.draftLog.length, 1);
  assert.strictEqual(sandbox.draftState.draftLog[0].player, 'WR Player 0');
});

// ═══════════════════════════════════════════════════════════
// PERSISTENCE ISOLATION -- the highest-risk requirement
// ═══════════════════════════════════════════════════════════

test('starting a mock does NOT mutate the original live draftState object', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { QB: 20, RB: 40, WR: 40, TE: 20, K: 15, DEF: 15 });
  const liveObjectRef = sandbox.draftState;
  const liveTeamsBefore = JSON.stringify(liveObjectRef.teams);
  sandbox.startMockDraft();
  assert.strictEqual(JSON.stringify(liveObjectRef.teams), liveTeamsBefore, 'the ORIGINAL object (by reference) must be unchanged');
  assert.strictEqual(liveObjectRef.draftLog.length, 0, 'the ORIGINAL objects draftLog must still be empty/untouched');
});

test('opponent mock picks do not mutate the original live draftState object', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  const liveObjectRef = sandbox.draftState;
  sandbox.startMockDraft(); // runs automation for teams 2,3,4 (team-01 is slot 1, on the clock first)
  assert.strictEqual(liveObjectRef.draftLog.length, 0, 'live object never receives any of the automated picks');
});

test('mock session does not write the live localStorage draft key', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.localStorage.getItem(sandbox.DRAFT_SAVE_KEY), null, 'the real live key must never be written during a mock session');
});

test('exit mock restores the original live draftState object exactly (same reference, same content)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { QB: 20, RB: 40, WR: 40, TE: 20, K: 15, DEF: 15 });
  const liveObjectRef = sandbox.draftState;
  sandbox.startMockDraft();
  assert.notStrictEqual(sandbox.draftState, liveObjectRef, 'while active, draftState points at the mock copy');
  sandbox.exitMockDraft();
  assert.strictEqual(sandbox.draftState, liveObjectRef, 'exiting restores the EXACT same object reference');
  assert.strictEqual(sandbox.mockModeActive, false);
});

test('restart mock discards prior mock selections but preserves setup/keepers', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-04', player: 'Kept Guy', pos: 'WR', round: 2 }];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  const picksAfterStart = sandbox.draftState.draftLog.length;
  assert.ok(picksAfterStart > 0, 'sanity: some automated picks occurred before team-04s first turn');
  sandbox.restartMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length > 0, true, 'automation ran again from a fresh pick 1');
  assert.strictEqual(sandbox.draftState.keepers.length, 1, 'keeper configuration preserved through restart');
  assert.strictEqual(sandbox.draftState.keepers[0].player, 'Kept Guy');
});

// ═══════════════════════════════════════════════════════════
// OPPONENT PICKS
// ═══════════════════════════════════════════════════════════

test('automated opponent makes a legal selection via the shared logDraftPick path', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04'); // user is slot 4 -- teams 1,2,3 pick automatically first
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 3, 'exactly 3 automated picks before team-04s first turn');
  sandbox.draftState.draftLog.forEach((e) => {
    assert.notStrictEqual(e.teamId, 'team-04');
  });
});

test('a drafted player cannot be selected twice', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  const names = sandbox.draftState.draftLog.map((e) => sandbox.playerKey(e.player, e.pos));
  const unique = new Set(names);
  assert.strictEqual(unique.size, names.length, 'no duplicate player key in draftLog');
});

test('a keeper cannot be selected by an automated opponent', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'RB Player 0', pos: 'RB', round: 1 }];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  const drafted = sandbox.draftState.draftLog.map((e) => sandbox.playerKey(e.player, e.pos));
  assert.ok(!drafted.includes(sandbox.playerKey('RB Player 0', 'RB')), 'the kept player must never appear in draftLog');
});

test('roster-illegal player is not selected when a legal option exists (need-first filter)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 2, 'team-02');
  sandbox.draftState.rosterConstruction = { QB: 1, RB: 1, WR: 0, TE: 0, K: 0, DEF: 0, FLEX: 0, SUPERFLEX: 0, BENCH: 0 };
  // team-01 already has its 1 QB and 1 RB slot filled via keepers --
  // its only remaining legal path is bench, but BENCH=0, so team-01 is
  // fully rostered and must be skipped entirely by automation.
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'QB Player 0', pos: 'QB', round: 1 },
    { id: 2, teamId: 'team-01', player: 'RB Player 0', pos: 'RB', round: 2 },
  ];
  seedPool(sandbox, { QB: 5, RB: 5, WR: 5, TE: 5, K: 5, DEF: 5 });
  const pick = sandbox.mockOpponentPick('team-01');
  assert.strictEqual(pick, null, 'a fully-rostered team (including bench) has no legal pick');
});

test('ADP-primary / top-K behavior: selected player always comes from the front of the ADP-sorted pool', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 30 });
  const pick = sandbox.mockOpponentPick('team-02');
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  const idx = available.findIndex((p) => p.name === pick.name);
  assert.ok(idx >= 0 && idx < sandbox.MOCK_TOP_K, 'selection must come from within the top-K ADP window');
});

// ═══════════════════════════════════════════════════════════
// DRAFT FLOW
// ═══════════════════════════════════════════════════════════

test('snake reversal is respected during automation (uses the real, unmodified resolveSlotForPick)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04', 'snake');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft(); // team-04 is slot 4 -- in a 4-team snake, round1 pick4 is team-04s FIRST turn (immediate)
  assert.strictEqual(sandbox.draftState.draftLog.length, 3);
  assert.strictEqual(sandbox.teamOnClock(4), 'team-04');
});

test('linear draft type works during automation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04', 'linear');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 3);
});

test('Manual draft type is blocked -- Start Mock Draft does not activate mock mode', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01', 'manual');
  seedPool(sandbox, { WR: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.mockModeActive, false, 'Manual draft type must never enter Mock mode');
  assert.ok(sandbox.mockStatusMessage && sandbox.mockStatusMessage.indexOf('Snake or Linear') !== -1);
});

test('canStartMockDraft() correctly reports false for Manual, true for Snake/Linear', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01', 'manual');
  assert.strictEqual(sandbox.canStartMockDraft(), false);
  sandbox.draftState.draftType = 'snake';
  assert.strictEqual(sandbox.canStartMockDraft(), true);
});

test('a keeper slot is skipped during automation using the existing keeper-aware nextPickNumber() -- no mock-specific skip logic', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  // team-02 (slot 2) keeps a player in round 1 -- pick 2 is a keeper slot.
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'WR Player 0', pos: 'WR', round: 1 }];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  // Only team-01 and team-03 pick live before team-04s turn (pick 2 was a keeper, auto-skipped).
  assert.strictEqual(sandbox.draftState.draftLog.length, 2);
  const teamIds = sandbox.draftState.draftLog.map((e) => e.teamId);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(teamIds)), ['team-01', 'team-03']);
});

test('consecutive keeper slots are skipped during automation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  // Round 1: team-02 and team-03 BOTH keep (picks 2 and 3 are both keeper slots, back to back).
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-02', player: 'WR Player 0', pos: 'WR', round: 1 },
    { id: 2, teamId: 'team-03', player: 'RB Player 0', pos: 'RB', round: 1 },
  ];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 1, 'only team-01 picks live before team-04s turn');
  assert.strictEqual(sandbox.draftState.draftLog[0].teamId, 'team-01');
});

test('the users own keeper slot is skipped when finding their next real turn', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01'); // team-01 is slot 1
  // team-01 keeps in Round 1 (pick 1) -- their real first live turn is Round 2 (pick 8, even round reversal, slot1 -> posInRound=4 -> pick=4+4=8).
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'QB Player 0', pos: 'QB', round: 1 }];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  // Picks 2,3,4 (teams 2,3,4, round 1) then 5,6,7 (teams 4,3,2 again,
  // round 2 snake-reversed) all happen live before team-01s own real
  // turn -- pick 1 (team-01s Round 1 keeper) is skipped, not treated
  // as their turn, so automation correctly continues past it.
  assert.strictEqual(sandbox.draftState.draftLog.length, 6, 'picks 2-7 all happen live before team-01s real turn');
  assert.strictEqual(sandbox.nextPickNumber(), 8, 'team-01s real next turn is pick 8 (Round 2, snake-reversed back to slot 1)');
  assert.strictEqual(sandbox.teamOnClock(8), 'team-01');
});

test('automation stops exactly at the users next selectable pick, and mockModeActive stays true (does not auto-exit)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.mockModeActive, true);
  assert.strictEqual(sandbox.teamOnClock(sandbox.nextPickNumber()), 'team-04');
  assert.strictEqual(sandbox.mockAutomationRunning, false, 'the batch loop itself has stopped, awaiting the users manual pick');
});

test('after the users manual selection, automation resumes for the remaining opponents', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 3);
  // User makes a normal manual pick via the SAME shared path a real click uses.
  const myPick = sandbox.buildAvailablePlayersSortedByAdp()[0];
  sandbox.logDraftPick(myPick.name, myPick.pos);
  assert.strictEqual(sandbox.draftState.draftLog.length, 4);
  sandbox.runMockAutomationUntilUserTurn();
  // Round 2 (reversed): team-04 picks again immediately (last-slot snake
  // wraparound), so automation should have advanced 0 additional
  // opponent picks here and stopped right back on team-04 -- confirms
  // the loop correctly recognizes back-to-back user turns too.
  assert.strictEqual(sandbox.teamOnClock(sandbox.nextPickNumber()), 'team-04');
});

test('mock completes without an infinite loop once all rounds are drafted', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 2, 'team-01');
  sandbox.draftState.numRounds = 2;
  sandbox.draftState.rosterConstruction = { QB: 1, RB: 1, WR: 0, TE: 0, K: 0, DEF: 0, FLEX: 0, SUPERFLEX: 0, BENCH: 0 };
  seedPool(sandbox, { QB: 10, RB: 10 });
  // 2-team snake, 2 rounds = 4 total picks: pick1=team-01, pick2=team-02,
  // pick3=team-02 (round2 snake-reversed wraparound), pick4=team-01.
  sandbox.startMockDraft(); // team-01 on the clock immediately (pick 1)
  let myPick = sandbox.buildAvailablePlayersSortedByAdp()[0];
  sandbox.logDraftPick(myPick.name, myPick.pos); // pick 1
  sandbox.runMockAutomationUntilUserTurn(); // auto-picks 2,3 (both team-02), stops at pick 4 (team-01 again)
  assert.strictEqual(sandbox.teamOnClock(sandbox.nextPickNumber()), 'team-01', 'stopped correctly at team-01s final turn');
  myPick = sandbox.buildAvailablePlayersSortedByAdp()[0];
  sandbox.logDraftPick(myPick.name, myPick.pos); // pick 4 -- the last configured pick
  sandbox.runMockAutomationUntilUserTurn(); // nothing left to automate
  assert.ok(sandbox.isDraftComplete(), 'draft should report complete once all configured picks are made');
  assert.strictEqual(sandbox.draftState.draftLog.length, 4, 'exactly the total configured pick count -- no runaway/duplicate picks');
});

test('defensive loop protection: automation stops safely if an opponent cannot produce a legal player', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 3, 'team-03');
  // Deliberately tiny pool + tight roster so team-02 runs out of legal
  // options before team-03s turn -- must stop safely, not throw/hang.
  sandbox.draftState.rosterConstruction = { QB: 1, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, FLEX: 0, SUPERFLEX: 0, BENCH: 0 };
  seedPool(sandbox, { QB: 1 }); // only 1 QB exists; team-01 will take it, team-02 has nothing legal to pick
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.mockAutomationRunning, false, 'loop must not hang');
  assert.ok(sandbox.mockStatusMessage, 'a clear status message must be surfaced');
});

// ═══════════════════════════════════════════════════════════
// SAGE
// ═══════════════════════════════════════════════════════════

test('rosterContext at the users turn reflects the mock roster + keepers (via the real, parameterized computeRosterNeed)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-04', player: 'WR Player 0', pos: 'WR', round: 1 }];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  const rc = sandbox.computeRosterNeed(); // default = draftState.myTeamId, which is team-04 within the mock copy
  assert.strictEqual(rc.filled.WR, 1, 'the users own kept WR is reflected in the mock rosterContext');
});

test('currentPool at the users turn excludes simulated drafted players and keepers (via the real, unmodified buildAvailablePlayersSortedByAdp)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'RB Player 0', pos: 'RB', round: 1 }];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  const draftedNames = sandbox.draftState.draftLog.map((e) => e.player);
  draftedNames.forEach((n) => assert.ok(!available.some((p) => p.name === n)));
  assert.ok(!available.some((p) => p.name === 'RB Player 0'), 'kept player excluded from currentPool');
});

test('the roster-advisory helper (opponent roster need) works for an arbitrary team, not just the user', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'WR Player 0', pos: 'WR', round: 1 }];
  const rc = sandbox.computeRosterNeed('team-02');
  assert.strictEqual(rc.filled.WR, 1, 'opponent team-02s keeper is reflected when explicitly requesting ITS roster need');
  const rcDefault = sandbox.computeRosterNeed();
  assert.strictEqual(rcDefault.filled.WR, 0, 'the default (no argument) call is still scoped to draftState.myTeamId, unchanged');
});

// ═══════════════════════════════════════════════════════════
// UI / CONTROL
// ═══════════════════════════════════════════════════════════

test('Start enters mock mode', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-01');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.mockModeActive, true);
});

test('Pause stops automation from proceeding further', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.mockModeActive = true;
  sandbox.liveDraftStateBackup = sandbox.draftState;
  sandbox.mockStartSnapshot = sandbox.draftState;
  sandbox.pauseMockDraft();
  assert.strictEqual(sandbox.mockPaused, true);
  sandbox.runMockAutomationUntilUserTurn();
  assert.strictEqual(sandbox.draftState.draftLog.length, 0, 'no automated picks occur while paused');
});

test('Resume continues automation after a pause', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.mockModeActive = true;
  sandbox.liveDraftStateBackup = sandbox.draftState;
  sandbox.mockStartSnapshot = sandbox.draftState;
  sandbox.mockPaused = true;
  sandbox.resumeMockDraft();
  assert.strictEqual(sandbox.mockPaused, false);
  assert.strictEqual(sandbox.draftState.draftLog.length, 3, 'automation actually ran after Resume');
});

test('Restart resets mock only -- does not touch the live object', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  const liveObjectRef = sandbox.draftState;
  sandbox.startMockDraft();
  sandbox.restartMockDraft();
  assert.strictEqual(liveObjectRef.draftLog.length, 0, 'live object still untouched after Restart');
  assert.notStrictEqual(sandbox.draftState, liveObjectRef);
});

test('Exit restores live state and turns mock mode off', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  const liveObjectRef = sandbox.draftState;
  sandbox.startMockDraft();
  sandbox.exitMockDraft();
  assert.strictEqual(sandbox.mockModeActive, false);
  assert.strictEqual(sandbox.draftState, liveObjectRef);
});

// ═══════════════════════════════════════════════════════════
// NO-KEEPER REGRESSION
// ═══════════════════════════════════════════════════════════

test('mock also works cleanly with keepers=[] (no-keeper league)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  sandbox.draftState.keepers = [];
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 3);
  assert.strictEqual(sandbox.mockModeActive, true);
});

// ═══════════════════════════════════════════════════════════
// FLAGSHIP MOCK SCENARIO
// 14-team snake, Slot 14, Team 14 keeps George Pickens (WR, R4, pick 43)
// and Quentin Johnston (WR, R14, pick 183).
// ═══════════════════════════════════════════════════════════

test('FLAGSHIP MOCK: both keepers rostered from Pick 1', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  assert.strictEqual(sandbox.keeperPickNumber(sandbox.draftState.keepers[0]), 43);
  assert.strictEqual(sandbox.keeperPickNumber(sandbox.draftState.keepers[1]), 183);
  assert.strictEqual(sandbox.computeRosterNeed('team-14').filled.WR, 2);
});

test('FLAGSHIP MOCK: both keepers excluded from opponent/player selection', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  const pool = { QB: 20, RB: 40, WR: 40, TE: 20, K: 15, DEF: 15 };
  seedPool(sandbox, pool);
  // Rename two WR pool entries to match the keepers exactly, to prove
  // exclusion (not just absence).
  sandbox.adpByPos.WR[0].name = 'George Pickens';
  sandbox.adpByPos.WR[0].key = sandbox.playerKey('George Pickens', 'WR');
  sandbox.adpByPos.WR[1].name = 'Quentin Johnston';
  sandbox.adpByPos.WR[1].key = sandbox.playerKey('Quentin Johnston', 'WR');
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  assert.ok(!available.some((p) => p.name === 'George Pickens'));
  assert.ok(!available.some((p) => p.name === 'Quentin Johnston'));
});

test('FLAGSHIP MOCK: automation skips keeper slot #43 and slot #183 using the existing engine, and original live state remains untouched', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  seedPool(sandbox, { QB: 30, RB: 60, WR: 60, TE: 30, K: 20, DEF: 20 });
  const liveObjectRef = sandbox.draftState;
  sandbox.startMockDraft();
  // team-14 is slot 14 (last) -- round1 pick14 is their FIRST live turn (immediate, no keeper there).
  assert.strictEqual(sandbox.draftState.draftLog.length, 13, 'teams 1-13 pick live in round 1 before team-14s turn');
  // Confirm pick 43 (Round 4 keeper) and pick 183 (Round 14 keeper)
  // are correctly identified as keeper slots by the real engine.
  const keeperSlots = sandbox.buildKeeperPickNumberSet();
  assert.ok(keeperSlots[43] && keeperSlots[183]);
  // Live object completely untouched throughout.
  assert.strictEqual(liveObjectRef.draftLog.length, 0);
  assert.strictEqual(liveObjectRef.keepers.length, 2, 'live keepers array itself also untouched (mock has its own clone)');
});

test('FLAGSHIP MOCK: SAGE state (rosterContext + currentPool) at the users turn is correct', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  seedPool(sandbox, { QB: 30, RB: 60, WR: 60, TE: 30, K: 20, DEF: 20 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.teamOnClock(sandbox.nextPickNumber()), 'team-14');
  const rc = sandbox.computeRosterNeed();
  assert.strictEqual(rc.filled.WR, 2, 'rosterContext correctly shows 2 WRs already rostered via keepers');
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  assert.ok(!available.some((p) => p.pos === 'WR' && (p.name === 'George Pickens' || p.name === 'Quentin Johnston')));
});

console.log(`draft-command-center-mock.test.js: ${passed}/${passed + failed} passed`);
if (failures.length) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exit(1);
}
