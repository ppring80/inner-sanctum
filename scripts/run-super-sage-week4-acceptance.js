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

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'super-sage-week4');

function loadInputs(preferStated) {
  const roster = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));
  const capture = path.join(DIR, 'production-rankings.json');
  const useCapture = !preferStated && fs.existsSync(capture);
  const rankings = JSON.parse(fs.readFileSync(useCapture ? capture : path.join(DIR, 'stated-evidence-rankings.json'), 'utf8'));
  return { roster, rankings, kind: useCapture ? 'production capture' : 'stated evidence only (not a production export)' };
}

function run({ preferStated = false } = {}) {
  const { roster, rankings, kind } = loadInputs(preferStated);
  const record = buildLineupDecisionRecord({
    rankings, roster: roster.roster, slots: roster.slots, scoring: roster.scoring, season: roster.season, week: roster.week
  });
  return { record, roster, rankings, kind, mcp: toMcpLineup(record), website: toWebsiteLineup(record) };
}

function report(result) {
  const { record, roster, kind, mcp, website } = result;
  const lines = [];
  lines.push(`SUPER SAGE WEEK 4 ACCEPTANCE — ${kind}`);
  lines.push(`decisionId ${record.decisionId}`);
  lines.push('');
  record.slots.forEach((slot) => {
    const e = slot.explanation;
    lines.push(`[${slot.slotLabel}] ${e.headline}`);
    lines.push(`  decided by: ${slot.decidedBy}; confidence ${slot.confidence.label} (${slot.confidence.rules.join('; ') || 'no qualifying rules'})`);
    e.why.forEach((w) => lines.push(`  why: ${w}`));
    e.materialFacts.forEach((m) => lines.push(`  material: ${m}`));
    e.whatCouldChange.forEach((w) => lines.push(`  could change: ${w}`));
    if (slot.gate) slot.gate.conditions.forEach((c) => lines.push(`  gate ${c.passed ? 'PASS' : 'FAIL'} ${c.code}: ${c.detail}`));
    lines.push('');
  });
  lines.push(`Bench: ${record.bench.map((p) => p.name).join(', ') || '—'}`);
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
