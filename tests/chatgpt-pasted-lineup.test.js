'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../netlify/functions/chatgpt-mcp.js'),
  'utf8'
);

assert.ok(source.includes('"pasted_roster"'));
assert.ok(source.includes('buildLineupSlotsFromPastedRoster'));
assert.ok(source.includes('When present, this roster always takes precedence over any linked league.'));
assert.ok(source.includes('Never silently substitute the linked roster for a '));
assert.ok(source.includes('roster supplied in the conversation. Use this for phrasings '));
assert.ok(source.includes('const snapshot = usingPastedRoster'));
assert.ok(source.includes('The pasted roster was used instead of any linked league.'));
assert.ok(source.includes('pasted roster did not include a valid league team count'));
assert.ok(source.includes('pasted roster did not include a recognized scoring format'));

const normalizers = require('../netlify/functions/inner-sanctum-ranking-normalizers');

assert.strictEqual(normalizers.isUnavailableRosterStatus('O'), true);
assert.strictEqual(normalizers.isUnavailableRosterStatus('OUT'), true);
assert.strictEqual(normalizers.isUnavailableRosterStatus('D'), false);

console.log('12 pasted-lineup tool assertions passed, 0 failed.');
