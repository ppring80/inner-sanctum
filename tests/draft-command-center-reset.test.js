// tests/draft-command-center-reset.test.js
//
// Regression coverage for the "Reset Draft" bug fix (Reset returning to
// PICK 2 / TEAM 2 instead of the true first selectable pick, caused by
// a stale, already-scheduled Mock Draft automation setTimeout callback
// surviving Reset/Restart and later acting on a NEW session's state).
// Executes the REAL, complete extracted main <script> block from the
// real draft.html file via Node's built-in `vm` module -- not a
// reimplementation, matching the established pattern in
// tests/draft-command-center-keepers.test.js and
// tests/draft-command-center-mock.test.js.
//
// Two sandbox flavors are used:
//   - makeSandbox(): setTimeout fires its callback immediately/
//     synchronously -- fast, deterministic, used for every test that
//     verifies LOGIC (does Reset produce the right state).
//   - makeRealTimerSandbox(): setTimeout is Node's REAL, genuinely
//     deferred timer -- used ONLY for the dedicated race-condition
//     reproduction test, because that is a real timing bug and a
//     synchronous override would structurally hide it.
//
// Run: node tests/draft-command-center-reset.test.js

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
async function testAsync(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}

const draftHtml = fs.readFileSync(path.join(__dirname, '../draft.html'), 'utf8');

function extractMainScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
}
const mainScript = extractMainScript(draftHtml);

test('draft.html source contains the generation-counter fix', () => {
  assert.ok(mainScript.includes('mockAutomationGeneration'), 'mockAutomationGeneration must exist in the real file');
});

// ───────────────────────────────────────────────────────────
// Fake DOM
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

function baseSandboxFields(storageData) {
  const fakeStorage = {
    getItem: (k) => (k in storageData ? storageData[k] : null),
    setItem: (k, v) => { storageData[k] = String(v); },
    removeItem: (k) => { delete storageData[k]; },
  };
  // Discriminates the ADP endpoint from everything else -- matching the
  // established pattern in tests/draft-sage-integration.test.js. This
  // matters specifically for makeRealTimerSandbox() below: the script's
  // own bottom-of-file initDraftState()/loadAll() bootstrap always runs
  // on load and calls the ADP endpoint; letting that call REJECT (as a
  // naive stub would) triggers loadFallback(), which overwrites adpByPos
  // from window.PLAYER_POOL (empty in this sandbox) the moment a test
  // genuinely awaits real elapsed time -- corrupting a test's own
  // manually-seeded pool with no relation to the actual code under test.
  // Fast (synchronous-setTimeout) sandboxes never observe this because
  // their test setup always runs before any microtask can fire; a real-
  // timer sandbox that explicitly waits real milliseconds absolutely can.
  const fetchDispatcher = (url) => {
    if (typeof url === 'string' && url.indexOf('/.netlify/functions/adp') === 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ players: [] }) });
    }
    return Promise.reject(new Error('no network in test'));
  };
  return {
    document: makeFakeDocument(),
    localStorage: fakeStorage,
    sessionStorage: fakeStorage,
    fetch: fetchDispatcher,
    window: { PLAYER_POOL: { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] } },
    console,
    URLSearchParams,
    Promise,
    alert: () => {},
    confirm: () => true,
    fetchTank01PlayerMap: () => Promise.resolve({}),
    applyLiveTeamsFromTank01: (list) => list,
    normalizePlayerName: (n) => (n || '').toLowerCase(),
  };
}

function makeSandbox() {
  const storageData = {};
  const sandbox = Object.assign(baseSandboxFields(storageData), {
    // Fast, synchronous -- for logic tests only.
    setTimeout: (fn) => { fn(); },
  });
  sandbox._storageData = storageData;
  vm.createContext(sandbox);
  return sandbox;
}

function makeRealTimerSandbox() {
  const storageData = {};
  const sandbox = Object.assign(baseSandboxFields(storageData), {
    // REAL, genuinely deferred Node timer -- for the race-condition test only.
    setTimeout,
  });
  sandbox._storageData = storageData;
  vm.createContext(sandbox);
  return sandbox;
}

function runScript(sandbox) {
  vm.runInContext(mainScript, sandbox);
}

// For the real-timer sandbox only: the script's own bottom-of-file
// initDraftState()/loadAll() bootstrap always runs on load and, on
// EITHER its success or its catch/loadFallback() path, unconditionally
// reassigns adpByPos at some point during its async chain (confirmed by
// reading loadAll()'s real source: `adpByPos={}` happens in the try
// branch even with zero returned players, and loadFallback() does the
// same from window.PLAYER_POOL in the catch branch). A fast/synchronous
// sandbox never observes this because the test's own setup always runs
// before the event loop ever gets a chance to drain that async chain.
// A real-timer test that genuinely awaits elapsed time can -- so it
// must let the bootstrap fully settle FIRST, exactly like
// tests/draft-sage-integration.test.js's own runScript() already does,
// before seeding its own scenario.
async function runScriptAndSettle(sandbox) {
  vm.runInContext(mainScript, sandbox);
  await new Promise((r) => sandbox.setTimeout(r, 30));
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
// LIVE / NORMAL DRAFT RESET
// ═══════════════════════════════════════════════════════════

test('1. live draft: make several picks -> Reset -> draftLog empty', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  for (let i = 0; i < 5; i++) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  assert.strictEqual(sandbox.draftState.draftLog.length, 5);
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
});

test('2. nextPickId returns to correct initial value after Reset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 10 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  assert.ok(sandbox.draftState.nextPickId > 1);
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.draftState.nextPickId, 1);
});

test('3. nextPickNumber() after Reset returns the first selectable pick (no keeper on pick 1)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 30 });
  for (let i = 0; i < 8; i++) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.nextPickNumber(), 1, 'must be exactly pick 1, not pick 2 or later');
});

test('4. teamOnClock(nextPickNumber()) is correct after Reset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 30 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.teamOnClock(sandbox.nextPickNumber()), 'team-01', 'slot 1 (team-01) must be on the clock, not team-02');
});

test('5. DRAFTED counts derive as zero after Reset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 30 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.draftState.draftLog.length, 0, 'DRAFTED count is derived directly from draftLog.length');
});

test('6. My Team contains only configured keepers after Reset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept Guy', pos: 'WR', round: 4 }];
  seedPool(sandbox, { WR: 30, RB: 20 });
  sandbox.logDraftPick('WR Player 5', 'WR');
  sandbox.logDraftPick('RB Player 0', 'RB');
  sandbox.clearDrafted();
  sandbox.renderMyRoster();
  const html = sandbox.document.getElementById('rosterPanel').innerHTML;
  assert.ok(html.includes('Kept Guy'), 'the keeper must still be present');
  assert.ok(html.includes('My Team — 1 Player'), 'only the keeper remains -- the 2 live picks are gone');
});

test('7. drafted ordinary players become available again after Reset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 10 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  assert.ok(!sandbox.buildAvailablePlayersSortedByAdp().some((p) => p.name === 'WR Player 0'));
  sandbox.clearDrafted();
  assert.ok(sandbox.buildAvailablePlayersSortedByAdp().some((p) => p.name === 'WR Player 0'), 'must be available again');
});

test('8. keeper players remain unavailable after Reset', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-02', player: 'Kept Guy', pos: 'WR', round: 1 }];
  seedPool(sandbox, { WR: 10 });
  sandbox.logDraftPick('WR Player 1', 'WR');
  sandbox.clearDrafted();
  assert.ok(!sandbox.buildAvailablePlayersSortedByAdp().some((p) => p.name === 'Kept Guy'), 'keeper stays excluded from availability');
});

test('9. Setup survives Reset unchanged', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14', 'snake');
  sandbox.draftState.numRounds = 14;
  seedPool(sandbox, { WR: 10 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.draftState.teams.length, 14);
  assert.strictEqual(sandbox.draftState.myTeamId, 'team-14');
  assert.strictEqual(sandbox.draftState.draftType, 'snake');
  assert.strictEqual(sandbox.draftState.numRounds, 14);
});

test('10. keeper round assignments survive Reset unchanged', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  seedPool(sandbox, { WR: 10 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  sandbox.clearDrafted();
  assert.strictEqual(sandbox.draftState.keepers.length, 2);
  assert.strictEqual(sandbox.draftState.keepers[0].round, 4);
  assert.strictEqual(sandbox.draftState.keepers[1].round, 14);
});

test('11. Reset with a keeper occupying Pick 1 correctly advances to the first SELECTABLE pick, not a blind Pick 1', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  sandbox.draftState.keepers = [{ id: 1, teamId: 'team-01', player: 'Kept Guy', pos: 'WR', round: 1 }]; // occupies pick 1
  seedPool(sandbox, { WR: 10 });
  sandbox.clearDrafted();
  assert.notStrictEqual(sandbox.nextPickNumber(), 1, 'pick 1 is a keeper slot -- must not be offered as selectable');
  assert.strictEqual(sandbox.nextPickNumber(), 2, 'pick 2 (team-02) is the true first selectable pick');
  assert.strictEqual(sandbox.teamOnClock(2), 'team-02');
});

// ═══════════════════════════════════════════════════════════
// MOCK DRAFT RESET
// ═══════════════════════════════════════════════════════════

test('12/13/15/16/17. Mock: start -> automated picks -> user pick -> Reset stops automation, restores live, resets it, exits mock', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  const liveObjectRef = sandbox.draftState;
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 3, 'sanity: automation ran before the users turn');
  const myPick = sandbox.buildAvailablePlayersSortedByAdp()[0];
  sandbox.logDraftPick(myPick.name, myPick.pos);
  assert.strictEqual(sandbox.mockModeActive, true);

  sandbox.clearDrafted();

  assert.strictEqual(sandbox.mockAutomationRunning, false, '13. automation is stopped');
  assert.strictEqual(sandbox.mockModeActive, false, '15. mockModeActive is false');
  assert.strictEqual(sandbox.draftState, liveObjectRef, '16. live state (exact same object) is restored, not a copy');
  assert.strictEqual(sandbox.draftState.draftLog.length, 0, '17. resulting LIVE draftLog is empty');
});

test('14. no queued automation callback can make a post-reset pick (logic-level: generation mismatch blocks it)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  const generationDuringOldBatch = sandbox.mockAutomationGeneration;
  sandbox.clearDrafted();
  // A brand-new mock session, started quickly, must claim a NEW generation.
  sandbox.startMockDraft();
  assert.notStrictEqual(sandbox.mockAutomationGeneration, generationDuringOldBatch, 'a new batch must never reuse an old generation number');
});

test('18. live localStorage contains the reset live state, NOT mock selections', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  assert.strictEqual(sandbox._storageData[sandbox.DRAFT_SAVE_KEY], undefined, 'sanity: mock never wrote the live key while active');
  sandbox.clearDrafted();
  const saved = JSON.parse(sandbox._storageData[sandbox.DRAFT_SAVE_KEY]);
  assert.strictEqual(saved.draftLog.length, 0, 'the persisted state is the RESET live draft, not the 3 mock picks');
});

test('19. browser reload/load simulation restores the clean reset state', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 4, 'team-04');
  seedPool(sandbox, { QB: 10, RB: 20, WR: 20, TE: 10, K: 10, DEF: 10 });
  sandbox.startMockDraft();
  sandbox.clearDrafted();
  const reloaded = sandbox.readSavedDraftState();
  assert.strictEqual(reloaded.draftLog.length, 0);
  assert.strictEqual(reloaded.teams.length, 4);
});

test('20. Undo after Reset cannot restore a pre-reset pick', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 10, 'team-01');
  seedPool(sandbox, { WR: 10 });
  sandbox.logDraftPick('WR Player 0', 'WR');
  sandbox.clearDrafted();
  sandbox.undoLastPick(); // must be a safe no-op -- nothing to undo
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
});

// ═══════════════════════════════════════════════════════════
// KEEPER ACCEPTANCE SCENARIO (flagship, 14-team/Slot 14)
// ═══════════════════════════════════════════════════════════

test('FLAGSHIP: full Reset acceptance -- 14-team snake, Slot 14, Pickens R4 + Johnston R14', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  setupLeague(sandbox, 14, 'team-14');
  sandbox.draftState.numRounds = 14;
  sandbox.draftState.keepers = [
    { id: 1, teamId: 'team-14', player: 'George Pickens', pos: 'WR', round: 4 },
    { id: 2, teamId: 'team-14', player: 'Quentin Johnston', pos: 'WR', round: 14 },
  ];
  seedPool(sandbox, { QB: 30, RB: 60, WR: 60, TE: 30, K: 20, DEF: 20 });

  // Draft several ordinary live picks first.
  for (let i = 0; i < 10; i++) {
    const p = sandbox.buildAvailablePlayersSortedByAdp()[0];
    sandbox.logDraftPick(p.name, p.pos);
  }

  sandbox.clearDrafted();

  // Setup unchanged.
  assert.strictEqual(sandbox.draftState.teams.length, 14);
  assert.strictEqual(sandbox.draftState.myTeamId, 'team-14');
  assert.strictEqual(sandbox.draftState.numRounds, 14);
  assert.strictEqual(sandbox.draftState.draftType, 'snake');

  // Keepers remain.
  assert.strictEqual(sandbox.draftState.keepers.length, 2);

  // My Team = exactly the 2 keepers.
  sandbox.renderMyRoster();
  const rosterHtml = sandbox.document.getElementById('rosterPanel').innerHTML;
  assert.ok(rosterHtml.includes('My Team — 2 Players'));
  assert.ok(rosterHtml.includes('George Pickens') && rosterHtml.includes('Quentin Johnston'));

  // DRAFTED (0).
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);

  // Board availability: keepers excluded, ordinary players restored.
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  assert.ok(!available.some((p) => p.name === 'George Pickens' || p.name === 'Quentin Johnston'));
  assert.ok(available.length > 0, 'ordinary players are available again');

  // Progression returns to the first selectable pick (pick 1, no keeper there).
  assert.strictEqual(sandbox.nextPickNumber(), 1);
  assert.strictEqual(sandbox.teamOnClock(1), 'team-01');

  // The keeper engine still skips team-14's keeper rounds later, unchanged.
  const keeperSlots = sandbox.buildKeeperPickNumberSet();
  assert.ok(keeperSlots[43] && keeperSlots[183]);
});

// ═══════════════════════════════════════════════════════════
// THE ACTUAL RACE CONDITION — REAL, GENUINELY DEFERRED TIMERS
// This is the test that would have FAILED against the code before
// this fix (mockAutomationRunning/mockModeActive alone, no generation
// counter) and PASSES now. A synchronous-setTimeout sandbox cannot
// expose this bug at all -- real timing is required.
// ═══════════════════════════════════════════════════════════

async function runAsyncTests() {
  await testAsync('REAL-TIMER: Restart Mock while a batch is still in-flight does not leave automation silently stuck, and a stale callback cannot act on the restarted session', async () => {
  const sandbox = makeRealTimerSandbox();
  await runScriptAndSettle(sandbox); // let the bootstrap loadAll() fully finish BEFORE seeding our own scenario
  setupLeague(sandbox, 6, 'team-06'); // user is last -- 5 opponent picks happen first
  seedPool(sandbox, { QB: 20, RB: 40, WR: 40, TE: 20, K: 20, DEF: 20 });

  // Kick off automation: makes opponent picks with REAL 150ms delays
  // between them, so a step() callback is guaranteed to still be
  // pending shortly after the first pick.
  sandbox.startMockDraft();
  assert.strictEqual(sandbox.draftState.draftLog.length, 1, 'sanity: the first automated pick happens synchronously');
  assert.strictEqual(sandbox.mockAutomationRunning, true, 'sanity: a batch is genuinely still in-flight (next step is pending)');

  // User clicks Restart Mock WHILE that batch is still in-flight --
  // this is exactly the scenario the generation-counter fix protects.
  sandbox.restartMockDraft();
  const restartedDraftState = sandbox.draftState;

  // With the fix: mockAutomationRunning was explicitly cleared before
  // requesting a new batch, so the new batch starts making progress
  // immediately (synchronously, right up to ITS OWN first pending
  // setTimeout) -- it must not be silently stuck at 0 forever waiting
  // on a leftover flag from the batch that Restart just discarded.
  assert.strictEqual(restartedDraftState.draftLog.length, 1, 'the NEW batch already made its own first pick synchronously, not blocked by a stale mockAutomationRunning flag');

  // Wait long enough for the OLD (pre-Restart) batch's pending step()
  // to have fired, if it were ever going to.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // The restarted session's draftLog must reflect ONLY its own
  // legitimate automation (up to 5 opponent picks, stopping at the
  // user's turn) -- never an extra pick injected by the OLD batch's
  // orphaned callback, which the generation mismatch must have
  // silently no-op'd.
  const finalTeamIds = restartedDraftState.draftLog.map((e) => e.teamId);
  assert.ok(finalTeamIds.every((id) => id !== 'team-06'), 'automation must never draft for the user');
  assert.ok(restartedDraftState.draftLog.length <= 5, 'never more than the 5 legitimate opponent picks before the users turn');
  assert.strictEqual(sandbox.teamOnClock(sandbox.nextPickNumber()), 'team-06', 'automation correctly stopped exactly at the users turn, with no extra stray pick beyond it');
});
}

runAsyncTests().then(() => {
  console.log(`draft-command-center-reset.test.js: ${passed}/${passed + failed} passed`);
  if (failures.length) {
    failures.forEach((f) => console.error('FAIL:', f));
    process.exit(1);
  }
});
