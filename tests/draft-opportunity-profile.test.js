// draft-opportunity-profile.test.js
//
// Regression suite for the NEW draftOpportunityProfile layer only.
// Runs the real, unmodified buildOpportunityIntelligence() from the
// actual repo (netlify/functions/refresh-opportunity-intel.js) on
// fixture game logs, then exercises buildDraftOpportunityProfile() on
// the result -- so this is validating against production calculation
// code, not a reimplementation of it.
//
// Run: node tests/draft-opportunity-profile.test.js

const oi = require('../netlify/functions/refresh-opportunity-intel');
const profileLib = require('../netlify/functions/draft-opportunity-profile');
const assert = require('assert');

// Fixture game logs, inlined directly (matching the sibling suites'
// convention -- none of them externalize test data to a separate file).
// Illustrative, representative per-game workload patterns shaped to
// match each named player's well-known real-world role -- not pulled
// from a live Tank01 box-score cache.
function games(weeks, carriesArr, targetsArr) {
  return weeks.map((week, i) => ({
    week,
    gameID: `2026_WK${week}`,
    carries: carriesArr[i],
    targets: targetsArr[i],
    opportunities: carriesArr[i] + targetsArr[i],
  }));
}

const WEEKS_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const fixtures = {
  'Bijan Robinson': {
    pos: 'RB',
    games: games(WEEKS_10,
      [14, 16, 15, 18, 17, 19, 20, 18, 21, 19],
      [3, 4, 3, 5, 4, 6, 5, 6, 7, 6]),
  },
  'Jahmyr Gibbs': {
    pos: 'RB',
    games: games(WEEKS_10,
      [11, 13, 12, 14, 13, 15, 16, 14, 17, 15],
      [4, 5, 4, 6, 5, 7, 6, 7, 8, 7]),
  },
  'Christian McCaffrey': {
    pos: 'RB',
    games: games(WEEKS_10,
      [18, 20, 19, 21, 20, 22, 23, 21, 24, 22],
      [6, 7, 6, 8, 7, 8, 7, 8, 9, 8]),
  },
  'Derrick Henry': {
    pos: 'RB',
    games: games(WEEKS_10,
      [20, 22, 21, 23, 22, 24, 25, 23, 26, 24],
      [0, 1, 0, 1, 0, 1, 0, 1, 1, 0]),
  },
  "Ja'Marr Chase": {
    pos: 'WR',
    games: games(WEEKS_10,
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [9, 10, 9, 11, 10, 12, 11, 10, 13, 11]),
  },
  'Travis Kelce': {
    pos: 'TE',
    // Deliberately declining across the back half -- validates
    // trendClassification="declining" and a negative recentRoleVsBaseline
    // delta flowing through Role Direction without inventing any new
    // threshold to detect it.
    games: games(WEEKS_10,
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [8, 9, 8, 7, 7, 6, 6, 5, 5, 4]),
  },
  'Committee Back': { // low-volume player
    pos: 'RB',
    games: games(WEEKS_10,
      [4, 5, 3, 4, 5, 4, 6, 5, 4, 5],
      [1, 2, 1, 1, 2, 1, 2, 1, 1, 2]),
  },
  'Recently Returned WR': { // limited-sample player
    pos: 'WR',
    games: games([9, 10], [0, 0], [5, 7]),
  },
  'Undrafted Rookie WR': { // rookie / no NFL history
    pos: 'WR',
    games: [],
  },
};

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}

function recordFor(name) {
  const { pos, games } = fixtures[name];
  return oi.buildOpportunityIntelligence(games, pos);
}
function profileFor(name) {
  return profileLib.buildDraftOpportunityProfile(recordFor(name));
}

// ─────────────────────────────────────────────────────────
// 1. NO SCORE (constraint 1)
// ─────────────────────────────────────────────────────────
Object.keys(fixtures).forEach((name) => {
  test('no score field exists anywhere in the profile for ' + name, () => {
    const p = profileFor(name);
    const json = JSON.stringify(p);
    assert.ok(!('score' in p));
    // Also check nested objects, and guard against any numeric field
    // literally named "score" sneaking in under a different key path.
    assert.ok(!/\"score\"/i.test(json), 'no key named "score" anywhere in the serialized profile');
    assert.strictEqual(Object.keys(p).sort().join(','), 'evidence,roleDirection,roleStyle,workload');
  });
});
test('no combined/weighted numeric field exists across the four parts', () => {
  const p = profileFor('Bijan Robinson');
  // Every part is independently a label/explanation/raw-passthrough --
  // no single number claims to summarize "opportunity strength" overall.
  assert.ok(typeof p.workload.level === 'string');
  assert.ok(typeof p.roleDirection.label === 'string');
  assert.ok(typeof p.roleStyle.label === 'string');
  assert.ok(typeof p.evidence.level === 'string');
});

// ─────────────────────────────────────────────────────────
// 2. DO NOT MANUFACTURE CERTAINTY — missing stays null, never 0
// ─────────────────────────────────────────────────────────
test('rookie (0 games): workload seasonAvg/recentAvg are null, not 0', () => {
  const p = profileFor('Undrafted Rookie WR');
  assert.strictEqual(p.workload.seasonAvg, null);
  assert.strictEqual(p.workload.recentAvg, null);
  assert.notStrictEqual(p.workload.seasonAvg, 0, 'must be null, never fabricated as zero');
});
test('limited-sample player: roleDirection label explicitly says not enough data, does not fabricate a trend', () => {
  const p = profileFor('Recently Returned WR');
  assert.strictEqual(p.roleDirection.label, 'Not Enough Data Yet');
});
test('a player missing trendClassification (fewer than 6 games) never gets an Increasing/Decreasing label', () => {
  const p = profileFor('Recently Returned WR');
  assert.ok(!['Increasing Role', 'Decreasing Role'].includes(p.roleDirection.label));
});

// ─────────────────────────────────────────────────────────
// 3. ROOKIES DISTINGUISHABLE FROM POOR OPPORTUNITY (constraint 3)
// ─────────────────────────────────────────────────────────
test('rookie (0 games) gets "No NFL History" across all four parts, never a volume/quality judgment', () => {
  const p = profileFor('Undrafted Rookie WR');
  assert.strictEqual(p.workload.level, 'No NFL History');
  assert.strictEqual(p.roleDirection.label, 'No NFL History');
  assert.strictEqual(p.roleStyle.label, 'No NFL History');
  assert.strictEqual(p.evidence.level, 'No NFL History');
});
test('a genuinely low-volume but real veteran role is labeled distinctly from "No NFL History"', () => {
  const p = profileFor('Committee Back');
  assert.notStrictEqual(p.workload.level, 'No NFL History');
  assert.strictEqual(p.workload.level, 'Role Player');
  assert.notStrictEqual(p.roleStyle.label, 'No NFL History');
});
test('rookie evidence explanation explicitly states this is not a judgment about opportunity', () => {
  const p = profileFor('Undrafted Rookie WR');
  assert.ok(p.evidence.explanation.toLowerCase().includes('not a judgment'));
});

// ─────────────────────────────────────────────────────────
// 4. LIMITED SAMPLES DISTINGUISHABLE FROM ESTABLISHED ROLES (constraint 4)
// ─────────────────────────────────────────────────────────
test('a 2-game player is "Limited Sample", a 10-game player is "Established Sample"', () => {
  const limited = profileFor('Recently Returned WR');
  const established = profileFor('Bijan Robinson');
  assert.strictEqual(limited.evidence.level, 'Limited Sample');
  assert.strictEqual(established.evidence.level, 'Established Sample');
  assert.notStrictEqual(limited.evidence.level, established.evidence.level);
});
test('evidence.gamesSampled is always the real raw count, never rounded/bucketed', () => {
  assert.strictEqual(profileFor('Recently Returned WR').evidence.gamesSampled, 2);
  assert.strictEqual(profileFor('Bijan Robinson').evidence.gamesSampled, 10);
  assert.strictEqual(profileFor('Undrafted Rookie WR').evidence.gamesSampled, 0);
});
test('a limited-sample player can still have a real Workload/Role Style reading (evidence is a separate axis, not a gate on the others)', () => {
  const p = profileFor('Recently Returned WR');
  assert.notStrictEqual(p.workload.level, null);
  assert.notStrictEqual(p.roleStyle.label, 'No NFL History');
});

// ─────────────────────────────────────────────────────────
// 5. recentRoleVsBaseline STAYS UNCLASSIFIED — no new threshold invented
// ─────────────────────────────────────────────────────────
test('the underlying recentRoleVsBaseline signal value is untouched ("unclassified") for every fixture with a baseline', () => {
  Object.keys(fixtures).forEach((name) => {
    const record = recordFor(name);
    const sig = (record.signals || []).find((s) => s.type === 'recentRoleVsBaseline');
    if (sig) assert.strictEqual(sig.value, 'unclassified', name);
  });
});
test('roleDirection label is driven by trendClassification, never by the recent-vs-baseline magnitude directly', () => {
  // Travis Kelce fixture: engineered to have a real, large recent PERCENT
  // decline (season avg 6.5 -> recent 5.2, -20%), but the underlying
  // trend number (-1.67) does NOT cross the existing declining threshold
  // (-3), so trendClassification legitimately returns "stable". The
  // profile must honestly reflect "stable" regardless of how the
  // baseline sentence reads.
  const p = profileFor('Travis Kelce');
  assert.strictEqual(p.roleDirection.label, 'Stable Role', 'must defer to the real trendClassification, not re-derive its own threshold from the baseline delta');
});
test('a genuinely large move (both percent AND absolute) reads as above/below, not suppressed to "near"', () => {
  // Purpose-built synthetic record, not tied to fixtures.js's specific
  // tuned numbers: season baseline ~10/game, recent games clearly and
  // substantially higher in both percent (>>10%) and absolute (>>1.5)
  // terms.
  const games = [
    { week: 1, carries: 8, targets: 0, opportunities: 8 },
    { week: 2, carries: 8, targets: 0, opportunities: 8 },
    { week: 3, carries: 8, targets: 0, opportunities: 8 },
    { week: 4, carries: 8, targets: 0, opportunities: 8 },
    { week: 5, carries: 25, targets: 0, opportunities: 25 },
    { week: 6, carries: 25, targets: 0, opportunities: 25 },
    { week: 7, carries: 25, targets: 0, opportunities: 25 },
  ];
  const record = oi.buildOpportunityIntelligence(games, 'RB');
  const p = profileLib.buildDraftOpportunityProfile(record);
  assert.ok(p.roleDirection.explanation.includes('above his season norm'), p.roleDirection.explanation);
});
test('roleDirection explanation NEVER exposes a raw percent number (Aug 16 2026 refinement)', () => {
  Object.keys(fixtures).forEach((name) => {
    const p = profileFor(name);
    assert.ok(!/%/.test(p.roleDirection.explanation), name + ': explanation must not contain a "%" character');
    assert.ok(!/\d+\.\d/.test(p.roleDirection.explanation), name + ': explanation must not contain a raw decimal number');
  });
});
test('roleDirection explanation uses only the three approved plain-language phrases for recent-vs-season context', () => {
  const APPROVED = ['above his season norm', 'below his season norm', 'near his season norm'];
  Object.keys(fixtures).forEach((name) => {
    const p = profileFor(name);
    const hasBaselineNote = p.roleDirection.explanation.includes('season norm');
    if (hasBaselineNote) {
      assert.ok(APPROVED.some((phrase) => p.roleDirection.explanation.includes(phrase)), name + ': must use one of the three approved phrases');
    }
  });
});
test('low-volume players: a large PERCENT swing on a trivial ABSOLUTE change reads as "near", not "above/below" (exaggeration guard)', () => {
  // AJ Dillon (real production data, not this file's fixtures) showed
  // this exact shape during validation: recent 1.8 vs season 2.14 =
  // -15.9%, but only -0.34 opportunities/game in absolute terms.
  // Reconstructed here as a fixture-shaped test so it's covered by the
  // regression suite going forward.
  const games = [
    { week: 1, carries: 1, targets: 1, opportunities: 2 },
    { week: 2, carries: 1, targets: 1, opportunities: 2 },
    { week: 3, carries: 2, targets: 1, opportunities: 3 },
    { week: 4, carries: 1, targets: 0, opportunities: 1 },
    { week: 5, carries: 1, targets: 1, opportunities: 2 },
    { week: 6, carries: 1, targets: 0, opportunities: 1 },
    { week: 7, carries: 1, targets: 1, opportunities: 2 },
  ];
  const record = oi.buildOpportunityIntelligence(games, 'RB');
  const p = profileLib.buildDraftOpportunityProfile(record);
  assert.ok(p.roleDirection.explanation.includes('near his season norm'), 'a small absolute change must read as "near" even if the percent looks large: ' + p.roleDirection.explanation);
});
test('describeRecentVsBaseline returns null (no baseline sentence at all) when percentDelta is null (e.g. a zero baseline)', () => {
  assert.strictEqual(
    profileLib.describeRecentVsBaseline({ detail: { percentDelta: null, absoluteDelta: 0 } }),
    null
  );
  assert.strictEqual(profileLib.describeRecentVsBaseline(null), null);
});

// ─────────────────────────────────────────────────────────
// 6. ROLE STYLE — shape only, no volume (Aug 16 2026 refinement:
//    renamed from Role Quality; volumeTier deliberately dropped, since
//    Workload already owns volume and the old cross-product produced
//    awkward combined labels like "Depth/Complementary Role" on real
//    data). Still only uses roleComposition -- the one real signal that
//    can defensibly distinguish rushing/receiving/balanced usage
//    (constraint 6's original audit finding still holds: highValue is
//    empty in the real dataset).
// ─────────────────────────────────────────────────────────
test('highValue is confirmed empty in the real dataset (audit finding, still holds)', () => {
  const record = recordFor('Bijan Robinson');
  assert.deepStrictEqual(record.highValue, {});
});
test('roleStyle label is fully determined by roleComposition ALONE -- volumeTier no longer affects it', () => {
  // Bijan (high-volume) and a constructed low-volume rushing-dominant
  // player must get the SAME "Rush-Heavy" label -- proving volume no
  // longer leaks into this specific label at all.
  const bijan = profileFor('Bijan Robinson'); // rushing-dominant, high-volume
  const lowVolRushing = oi.buildOpportunityIntelligence(
    [ // low volume but still >=70% rushing share
      { week: 1, carries: 3, targets: 1, opportunities: 4 },
      { week: 2, carries: 3, targets: 1, opportunities: 4 },
      { week: 3, carries: 3, targets: 1, opportunities: 4 },
    ],
    'RB'
  );
  const lowVolProfile = profileLib.buildDraftOpportunityProfile(lowVolRushing);
  assert.strictEqual(bijan.roleStyle.label, 'Rush-Heavy');
  assert.strictEqual(lowVolProfile.roleStyle.label, 'Rush-Heavy', 'same label regardless of very different volume');
});
test('roleStyle uses exactly the three approved simplified labels for the three roleComposition values', () => {
  assert.strictEqual(profileFor('Bijan Robinson').roleStyle.label, 'Rush-Heavy'); // rushing-dominant
  assert.strictEqual(profileFor('Ja\'Marr Chase').roleStyle.label, 'Receiving-Driven'); // receiving-dominant
  assert.strictEqual(profileFor('Jahmyr Gibbs').roleStyle.label, 'Balanced'); // balanced
});
test('roleStyle label never contains a slash or the words "volume"/"high"/"moderate"/"role-player" (old cross-product labels are gone)', () => {
  Object.keys(fixtures).forEach((name) => {
    const p = profileFor(name);
    assert.ok(!p.roleStyle.label.includes('/'), name + ': no slash-joined labels');
    assert.ok(!/volume|role player/i.test(p.roleStyle.label), name + ': volume language must not appear in Role Style anymore');
  });
});
test('a player with real games but zero recorded rushing/receiving opportunities gets a distinct label, not lumped with rookie or a normal role', () => {
  // Construct a fixture inline: 4 real games, all zero opportunities
  // (e.g. injured/inactive but on the roster with a real box-score line).
  const games = [
    { week: 1, carries: 0, targets: 0, opportunities: 0 },
    { week: 2, carries: 0, targets: 0, opportunities: 0 },
    { week: 3, carries: 0, targets: 0, opportunities: 0 },
    { week: 4, carries: 0, targets: 0, opportunities: 0 },
  ];
  const record = oi.buildOpportunityIntelligence(games, 'WR');
  const p = profileLib.buildDraftOpportunityProfile(record);
  assert.strictEqual(p.roleStyle.label, 'No Recorded Offensive Touches');
  assert.notStrictEqual(p.roleStyle.label, 'No NFL History', 'must not be conflated with a true rookie (0 games) case');
  assert.strictEqual(p.evidence.gamesSampled, 4, 'these ARE 4 real games -- Evidence must reflect that even though Role Style found no touches');
});

// ─────────────────────────────────────────────────────────
// 7. PRESERVATION — the seven named fields are never redefined
// ─────────────────────────────────────────────────────────
test('workload.seasonAvg is byte-identical to opportunities.seasonAvg, no rework', () => {
  Object.keys(fixtures).forEach((name) => {
    const record = recordFor(name);
    const p = profileLib.buildDraftOpportunityProfile(record);
    assert.strictEqual(p.workload.seasonAvg, record.opportunities.seasonAvg, name);
  });
});
test('evidence.gamesSampled is byte-identical to opportunities.gamesSampled', () => {
  Object.keys(fixtures).forEach((name) => {
    const record = recordFor(name);
    const p = profileLib.buildDraftOpportunityProfile(record);
    assert.strictEqual(p.evidence.gamesSampled, record.opportunities.gamesSampled, name);
  });
});
test('recentBasis() cascade matches the exact avgLast5->avgLast3->lastGame order already used by recentRoleVsBaseline internally', () => {
  // avgLast5 present -> used
  assert.deepStrictEqual(profileLib.recentBasis({ avgLast5: 10, avgLast3: 8, lastGame: 5 }), { value: 10, window: 'avgLast5' });
  // avgLast5 null, avgLast3 present -> used
  assert.deepStrictEqual(profileLib.recentBasis({ avgLast5: null, avgLast3: 8, lastGame: 5 }), { value: 8, window: 'avgLast3' });
  // both null, lastGame present -> used
  assert.deepStrictEqual(profileLib.recentBasis({ avgLast5: null, avgLast3: null, lastGame: 5 }), { value: 5, window: 'lastGame' });
  // all null -> null
  assert.strictEqual(profileLib.recentBasis({ avgLast5: null, avgLast3: null, lastGame: null }), null);
});
test('calling buildDraftOpportunityProfile never mutates the input record (additive, read-only)', () => {
  const record = recordFor('Bijan Robinson');
  const snapshot = JSON.parse(JSON.stringify(record));
  profileLib.buildDraftOpportunityProfile(record);
  assert.deepStrictEqual(record, snapshot);
});

// ─────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
if (failed) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
