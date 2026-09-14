'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../draft.html'), 'utf8');

assert.ok(source.includes('.ptable .pick-action-cell{width:72px;min-width:72px;text-align:center'));
assert.ok(source.includes('.ptable .compare-cell{width:82px;min-width:82px;text-align:center'));
assert.ok(source.includes('.ptable .compare-cell .cmp-row-btn{display:block;width:72px;margin:0 auto'));
assert.ok(source.includes("return amIOnClockNow?'Draft':'Pick';"));
assert.strictEqual((source.match(/<th class="pick-action-cell">Pick<\/th><th class="compare-cell">Compare<\/th>/g) || []).length, 2);
assert.strictEqual((source.match(/<td class=\\?"pick-action-cell\\?">/g) || []).length, 2);
assert.strictEqual((source.match(/<td class=\\?"compare-cell\\?"><button class=\\?"act-btn cmp-row-btn/g) || []).length, 2);
assert.ok(source.includes('draftActionLabel(amIOnClockNow)'), 'full action wording must remain available');
assert.ok(source.includes('onclick="addCmp('), 'Compare behavior must remain wired');

console.log('draft-command-center-action-width.test.js passed');
