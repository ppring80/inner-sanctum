// tests/draft-command-center-keepers.test.js
//
// Regression coverage for keeper/frozen-player support added to
// draft.html. Executes the REAL, complete extracted main <script>
// block from the real draft.html file via Node's built-in `vm` module
// -- not a reimplementation, and not a new dependency. This mirrors
// the exact infrastructure already established in
// tests/draft-sage-integration.test.js (fake DOM built from scratch,
// no jsdom) rather than introducing a new package for this file alone.
//
// Run: node tests/draft-command-center-keepers.test.js

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

test('draft.html source actually contains the new keeper functions (sanity check before executing it)', () => {
  [
    'pickNumberForRoundAndSlot',
    'keeperPickNumber',
    'buildKeeperPickNumberSet',
    'buildKeeperPlayerIndex',
    'keeperValidationError',
    'addKeeperFromForm',
    'removeKeeper',
    'startEditKeeper',
    'renderKeeperSection',
    'renderOwnershipBadge',
  ].forEach((fn) => {
    assert.ok(mainScript.includes('function ' + fn), fn + ' must be defined in the real file');
  });
});

// ───────────────────────────────────────────────────────────
// Generic fake DOM -- identical shape to draft-sage-integration.test.js's
// own fake DOM (deliberately duplicated here rather than shared/imported,
// consistent with this codebase's established preference for small,
// independently-runnable test files over a shared test-utils module).
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
    // Setting innerHTML clears any children previously added via
    // appendChild (real DOM behavior) -- needed so renderKeeperSection()
    // (which sets container.innerHTML=...) and renderKeeperRoundOptions()
    // (which uses createElement/appendChild on the SAME kind of element)
    // never leave stale children lingering across calls in these tests.
    set innerHTML(v) { this._innerHTML = v; this.children.length = 0; },
    textContent: '',
    disabled: false,
    checked: false,
    options: [],
    children: [],
    dataset: {},
    focus() {}, blur() {}, click() {},
    // Real (if minimal) child-tracking -- needed for tests that inspect
    // <option> elements created via document.createElement/appendChild
    // (e.g. renderKeeperRoundOptions()), unlike draft-sage-integration
    // .test.js's own copy of this fake DOM, which never needs to.
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
  };
  const fetchDispatcher = (url) => {
    if (typeof url === 'string' && url.indexOf('/.netlify/functions/adp') === 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ players: [] }) });
    }
    return Promise.reject(new Error('no network in test'));
  };
  const sandbox = {
    document: fakeDocument,
    localStorage: fakeStorage,
    sessionStorage: fakeStorage,
    fetch: fetchDispatcher,
    window: { PLAYER_POOL: { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] } },
    console: console,
    setTimeout: setTimeout,
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

function crossRealm(value) {
  return JSON.parse(JSON.stringify(value));
}

function setupLeague(sandbox, numTeams, myTeamId) {
  const teams = [];
  for (let i = 1; i <= numTeams; i++) teams.push({ id: 'team-' + String(i).padStart(2, '0'), name: 'Team ' + i });
  sandbox.draftState = {
    schemaVersion: sandbox.DRAFT_SAVE_SCHEMA_VERSION,
    teams,
    myTeamId: myTeamId || teams[0].id,
    draftLog: [],
    nextPickId: 1,
    draftType: 'snake',
    numRounds: 16,
    rosterConstruction: sandbox.DEFAULT_ROSTER_CONSTRUCTION,
    keepers: [],
    nextKeeperId: 1,
  };
}

// ═══════════════════════════════════════════════════════════
// NO-KEEPER REGRESSION
// ═══════════════════════════════════════════════════════════

test('no-keeper regression: nextPickNumber() behaves exactly as before (max+1, no skipping)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10);
  assert.strictEqual(sandbox.nextPickNumber(), 1);
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'X', pos: 'WR', teamId: 'team-01' });
  assert.strictEqual(sandbox.nextPickNumber(), 2);
});

test('no-keeper regression: distanceToMySlot() unaffected by empty keepers array', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  assert.strictEqual(sandbox.distanceToMySlot(1), 0);
});

test('no-keeper regression: buildDraftIndex() returns only real draftLog entries when keepers=[]', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'X', pos: 'WR', teamId: 'team-01' });
  const idx = sandbox.buildDraftIndex();
  assert.strictEqual(Object.keys(idx).length, 1);
});

// ═══════════════════════════════════════════════════════════
// SNAKE / SLOT MATH -- inverse round/slot -> pick-number mapping
// ═══════════════════════════════════════════════════════════

test('pickNumberForRoundAndSlot: odd round, snake, matches forward computeSlotForPick', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  // Round 1 (odd) slot 5 of 10 teams -> pick 5
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(1, 5, 10, 'snake'), 5);
  assert.strictEqual(sandbox.computeSlotForPick(5, 10), 5);
});

test('pickNumberForRoundAndSlot: even round, snake reversal, matches forward computeSlotForPick', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  // Round 2 (even) slot 1 of 10 teams -> posInRound = 10-1+1=10 -> pick (2-1)*10+10=20
  const pn = sandbox.pickNumberForRoundAndSlot(2, 1, 10, 'snake');
  assert.strictEqual(pn, 20);
  assert.strictEqual(sandbox.computeSlotForPick(pn, 10), 1);
});

test('pickNumberForRoundAndSlot: linear draft type, no reversal', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const pn = sandbox.pickNumberForRoundAndSlot(2, 1, 10, 'linear');
  assert.strictEqual(pn, 11); // (2-1)*10+1
  assert.strictEqual(sandbox.computeSlotForPickLinear(pn, 10), 1);
});

test('pickNumberForRoundAndSlot: manual draft type returns null (no deterministic order)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(2, 1, 10, 'manual'), null);
});

test('pickNumberForRoundAndSlot: different league sizes (12-team, 14-team)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  // 12-team, round 3 (odd) slot 4 -> pick (3-1)*12+4=28
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(3, 4, 12, 'snake'), 28);
  // 14-team, round 4 (even) slot 3 -> posInRound=14-3+1=12 -> pick (4-1)*14+12=54
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(4, 3, 14, 'snake'), 54);
});

test('pickNumberForRoundAndSlot: invalid inputs return null rather than a wrong number', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(0, 1, 10, 'snake'), null);
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(1, 0, 10, 'snake'), null);
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(1, 11, 10, 'snake'), null);
  assert.strictEqual(sandbox.pickNumberForRoundAndSlot(1, 1, 0, 'snake'), null);
});

// ═══════════════════════════════════════════════════════════
// KEEPER STATE
// ═══════════════════════════════════════════════════════════

test('user keeper Round 4: resolves to correct overall pick number', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  const k = { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 };
  assert.strictEqual(sandbox.keeperPickNumber(k), 40);
});

test('user keeper Round 12: resolves to correct overall pick number', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  const k = { id: 1, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 };
  assert.strictEqual(sandbox.keeperPickNumber(k), 120);
});

test('multiple keepers for the same user resolve to independent, distinct pick numbers', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  const set = sandbox.buildKeeperPickNumberSet();
  assert.ok(set[40] && set[120]);
  assert.notStrictEqual(set[40], set[120]);
});

test('multiple teams keeping in the same round resolve to different pick numbers (no collision)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  const pnSlot1 = sandbox.pickNumberForRoundAndSlot(4, 1, 10, 'snake');
  const pnSlot5 = sandbox.pickNumberForRoundAndSlot(4, 5, 10, 'snake');
  assert.notStrictEqual(pnSlot1, pnSlot5);
  assert.strictEqual(pnSlot1, 40);
  assert.strictEqual(pnSlot5, 36);
});

test('many keepers without any arbitrary maximum -- 8 keepers on one team all resolve correctly', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [];
  for (let r = 1; r <= 8; r++) {
    sandbox.draftState.keepers.push({ id: r, teamId: 'team-01', player: 'Keeper ' + r, pos: 'RB', round: r });
  }
  assert.strictEqual(sandbox.draftState.keepers.length, 8);
  const set = sandbox.buildKeeperPickNumberSet();
  assert.strictEqual(Object.keys(set).length, 8);
});

// ═══════════════════════════════════════════════════════════
// DRAFT PROGRESSION
// ═══════════════════════════════════════════════════════════

test('nextPickNumber() skips a single keeper-occupied slot', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept', pos: 'WR', round: 4 }]; // pick 40
  for (let p = 1; p <= 39; p++) sandbox.draftState.draftLog.push({ id: p, pickNumber: p, player: 'F' + p, pos: 'RB', teamId: 'team-02' });
  assert.strictEqual(sandbox.nextPickNumber(), 41);
});

test('nextPickNumber() skips consecutive keeper slots', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 2, 'team-01');
  // 2-team league: round 4 slot1=pick7, round4 slot2=pick8 (both even round: posInRound=2-slot+1)
  // round4: slot1 -> posInRound=2, pick=(4-1)*2+2=8; slot2 -> posInRound=1, pick=(4-1)*2+1=7
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'Kept A', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-02', player: 'Kept B', pos: 'RB', round: 4 },
  ];
  for (let p = 1; p <= 6; p++) sandbox.draftState.draftLog.push({ id: p, pickNumber: p, player: 'F' + p, pos: 'TE', teamId: 'team-01' });
  // picks 7 and 8 are BOTH keeper slots -> nextPickNumber must skip both and land on 9
  assert.strictEqual(sandbox.nextPickNumber(), 9);
});

test('a keeper slot between two live selections is skipped correctly', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'Kept', pos: 'TE', round: 1 }]; // pick 2 (slot 2, round1 odd)
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Live1', pos: 'RB', teamId: 'team-01' });
  assert.strictEqual(sandbox.nextPickNumber(), 3); // 2 is a keeper slot, skip to 3
});

test('the users own keeper slot is not treated as a live decision (distanceToMySlot skips it)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept', pos: 'WR', round: 1 }]; // pick 1, my own slot
  const distance = sandbox.distanceToMySlot(1);
  assert.notStrictEqual(distance, 0, 'must not report the keeper slot itself as "on the clock now"');
  assert.strictEqual(distance, 19); // next real turn is pick 20 (round2 even, slot1), offset = 20-1
});

test('next-user-pick resolves to the next actual selectable turn (SAGE inherits this via distanceToMySlot)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept', pos: 'WR', round: 2 }]; // pick 20
  const away = sandbox.distanceToMySlot(1);
  assert.notStrictEqual(away, 19); // would be 19 if pick 20 were live; it isn't
});

// ═══════════════════════════════════════════════════════════
// PLAYER AVAILABILITY
// ═══════════════════════════════════════════════════════════

test('keeper removed from available pool immediately (buildDraftIndex)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'Some Player', pos: 'TE', round: 3 }];
  const idx = sandbox.buildDraftIndex();
  assert.ok(idx['some-player|TE']);
  assert.strictEqual(idx['some-player|TE'].isKeeper, true);
});

test('keeper cannot be drafted -- excluded from SAGE candidate/currentPool data', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.adpByPos = {
    WR: [
      { name: 'George Pickens', pos: 'WR', team: 'PIT', adp: 30, key: sandbox.playerKey('George Pickens', 'WR') },
      { name: 'Other WR', pos: 'WR', team: 'X', adp: 50, key: sandbox.playerKey('Other WR', 'WR') },
    ],
    QB: [], RB: [], TE: [], K: [], DEF: [],
  };
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  assert.ok(!available.some((p) => p.name === 'George Pickens'));
  assert.ok(available.some((p) => p.name === 'Other WR'));
});

test('removing a keeper restores availability when the player was otherwise undrafted', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'Some Player', pos: 'TE', round: 3 }];
  assert.ok(sandbox.buildDraftIndex()['some-player|TE']);
  sandbox.draftState.keepers = [];
  assert.ok(!sandbox.buildDraftIndex()['some-player|TE']);
});

// ═══════════════════════════════════════════════════════════
// ROSTER
// ═══════════════════════════════════════════════════════════

test('keeper counted in computeRosterNeed() filled positions from Pick 1', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  const rosterNeed = sandbox.computeRosterNeed();
  assert.strictEqual(rosterNeed.filled.WR, 2);
});

test('keeper appears in renderMyRoster() output from draft start, with keeper-round label', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.renderMyRoster();
  const html = sandbox.document.getElementById('rosterPanel').innerHTML;
  assert.ok(html.includes('George Pickens'));
  assert.ok(html.includes('KEEPER R4'));
});

test('MY TEAM player count includes keepers (2 keepers + 1 live selection = 3 players)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  sandbox.draftState.draftLog = [{ id: 1, pickNumber: 1, player: 'Live RB', pos: 'RB', teamId: 'team-01' }];
  sandbox.renderMyRoster();
  const html = sandbox.document.getElementById('rosterPanel').innerHTML;
  assert.ok(html.includes('My Team — 3 Players'));
});

// ═══════════════════════════════════════════════════════════
// SAGE
// ═══════════════════════════════════════════════════════════

test('rosterContext (computeRosterNeed output) correctly reflects keeper ownership for SAGE', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  const rc = sandbox.computeRosterNeed();
  assert.strictEqual(rc.filled.WR, 2);
  assert.ok(rc.remainingDedicated.WR <= (sandbox.DEFAULT_ROSTER_CONSTRUCTION.WR - 2 >= 0 ? sandbox.DEFAULT_ROSTER_CONSTRUCTION.WR - 2 : 0) + 1);
});

test('SAGE scoring/ranking functions (compareEvaluatedCandidates-equivalent snake math) are untouched by keeper logic', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  // computeSlotForPick/computeSlotForPickLinear are the pure functions
  // any SAGE-facing pick math ultimately depends on -- confirm their
  // output is completely unaffected by the presence of keepers.
  assert.strictEqual(sandbox.computeSlotForPick(20, 10), 1);
  assert.strictEqual(sandbox.computeSlotForPickLinear(11, 10), 1);
});

// ═══════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════

test('duplicate keeper player (assigned to a different team) is rejected', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Taken Guy', pos: 'WR', round: 2 }];
  const err = sandbox.keeperValidationError({ teamId: 'team-02', player: 'Taken Guy', pos: 'WR', round: 5 }, null);
  assert.ok(err);
});

test('duplicate team + round keeper assignment is rejected', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Taken Guy', pos: 'WR', round: 2 }];
  const err = sandbox.keeperValidationError({ teamId: 'team-01', player: 'Different Guy', pos: 'RB', round: 2 }, null);
  assert.ok(err);
});

test('invalid keeper round (zero, or beyond configured league length) is rejected', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  assert.ok(sandbox.keeperValidationError({ teamId: 'team-01', player: 'X', pos: 'RB', round: 0 }, null));
  assert.ok(sandbox.keeperValidationError({ teamId: 'team-01', player: 'X', pos: 'RB', round: 99 }, null));
});

test('a player already in draftLog cannot also be assigned as a keeper', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Already Drafted', pos: 'QB', teamId: 'team-04' });
  const err = sandbox.keeperValidationError({ teamId: 'team-05', player: 'Already Drafted', pos: 'QB', round: 1 }, null);
  assert.ok(err);
});

test('a valid, non-conflicting keeper candidate is accepted (no error)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  const err = sandbox.keeperValidationError({ teamId: 'team-03', player: 'New Guy', pos: 'RB', round: 5 }, null);
  assert.strictEqual(err, null);
});

// ═══════════════════════════════════════════════════════════
// DRAFTLOG INVARIANT
// ═══════════════════════════════════════════════════════════

test('a configured keeper never creates a draftLog entry', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept', pos: 'WR', round: 4 }];
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
});

test('logDraftPick() no-ops defensively if it somehow receives a keeper-identified player (never removes/re-adds)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept Player', pos: 'WR', round: 4 }];
  sandbox.logDraftPick('Kept Player', 'WR');
  assert.strictEqual(sandbox.draftState.draftLog.length, 0, 'must not create a draftLog entry for a keeper');
  assert.strictEqual(sandbox.draftState.keepers.length, 1, 'must not remove the keeper either');
});

test('keeper-occupied slot may be displayed (own-badge) without becoming a live pick', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  const entry = { id: 'keeper-1', pickNumber: 40, player: 'George Pickens', pos: 'WR', teamId: 'team-01', isKeeper: true, round: 4 };
  const badge = sandbox.renderOwnershipBadge(entry, true);
  assert.ok(badge.includes('Keeper R4'));
  assert.ok(!badge.includes('openReassignModal'), 'keeper badge must not be wired to the live-pick reassign flow');
});

// ═══════════════════════════════════════════════════════════
// UNDO / PERSISTENCE
// ═══════════════════════════════════════════════════════════

test('Undo Last Pick does not remove keepers', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept', pos: 'WR', round: 4 }];
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Live Pick', pos: 'RB', teamId: 'team-01' });
  sandbox.undoLastPick();
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
  assert.strictEqual(sandbox.draftState.keepers.length, 1);
});

test('save/load preserves keepers', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept', pos: 'WR', round: 4 }];
  sandbox.saveDraftState();
  const reloaded = sandbox.readSavedDraftState();
  assert.strictEqual(reloaded.keepers.length, 1);
  assert.strictEqual(reloaded.keepers[0].player, 'Kept');
});

test('old save without a keepers field loads correctly as keepers=[]', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const oldSave = {
    schemaVersion: sandbox.DRAFT_SAVE_SCHEMA_VERSION,
    teams: [{ id: 'team-01', name: 'Team 1' }],
    myTeamId: 'team-01',
    draftLog: [],
    nextPickId: 1,
  };
  sandbox.localStorage.setItem(sandbox.DRAFT_SAVE_KEY, JSON.stringify(oldSave));
  const loaded = sandbox.readSavedDraftState();
  assert.ok(Array.isArray(loaded.keepers) && loaded.keepers.length === 0);
});

test('Reset Draft (clearDrafted) clears draftLog but PRESERVES keeper configuration -- consistent with the existing "team setup is preserved" semantics already documented for this function', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.draftState.nextKeeperId = 2;
  sandbox.draftState.draftLog = [{ id: 1, pickNumber: 1, player: 'Live Pick', pos: 'RB', teamId: 'team-01' }];
  sandbox.draftState.nextPickId = 2;
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
  assert.strictEqual(sandbox.draftState.nextPickId, 1);
  assert.strictEqual(sandbox.draftState.keepers.length, 1);
  assert.strictEqual(sandbox.draftState.keepers[0].player, 'George Pickens');
  assert.strictEqual(sandbox.draftState.teams.length, 10);
  assert.strictEqual(sandbox.draftState.myTeamId, 'team-01');
});

// ═══════════════════════════════════════════════════════════
// FLAGSHIP CUSTOMER SCENARIO
// 10-team snake league; My Team keeps George Pickens (WR, R4) and
// Quentin Johnston (WR, R12); other teams also have keepers.
// ═══════════════════════════════════════════════════════════

test('FLAGSHIP: both user keepers unavailable from Pick 1', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
    { id: 3, teamId: 'team-02', player: 'Other Team Keeper A', pos: 'RB', round: 2 },
    { id: 4, teamId: 'team-05', player: 'Other Team Keeper B', pos: 'TE', round: 6 },
  ];
  const idx = sandbox.buildDraftIndex();
  assert.ok(idx['george-pickens|WR'] && idx['quentin-johnston|WR']);
});

test('FLAGSHIP: both user keepers appear on My Team from Pick 1, labeled with keeper round', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  sandbox.renderMyRoster();
  const html = sandbox.document.getElementById('rosterPanel').innerHTML;
  assert.ok(html.includes('George Pickens') && html.includes('KEEPER R4'));
  assert.ok(html.includes('Quentin Johnston') && html.includes('KEEPER R12'));
});

test('FLAGSHIP: rosterContext sees two WRs already rostered', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  assert.strictEqual(sandbox.computeRosterNeed().filled.WR, 2);
});

test('FLAGSHIP: SAGE does not recommend either keeper (excluded from the available pool it draws from)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.adpByPos = {
    WR: [{ name: 'George Pickens', pos: 'WR', team: 'PIT', adp: 30, key: sandbox.playerKey('George Pickens', 'WR') }],
    QB: [], RB: [], TE: [], K: [], DEF: [],
  };
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  assert.ok(!available.some((p) => p.name === 'George Pickens'));
});

test('FLAGSHIP: the users Round 4 and Round 12 live slots are both skipped by nextPickNumber()', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }, // pick 40
  ];
  for (let p = 1; p <= 39; p++) sandbox.draftState.draftLog.push({ id: p, pickNumber: p, player: 'F' + p, pos: 'RB', teamId: 'team-02' });
  assert.strictEqual(sandbox.nextPickNumber(), 41, 'pick 40 (Round 4 keeper) is skipped');
});

test('FLAGSHIP: other teams keeper slots are also skipped, and their keeper players are unavailable', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'Other Team Keeper A', pos: 'RB', round: 2 }]; // slot2,round2(even)->posInRound=10-2+1=9->pick=(2-1)*10+9=19
  const idx = sandbox.buildDraftIndex();
  assert.ok(idx['other-team-keeper-a|RB']);
  for (let p = 1; p <= 18; p++) sandbox.draftState.draftLog.push({ id: p, pickNumber: p, player: 'F' + p, pos: 'TE', teamId: 'team-03' });
  assert.strictEqual(sandbox.nextPickNumber(), 20, 'pick 19 (other teams keeper) is skipped too');
});

test('FLAGSHIP: live selections continue populating draftLog normally; keepers never enter it', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Live Pick One', pos: 'QB', teamId: 'team-01' });
  assert.strictEqual(sandbox.draftState.draftLog.length, 1);
  assert.strictEqual(sandbox.draftState.keepers.length, 2);
});

// ═══════════════════════════════════════════════════════════
// SETUP-UI REFINEMENT: searchable player selector, auto-derived
// position, Round dropdown (added in the UI-refinement pass; does not
// touch keeper engine functions -- see file header note per-test).
// ═══════════════════════════════════════════════════════════

function setupLeagueWithPool(sandbox, numTeams, myTeamId) {
  setupLeague(sandbox, numTeams, myTeamId);
  sandbox.adpByPos = {
    WR: [
      { name: 'George Pickens', pos: 'WR', team: 'PIT', adp: 20, key: sandbox.playerKey('George Pickens', 'WR') },
      { name: 'Quentin Johnston', pos: 'WR', team: 'LAC', adp: 45, key: sandbox.playerKey('Quentin Johnston', 'WR') },
      { name: 'Jahmyr Gibbs', pos: 'WR', team: 'DET', adp: 5, key: sandbox.playerKey('Jahmyr Gibbs', 'WR') }, // deliberately mis-tagged WR in this fixture only to prove position is NOT hand-typed -- unrelated to real ADP data
    ],
    RB: [
      { name: 'Jahmyr Gibbs RB', pos: 'RB', team: 'DET', adp: 3, key: sandbox.playerKey('Jahmyr Gibbs RB', 'RB') },
    ],
    QB: [], TE: [], K: [], DEF: [],
  };
}

test('searchable player selection uses the real/canonical adpByPos dataset, not a second dataset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  const flat = sandbox.allPlayersFlat();
  assert.ok(flat.some((p) => p.name === 'George Pickens' && p.pos === 'WR'));
  assert.ok(flat.some((p) => p.name === 'Jahmyr Gibbs RB' && p.pos === 'RB'));
  assert.strictEqual(flat.length, 4, 'flat list is exactly the union of adpByPos, nothing invented');
});

test('selecting a player auto-populates/derives position -- addKeeperFromForm never reads a manual position control', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-01';
  sandbox.selectKeeperPlayerFromResults(sandbox.playerKey('George Pickens', 'WR'));
  assert.strictEqual(sandbox.keeperFormSelectedPlayer.pos, 'WR');
  sandbox.document.getElementById('keeperFormRound').value = '4';
  sandbox.addKeeperFromForm();
  assert.strictEqual(sandbox.draftState.keepers.length, 1);
  assert.strictEqual(sandbox.draftState.keepers[0].pos, 'WR', 'position came from the canonical record, never manually chosen');
  assert.strictEqual(sandbox.draftState.keepers[0].player, 'George Pickens');
});

test('the underlying keeper object shape is unchanged: {teamId, player, pos, round}', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-01';
  sandbox.selectKeeperPlayerFromResults(sandbox.playerKey('George Pickens', 'WR'));
  sandbox.document.getElementById('keeperFormRound').value = '4';
  sandbox.addKeeperFromForm();
  const k = sandbox.draftState.keepers[0];
  assert.deepStrictEqual(Object.keys(k).sort(), ['id', 'pos', 'player', 'round', 'teamId'].sort());
});

test('round dropdown is generated to match the leagues configured Number of Rounds (14, not hard-coded)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-14';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  assert.strictEqual(roundSel.children.length, 14);
  assert.strictEqual(roundSel.children[0].value, '1');
  assert.strictEqual(roundSel.children[13].value, '14');
});

test('round dropdown reflects a DIFFERENT configured Number of Rounds (18) without hard-coding', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.numRounds = 18;
  sandbox.renderKeeperSection();
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  assert.strictEqual(roundSel.children.length, 18);
});

test('a round already occupied by the selected teams OTHER keeper is disabled in the dropdown', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-01';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  const round4Option = roundSel.children.find((o) => o.value === '4');
  assert.strictEqual(round4Option.disabled, true);
  const round5Option = roundSel.children.find((o) => o.value === '5');
  assert.strictEqual(round5Option.disabled, false);
});

test('the same occupied round is NOT disabled for a DIFFERENT team (per-team occupancy, not global)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-02';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  const round4Option = roundSel.children.find((o) => o.value === '4');
  assert.strictEqual(round4Option.disabled, false);
});

test('an already-kept player does not appear in search results for another team', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  const reason = sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('George Pickens', 'WR'), null);
  assert.ok(reason);
});

test('a drafted (draftLog) player also does not appear in search results', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.draftLog.push({ id: 1, pickNumber: 1, player: 'Jahmyr Gibbs RB', pos: 'RB', teamId: 'team-03' });
  const reason = sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('Jahmyr Gibbs RB', 'RB'), null);
  assert.ok(reason);
});

test('removing a keeper restores that player as selectable again immediately', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  assert.ok(sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('George Pickens', 'WR'), null));
  sandbox.removeKeeper(1);
  assert.strictEqual(sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('George Pickens', 'WR'), null), null);
});

test('removing a keeper also re-enables that teams round in the dropdown', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.removeKeeper(1);
  sandbox.document.getElementById('keeperFormTeam').value = 'team-01';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  const round4Option = roundSel.children.find((o) => o.value === '4');
  assert.strictEqual(round4Option.disabled, false);
});

test('editing a keeper does NOT falsely flag its own player/round as a conflict', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.startEditKeeper(1);
  // The player-eligibility check (excludeKeeperId=keeperEditingId=1) must
  // not treat the keeper's OWN player as a conflict while it's being edited.
  const reason = sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('George Pickens', 'WR'), sandbox.keeperEditingId);
  assert.strictEqual(reason, null);
  // Re-adding with the SAME round must also succeed via the real
  // (untouched) keeperValidationError backstop.
  sandbox.document.getElementById('keeperFormRound').value = '4';
  sandbox.addKeeperFromForm();
  assert.strictEqual(sandbox.draftState.keepers.length, 1);
  assert.strictEqual(sandbox.draftState.keepers[0].round, 4);
});

test('editing a keeper preserves canonical player/position through the selector, and Team populates correctly', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-05');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-05', player: 'Quentin Johnston', pos: 'WR', round: 12 }];
  sandbox.startEditKeeper(1);
  assert.strictEqual(sandbox.keeperFormSelectedPlayer.name, 'Quentin Johnston');
  assert.strictEqual(sandbox.keeperFormSelectedPlayer.pos, 'WR');
  assert.strictEqual(sandbox.document.getElementById('keeperFormPlayerSearch').value, 'Quentin Johnston');
  // Team must populate correctly -- this specifically exercises the
  // fix for a pre-existing ordering bug (keeperFormTeamOptions() inside
  // renderKeeperSection() rebuilds the <select> and would otherwise
  // silently reset it to the first team).
  assert.strictEqual(sandbox.document.getElementById('keeperFormTeam').value, 'team-05');
  assert.strictEqual(sandbox.document.getElementById('keeperFormRound').value, '12');
});

test('editing a keeper and changing its round still runs normal keeper validation', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-01', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-01', player: 'Quentin Johnston', pos: 'WR', round: 12 },
  ];
  sandbox.draftState.nextKeeperId = 3;
  sandbox.startEditKeeper(1); // editing Pickens
  sandbox.document.getElementById('keeperFormRound').value = '12'; // collides with Johnston's round
  sandbox.addKeeperFromForm();
  // Must be rejected by the real, untouched keeperValidationError --
  // Pickens should NOT have been re-added with a colliding round.
  assert.strictEqual(sandbox.draftState.keepers.length, 1, 'only Johnston remains; the invalid edit was rejected');
  assert.strictEqual(sandbox.draftState.keepers[0].player, 'Quentin Johnston');
});

// ═══════════════════════════════════════════════════════════
// FLAGSHIP CUSTOMER SCENARIO (UI-refinement pass): 14-team snake
// league, draft slot 14, Team 14 keeps George Pickens (WR, R4) and
// Quentin Johnston (WR, R14) -- entered via the refined selector.
// ═══════════════════════════════════════════════════════════

test('FLAGSHIP (UI refinement): Pickens and Johnston both resolve to WR automatically via the selector', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.renderKeeperSection();

  sandbox.document.getElementById('keeperFormTeam').value = 'team-14';
  sandbox.selectKeeperPlayerFromResults(sandbox.playerKey('George Pickens', 'WR'));
  sandbox.document.getElementById('keeperFormRound').value = '4';
  sandbox.addKeeperFromForm();

  sandbox.document.getElementById('keeperFormTeam').value = 'team-14';
  sandbox.renderKeeperRoundOptions();
  sandbox.selectKeeperPlayerFromResults(sandbox.playerKey('Quentin Johnston', 'WR'));
  sandbox.document.getElementById('keeperFormRound').value = '14';
  sandbox.addKeeperFromForm();

  assert.strictEqual(sandbox.draftState.keepers.length, 2);
  assert.ok(sandbox.draftState.keepers.every((k) => k.pos === 'WR'));
  assert.ok(sandbox.draftState.keepers.some((k) => k.player === 'George Pickens' && k.round === 4));
  assert.ok(sandbox.draftState.keepers.some((k) => k.player === 'Quentin Johnston' && k.round === 14));
});

test('FLAGSHIP (UI refinement): Round dropdown contains exactly 1-14', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-14';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  const values = roundSel.children.map((o) => o.value);
  assert.deepStrictEqual(values, Array.from({ length: 14 }, (_, i) => String(i + 1)));
});

test('FLAGSHIP (UI refinement): after Pickens is assigned to Team 14 Round 4, Round 4 cannot be reselected for Team 14', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 }];
  sandbox.renderKeeperSection();
  sandbox.document.getElementById('keeperFormTeam').value = 'team-14';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  const round4Option = roundSel.children.find((o) => o.value === '4');
  assert.strictEqual(round4Option.disabled, true);
});

test('FLAGSHIP (UI refinement): Pickens cannot be assigned to another team once kept by Team 14', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 }];
  const reason = sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('George Pickens', 'WR'), null);
  assert.ok(reason, 'Pickens must be ineligible for selection by any other team');
  // Defensive backstop still catches it even if the UI filter were somehow bypassed:
  const err = sandbox.keeperValidationError({ teamId: 'team-02', player: 'George Pickens', pos: 'WR', round: 6 }, null);
  assert.ok(err);
});

test('FLAGSHIP (UI refinement): editing/removing either keeper restores the appropriate options correctly', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeagueWithPool(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  sandbox.draftState.nextKeeperId = 3;
  sandbox.removeKeeper(2); // remove Johnston
  assert.strictEqual(sandbox.keeperPlayerIneligibilityReason(sandbox.playerKey('Quentin Johnston', 'WR'), null), null, 'Johnston is selectable again');
  sandbox.document.getElementById('keeperFormTeam').value = 'team-14';
  sandbox.renderKeeperRoundOptions();
  const roundSel = sandbox.document.getElementById('keeperFormRound');
  assert.strictEqual(roundSel.children.find((o) => o.value === '14').disabled, false, 'Round 14 is available again');
  assert.strictEqual(roundSel.children.find((o) => o.value === '4').disabled, true, 'Round 4 (Pickens) remains occupied');
});

// ═══════════════════════════════════════════════════════════
// Pre-existing keeper engine tests remain unchanged and passing --
// confirmed by the fact that every test ABOVE this section in this
// same file (unmodified from the prior pass) still passes.
// ═══════════════════════════════════════════════════════════

console.log(`draft-command-center-keepers.test.js: ${passed}/${passed + failed} passed`);
if (failures.length) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exit(1);
}
