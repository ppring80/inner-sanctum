'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../free-agents.html'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Could not extract ' + name);
}

const sandbox = { boardSort: 'sage' };
vm.createContext(sandbox);
['sage', 'bestPriority', 'sagePositionTier', 'sortRows'].forEach((name) => {
  vm.runInContext(extractFunction(name), sandbox);
});

function player(name, position, rank) {
  return {
    name,
    position,
    verdict: 'PASS',
    evidence: { sage: { position, positionRank: rank } }
  };
}

const sorted = sandbox.sortRows([
  player('Defense Six', 'DEF', 6),
  player('Kicker Seven', 'K', 7),
  player('Receiver Twenty', 'WR', 20),
  player('Quarterback Twelve', 'QB', 12),
  player('Runner Fifteen', 'RB', 15),
  player('Tight End Eighteen', 'TE', 18),
  player('Flex Twenty Five', 'FLEX', 25)
]);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sorted.map((item) => item.name))),
  [
    'Quarterback Twelve',
    'Runner Fifteen',
    'Tight End Eighteen',
    'Receiver Twenty',
    'Flex Twenty Five',
    'Defense Six',
    'Kicker Seven'
  ],
  'QB/RB/WR/TE/FLEX must appear before K/DEF when Weekly SAGE is selected'
);

sandbox.boardSort = 'best';
const original = [
  player('Defense Six', 'DEF', 6),
  player('Receiver Twenty', 'WR', 20)
];
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.sortRows(original).map((item) => item.name))),
  original.map((item) => item.name),
  'Best For Me ordering must remain unchanged'
);

console.log('free-agents-sage-sort.test.js passed');
