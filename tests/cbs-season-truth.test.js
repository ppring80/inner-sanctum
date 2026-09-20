'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const connector = fs.readFileSync(
  path.join(__dirname, '..', 'cbs-extension', 'cbs-browser-connector.js'),
  'utf8'
);
const connectPage = fs.readFileSync(path.join(__dirname, '..', 'connect-league.html'), 'utf8');

assert.ok(
  connector.includes('function findSeasonInDocument(doc)'),
  'CBS connector must distinguish explicit season evidence from a calendar fallback'
);
assert.ok(
  connector.includes('const seasonEvidence = {'),
  'CBS multi-page capture must retain season evidence for each source page'
);
assert.ok(
  connector.includes('if (explicitSeasons.length > 1)'),
  'CBS capture must reject mixed-season source pages'
);
assert.ok(
  connector.includes('Open the current-season team page and sync again.'),
  'CBS mixed-season failure must give the customer a recovery action'
);
assert.match(
  connectPage,
  /window\.receiveCbsConnection\s*=\s*async function/,
  'CBS receiver must be able to wait for the linked ChatGPT snapshot refresh'
);
assert.match(
  connectPage,
  /await refreshChatGptLinkIfNeeded\(\s*"cbs"\s*\)/,
  'CBS success must wait for the ChatGPT roster snapshot refresh'
);

console.log('cbs-season-truth.test.js passed');
