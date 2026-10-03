#!/usr/bin/env node
'use strict';

// scripts/run-super-sage-week4-acceptance.js
//
// Offline Week 4 Super SAGE acceptance harness. Builds the shared decision
// record for The Vanilla Gorilla roster and prints what decided every slot.
// Uses production-rankings.json when captured, otherwise the stated-evidence
// fixture (only the facts in the brief; it reports every evidence gap).

const fs = require('fs');
const path = require('path');
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision.js');
const { toMcpLineup, toWebsiteLineup, decisionOf } = require('../netlify/functions/_super-sage-lineup-presenters.js');
const { fromSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'super-sage-week4');

function loadInputs(preferStated) {
  const roster = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));
  const capture = path.join(DIR, 'production-rankings.json');
  const useCapture = !preferStated && fs.existsSync(capture);
  const rankings = JSON.parse(fs.readFileSync(useCapture ? capture : path.join(DIR, 'stated-evidence-rankings.json'), 'utf8'));
  // Observed workload: an as-of-week opportunity snapshot, if one has been
  // captured. Absent => recorded as a gap, never substituted.
  const oppPath = path.join(DIR, 'production-opportunity.json');
  const opportunity = useCapture && fs.existsSync(oppPath)
    ? fromSnapshot(JSON.parse(fs.readFileSync(oppPath, 'utf8')), { season: roster.season, week: roster.week, key: 'production-opportunity.json' })
    : null;
  return { roster, rankings, opportunity, kind: useCapture ? 'production capture' : 'stated evidence only (not a production export)' };
}

function run({ preferStated = false } = {}) {
  const { roster, rankings, opportunity, kind } = loadInputs(preferStated);
  const record = buildLineupDecisionRecord({
    rankings, roster: roster.roster, slots: roster.slots, scoring: roster.scoring, season: roster.season, week: roster.week, opportunity
  });
  return { record, roster, rankings, kind, mcp: toMcpLineup(record), website: toWebsiteLineup(record) };
}

function report(result) {
  const { record, roster, kind, mcp, website } = result;
  const lines = [];
  lines.push(`SUPER SAGE WEEK 4 ACCEPTANCE — ${kind}`);
  lines.push(`decisionId ${record.decisionId}`);
  lines.push(`scope: ${record.decisionScope} — ${record.rosterValue.note}`);
  lines.push(`policy ${record.policy.version}: projection-noise band ${record.policy.projectionNoiseBand}; near-zero projection ${record.policy.nearZeroProjection}`);
  const oo = record.observedOpportunity;
  lines.push(`observed opportunity: ${oo.status}${oo.reason ? ` — ${oo.reason}` : ''}${oo.provenance && oo.provenance.weeksIncluded ? ` (weeks ${oo.provenance.weeksIncluded.join(',')})` : ''}`);
  lines.push('');
  record.slots.forEach((slot) => {
    const e = slot.explanation;
    lines.push(`[${slot.slotLabel}] ${e.headline}`);
    lines.push(`  decided by: ${slot.decidedBy}; confidence ${slot.confidence.label} (${slot.confidence.rules.join('; ') || 'no qualifying rules'})`);
    e.why.forEach((w) => lines.push(`  why: ${w}`));
    e.materialFacts.forEach((m) => lines.push(`  material: ${m}`));
    e.whatCouldChange.forEach((w) => lines.push(`  could change: ${w}`));
    if (slot.reassessedFrom) lines.push(`  set aside (REASSESS): ${slot.reassessedFrom}`);
    if (slot.gate) {
      lines.push(`  comparison with ${slot.comparator.name}: class ${slot.gate.comparisonClass}, resolution ${slot.gate.resolution}`);
      (slot.gate.classReasons || []).forEach((r) => lines.push(`    class reason: ${r}`));
      slot.gate.conditions.forEach((c) => lines.push(`  gate ${c.passed ? 'PASS' : 'FAIL'} ${c.code}: ${c.detail}`));
      (slot.gate.notAdmissible || []).forEach((n) => lines.push(`  non-decisive ${n.code} ${n.player}: ${JSON.stringify(n.value)} — ${n.reason}`));
      slot.blockedChallengers.forEach((b) => lines.push(`  challenger ${b.name} (${b.position}): class ${b.comparisonClass}, resolution ${b.resolution}, failed [${b.failed.join(', ')}]${b.classReasons.length ? ` — ${b.classReasons.join(' ')}` : ''}`));
    }
    lines.push('');
  });
  const everyone = [...new Map([...record.slots.flatMap((s) => [s.starter, s.comparator, ...(s.candidates || [])]), ...record.bench, ...record.unavailable]
    .filter(Boolean).map((p) => [p.name, p])).values()];
  lines.push('BASELINE VALIDITY');
  everyone.forEach((p) => {
    const v = p.baselineValidity;
    lines.push(`  ${p.name.padEnd(18)} ${String(p.position).padEnd(3)} ${p.baseline.positionRank != null ? (p.position + p.baseline.positionRank).padEnd(5) : '—    '} ${v.state.padEnd(11)} ${v.authority.padEnd(33)} status ${v.effectiveStatus ? `${v.effectiveStatus.reported} (${v.effectiveStatus.source})` : '—'}`);
    v.triggers.forEach((t) => lines.push(`      trigger ${t.code}: ${t.detail}`));
  });
  lines.push('');
  lines.push('FLEX-ELIGIBLE EVIDENCE PACKETS');
  everyone.filter((p) => ['RB', 'WR', 'TE'].includes(p.position) && p.baselineValidity.state !== 'UNAVAILABLE').forEach((p) => {
    const pr = p.projection;
    lines.push(`  ${p.name} (${p.position}${p.baseline.positionRank}, ${p.baseline.tier}, SAGE confidence ${p.baseline.confidenceLabel}) projection ${pr.admissible ? `${pr.points} ${pr.source}${pr.fresh ? ' fresh' : ''}` : 'n/a'}; matchup ${p.matchup}`);
    lines.push(`      observed: ${p.observedOpportunity ? JSON.stringify({ avgLast3: p.observedOpportunity.avgLast3, lastGame: p.observedOpportunity.lastGame, trend: p.observedOpportunity.observedTrend || null }) : 'none'}`);
    lines.push(`      established role: ${p.establishedRole.status}${p.establishedRole.level ? ` (${p.establishedRole.level})` : ''} — ${p.establishedRole.description || p.establishedRole.reason}`);
    lines.push(`      role expansion: claimed ${p.roleExpansion.claimed}, validated ${p.roleExpansion.validated} — ${p.roleExpansion.note}`);
    lines.push(`      expected opportunity (promoted signals): ${p.expectedOpportunity.length ? JSON.stringify(p.expectedOpportunity) : 'none'}; uncertainty: ${p.uncertainty.map((u) => u.text).join('; ') || 'none'}`);
  });
  lines.push('');
  lines.push(`Bench (START/SIT only; not a DROP signal): ${record.bench.map((p) => p.name).join(', ') || '—'}`);
  lines.push(`Unavailable: ${record.unavailable.map((p) => `${p.name} (${p.availability.rosterStatus || p.availability.injuryStatus})`).join(', ') || '—'}`);
  record.benchWatch.forEach((w) => lines.push(`Watch: ${w.player} — ${w.notes.join(' ')}`));
  const gaps = [...new Map([...record.slots.flatMap((s) => s.starter ? [s.starter] : (s.candidates || [])), ...record.bench].map((p) => [p.name, p])).values()].filter((p) => p && p.uncertainty.some((u) => u.code === 'MISSING_WEEKLY_SAGE_STANDING'));
  if (gaps.length) lines.push(`Evidence gaps (no Weekly SAGE rank/tier): ${gaps.map((p) => p.name).join(', ')}`);
  const reported = roster.productionLineupReported || [];
  const chosen = record.slots.map((s) => s.starter ? s.starter.name : `NO CALL (${s.slotLabel})`);
  lines.push(`Reported current production lineup: ${reported.join(', ')}`);
  lines.push(`Super SAGE lineup:                  ${chosen.join(', ')}`);
  lines.push(`MCP and website express the same decision: ${JSON.stringify(decisionOf(mcp)) === JSON.stringify(decisionOf(website))}`);
  return lines.join('\n');
}

if (require.main === module) {
  const result = run({ preferStated: process.argv.includes('--stated') });
  console.log(report(result));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result.record, null, 2));
}

module.exports = { run, report, loadInputs };
