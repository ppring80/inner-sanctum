'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../survivor.html'), 'utf8');
const match = source.match(/function hasUsableOdds\(games\)\{[\s\S]*?\n\}/);

assert.ok(match, 'survivor.html must define hasUsableOdds');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[0], sandbox);

assert.strictEqual(sandbox.hasUsableOdds([]), false);
assert.strictEqual(sandbox.hasUsableOdds([{ awayWinPct: null, homeWinPct: null, spread: null }]), false);
assert.strictEqual(sandbox.hasUsableOdds([{ awayWinPct: null, homeWinPct: null, spread: -3.5 }]), true);
assert.strictEqual(sandbox.hasUsableOdds([{ awayWinPct: null, homeWinPct: null, spread: 0 }]), true);
assert.strictEqual(sandbox.hasUsableOdds([{ awayWinPct: 55, homeWinPct: null, spread: null }]), true);
assert.strictEqual(sandbox.hasUsableOdds([{ awayWinPct: null, homeWinPct: 55, spread: null }]), true);

assert.match(source, /var hasOdds=hasUsableOdds\(games\)/);
assert.match(source, /if\(!hasOdds\)\{\s*showNotice/);
assert.match(source, /if\(hasWinProbabilities&&sorted\.length\)/);

console.log('survivor-odds-banner.test.js passed');
