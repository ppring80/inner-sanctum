'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
const block = toml.match(/\[functions\."refresh-super-sage-evidence"\]\s*schedule\s*=\s*"([^"]+)"/);
assert(block, 'Super SAGE must have a native Netlify schedule');
assert.equal(block[1], '30 14 * 9-12 2,5', 'Preserve existing Tuesday/Friday UTC schedule');
assert(!fs.existsSync(path.join(root, '.github/workflows/super-sage-evidence-refresh.yml')),
  'Credential-dependent GitHub scheduler must not remain active');
const writer = require('../netlify/functions/refresh-super-sage-evidence');
assert.equal(typeof writer.handler, 'function', 'Reuse existing evidence writer unchanged');
console.log('Super SAGE native scheduling configuration PASS');
