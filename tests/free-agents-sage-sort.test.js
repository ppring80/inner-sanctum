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

assert.ok(
  source.includes("boardSort='sage'"),
  'Free Agents must initialize with SAGE Advice selected'
);
assert.ok(
  source.includes('<option value="sage">SAGE Advice</option><option value="best">Best For My Team</option>'),
  'SAGE Advice must be the first customer-facing sort option'
);
assert.ok(
  source.includes("boardPosition='ALL';boardSort='sage';renderDecisionBoard()"),
  'rendering new league data must restore the SAGE Advice default'
);

console.log('free-agents-sage-sort.test.js passed');

// REVIEW must not visually overstate an unproven weekly rank edge as an upgrade.
const impactSandbox = {};
vm.createContext(impactSandbox);
['escapeHtml', 'impact', 'sage', 'rosterImpactCell'].forEach((name) => {
  vm.runInContext(extractFunction(name), impactSandbox);
});
const reviewImpact = impactSandbox.rosterImpactCell({
  name: 'Brock Purdy',
  position: 'QB',
  verdict: 'REVIEW',
  decision: {
    reasonCode: 'UPGRADE_EVIDENCE_INSUFFICIENT',
    evidence: {
      sage: { position: 'QB', positionRank: 11 },
      rosterImpact: {
        classification: 'UPGRADE',
        weakestComparable: {
          name: 'Patrick Mahomes',
          sage: { position: 'QB', positionRank: 14 }
        }
      }
    }
  }
});
assert.ok(reviewImpact.includes('Weekly Rank Edge'), 'insufficient-evidence REVIEW must use a neutral weekly-rank label');
assert.ok(reviewImpact.includes('QB11 · Patrick Mahomes QB14'), 'neutral label must show both weekly ranks');
assert.ok(!reviewImpact.includes('↑ Upgrade'), 'insufficient-evidence REVIEW must not claim a proven upgrade');
assert.ok(!reviewImpact.includes('over Patrick Mahomes'), 'insufficient-evidence REVIEW must not imply a replacement');

const provenImpact = impactSandbox.rosterImpactCell({
  name: 'Proven Upgrade',
  position: 'RB',
  verdict: 'ADD_NOW',
  decision: {
    reasonCode: 'PROVEN_UPGRADE',
    evidence: {
      sage: { position: 'RB', positionRank: 8 },
      rosterImpact: {
        classification: 'UPGRADE',
        weakestComparable: {
          name: 'Current Starter',
          sage: { position: 'RB', positionRank: 24 }
        }
      }
    }
  }
});
assert.ok(provenImpact.includes('↑ Upgrade'), 'proven ADD NOW upgrade must retain the green upgrade label');
assert.ok(provenImpact.includes('over Current Starter RB24'), 'proven upgrade must retain replacement context');

console.log('free-agents roster-impact presentation assertions passed');
