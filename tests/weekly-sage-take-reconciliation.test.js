'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, '..', 'weekly-lineup-polish.js');
delete require.cache[require.resolve(modulePath)];
const reconcile = require(modulePath);

const mahomesRaw = "Bench-caliber Week 1 outlook, and a difficult matchup doesn't help. Best as a depth option this week.";
const mahomesStart = reconcile.reconcileSageTake(mahomesRaw, { call: 'start', slot: 'QB' });
assert(mahomesStart.includes("Bench-caliber Week 1 outlook"), 'preserves the negative weekly outlook');
assert(mahomesStart.includes('difficult matchup'), 'preserves the matchup analysis');
assert(!mahomesStart.includes('Best as a depth option'), 'removes the contradictory raw action');
assert(mahomesStart.includes('belongs in your starting lineup'), 'reconciles the personalized START decision');

const flexRaw = 'Strong starter profile with the matchup working in his favor. Confident start.';
const flexStart = reconcile.reconcileSageTake(flexRaw, { call: 'start', slot: 'FLEX' });
assert(flexStart.includes('Strong starter profile'), 'preserves positive outlook');
assert(!flexStart.includes('Confident start'), 'removes raw generic action');
assert(flexStart.includes('earns a FLEX spot'), 'explains personalized FLEX assignment');

const benchRaw = 'Elite Week 1 profile with a favorable matchup on top. Keep him locked in.';
const bench = reconcile.reconcileSageTake(benchRaw, { call: 'sit', slot: 'BENCH' });
assert(bench.includes('Elite Week 1 profile'), 'preserves strong player/week evaluation');
assert(!bench.includes('Keep him locked in'), 'removes contradictory raw START action');
assert(bench.includes('stronger roster option keeps him on your bench'), 'reconciles personalized BENCH decision');

const defensePolishedRaw = 'Elite Week 1 profile with a favorable matchup on top. Keep NE locked in.';
const defenseBench = reconcile.reconcileSageTake(defensePolishedRaw, { call: 'sit', slot: 'BENCH' });
assert(defenseBench.includes('Elite Week 1 profile'), 'preserves DEF outlook after defense-copy polish');
assert(!defenseBench.includes('Keep NE locked in'), 'removes team-specific DEF action before roster action is appended');
assert(defenseBench.includes('keeps him on your bench'), 'reconciles DEF bench decision deterministically');

const negativeBenchRaw = 'Bench-caliber Week 1 outlook. Best as a depth option this week.';
const negativeBench = reconcile.reconcileSageTake(negativeBenchRaw, { call: 'sit', slot: 'BENCH' });
assert(negativeBench.includes('Bench-caliber Week 1 outlook'), 'preserves negative bench outlook');
assert(negativeBench.includes('keeps him on your bench'), 'keeps roster decision explicit');

const untouched = reconcile.reconcileSageTake(mahomesRaw, null);
assert.strictEqual(untouched, mahomesRaw, 'global/non-personalized SAGE Take remains unchanged');

console.log('weekly-sage-take-reconciliation.test.js passed');
