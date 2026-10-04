'use strict';

// tests/super-sage-opportunity-leakage.test.js
//
// The temporal guard must derive the evidence window from the raw
// observations (_rawGames[].week and the gameID date), never from the cache's
// weeksRequested metadata. Tamper cases operate on an in-memory deep copy of
// the frozen production fixture; the file itself is never modified.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fromSnapshot, validateSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'super-sage-week4', 'production-opportunity.json');
const FIXTURE_SHA256 = 'f61b4443e0ecb6546e7f4f67b420f5b9afc3a397a6653e9b7e4a0df0ed6188da';
const bytes = fs.readFileSync(FIXTURE);
const fresh = () => JSON.parse(bytes.toString('utf8'));
const AS_OF = { season: 2026, week: 4 };

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

test('the frozen fixture is byte-identical to the verified production export', () => {
  assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256);
});

test('the clean production fixture passes and reports the weeks actually observed (1, 2, 3)', () => {
  const o = fromSnapshot(fresh(), { ...AS_OF, key: 'production-opportunity.json' });
  assert.strictEqual(o.status, 'AVAILABLE');
  assert.deepStrictEqual(o.provenance.weeksIncluded, [1, 2, 3]);
  assert.strictEqual(o.provenance.rawGamesChecked, 1064);
  assert.deepStrictEqual(o.provenance.declaredWeeksRequested, [3]);
  assert.strictEqual(o.provenance.declaredMatchesObserved, false, 'metadata is recorded, not trusted');
  assert.strictEqual(o.provenance.temporalAuthority, '_rawGames[].week and gameID date');
});

test('an injected Week 4 raw game is rejected as leakage', () => {
  const s = fresh();
  s.records['blake corum|RB']._rawGames.push({ week: 4, gameID: '20261001_LAR@PHI', carries: 12, targets: 2, opportunities: 14 });
  const o = fromSnapshot(s, AS_OF);
  assert.strictEqual(o.status, 'REJECTED');
  assert.match(o.reason, /week 4, at or after decision week 4 \(leakage\)/);
});

test('a future-dated observation is rejected even when it claims an early week', () => {
  const s = fresh();
  s.records['courtland sutton|WR']._rawGames.push({ week: 3, gameID: '20261005_DEN@SF', carries: 0, targets: 9, opportunities: 9 });
  const o = fromSnapshot(s, AS_OF);
  assert.strictEqual(o.status, 'REJECTED');
  assert.match(o.reason, /dated after the snapshot was computed/);
});

test('misleading weeksRequested metadata cannot launder a Week 4 observation', () => {
  const s = fresh();
  s.weeksRequested = [1, 2, 3];
  s.records['emmett johnson|RB']._rawGames.push({ week: 4, gameID: '20261004_KC@LV', carries: 9, targets: 1, opportunities: 10 });
  assert.strictEqual(fromSnapshot(s, AS_OF).status, 'REJECTED');
});

test('misleading weeksRequested metadata cannot reject or narrow clean observations either', () => {
  const s = fresh();
  s.weeksRequested = [9];
  const o = fromSnapshot(s, AS_OF);
  assert.strictEqual(o.status, 'AVAILABLE');
  assert.deepStrictEqual(o.provenance.weeksIncluded, [1, 2, 3]);
});

test('fails closed when temporal safety cannot be established', () => {
  const cases = {
    'raw game without a week': (s) => { delete s.records['malik nabers|WR']._rawGames[0].week; },
    'raw game without a dated gameID': (s) => { s.records['malik nabers|WR']._rawGames[0].gameID = 'unknown'; },
    'record without _rawGames': (s) => { delete s.records['jakobi meyers|WR']._rawGames; },
    'missing computedAt': (s) => { delete s.computedAt; },
    'missing season': (s) => { delete s.season; },
    'game outside the season': (s) => { s.records['malik nabers|WR']._rawGames[0].gameID = '20250913_DAL@NYG'; },
    'no records at all': (s) => { s.records = {}; }
  };
  Object.entries(cases).forEach(([label, tamper]) => {
    const s = fresh(); tamper(s);
    assert.strictEqual(fromSnapshot(s, AS_OF).status, 'REJECTED', label);
  });
});

test('a decision cutoff rejects observations on or after it', () => {
  assert.strictEqual(validateSnapshot(fresh(), { ...AS_OF, decisionCutoff: '2026-10-02T00:15:00Z' }).ok, true);
  const early = validateSnapshot(fresh(), { ...AS_OF, decisionCutoff: '2026-09-27T00:00:00Z' });
  assert.strictEqual(early.ok, false, 'Week 3 games on/after Sept 27 must be rejected for an earlier cutoff');
});

test('every roster RB/WR/TE record in the admitted snapshot contains only Weeks 1-3', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'super-sage-week4', 'roster.json'), 'utf8')).roster;
  const o = fromSnapshot(fresh(), AS_OF);
  const keys = Object.keys(o.records);
  roster.filter((p) => ['RB', 'WR', 'TE'].includes(p.position)).forEach((p) => {
    const key = keys.find((k) => k.startsWith(p.name.toLowerCase()) && k.endsWith('|' + p.position));
    assert.ok(key, p.name);
    o.records[key]._rawGames.forEach((g) => assert.ok(g.week <= 3, `${p.name} week ${g.week}`));
  });
});

console.log('super-sage-opportunity-leakage.test.js: ' + passed + ' passed');
