'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const functionsDir = path.join(__dirname, '..', 'netlify', 'functions');
const providerFiles = fs.readdirSync(functionsDir)
  .filter(name => name.endsWith('.js'))
  .filter(name => fs.readFileSync(path.join(functionsDir, name), 'utf8').includes('x-rapidapi-key'));

const intentionallyInertOrCacheOnly = new Set([
  'adp.js',
  'weekly-sage-defense-week.js'
]);

for (const name of providerFiles) {
  const source = fs.readFileSync(path.join(functionsDir, name), 'utf8');
  if (intentionallyInertOrCacheOnly.has(name)) continue;
  assert.ok(
    source.includes('requireTank01Budget'),
    `${name} reaches Tank01 but is not protected by the shared daily budget`
  );
}

const adp = fs.readFileSync(path.join(functionsDir, 'adp.js'), 'utf8');
assert.ok(adp.includes('cacheOnly: true'));
const defense = fs.readFileSync(path.join(functionsDir, 'weekly-sage-defense-week.js'), 'utf8');
assert.ok(defense.includes('deliberately inert'));

console.log(`${providerFiles.length} Tank01 provider files covered by budget or cache-only boundaries.`);
