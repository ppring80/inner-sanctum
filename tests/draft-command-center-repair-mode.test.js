// Regression lock for Draft Command Center historical-pick repair.
// Executes the real gate and Draft Command Center scripts from draft.html.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failed++;
    failures.push(`${name} :: ${error.message}`);
  }
}

const html = fs.readFileSync(path.join(__dirname, '../draft.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const gateScript = inlineScripts.find((script) => script.includes('function isPreviewBlocked'));
const mainScript = inlineScripts.find((script) => script.includes('function undoLastPick'));

assert.ok(gateScript, 'draft.html gate script must be present');
assert.ok(mainScript, 'draft.html main script must be present');

function fakeElement() {
  const classes = new Set();
  return {
    value: '',
    style: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    innerHTML: '',
    textContent: '',
    checked: false,
    disabled: false,
    dataset: {},
    appendChild() {},
    remove() {},
    focus() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getContext() { return null; },
  };
}

function makeSandbox() {
  const elements = {};
  const storage = {};
  const document = {
    body: { firstChild: null, insertBefore() {} },
    getElementById(id) {
      if (!elements[id]) elements[id] = fakeElement();
      return elements[id];
    },
    createElement: fakeElement,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const webStorage = {
    getItem: (key) => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    setItem: (key, value) => { storage[key] = String(value); },
    removeItem: (key) => { delete storage[key]; },
  };
  const sandbox = {
    document,
    localStorage: webStorage,
    sessionStorage: webStorage,
    window: {
      PLAYER_POOL: { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] },
      addEventListener() {},
    },
    fetch(url) {
      if (String(url).includes('/.netlify/functions/adp')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ players: [] }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    },
    console,
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    alert() {},
    confirm: () => true,
    fetchTank01PlayerMap: () => Promise.resolve({}),
    applyLiveTeamsFromTank01: (teams) => teams,
    normalizePlayerName: (name) => String(name || '').toLowerCase(),
  };
  vm.createContext(sandbox);
  vm.runInContext(gateScript, sandbox);
  vm.runInContext(mainScript, sandbox);

  // Repair tests exercise state transitions, not rendering or the network.
  sandbox.render = () => {};
  sandbox.refreshSageRecommendations = () => {};
  sandbox.saveDraftState = () => {};
  sandbox.closeReassignModal = function closeReassignModalForTest() {
    sandbox.currentReassignId = null;
  };
  return sandbox;
}

function configureDraft(sandbox, draftType = 'snake') {
  sandbox.draftState.teams = Array.from({ length: 10 }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Team ${index + 1}`,
  }));
  sandbox.draftState.myTeamId = 'team-1';
  sandbox.draftState.draftType = draftType;
  sandbox.draftState.numRounds = 16;
  sandbox.draftState.nextPickId = 1;
  sandbox.draftState.draftLog = [];
  sandbox.draftState.keepers = [];
}

function expectedTeamForPick(pickNumber, draftType = 'snake') {
  if (draftType === 'manual') return `team-${((pickNumber + 2) % 10) + 1}`;
  const round = Math.ceil(pickNumber / 10);
  const position = ((pickNumber - 1) % 10) + 1;
  const slot = draftType === 'linear' || round % 2 === 1 ? position : 11 - position;
  return `team-${slot}`;
}

function seedPicks(sandbox, count, draftType = 'snake', wrongPick43 = false) {
  for (let pick = 1; pick <= count; pick++) {
    sandbox.draftState.draftLog.push({
      id: sandbox.draftState.nextPickId++,
      pickNumber: pick,
      player: `Player ${pick}`,
      pos: ['QB', 'RB', 'WR', 'TE'][pick % 4],
      teamId: wrongPick43 && pick === 43 ? 'team-10' : expectedTeamForPick(pick, draftType),
    });
  }
}

function pickNumbers(sandbox) {
  return sandbox.draftState.draftLog.map((entry) => entry.pickNumber);
}

test('source exposes Undo Last Pick and Correct Historical Pick controls', () => {
  assert.ok(html.includes('onclick="undoLastPick()"'));
  assert.ok(html.includes('<div class="modal-ttl">Correct Historical Pick</div>'));
  assert.ok(html.includes('title="Correct historical pick"'));
  assert.ok(html.includes('Edit Pick &middot;'));
  assert.ok(html.includes('.prow.drafted{opacity:1;text-decoration:none;background:#f8f7f4}'));
  assert.ok(html.includes('.prow.drafted .pname{text-decoration:line-through}'));
  assert.ok(html.includes('.pcard.drafted{opacity:1;background:#f8f7f4}'));
  assert.ok(html.includes('.pcard.drafted .cname{text-decoration:line-through}'));
  assert.ok(html.includes('The player and pick number will stay the same.'));
  assert.ok(html.includes('Fantasy team that drafted this player'));
  assert.ok(html.includes('Remove Pick Completely'));
  assert.ok(html.includes('Save Team Change'));
  assert.ok(html.includes('onclick="applyReassign()"'));
});

test('full pick 1-47 scenario records the wrong team only at pick 43', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  assert.strictEqual(sandbox.draftState.draftLog.length, 47);
  assert.notStrictEqual(sandbox.draftState.draftLog[42].teamId, expectedTeamForPick(43));
});

test('repeated undo rolls picks 47 through 43 back in descending order', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  const removed = [];
  sandbox.confirm = (message) => { removed.push(Number(message.match(/pick #(\d+)/)[1])); return true; };
  for (let i = 0; i < 5; i++) sandbox.undoLastPick();
  assert.deepStrictEqual(removed, [47, 46, 45, 44, 43]);
  assert.deepStrictEqual(pickNumbers(sandbox), Array.from({ length: 42 }, (_, i) => i + 1));
});

test('rollback preserves picks 1-42 exactly', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  const original = JSON.stringify(sandbox.draftState.draftLog.slice(0, 42));
  for (let i = 0; i < 5; i++) sandbox.undoLastPick();
  assert.strictEqual(JSON.stringify(sandbox.draftState.draftLog), original);
});

test('removed players become available in the rebuilt draft index', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  for (let i = 0; i < 5; i++) sandbox.undoLastPick();
  const index = sandbox.buildDraftIndex();
  for (let pick = 43; pick <= 47; pick++) {
    const pos = ['QB', 'RB', 'WR', 'TE'][pick % 4];
    assert.strictEqual(index[sandbox.playerKey(`Player ${pick}`, pos)], undefined);
  }
});

test('corrected pick 43 can be re-entered and draft can continue', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  for (let i = 0; i < 5; i++) sandbox.undoLastPick();
  seedPicks(sandbox, 0);
  [43, 44, 45, 46, 47, 48].forEach((pick) => {
    sandbox.draftState.draftLog.push({
      id: sandbox.draftState.nextPickId++, pickNumber: pick, player: `Corrected ${pick}`,
      pos: 'WR', teamId: expectedTeamForPick(pick),
    });
  });
  assert.strictEqual(sandbox.nextPickNumber(), 49);
  assert.strictEqual(sandbox.draftState.draftLog.find((entry) => entry.pickNumber === 43).teamId, expectedTeamForPick(43));
});

test('repair sequence leaves no duplicate players', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  for (let i = 0; i < 5; i++) sandbox.undoLastPick();
  for (let pick = 43; pick <= 47; pick++) {
    sandbox.draftState.draftLog.push({ id: sandbox.draftState.nextPickId++, pickNumber: pick, player: `Player ${pick}`, pos: ['QB', 'RB', 'WR', 'TE'][pick % 4], teamId: expectedTeamForPick(pick) });
  }
  const keys = sandbox.draftState.draftLog.map((entry) => sandbox.playerKey(entry.player, entry.pos));
  assert.strictEqual(new Set(keys).size, keys.length);
});

['snake', 'linear', 'manual'].forEach((draftType) => {
  test(`repeated undo works in ${draftType} mode`, () => {
    const sandbox = makeSandbox();
    configureDraft(sandbox, draftType);
    seedPicks(sandbox, 5, draftType);
    sandbox.undoLastPick();
    sandbox.undoLastPick();
    assert.deepStrictEqual(pickNumbers(sandbox), [1, 2, 3]);
    assert.strictEqual(sandbox.nextPickNumber(), 4);
  });
});

test('undo at draft start is a safe no-op', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  let alertMessage = '';
  sandbox.alert = (message) => { alertMessage = message; };
  sandbox.undoLastPick();
  assert.strictEqual(sandbox.draftState.draftLog.length, 0);
  assert.strictEqual(alertMessage, 'No picks logged yet.');
});

test('Undo Last Pick removes the highest pickNumber, not array tail', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 5);
  sandbox.draftState.draftLog.reverse();
  sandbox.undoLastPick();
  assert.deepStrictEqual(pickNumbers(sandbox).sort((a, b) => a - b), [1, 2, 3, 4]);
});

test('Correct Historical Pick changes only team ownership', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 47, 'snake', true);
  const before = { ...sandbox.draftState.draftLog[42] };
  sandbox.currentReassignId = before.id;
  sandbox.document.getElementById('reassignTeamSel').value = expectedTeamForPick(43);
  sandbox.applyReassign();
  const after = sandbox.draftState.draftLog[42];
  assert.deepStrictEqual(
    { id: after.id, pickNumber: after.pickNumber, player: after.player, pos: after.pos },
    { id: before.id, pickNumber: before.pickNumber, player: before.player, pos: before.pos }
  );
  assert.strictEqual(after.teamId, expectedTeamForPick(43));
  assert.strictEqual(sandbox.draftState.draftLog.length, 47);
});

test('removing a pick restores roster membership derived from draftLog', () => {
  const sandbox = makeSandbox();
  configureDraft(sandbox);
  seedPicks(sandbox, 3);
  const removed = sandbox.draftState.draftLog[1];
  sandbox.removePickById(removed.id);
  assert.strictEqual(sandbox.draftState.draftLog.some((entry) => entry.id === removed.id), false);
  assert.strictEqual(sandbox.draftState.draftLog.filter((entry) => entry.teamId === removed.teamId).length, 0);
});

test('auction repair remains a separate implementation', () => {
  const auctionHtml = fs.readFileSync(path.join(__dirname, '../auction.html'), 'utf8');
  assert.ok(auctionHtml.includes('function removePick(id)'));
  assert.ok(auctionHtml.includes('state.draftLog'));
  assert.ok(!mainScript.includes('function removePick(id)'));
});

console.log(`Draft Command Center repair regression: ${passed} passed, ${failed} failed`);
if (failures.length) failures.forEach((failure) => console.error('FAIL:', failure));
process.exit(failed ? 1 : 0);
