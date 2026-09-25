const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const providerAdapters = fs.readFileSync(
  path.join(root, 'provider-adapters.js'),
  'utf8'
);
const connectLeague = fs.readFileSync(
  path.join(root, 'connect-league.html'),
  'utf8'
);

// Customer continuity: the website must not overwrite the legacy ESPN form.
assert.doesNotMatch(
  providerAdapters,
  /function guardLegacyEspnConnectForm\(\)/,
  'legacy ESPN form must remain available as a fallback'
);

// Protect the previously working manual ESPN connection path.
assert.match(connectLeague, /id=\"espnLeagueId\"/);
assert.match(connectLeague, /id=\"espnLeagueType\"/);
assert.match(connectLeague, /id=\"espnPrivateFields\"/);
assert.match(connectLeague, /id=\"espnS2\"/);
assert.match(connectLeague, /id=\"espnSwid\"/);
assert.match(connectLeague, /onclick=\"connectEspn\(\)\"/);
assert.match(connectLeague, /\/\.netlify\/functions\/espn-league/);
assert.match(connectLeague, /LeagueConnection\.connect\(\s*\"espn\"/);

console.log('espn-legacy-fallback-restored: PASS');
