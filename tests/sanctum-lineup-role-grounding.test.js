'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../sanctum.html'), 'utf8');

assert.ok(
  source.includes("A player appearing under BENCH in the user's fantasy lineup means only that the user benched him"),
  'Trash Lord must distinguish fantasy bench placement from NFL depth-chart role'
);
assert.ok(
  source.includes("They do not establish any player\\'s real NFL depth-chart role"),
  'lineup request must explicitly ground every persona against unsupported role inference'
);
assert.ok(
  source.includes("Do not call a benched fantasy player an NFL backup, buried, demoted, or losing work"),
  'lineup request must prohibit specific unsupported role claims'
);
assert.ok(
  source.includes("unless verified role evidence is explicitly provided"),
  'role claims must require explicit verified evidence'
);

console.log('sanctum-lineup-role-grounding.test.js passed');
