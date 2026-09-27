'use strict';

// tests/vendor-integrity.test.js
//
// Pins vendored third-party files (see vendor/README.md) so any change to them
// is explicit in review, and confirms the QR library stays side-effect free.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const QR_FILE = path.join(ROOT, 'vendor', 'qrcode-generator-2.0.4.js');
const QR_SHA256 = '79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c';

const source = fs.readFileSync(QR_FILE);
assert.strictEqual(crypto.createHash('sha256').update(source).digest('hex'), QR_SHA256,
  'vendor/qrcode-generator-2.0.4.js changed; update vendor/README.md and this pin deliberately');

const text = source.toString('utf8');
assert.ok(text.includes('Copyright (c) 2009 Kazuhiko Arase') && text.includes('MIT license'), 'license header retained');
['fetch(', 'XMLHttpRequest', 'eval(', 'new Function', 'document.', 'window.', 'localStorage']
  .forEach((needle) => assert.ok(!text.includes(needle), 'vendored QR library must not use ' + needle));

assert.ok(fs.readFileSync(path.join(ROOT, 'mobile-connect.js'), 'utf8')
  .includes('var QR_SCRIPT_SRC = "/vendor/qrcode-generator-2.0.4.js";'), 'mobile-connect.js loads the pinned file');

// The library runs in an empty sandbox (no DOM, no network) and produces a matrix.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(text, sandbox);
const qr = sandbox.qrcode(0, 'M');
qr.addData('https://theinnersanctum.xyz/connect-league?handoff=' + 'A'.repeat(43), 'Byte');
qr.make();
assert.strictEqual(qr.getModuleCount(), 41, 'a handoff link encodes as a version 6 QR code');

console.log('vendor-integrity.test.js: PASS');
