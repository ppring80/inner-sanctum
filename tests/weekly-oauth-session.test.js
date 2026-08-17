// tests/weekly-oauth-session.test.js
//
// Confirms weekly.html now calls checkOAuthSession() on load, matching
// sanctum.html/tiers.html/draft.html/auction.html -- the gap found
// during the Aug 17 2026 giveaway redemption design inspection.
//
// This executes the REAL script extracted from the real weekly.html
// file (via Node's built-in `vm` module, no new dependency) against a
// minimal set of fake globals -- not a reimplementation of the gate
// logic, and not just a text/grep check. Deliberately does not use
// jsdom or any other new package, consistent with this pass's file
// scope (package.json is not one of the files this change is allowed
// to touch).
//
// Run: node tests/weekly-oauth-session.test.js

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

const weeklyHtml = fs.readFileSync(path.join(__dirname, '../weekly.html'), 'utf8');

// Extract the actual gate <script> block (the one containing
// checkGatePasscode, same identifying pattern used elsewhere in this
// test suite family) -- this is the REAL, current file content, not a
// copy pasted into the test.
function extractGateScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const gateScript = scripts.find((s) => s.includes('checkGatePasscode'));
  if (!gateScript) throw new Error('Could not find the gate <script> block in weekly.html');
  return gateScript;
}

test('weekly.html source now defines checkOAuthSession (the gap this pass fixes)', () => {
  const script = extractGateScript(weeklyHtml);
  assert.ok(/function\s+checkOAuthSession\s*\(/.test(script), 'checkOAuthSession() must be defined');
});
test('weekly.html\'s initGate() now calls checkOAuthSession()', () => {
  const script = extractGateScript(weeklyHtml);
  const initGateBody = script.slice(script.indexOf('(function initGate()'));
  assert.ok(initGateBody.includes('checkOAuthSession()'), 'initGate() must call checkOAuthSession()');
});
test('weekly.html\'s checkOAuthSession() is byte-identical to draft.html\'s (deliberate duplication, not drift)', () => {
  const draftHtml = fs.readFileSync(path.join(__dirname, '../draft.html'), 'utf8');
  function extractFunctionBody(html, fnName) {
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes(fnName + '('));
    const start = script.indexOf('function ' + fnName);
    // Grab up to the matching closing brace at the same nesting level as a simple heuristic:
    // count braces from the function's opening brace.
    let depth = 0, i = script.indexOf('{', start), end = i;
    for (; i < script.length; i++) {
      if (script[i] === '{') depth++;
      if (script[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return script.slice(start, end);
  }
  const weeklyFn = extractFunctionBody(weeklyHtml, 'checkOAuthSession');
  const draftFn = extractFunctionBody(draftHtml, 'checkOAuthSession');
  assert.strictEqual(weeklyFn, draftFn);
});

// ─────────────────────────────────────────────────────────
// Real behavioral execution: run the actual extracted script in a
// sandboxed context with minimal fake globals, and prove
// checkOAuthSession() really does call unlockGate() on a successful
// session check -- not just that the function exists.
// ─────────────────────────────────────────────────────────
async function runBehavioralTests() {
  await testAsync('executing the real weekly.html gate script: a valid session (fullAccess:true) unlocks the gate', async () => {
    const script = extractGateScript(weeklyHtml);

    let overlayHidden = false;
    let fetchCalledWith = null;

    const fakeDocument = {
      getElementById: (id) => {
        if (id === 'gateOverlay') {
          return { style: { set display(v) { overlayHidden = (v === 'none'); }, get display() { return overlayHidden ? 'none' : ''; } } };
        }
        if (id === 'gateInput' || id === 'gateError') {
          return { value: '', classList: { add() {}, remove() {} }, focus() {} };
        }
        return null;
      },
    };
    const fakeSessionStorage = {
      _data: {},
      getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
      setItem(k, v) { this._data[k] = v; },
    };
    const fakeFetch = (url, opts) => {
      fetchCalledWith = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ fullAccess: true }) });
    };

    const sandbox = { document: fakeDocument, sessionStorage: fakeSessionStorage, fetch: fakeFetch, console };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);

    // The script's own top-level IIFE (initGate) already ran synchronously
    // during vm.runInContext above; checkOAuthSession() is async, so give
    // its promise chain a tick to resolve.
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(fetchCalledWith, '/.netlify/functions/verify-session', 'initGate must have triggered a real call to verify-session');
    assert.strictEqual(overlayHidden, true, 'a successful session check must hide the gate overlay (unlockGate())');
  });

  await testAsync('executing the real weekly.html gate script: no valid session (fullAccess:false) leaves the gate up', async () => {
    const script = extractGateScript(weeklyHtml);

    let overlayHidden = false;
    const fakeDocument = {
      getElementById: (id) => {
        if (id === 'gateOverlay') {
          return { style: { set display(v) { overlayHidden = (v === 'none'); }, get display() { return overlayHidden ? 'none' : ''; } } };
        }
        return { value: '', classList: { add() {}, remove() {} }, focus() {} };
      },
    };
    const fakeSessionStorage = { getItem: () => null, setItem() {} };
    const fakeFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ fullAccess: false }) });

    const sandbox = { document: fakeDocument, sessionStorage: fakeSessionStorage, fetch: fakeFetch, console };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(overlayHidden, false, 'the gate must stay up when there is no valid session');
  });

  await testAsync('executing the real weekly.html gate script: an already-unlocked sessionStorage flag skips the network call entirely', async () => {
    const script = extractGateScript(weeklyHtml);

    let fetchCalled = false;
    let overlayHidden = false;
    const fakeDocument = {
      getElementById: (id) => {
        if (id === 'gateOverlay') {
          return { style: { set display(v) { overlayHidden = (v === 'none'); }, get display() { return overlayHidden ? 'none' : ''; } } };
        }
        return { value: '', classList: { add() {}, remove() {} }, focus() {} };
      },
    };
    const fakeSessionStorage = { getItem: (k) => (k === 'sanctum_acolyte_unlock' ? 'true' : null), setItem() {} };
    const fakeFetch = () => { fetchCalled = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({ fullAccess: true }) }); };

    const sandbox = { document: fakeDocument, sessionStorage: fakeSessionStorage, fetch: fakeFetch, console };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(overlayHidden, true, 'already-unlocked via sessionStorage must still hide the overlay');
    assert.strictEqual(fetchCalled, false, 'must not bother calling verify-session when already unlocked locally');
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
