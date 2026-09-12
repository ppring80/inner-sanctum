'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const redirectsPath = path.join(__dirname, '..', '_redirects');
const redirects = fs.readFileSync(redirectsPath, 'utf8');
const activeRules = redirects
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const HTTPS_RULE = 'https://www.theinnersanctum.xyz/* https://theinnersanctum.xyz/:splat 301!';
const HTTP_RULE = 'http://www.theinnersanctum.xyz/* https://theinnersanctum.xyz/:splat 301!';

assert(
  activeRules.includes(HTTPS_RULE),
  'www HTTPS traffic must permanently redirect to the apex HTTPS host while preserving the path'
);

assert(
  activeRules.includes(HTTP_RULE),
  'www HTTP traffic must permanently redirect to the apex HTTPS host while preserving the path'
);

assert(
  !activeRules.some((line) => /^https:\/\/theinnersanctum\.xyz\//.test(line.split(/\s+/)[0])),
  'the apex host must not be redirected away from itself'
);

console.log('Patreon canonical-host regression tests passed.');
