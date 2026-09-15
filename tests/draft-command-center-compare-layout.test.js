'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../draft.html'), 'utf8');

assert.ok(source.includes('.ptable .compare-cell{width:82px;min-width:82px;text-align:center'));
assert.ok(source.includes('.ptable .compare-cell .cmp-row-btn{display:block;width:72px;margin:0 auto'));
assert.strictEqual((source.match(/<th class="compare-cell">Compare<\/th>/g) || []).length, 2);
assert.strictEqual((source.match(/<td class="compare-cell"><button class="act-btn cmp-row-btn"/g) || []).length, 2);
assert.ok(source.includes("onclick=\"addCmp("), 'existing Compare behavior must remain wired');

console.log('draft-command-center-compare-layout.test.js passed');
