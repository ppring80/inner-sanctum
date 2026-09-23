'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'chat.js'), 'utf8');

assert.ok(!source.includes('x-rapidapi-key'), 'customer chat must not contain a RapidAPI credential path');
assert.ok(!source.includes('fetchTank01('), 'customer chat must not call Tank01 directly');
assert.ok(source.includes('getStore({ name: "camp-watch" })'), 'customer chat reads cached news');
assert.ok(source.includes('getStore({ name: "adp-snapshot" })'), 'customer chat reads cached ADP');
assert.ok(source.includes('getStore({ name: "player-data" })'), 'customer chat reads cached player injury data');
assert.ok(source.includes('STALE SNAPSHOT'), 'customer chat labels stale injury evidence');
assert.ok(source.includes('Do not describe cached data as newer than it is.'), 'customer chat forbids false freshness claims');

console.log('Customer chat Tank01 cache-only assertions passed.');
