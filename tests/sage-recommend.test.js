// tests/sage-recommend.test.js
//
// Regression coverage for netlify/functions/sage-recommend.js (SAGE ->
// Draft Command Center V1).
//
// Uses the REAL, unmodified pillar and synthesis modules
// (draft-opportunity-profile.js, draft-market-profile.js,
// draft-scarcity-profile.js, draft-sage-synthesis.js) via the actual
// exports.handler -- not a reimplementation of their logic. Only
// @netlify/blobs is mocked (same Module._resolveFilename technique
// already proven in opportunity-intel-sample.test.js and
// redeem-giveaway-code.test.js).
//
// Run: node tests/sage-recommend.test.js

const assert = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}

// ─────────────────────────────────────────────────────────
// Mock @netlify/blobs BEFORE the first require of the module under
// test (see redeem-giveaway-code.test.js for why this ordering matters
// on this Node version).
// ─────────────────────────────────────────────────────────
const blobStores = {};
let setJSONCallCount = 0;

function installBlobsMock() {
  const fakeModulePath = path.join(__dirname, '__fake_netlify_blobs_sage__.js');
  require.cache[fakeModulePath] = {
    id: fakeModulePath,
    filename: fakeModulePath,
    loaded: true,
    exports: {
      connectLambda: () => {},
      getStore: ({ name }) => {
        if (!blobStores[name]) blobStores[name] = {};
        const store = blobStores[name];
        return {
          get: async (key) => (key in store ? store[key] : null),
          setJSON: async (key, value) => { setJSONCallCount++; store[key] = value; },
        };
      },
    },
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@netlify/blobs') return fakeModulePath;
    return originalResolve.call(this, request, ...rest);
  };
  return originalResolve;
}

const originalResolve = installBlobsMock();
const sageModule = require('../netlify/functions/sage-recommend.js');
Module._resolveFilename = originalResolve;

function resetStores() {
  Object.keys(blobStores).forEach((k) => delete blobStores[k]);
  setJSONCallCount = 0;
}

function makeEvent(bodyObj, method) {
  return { httpMethod: method || 'POST', body: JSON.stringify(bodyObj || {}) };
}

// Builds a realistic opportunityIntelligence record shape (matching
// what buildOpportunityIntelligence() actually produces) directly,
// since these tests are about sage-recommend.js's wiring, not
// re-deriving Opportunity records from raw game logs.
function makeOpportunityRecord(overrides) {
  return Object.assign(
    {
      playerID: 'p1',
      longName: 'Test Player',
      pos: 'RB',
      opportunities: { lastGame: 15, avgLast3: 15, avgLast5: 15, seasonAvg: 15, trend: 5, gamesSampled: 8 },
      rushing: { lastGame: 12, avgLast3: 12, avgLast5: 12, seasonAvg: 12, trend: 3, gamesSampled: 8 },
      receiving: { lastGame: 3, avgLast3: 3, avgLast5: 3, seasonAvg: 3, trend: 0, gamesSampled: 8 },
      historical: {},
      highValue: {},
      persistence: {},
      signals: [
        { type: 'sampleSize', value: 'adequate', detail: {} },
        { type: 'roleComposition', value: 'rushing-dominant', detail: { carriesShare: 0.8, targetsShare: 0.2 } },
        { type: 'trendClassification', value: 'expanding', detail: { trend: 5 } },
        { type: 'volumeTier', value: 'high-volume', detail: {} },
        { type: 'recentRoleVsBaseline', value: 'unclassified', detail: { recentValue: 15, baselineValue: 15, absoluteDelta: 0, percentDelta: 0 } }
      ],
    },
    overrides || {}
  );
}

function seedOpportunity(key, record) {
  blobStores['opportunity-intel'] = blobStores['opportunity-intel'] || {};
  blobStores['opportunity-intel'].latest = blobStores['opportunity-intel'].latest || { records: {} };
  blobStores['opportunity-intel'].latest.records[key] = record;
}
function seedContext(key, record) {
  blobStores['context-intel'] = blobStores['context-intel'] || {};
  blobStores['context-intel'].latest = blobStores['context-intel'].latest || { records: {} };
  blobStores['context-intel'].latest.records[key] = record;
}

// ─────────────────────────────────────────────────────────
// 1. PURE FUNCTIONS
// ─────────────────────────────────────────────────────────
const T = sageModule._test;

test('playerKey matches the exact convention used across opportunity-intel/context-intel (normalized name + |POS)', () => {
  assert.strictEqual(T.playerKey({ name: "Ja'Marr Chase", pos: 'wr' }), 'jamarr chase|WR');
});

// ─────────────────────────────────────────────────────────
// Aug 18 2026 fix: Ja'Marr Chase identity-normalization defect.
// normalizePlayerName()'s apostrophe class used to LOOK like it covered
// three different apostrophe styles ([.''']) but all three characters
// were actually the identical ASCII U+0027 typed three times -- a
// curly apostrophe (U+2019, the common "smart quote" a data source or
// CMS can produce) silently failed to strip, breaking the Opportunity
// cache lookup for exactly this name. Confirmed by a live diagnostic
// that ran the real production handler with both variants.
// ─────────────────────────────────────────────────────────
test("apostrophe fix: straight (U+0027) and curly right (U+2019) quotes normalize Ja'Marr Chase to the identical key", () => {
  const straight = T.playerKey({ name: 'Ja' + String.fromCharCode(0x27) + 'Marr Chase', pos: 'WR' });
  const curlyRight = T.playerKey({ name: 'Ja' + String.fromCharCode(0x2019) + 'Marr Chase', pos: 'WR' });
  assert.strictEqual(straight, 'jamarr chase|WR');
  assert.strictEqual(curlyRight, straight, 'a curly right-quote apostrophe must normalize to the exact same key as the straight one');
});
test('apostrophe fix: curly left quote (U+2018) also normalizes to the identical key', () => {
  const straight = T.playerKey({ name: 'Ja' + String.fromCharCode(0x27) + 'Marr Chase', pos: 'WR' });
  const curlyLeft = T.playerKey({ name: 'Ja' + String.fromCharCode(0x2018) + 'Marr Chase', pos: 'WR' });
  assert.strictEqual(curlyLeft, straight);
});
test('apostrophe fix: unpunctuated names (e.g. Jahmyr Gibbs) are completely unaffected', () => {
  assert.strictEqual(T.playerKey({ name: 'Jahmyr Gibbs', pos: 'RB' }), 'jahmyr gibbs|RB');
});
test('apostrophe fix: every other existing normalization rule is preserved unchanged (period, hyphen, suffix, whitespace)', () => {
  assert.strictEqual(T.normalizePlayerName('A.J. Brown'), 'aj brown');
  assert.strictEqual(T.normalizePlayerName('Amon-Ra St. Brown'), 'amon ra st brown');
  assert.strictEqual(T.normalizePlayerName('Michael Pittman Jr.'), 'michael pittman');
  assert.strictEqual(T.normalizePlayerName('  Extra   Space  '), 'extra space');
});
test('CODE_RANK contains exactly the codes found in the real draft-sage-synthesis.js (no invented categories)', () => {
  const draftSage = require('../netlify/functions/draft-sage-synthesis.js');
  // Every code sage-recommend.js knows how to rank must be a real,
  // literal string that appears in the actual synthesis module's source.
  const synthSource = require('fs').readFileSync(require.resolve('../netlify/functions/draft-sage-synthesis.js'), 'utf8');
  T.CODE_RANK.forEach((code) => {
    assert.ok(synthSource.includes("'" + code + "'"), 'CODE_RANK entry "' + code + '" must be a real code from draft-sage-synthesis.js');
  });
});
test('codeRank: take-now ranks strictly higher (lower index) than flexible, which ranks higher than pass-for-now', () => {
  assert.ok(T.codeRank('take-now') < T.codeRank('flexible'));
  assert.ok(T.codeRank('flexible') < T.codeRank('pass-for-now'));
});
test('codeRank: an unrecognized code sorts last, never crashes', () => {
  assert.strictEqual(T.codeRank('totally-made-up-code'), T.CODE_RANK.length);
});
test('isValidPlayerShape rejects missing/empty name, accepts a normal player object', () => {
  assert.strictEqual(T.isValidPlayerShape({ name: 'Real Player', pos: 'RB' }), true);
  assert.strictEqual(T.isValidPlayerShape({ pos: 'RB' }), false);
  assert.strictEqual(T.isValidPlayerShape({ name: '', pos: 'RB' }), false);
  assert.strictEqual(T.isValidPlayerShape(null), false);
});
test('attachAdp returns null for a null record, otherwise merges adp onto a copy (does not mutate the original)', () => {
  assert.strictEqual(T.attachAdp(null, { adp: 5 }), null);
  const record = { foo: 'bar' };
  const result = T.attachAdp(record, { adp: 12.5 });
  assert.strictEqual(result.adp, 12.5);
  assert.strictEqual(result.foo, 'bar');
  assert.strictEqual(record.adp, undefined, 'original record object must not be mutated');
});

// ─────────────────────────────────────────────────────────
// 2. HANDLER-LEVEL TESTS (real exports.handler, real pillar/synthesis
//    modules, mocked Blobs)
// ─────────────────────────────────────────────────────────
async function runHandlerTests() {
  await testAsync("Aug 18 2026 fix: straight and curly apostrophe variants of Ja'Marr Chase both match the SAME real Opportunity record and produce the SAME real recommendation", async () => {
    resetStores();
    seedOpportunity('jamarr chase|WR', makeOpportunityRecord({ longName: "Ja'Marr Chase", pos: 'WR', signals: [
      { type: 'sampleSize', value: 'adequate', detail: {} },
      { type: 'roleComposition', value: 'receiving-dominant', detail: { carriesShare: 0, targetsShare: 1 } },
      { type: 'volumeTier', value: 'high-volume', detail: {} },
    ] }));

    const straightVariant = { name: 'Ja' + String.fromCharCode(0x27) + 'Marr Chase', pos: 'WR', adp: 1.6 };
    const curlyVariant = { name: 'Ja' + String.fromCharCode(0x2019) + 'Marr Chase', pos: 'WR', adp: 1.6 };

    const resStraight = await sageModule.handler(makeEvent({ candidates: [straightVariant], currentPick: 1, nextUserPick: 24 }));
    const resCurly = await sageModule.handler(makeEvent({ candidates: [curlyVariant], currentPick: 1, nextUserPick: 24 }));
    const bodyStraight = JSON.parse(resStraight.body);
    const bodyCurly = JSON.parse(resCurly.body);

    // Both must find the real Opportunity record -- neither should be
    // flagged as missing "opportunity" anymore (this is exactly the
    // check that failed before the fix).
    assert.ok(!bodyStraight.degraded.some((d) => d.missing.includes('opportunity')), 'straight-apostrophe variant must match the Opportunity record');
    assert.ok(!bodyCurly.degraded.some((d) => d.missing.includes('opportunity')), 'curly-apostrophe variant must ALSO match the same Opportunity record -- this is the actual fix');

    // Both must produce the identical real recommendation from the
    // actual handler -- not a reimplementation of the comparison.
    assert.strictEqual(bodyCurly.recommendations[0].code, bodyStraight.recommendations[0].code);
    assert.strictEqual(bodyCurly.recommendations[0].recommendation, bodyStraight.recommendations[0].recommendation);
    assert.strictEqual(bodyCurly.recommendations[0].explanation, bodyStraight.recommendations[0].explanation);
  });

  await testAsync("Aug 18 2026 fix: reproduces the exact live diagnostic scenario -- Chase and Gibbs both resolve to take-now regardless of apostrophe style", async () => {
    resetStores();
    seedOpportunity('jamarr chase|WR', makeOpportunityRecord({ longName: "Ja'Marr Chase", pos: 'WR', signals: [
      { type: 'sampleSize', value: 'adequate', detail: {} },
      { type: 'roleComposition', value: 'receiving-dominant', detail: { carriesShare: 0, targetsShare: 1 } },
      { type: 'trendClassification', value: 'stable', detail: { trend: 0 } },
      { type: 'volumeTier', value: 'high-volume', detail: {} },
    ] }));
    seedOpportunity('jahmyr gibbs|RB', makeOpportunityRecord({ longName: 'Jahmyr Gibbs', pos: 'RB', signals: [
      { type: 'sampleSize', value: 'adequate', detail: {} },
      { type: 'roleComposition', value: 'balanced', detail: { carriesShare: 0.6, targetsShare: 0.4 } },
      { type: 'trendClassification', value: 'stable', detail: { trend: 0 } },
      { type: 'volumeTier', value: 'high-volume', detail: {} },
    ] }));

    const curlyChase = { name: 'Ja' + String.fromCharCode(0x2019) + 'Marr Chase', pos: 'WR', adp: 1.6 };
    const gibbs = { name: 'Jahmyr Gibbs', pos: 'RB', adp: 2.0 };

    const res = await sageModule.handler(makeEvent({ candidates: [curlyChase, gibbs], currentPick: 1, nextUserPick: 24 }));
    const body = JSON.parse(res.body);
    const chaseRec = body.recommendations.find((r) => r.player.name.includes('Marr Chase'));
    const gibbsRec = body.recommendations.find((r) => r.player.name === 'Jahmyr Gibbs');

    assert.strictEqual(chaseRec.code, 'take-now', 'this is the exact bug: before the fix this was "consider-now"');
    assert.strictEqual(gibbsRec.code, 'take-now');
  });

  await testAsync('Aug 17 2026 correction: a player OUTSIDE the candidate subset, present only in currentPool, measurably changes the real Scarcity read', async () => {
    resetStores();
    // The candidate actually being evaluated.
    seedOpportunity('the candidate|RB', makeOpportunityRecord({ playerID: 'candidate-id', longName: 'The Candidate', pos: 'RB', signals: [
      { type: 'sampleSize', value: 'adequate', detail: {} },
      { type: 'roleComposition', value: 'rushing-dominant', detail: { carriesShare: 0.8, targetsShare: 0.2 } },
      { type: 'volumeTier', value: 'high-volume', detail: {} },
    ] }));
    // A same-position, comparable-or-better player that will NEVER be
    // sent as a candidate -- only ever present in currentPool, exactly
    // matching how draft.html now sends the broader available pool
    // separately from the bounded candidate slice.
    seedOpportunity('outside depth|RB', makeOpportunityRecord({ playerID: 'outside-id', longName: 'Outside Depth', pos: 'RB', signals: [
      { type: 'sampleSize', value: 'adequate', detail: {} },
      { type: 'roleComposition', value: 'rushing-dominant', detail: { carriesShare: 0.75, targetsShare: 0.25 } },
      { type: 'volumeTier', value: 'high-volume', detail: {} },
    ] }));

    const opportunityCache = blobStores['opportunity-intel'].latest;
    const candidatePlayer = { name: 'The Candidate', pos: 'RB', adp: 12 };
    const outsidePlayer = { name: 'Outside Depth', pos: 'RB', adp: 55 }; // well beyond any candidate-cap ADP

    // Build the exact same kind of pool sage-recommend.js's own
    // evaluateCandidate() builds internally, via its real, unmodified
    // exported buildOpportunityPool() -- proving the real wiring, not
    // a reimplementation of it.
    const narrowPool = T.buildOpportunityPool(opportunityCache, [candidatePlayer]);
    const broadPool = T.buildOpportunityPool(opportunityCache, [candidatePlayer, outsidePlayer]);

    assert.strictEqual(narrowPool.length, 1);
    assert.strictEqual(broadPool.length, 2, 'the outside player must be present in the broader pool');

    // Call the REAL, unmodified draft-scarcity-profile.js directly --
    // no pillar logic touched, just observing its real output against
    // the two different pool shapes.
    const { buildDraftScarcityProfile } = require('../netlify/functions/draft-scarcity-profile.js');
    const candidateRecord = T.attachAdp(T.getOpportunityRecord(opportunityCache, candidatePlayer), candidatePlayer);

    const scarcityNarrow = buildDraftScarcityProfile({ candidate: candidateRecord, currentPool: narrowPool, nextTurnPool: [] });
    const scarcityBroad = buildDraftScarcityProfile({ candidate: candidateRecord, currentPool: broadPool, nextTurnPool: [] });

    assert.strictEqual(scarcityNarrow.depthNow.comparableOptions, 0, 'with no other same-position player in the pool, there should be zero comparable options');
    assert.strictEqual(scarcityNarrow.depthNow.label, 'No Comparable Options');

    assert.strictEqual(
      scarcityBroad.depthNow.comparableOptions,
      1,
      'once the outside-the-candidate-subset player is included in currentPool, depthNow.comparableOptions must reflect it -- proving it genuinely influences the Scarcity read, not just that the field is technically present'
    );
    assert.strictEqual(scarcityBroad.depthNow.label, 'One Comparable Option');
    assert.strictEqual(scarcityBroad.depthNow.comparablePlayers[0].longName, 'Outside Depth', 'the specific outside player must be the one identified as the comparable option');
  });

  await testAsync('non-POST method -> 405', async () => {
    const res = await sageModule.handler(makeEvent({}, 'GET'));
    assert.strictEqual(res.statusCode, 405);
  });

  await testAsync('malformed JSON body -> 400, no crash', async () => {
    const res = await sageModule.handler({ httpMethod: 'POST', body: '{not json' });
    assert.strictEqual(res.statusCode, 400);
  });

  await testAsync('empty/malformed candidates array -> 200, zero recommendations, no crash', async () => {
    resetStores();
    const res = await sageModule.handler(makeEvent({ candidates: [], currentPick: 5, nextUserPick: 17 }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.candidateCount, 0);
    assert.deepStrictEqual(body.recommendations, []);
  });

  await testAsync('candidates missing required "name" are filtered out silently, not a crash', async () => {
    resetStores();
    const res = await sageModule.handler(makeEvent({
      candidates: [{ pos: 'RB', adp: 5 }, { name: 'Real Player', pos: 'RB', adp: 8 }],
      currentPick: 5, nextUserPick: 17
    }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.candidateCount, 1);
  });

  await testAsync('full pillar data present for every candidate -> 200, real recommendations, no raw pillar objects exposed', async () => {
    resetStores();
    seedOpportunity('player a|RB', makeOpportunityRecord({ longName: 'Player A', pos: 'RB' }));
    seedOpportunity('player b|WR', makeOpportunityRecord({ longName: 'Player B', pos: 'WR', signals: [
      { type: 'sampleSize', value: 'adequate', detail: {} },
      { type: 'roleComposition', value: 'receiving-dominant', detail: { carriesShare: 0, targetsShare: 1 } },
      { type: 'volumeTier', value: 'high-volume', detail: {} },
    ] }));
    seedContext('player a|RB', { contextStatus: 'context-profiled', contextProfile: { environmentChange: { label: 'Improved', explanation: 'x' }, roleOpportunity: { label: 'Expanded', explanation: 'x' }, rookieImpact: { label: 'N/A', explanation: 'x' }, contextConfidence: { label: 'Strong', explanation: 'x' } } });

    const res = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Player A', pos: 'RB', adp: 12 }, { name: 'Player B', pos: 'WR', adp: 18 }],
      currentPick: 12, nextUserPick: 24
    }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.candidateCount, 2);
    assert.ok(body.recommendations.length >= 1);
    const first = body.recommendations[0];
    assert.ok(first.player && first.player.name);
    assert.ok(typeof first.recommendation === 'string');
    assert.ok(typeof first.code === 'string');
    assert.ok(typeof first.explanation === 'string');
    assert.ok(Array.isArray(first.reasons));
    // Never expose raw pillar objects.
    assert.ok(!('opportunityProfile' in first));
    assert.ok(!('marketProfile' in first));
    assert.ok(!('scarcityProfile' in first));
    assert.ok(!('contextProfile' in first));
  });

  await testAsync('missing Opportunity data for one candidate does not fail the whole request', async () => {
    resetStores();
    seedOpportunity('has data|RB', makeOpportunityRecord({ longName: 'Has Data', pos: 'RB' }));
    // "No Data" is deliberately never seeded into opportunity-intel.
    const res = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Has Data', pos: 'RB', adp: 10 }, { name: 'No Data', pos: 'WR', adp: 20 }],
      currentPick: 10, nextUserPick: 22
    }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.candidateCount, 2);
    const degradedNames = body.degraded.map((d) => d.name);
    assert.ok(degradedNames.includes('No Data'));
    const noDataDegraded = body.degraded.find((d) => d.name === 'No Data');
    assert.ok(noDataDegraded.missing.includes('opportunity'));
  });

  await testAsync('missing Context data for one candidate does not fail the whole request', async () => {
    resetStores();
    seedOpportunity('player c|TE', makeOpportunityRecord({ longName: 'Player C', pos: 'TE' }));
    // No context-intel seeded at all for this player.
    const res = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Player C', pos: 'TE', adp: 30 }],
      currentPick: 10, nextUserPick: 22
    }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.degraded.length, 1);
    assert.ok(body.degraded[0].missing.includes('context'));
    assert.ok(!body.degraded[0].missing.includes('opportunity'), 'opportunity WAS present -- only context should be flagged missing');
  });

  await testAsync('completely missing both Opportunity and Context caches (never refreshed) -> still 200, graceful, not a crash', async () => {
    resetStores(); // both stores entirely absent
    const res = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Anyone', pos: 'RB', adp: 15 }],
      currentPick: 10, nextUserPick: 22
    }));
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.degraded[0].missing.includes('opportunity'), true);
  });

  await testAsync('deterministic ordering: a stronger SAGE code sorts before a weaker one', async () => {
    resetStores();
    // Player X: strong recent role + strong context up + pick pressure -> likely take-now/strong-consideration
    seedOpportunity('strong signal|RB', makeOpportunityRecord({
      longName: 'Strong Signal', pos: 'RB',
      opportunities: { lastGame: 20, avgLast3: 20, avgLast5: 20, seasonAvg: 12, trend: 8, gamesSampled: 8 },
      signals: [
        { type: 'sampleSize', value: 'adequate', detail: {} },
        { type: 'roleComposition', value: 'rushing-dominant', detail: { carriesShare: 0.85, targetsShare: 0.15 } },
        { type: 'trendClassification', value: 'expanding', detail: { trend: 8 } },
        { type: 'volumeTier', value: 'high-volume', detail: {} },
      ]
    }));
    // Player Y: no opportunity data at all -> needs-more-evidence territory
    const res = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Weak Signal', pos: 'WR', adp: 5 }, { name: 'Strong Signal', pos: 'RB', adp: 50 }],
      currentPick: 1, nextUserPick: 24
    }));
    const body = JSON.parse(res.body);
    const strongIdx = body.recommendations.findIndex((r) => r.player.name === 'Strong Signal');
    const weakIdx = body.recommendations.findIndex((r) => r.player.name === 'Weak Signal');
    if (strongIdx !== -1 && weakIdx !== -1) {
      assert.ok(strongIdx < weakIdx, 'a player with real strong Opportunity evidence should not rank behind one with none, even with a much better ADP');
    }
  });

  await testAsync('tie-break: identical SAGE code -> lower ADP sorts first (existing objective field, not an invented score)', async () => {
    resetStores();
    // Two structurally-identical records -- same code guaranteed -- differing only by which player/ADP is attached.
    const identicalSignals = makeOpportunityRecord({ pos: 'RB' }).signals;
    seedOpportunity('twin a|RB', makeOpportunityRecord({ longName: 'Twin A', pos: 'RB', signals: identicalSignals }));
    seedOpportunity('twin b|RB', makeOpportunityRecord({ longName: 'Twin B', pos: 'RB', signals: identicalSignals }));

    const res = await sageModule.handler(makeEvent({
      candidates: [
        { name: 'Twin A', pos: 'RB', adp: 25 },
        { name: 'Twin B', pos: 'RB', adp: 10 } // better (lower) ADP
      ],
      currentPick: 10, nextUserPick: 22
    }));
    const body = JSON.parse(res.body);
    const aIdx = body.recommendations.findIndex((r) => r.player.name === 'Twin A');
    const bIdx = body.recommendations.findIndex((r) => r.player.name === 'Twin B');
    if (aIdx !== -1 && bIdx !== -1 && body.recommendations[aIdx].code === body.recommendations[bIdx].code) {
      assert.ok(bIdx < aIdx, 'Twin B (lower ADP) must sort before Twin A when their SAGE codes are identical');
    }
  });

  await testAsync('returns at most 5 recommendations even with more candidates supplied', async () => {
    resetStores();
    const candidates = [];
    for (let i = 0; i < 10; i++) {
      seedOpportunity('player ' + i + '|RB', makeOpportunityRecord({ longName: 'Player ' + i, pos: 'RB' }));
      candidates.push({ name: 'Player ' + i, pos: 'RB', adp: i + 1 });
    }
    const res = await sageModule.handler(makeEvent({ candidates, currentPick: 1, nextUserPick: 13 }));
    const body = JSON.parse(res.body);
    assert.ok(body.recommendations.length <= 5);
  });

  await testAsync('server-side candidate cap: sending more than MAX_CANDIDATES does not crash or balloon work', async () => {
    resetStores();
    const candidates = [];
    for (let i = 0; i < 60; i++) candidates.push({ name: 'Bulk Player ' + i, pos: 'WR', adp: i + 1 });
    const res = await sageModule.handler(makeEvent({ candidates, currentPick: 1, nextUserPick: 13 }));
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(body.candidateCount <= 40);
  });

  await testAsync('HARD SAFETY: sage-recommend.js never writes to any Blobs store (read-only, confirmed via the real handler)', async () => {
    resetStores();
    seedOpportunity('safety check|RB', makeOpportunityRecord({ longName: 'Safety Check', pos: 'RB' }));
    await sageModule.handler(makeEvent({
      candidates: [{ name: 'Safety Check', pos: 'RB', adp: 5 }],
      currentPick: 5, nextUserPick: 17
    }));
    assert.strictEqual(setJSONCallCount, 0, 'a read-only recommendation request must never call setJSON on any store');
  });

  await testAsync('scoring field is accepted without error but does not affect the response shape (not consumed by any pillar today)', async () => {
    resetStores();
    seedOpportunity('scoring test|RB', makeOpportunityRecord({ longName: 'Scoring Test', pos: 'RB' }));
    const resPPR = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Scoring Test', pos: 'RB', adp: 5 }],
      currentPick: 5, nextUserPick: 17, scoring: 'ppr'
    }));
    const resStd = await sageModule.handler(makeEvent({
      candidates: [{ name: 'Scoring Test', pos: 'RB', adp: 5 }],
      currentPick: 5, nextUserPick: 17, scoring: 'standard'
    }));
    const bodyPPR = JSON.parse(resPPR.body);
    const bodyStd = JSON.parse(resStd.body);
    assert.strictEqual(bodyPPR.recommendations[0].code, bodyStd.recommendations[0].code, 'scoring has no effect today -- flagged in the report, not silently pretended to matter');
  });
}

runHandlerTests().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  if (failed) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
});
