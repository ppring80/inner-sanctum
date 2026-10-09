'use strict';
const assert = require('node:assert/strict');
const { validateBackfieldCoverage } = require('../netlify/functions/_super-sage-rookie-backfield-checks');
const { validate } = require('../netlify/functions/_super-sage-shadow-fast-review');
const { VERSION } = require('../netlify/functions/_super-sage-rookie-drill');
const packet = { requireBackfieldExplanation: true, players: [{ id: 'B', name: 'Saquon Barkley', position: 'RB', facts: [
  { factId: 'B:availability', field: 'availability', value: { status: 'QUESTIONABLE' } },
  { factId: 'B:roleExpansion', field: 'roleExpansion', value: { validated: false } },
  { factId: 'B:backfieldContext', field: 'backfieldContext', value: { reportedRoles: { candidateListedRank: 1, players: [{ name: 'Saquon Barkley', listedRank: 1, status: 'QUESTIONABLE' }, { name: 'Tank Bigsby', listedRank: 2, status: 'IR' }, { name: 'Will Shipley', listedRank: 3, status: 'UNKNOWN' }], nextListedAlternative: { name: 'Will Shipley', status: 'UNKNOWN' }, notListedInChart: ['Dameon Pierce'] } } }
] }] };
const before = JSON.stringify(packet);
const answer = { selected: 'B', confidence: 'LOW', explanation: "I'd lean Barkley, but he remains questionable. Bigsby is on IR, leaving Shipley next on the chart, with his health unknown; Pierce is missing from the chart. We don't know how the work would change.", caveat: 'Barkley remains questionable.', reconsider: 'New availability evidence.', factIds: packet.players[0].facts.map(f => f.factId) };
assert.deepEqual(validateBackfieldCoverage(answer, packet), []);
for (const [from, to, code] of [ ['his health unknown', 'his chart position third', 'missing_alternative_health_uncertainty'], ['Bigsby is on IR', 'Bigsby is second', 'missing_unavailable_back_context'], ['Pierce is missing from the chart', 'Pierce is another option', 'missing_uncharted_alternative'], ["We don't know how the work would change", 'The work will increase', 'missing_workload_uncertainty'] ]) assert(validateBackfieldCoverage({ ...answer, explanation: answer.explanation.replace(from, to) }, packet).includes(code));
assert(validateBackfieldCoverage({ ...answer, factIds: ['B:availability'] }, packet).includes('missing_backfield_citation'));
const omitted = { ...answer, explanation: "I'd start Barkley because his projected points give him a reliable floor." };
assert(validate(omitted, packet).includes('missing_next_listed_alternative'));
assert.equal(validate(omitted, packet).filter(e => e === 'unsupported_floor_comparison').length, 1);
assert.equal(VERSION, 'rookie-sonnet-drill-v13-human-voice', 'spent budgets and saved history keep their namespace');
assert.equal(JSON.stringify(packet), before);
console.log('PASS: role-change omissions rejected, unknown health and unverified work retained, floor errors deduplicated, immutable packet and unchanged budget version. No provider calls.');
