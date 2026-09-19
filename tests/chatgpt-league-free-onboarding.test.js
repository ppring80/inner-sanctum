'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const oauthSource = fs.readFileSync(
  path.join(__dirname, '../netlify/functions/chatgpt-oauth.js'),
  'utf8'
);

const mcpSource = fs.readFileSync(
  path.join(__dirname, '../netlify/functions/chatgpt-mcp.js'),
  'utf8'
);

assert.ok(
  oauthSource.includes('No league is required for rankings, comparisons, profiles, or draft outlooks.')
);
assert.ok(
  oauthSource.includes('selected = {\n        provider: null,\n        link: null')
);
assert.ok(
  oauthSource.includes('approveButton.disabled =\n        false;')
);
assert.ok(
  oauthSource.includes('if (linkToken) {')
);
assert.ok(
  oauthSource.includes('snapshotKey:\n      values.snapshotKey ||\n      null')
);
assert.ok(
  !oauthSource.includes('A valid Inner Sanctum league link is required.')
);
assert.ok(
  !oauthSource.includes('No ChatGPT-ready league is linked in this browser.')
);

assert.ok(
  mcpSource.includes('let snapshot =\n    null;\n\n  if (snapshotKey) {')
);
assert.ok(
  !mcpSource.includes('The access token is not bound to a linked league.')
);
assert.strictEqual(
  (mcpSource.match(/https:\/\/theinnersanctum\.xyz\/connect-league/g) || []).length,
  2
);
assert.strictEqual(
  (mcpSource.match(/error:\s*"league_not_connected"/g) || []).length,
  2
);

console.log('11 ChatGPT league-free onboarding assertions passed, 0 failed.');
