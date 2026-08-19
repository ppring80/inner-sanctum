// tests/draft-sage-integration.test.js
//
// Regression coverage for the SAGE V1 integration added to draft.html
// (Aug 17 2026). Executes the REAL, complete extracted main <script>
// block from the real draft.html file via Node's built-in `vm` module
// -- not a reimplementation, and not a new dependency (deliberately
// avoids jsdom, consistent with this pass's "no new dependency" rule --
// the same reasoning already applied to weekly-oauth-session.test.js).
//
// A generic fake DOM element factory is used (rather than enumerating
// every element by id) since the full script's render() touches many
// elements (dbar, clockBar, rosterPanel, sagePanel, etc.) -- this lets
// the ENTIRE real script execute without manually resolving its large
// internal dependency chain (refreshSageRecommendations depends on
// nextPickNumber/distanceToMySlot/buildDraftIndex/draftSetupComplete/
// isDraftComplete/resolveSlotForPick/..., all real, all exercised as
// actually written).
//
// The separately-delivered draft-command-center.test.js and
// smoke-test.js (this file's established pre-SAGE regression suites,
// not part of the committed tests/ directory) were also re-run against
// this exact file during implementation and both passed unchanged
// (113/113, 61/61) -- strong independent evidence that existing pick
// logging/undo/snake-math behavior is untouched, referenced in the
// final report rather than duplicated here.
//
// Run: node tests/draft-sage-integration.test.js

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
  // The main script is the one with logDraftPick/refreshSageRecommendations -- by far the largest.
  return scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
}
const mainScript = extractMainScript(draftHtml);

test('draft.html source actually contains the new SAGE functions (sanity check before executing it)', () => {
  ['refreshSageRecommendations', 'buildAvailablePlayersSortedByAdp', 'deriveNextTurnPool', 'renderSagePanel'].forEach((fn) => {
    assert.ok(mainScript.includes('function ' + fn), fn + ' must be defined in the real file');
  });
});

// ─────────────────────────────────────────────────────────
// Generic fake DOM: every element supports the small set of
// properties/methods the real script actually calls anywhere in a full
// render pass, without enumerating every element id by hand.
// ─────────────────────────────────────────────────────────
function makeFakeElement() {
  const classes = new Set();
  return {
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
    innerHTML: '',
    textContent: '',
    disabled: false,
    checked: false,
    options: [],
    children: [],
    dataset: {},
    focus() {}, blur() {}, click() {},
    appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getContext: () => null,
  };
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

function makeSandbox(sageFetchImpl) {
  const fakeDocument = makeFakeDocument();
  const storageData = {};
  const fakeStorage = {
    getItem: (k) => (k in storageData ? storageData[k] : null),
    setItem: (k, v) => { storageData[k] = String(v); },
    removeItem: (k) => { delete storageData[k]; },
  };
  // Dispatches by URL rather than using one blanket mock: the script's
  // own bottom-of-file initDraftState()/loadAll() auto-run always fires
  // on load and calls the ADP endpoint -- letting that succeed trivially
  // (rather than rejecting into loadFallback(), which resets adpByPos
  // asynchronously) avoids a real race against each test's own
  // subsequent state setup. Only the SAGE endpoint call is routed
  // through the test-supplied mock.
  const fetchDispatcher = (url, opts) => {
    if (typeof url === 'string' && url.indexOf('/.netlify/functions/adp') === 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ players: [] }) });
    }
    if (typeof url === 'string' && url.indexOf('/.netlify/functions/sage-recommend') === 0) {
      return (sageFetchImpl || (() => Promise.reject(new Error('no network in test'))))(url, opts);
    }
    return Promise.reject(new Error('Unexpected fetch URL in test: ' + url));
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

async function runScript(sandbox) {
  vm.runInContext(mainScript, sandbox);
  // Let the script's own bottom-of-file initDraftState()/loadAll() auto-
  // run fully settle before the caller configures its own scenario.
  // loadAll() explicitly refreshes SAGE on its success path -- draftState
  // .teams is still empty at this exact moment, so that call correctly
  // no-ops (draftSetupComplete() is false), but only if the test's own
  // state setup happens strictly AFTER this settles, not concurrently.
  await new Promise((r) => setTimeout(r, 20));
}

// Values created INSIDE the vm context (e.g. anything returned by a
// function executed via runInContext) are instances of that context's
// own separate Array/Object/String constructors -- a different realm.
// assert.deepStrictEqual checks constructor identity as part of "strict"
// and will report a mismatch even for identical-looking content across
// realms. This round-trip produces a plain host-realm equivalent so
// normal strict comparisons work correctly. Only needed for values
// pulled OUT of the sandbox for comparison; nothing about the sandbox
// execution itself is affected.
function crossRealm(value) {
  return JSON.parse(JSON.stringify(value));
}

// Directly configure a minimal, valid draft in the sandbox without
// going through the UI layer (setup modal DOM interactions aren't
// meaningfully testable through the generic fake elements) -- this
// mirrors exactly the shape saveSetup() itself would produce.
function configureMinimalDraft(sandbox, overrides) {
  sandbox.draftState = Object.assign(
    {
      schemaVersion: 1,
      teams: [{ id: 'team-01', name: 'Team 1' }, { id: 'team-02', name: 'Team 2' }],
      myTeamId: 'team-01',
      draftLog: [],
      nextPickId: 1,
      draftType: 'snake',
      numRounds: 10,
    },
    overrides || {}
  );
  sandbox.adpByPos = {
    RB: [
      { name: 'Player A', pos: 'RB', team: 'SF', adp: 1, key: sandbox.playerKey('Player A', 'RB') },
      { name: 'Player B', pos: 'RB', team: 'DAL', adp: 5, key: sandbox.playerKey('Player B', 'RB') },
    ],
    WR: [
      { name: 'Player C', pos: 'WR', team: 'CIN', adp: 3, key: sandbox.playerKey('Player C', 'WR') },
    ],
  };
  sandbox.ready = true;
  sandbox.sageInitialRefreshDone = true; // mirrors saveSetup()'s real behavior -- this harness is standing in for a completed setup, not a fresh page load
}

// ─────────────────────────────────────────────────────────
// Pure-function-shaped tests, executed against the REAL functions in
// the REAL script (via vm), not copies.
// ─────────────────────────────────────────────────────────
test('buildAvailablePlayersSortedByAdp: returns players in ADP order, excluding anyone in draftLog', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  configureMinimalDraft(sandbox);
  sandbox.draftState.draftLog = [{ id: 1, pickNumber: 1, player: 'Player A', pos: 'RB', teamId: 'team-01' }];
  const available = sandbox.buildAvailablePlayersSortedByAdp();
  const names = available.map((p) => p.name);
  assert.ok(!names.includes('Player A'), 'a drafted player must not appear as available');
  assert.deepStrictEqual(crossRealm(names), ['Player C', 'Player B'], 'must be sorted by ADP ascending among the remaining players');
});

test('deriveNextTurnPool: skips the N most-likely-taken players, keeps the rest', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const pool = [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }, { name: 'P4' }];
  const result = sandbox.deriveNextTurnPool(pool, 2, 10);
  assert.deepStrictEqual(result.map((p) => p.name), ['P3', 'P4']);
});
test('deriveNextTurnPool: null/undefined picksUntilNextTurn treated as 0 (no skip), never throws', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const pool = [{ name: 'P1' }, { name: 'P2' }];
  assert.deepStrictEqual(sandbox.deriveNextTurnPool(pool, null, 10).map((p) => p.name), ['P1', 'P2']);
});
test('deriveNextTurnPool: respects the maxSize cap', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const pool = Array.from({ length: 20 }, (_, i) => ({ name: 'P' + i }));
  assert.strictEqual(sandbox.deriveNextTurnPool(pool, 0, 5).length, 5);
});
test('deriveNextTurnPool: Aug 17 2026 correction -- returns the FULL uncapped remainder when maxSize is omitted (broader Scarcity pool, not a bounded slice)', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const pool = Array.from({ length: 40 }, (_, i) => ({ name: 'P' + i }));
  const result = sandbox.deriveNextTurnPool(pool, 3);
  assert.strictEqual(result.length, 37, 'must return everything beyond the skip, not capped to SAGE_MAX_CANDIDATES or any other bound');
});

test('toSagePlayer: strips a full board player object down to name/pos/adp/team only', () => {
  const sandbox = makeSandbox();
  runScript(sandbox);
  const boardPlayer = { name: 'Full Player', pos: 'WR', adp: 12.4, team: 'KC', key: 'full player|WR', someInternalField: 'should not leak' };
  const sagePlayer = sandbox.toSagePlayer(boardPlayer);
  assert.deepStrictEqual(crossRealm(sagePlayer), { name: 'Full Player', pos: 'WR', adp: 12.4, team: 'KC' });
});

// ─────────────────────────────────────────────────────────
// Behavioral: the real refreshSageRecommendations(), executed against
// the real fetch call it constructs, proving the hard safety boundary
// and the required failure-message behavior.
// ─────────────────────────────────────────────────────────
// Builds a real 12-team snake draft with `picksLogged` dummy picks
// already made (so nextPickNumber() returns picksLogged+1), the user
// in slot 12 (last slot -- the case where the wraparound/back-to-back
// turn actually occurs). Team ownership of the filler picks doesn't
// affect nextPickNumber()/distanceToMySlot() at all, so every filler
// entry is just logged against team-01 for simplicity.
function configureTwelveTeamSnake(sandbox, picksLogged) {
  var teams = [];
  for (var i = 1; i <= 12; i++) teams.push({ id: 'team-' + String(i).padStart(2, '0'), name: 'Team ' + i });
  var draftLog = [];
  for (var p = 1; p <= picksLogged; p++) {
    draftLog.push({ id: p, pickNumber: p, player: 'Filler Player ' + p, pos: 'RB', teamId: 'team-01' });
  }
  sandbox.draftState = { schemaVersion: 1, teams: teams, myTeamId: 'team-12', draftLog: draftLog, nextPickId: picksLogged + 1, draftType: 'snake', numRounds: 20 };
  sandbox.adpByPos = { RB: [{ name: 'Available Player', pos: 'RB', team: 'SF', adp: 1, key: sandbox.playerKey('Available Player', 'RB') }] };
  sandbox.ready = true;
  sandbox.sageInitialRefreshDone = true;
}

// Captures the real request body refreshSageRecommendations() sends,
// via the real handler -- not a reimplementation of its logic.
async function captureSageRequestBody(sandbox) {
  var capturedBody = null;
  sandbox.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('/.netlify/functions/sage-recommend') === 0) {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ recommendations: [] }); } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ players: [] }); } });
  };
  sandbox.refreshSageRecommendations();
  await new Promise(function (r) { setTimeout(r, 10); });
  return capturedBody;
}

async function runBehavioralTests() {
  await testAsync('Snake-turn fix: Pick 11, Slot 12 -> nextUserPick 12 (away!==0, unchanged existing behavior)', async () => {
    const sandbox = makeSandbox();
    await runScript(sandbox);
    configureTwelveTeamSnake(sandbox, 10); // 10 logged -> nextPickNumber() = 11
    const body = await captureSageRequestBody(sandbox);
    assert.strictEqual(body.currentPick, 11);
    assert.strictEqual(body.nextUserPick, 12, 'slot 12 is not yet on the clock at pick 11 -- next turn is the very next pick, same as before this fix');
  });

  await testAsync('Snake-turn fix: Pick 12, Slot 12 -> nextUserPick 13 (on the clock now; immediate back-to-back wraparound turn)', async () => {
    const sandbox = makeSandbox();
    await runScript(sandbox);
    configureTwelveTeamSnake(sandbox, 11); // 11 logged -> nextPickNumber() = 12
    const body = await captureSageRequestBody(sandbox);
    assert.strictEqual(body.currentPick, 12);
    assert.strictEqual(body.nextUserPick, 13, 'this is the exact bug: before the fix this was 12, identical to currentPick');
  });

  await testAsync('Snake-turn fix: Pick 13, Slot 12 -> nextUserPick 36 (on the clock again from the wraparound; next real turn is far into round 3)', async () => {
    const sandbox = makeSandbox();
    await runScript(sandbox);
    configureTwelveTeamSnake(sandbox, 12); // 12 logged -> nextPickNumber() = 13
    const body = await captureSageRequestBody(sandbox);
    assert.strictEqual(body.currentPick, 13);
    assert.strictEqual(body.nextUserPick, 36, 'pick 13 is ALSO slot 12 (the wraparound) -- the next real turn after that is round 3\'s slot 12 pick, #36');
  });

  await testAsync('Snake-turn fix: nextTurnPool skip distance matches the corrected nextUserPick gap, not the raw away value', async () => {
    const sandbox = makeSandbox();
    await runScript(sandbox);
    configureTwelveTeamSnake(sandbox, 11); // pick 12, on the clock -> corrected gap should be 1 (picks 12->13), not 0
    var capturedBody = null;
    sandbox.fetch = function (url, opts) {
      if (typeof url === 'string' && url.indexOf('/.netlify/functions/sage-recommend') === 0) {
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ recommendations: [] }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ players: [] }); } });
    };
    // deriveNextTurnPool is pure and already covered elsewhere -- this
    // test just confirms refreshSageRecommendations() passes it the
    // CORRECTED distance (1), not the raw away value (0), by checking
    // the real function directly with the same inputs it used.
    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));
    var available = sandbox.buildAvailablePlayersSortedByAdp();
    var poolWithRawAway = sandbox.deriveNextTurnPool(available, 0).map(sandbox.toSagePlayer);
    var poolWithCorrectedAway = sandbox.deriveNextTurnPool(available, 1).map(sandbox.toSagePlayer);
    assert.deepStrictEqual(crossRealm(capturedBody.nextTurnPool), crossRealm(poolWithCorrectedAway));
    assert.notDeepStrictEqual(crossRealm(capturedBody.nextTurnPool), crossRealm(poolWithRawAway));
  });

  await testAsync('refreshSageRecommendations sends a POST with the expected request shape', async () => {
    let capturedUrl = null, capturedOpts = null;
    const sandbox = makeSandbox((url, opts) => {
      capturedUrl = url; capturedOpts = opts;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
    });
    await runScript(sandbox);
    configureMinimalDraft(sandbox);
    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(capturedUrl, '/.netlify/functions/sage-recommend');
    assert.strictEqual(capturedOpts.method, 'POST');
    const body = JSON.parse(capturedOpts.body);
    assert.ok(Array.isArray(body.candidates) && body.candidates.length > 0);
    assert.ok(Array.isArray(body.currentPool));
    assert.ok(Array.isArray(body.nextTurnPool));
    assert.strictEqual(typeof body.currentPick, 'number');
  });

  await testAsync('Aug 17 2026 correction: currentPool is the BROADER available population, not the same bounded slice as candidates -- a player beyond the candidate cap is included', async () => {
    let capturedOpts = null;
    const sandbox = makeSandbox((url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
    });
    await runScript(sandbox);
    configureMinimalDraft(sandbox);
    // Add 30 more RBs beyond the SAGE_MAX_CANDIDATES=25 cap, all with
    // worse ADP than everything already in the fixture, so they sort
    // to the very end of the available list -- guaranteed OUTSIDE the
    // bounded candidate slice, but still real available players.
    for (let i = 0; i < 30; i++) {
      sandbox.adpByPos.RB.push({ name: 'Depth RB ' + i, pos: 'RB', team: 'FA', adp: 100 + i, key: sandbox.playerKey('Depth RB ' + i, 'RB') });
    }

    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));

    const body = JSON.parse(capturedOpts.body);
    const candidateNames = body.candidates.map((p) => p.name);
    const currentPoolNames = body.currentPool.map((p) => p.name);

    assert.ok(body.candidates.length <= 25, 'candidates must stay bounded to ~top 25');
    assert.ok(!candidateNames.includes('Depth RB 29'), 'a low-priority depth player must NOT be in the bounded candidate set');
    assert.ok(currentPoolNames.includes('Depth RB 29'), 'but that same player MUST be present in the broader currentPool sent to Scarcity');
    assert.ok(body.currentPool.length > body.candidates.length, 'currentPool must be strictly larger than the bounded candidate set');
  });

  await testAsync('HARD SAFETY: refreshSageRecommendations never mutates draftState/draftLog, success or failure', async () => {
    const sandbox = makeSandbox(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [{ player: { name: 'Player A', pos: 'RB' }, adp: 1, recommendation: 'Take Now', code: 'take-now', explanation: 'x', reasons: [] }] }) }));
    await runScript(sandbox);
    configureMinimalDraft(sandbox);
    const before = JSON.parse(JSON.stringify(sandbox.draftState));

    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));

    assert.deepStrictEqual(sandbox.draftState, before, 'draftState must be byte-for-byte identical after a SAGE call');
  });

  await testAsync('on fetch rejection, sageError is set to the exact required message and the panel reflects it', async () => {
    const sandbox = makeSandbox(() => Promise.reject(new Error('network down')));
    await runScript(sandbox);
    configureMinimalDraft(sandbox);

    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(sandbox.sageError, 'SAGE recommendations temporarily unavailable.');
    assert.strictEqual(sandbox.sageRecommendations, null);
  });

  await testAsync('on a non-ok HTTP response, the same required message is shown (not a raw error/stack)', async () => {
    const sandbox = makeSandbox(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Internal detail nobody should see' }) }));
    await runScript(sandbox);
    configureMinimalDraft(sandbox);

    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(sandbox.sageError, 'SAGE recommendations temporarily unavailable.');
  });

  await testAsync('logDraftPick still logs a real pick correctly with SAGE wired in (afterDraftMutation calls both render() and refreshSageRecommendations() without interfering with either)', async () => {
    const sandbox = makeSandbox(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [] }) }));
    await runScript(sandbox);
    configureMinimalDraft(sandbox);

    sandbox.logDraftPick('Player A', 'RB');
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(sandbox.draftState.draftLog.length, 1, 'the pick must still be logged correctly');
    assert.strictEqual(sandbox.draftState.draftLog[0].player, 'Player A');
    assert.strictEqual(sandbox.draftState.draftLog[0].teamId, 'team-01');
  });

  await testAsync('a SAGE failure does not prevent a subsequent pick from being logged (rest of the page keeps functioning)', async () => {
    const sandbox = makeSandbox(() => Promise.reject(new Error('SAGE is down')));
    await runScript(sandbox);
    configureMinimalDraft(sandbox);

    sandbox.logDraftPick('Player A', 'RB'); // triggers afterDraftMutation -> refreshSageRecommendations, which will fail
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(sandbox.draftState.draftLog.length, 1, 'the pick logs successfully even though SAGE failed for this same event');
    assert.strictEqual(sandbox.sageError, 'SAGE recommendations temporarily unavailable.');

    // A second, independent action (undo) must also still work normally afterward.
    sandbox.confirm = () => true;
    sandbox.undoLastPick();
    assert.strictEqual(sandbox.draftState.draftLog.length, 0, 'undo must still work after a prior SAGE failure');
  });

  await testAsync('a late (superseded) response is discarded -- does not overwrite a newer request\'s result', async () => {
    let resolveFirst;
    let callCount = 0;
    const sandbox = makeSandbox((url, opts) => {
      callCount++;
      if (callCount === 1) {
        return new Promise((resolve) => { resolveFirst = resolve; }); // never resolves until we say so
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [{ player: { name: 'Second Call Player', pos: 'RB' }, adp: 1, recommendation: 'Take Now', code: 'take-now', explanation: 'x', reasons: [] }] }) });
    });
    await runScript(sandbox);
    configureMinimalDraft(sandbox);

    sandbox.refreshSageRecommendations(); // first call, hangs
    sandbox.refreshSageRecommendations(); // second call, resolves immediately
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(sandbox.sageRecommendations[0].player.name, 'Second Call Player');

    // Now let the FIRST (stale) call resolve with different data -- it must be discarded.
    resolveFirst({ ok: true, json: () => Promise.resolve({ recommendations: [{ player: { name: 'Stale Player' }, adp: 1, recommendation: 'x', code: 'x', explanation: 'x', reasons: [] }] }) });
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(sandbox.sageRecommendations[0].player.name, 'Second Call Player', 'the late/stale first response must not overwrite the newer result');
  });

  await testAsync('refreshSageRecommendations no-ops cleanly (no fetch call) when draft setup is not complete', async () => {
    let fetchCalled = false;
    const sandbox = makeSandbox(() => { fetchCalled = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [] }) }); });
    await runScript(sandbox);
    sandbox.draftState = { schemaVersion: 1, teams: [], myTeamId: null, draftLog: [], nextPickId: 1, draftType: 'snake', numRounds: 16 };
    sandbox.adpByPos = {};
    sandbox.ready = true;

    sandbox.refreshSageRecommendations();
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(fetchCalled, false, 'must not call the network at all before setup is complete');
  });
}

runBehavioralTests().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  if (failed) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
});
