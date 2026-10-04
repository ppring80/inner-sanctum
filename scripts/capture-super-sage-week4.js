#!/usr/bin/env node
'use strict';

// scripts/capture-super-sage-week4.js
//
// Saves the REAL production Weekly SAGE rankings response for the Week 4
// Super SAGE acceptance case, so the offline harness runs on actual values.
// Read-only: one GET to the public rankings endpoint (no provider refresh).
//
//   node scripts/capture-super-sage-week4.js [--base https://theinnersanctum.xyz]

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'super-sage-week4');
const roster = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));
const i = process.argv.indexOf('--base');
const base = i >= 0 ? process.argv[i + 1] : 'https://theinnersanctum.xyz';

(async () => {
  const params = new URLSearchParams({ season: String(roster.season), week: String(roster.week), seasonType: 'reg', scoring: roster.scoring, teams: String(roster.teams) });
  const url = `${base}/.netlify/functions/weekly-sage-rankings?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const body = await res.json();
  if (!res.ok || !body.positions) throw new Error(`Rankings unavailable (HTTP ${res.status}): ${body.error || 'no positions'}`);
  const missing = Object.entries(body.positions).filter(([, rows]) => !Array.isArray(rows) || !rows.length).map(([p]) => p);
  if (missing.length) throw new Error(`Rankings incomplete; refusing to capture. Missing: ${missing.join(', ')}`);
  const out = { source: `Captured from ${url} at ${new Date().toISOString()}`, ...body };
  fs.writeFileSync(path.join(DIR, 'production-rankings.json'), JSON.stringify(out, null, 2));
  console.log(`Saved production-rankings.json (${Object.values(body.positions).reduce((n, r) => n + r.length, 0)} rows).`);
})().catch((err) => { console.error(err.message); process.exit(1); });
