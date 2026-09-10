const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'provider-adapters.js'), 'utf8');

assert.match(source, /function guardLegacyEspnConnectForm\(\)/, 'safe ESPN fallback guard must exist');
assert.match(source, /#espnLeagueType, #espnPrivateFields, #espnS2, #espnSwid/, 'guard must detect every legacy ESPN credential control');
assert.match(source, /No League ID, Public\/Private selection, Developer Tools, SWID or espn_s2 copy\/paste is required\./, 'safe customer copy must explicitly replace the legacy workflow');
assert.match(source, /Inner Sanctum Connect is not active in this browser yet\./, 'missing extension must produce a supported-browser message');
assert.match(source, /Never paste ESPN cookies or session values here\./, 'fallback must never instruct customers to paste session values');
assert.match(source, /id=\"espnResult\"/, 'extension-compatible ESPN result hook must remain');
assert.match(source, /class=\"connect-btn\"/, 'extension-compatible ESPN connect button must remain');

console.log('espn-connect-safe-fallback: PASS');
