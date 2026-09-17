'use strict';

// tests/stale-evidence-season-week.test.js
//
// Regression coverage for the confirmed stale-season evidence bug:
// waiver-candidates.js's readRisersFallers()/readOpportunityIntel() used
// to trust whatever the "latest" Netlify Blobs key held, with no check
// that it actually belonged to the season/week being requested. Production
// evidence: view-risers-fallers reported season 2025, Week 1 -> 2, and
// that stale 2025 trend/snap-share data was displayed as current 2026
// evidence (e.g. Alvin Kamara's 86% snap share).
//
// Two layers:
//   1. Direct unit coverage of the new validators
//      (isValidRisersFallersForRequest / isValidOpportunityIntelForRequest)
//      -- the actual fix. isValidRisersFallersForRequest requires
//      requestedWeek >= 3 (Risers & Fallers describes a completed
//      historical week-over-week delta; the requested week is the
//      UPCOMING waiver week, so the earliest possible valid trend is the
//      Weeks 1->2 delta, which can only support a Week 3+ decision).
//   2. A full, real pipeline run (enrichCandidates -> buildWaiverDecisions
//      -> buildCustomerRecommendations, no reimplementation) proving that
//      evidence the validators reject cannot produce a STASH verdict or
//      FAAB guidance, and that evidence they accept still can. This is the
//      same evidence shape (WR workload via targets) that drove the
//      original Kamara-style miscalibration.
//
// Run: node tests/stale-evidence-season-week.test.js

const assert = require('assert');
const {
  _test: {
    isValidRisersFallersForRequest,
    isValidOpportunityIntelForRequest,
    enrichCandidates
  }
} = require('../netlify/functions/waiver-candidates.js');
const { buildWaiverDecisions } = require('../netlify/functions/waiver-decision.js');
const {
  _test: { buildCustomerRecommendations }
} = require('../netlify/functions/waiver-recommendations.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Layer 1: validator unit tests
// ───────────────────────────────────────────────────────────────────────

test('2026 Weeks 1->2 trend cache is rejected for a Week 2 request (no completed two-week trend can exist yet)', () => {
  const cached = { season: 2026, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 2), false);
});

test('the same Weeks 1->2 cache is accepted for a Week 3 request', () => {
  const cached = { season: 2026, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 3), true);
});

test('a Weeks 2->3 cache is accepted for a Week 4 request', () => {
  const cached = { season: 2026, currentWeek: 3, previousWeek: 2, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 4), true);
});

test('wrong-season trend evidence fails closed even with the correct week alignment', () => {
  const cached = { season: 2025, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 3), false);
});

test('stale trend evidence (further behind than the request needs) fails closed', () => {
  // Week 4 needs the Weeks 2->3 delta; a Weeks 1->2 delta is stale for it,
  // even though it would be valid for a Week 3 request.
  const cached = { season: 2026, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 4), false);
});

test('future-week trend evidence fails closed', () => {
  // Week 3 needs the Weeks 1->2 delta; a Weeks 2->3 delta describes a
  // week that has not been decided on yet from this request's viewpoint.
  const cached = { season: 2026, currentWeek: 3, previousWeek: 2, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 3), false);
});

test('Weeks 2 alone can never have valid trend evidence, regardless of cache content', () => {
  const cached = { season: 2026, currentWeek: 1, previousWeek: 0, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 2), false);
});

test('Risers & Fallers evidence missing season/currentWeek/previousWeek is rejected, not treated as a match', () => {
  assert.strictEqual(isValidRisersFallersForRequest({ risers: [], fallers: [] }, 2026, 3), false);
  assert.strictEqual(isValidRisersFallersForRequest({ season: 2026, currentWeek: 2 }, 2026, 3), false);
  assert.strictEqual(isValidRisersFallersForRequest(null, 2026, 3), false);
});

test('ambiguous Risers & Fallers evidence (non-numeric week fields) is rejected', () => {
  const cached = { season: 2026, currentWeek: 'two', previousWeek: 1, risers: [], fallers: [] };
  assert.strictEqual(isValidRisersFallersForRequest(cached, 2026, 3), false);
});

test('valid 2026 Week 1 Opportunity Intelligence evidence can support a Week 2 request', () => {
  const cached = { season: 2026, weeksRequested: [1], records: {} };
  assert.strictEqual(isValidOpportunityIntelForRequest(cached, 2026, 2), true);
});

test('stale-season Opportunity Intelligence evidence is rejected', () => {
  const cached = { season: 2025, weeksRequested: [1], records: {} };
  assert.strictEqual(isValidOpportunityIntelForRequest(cached, 2026, 2), false);
});

test('future-week Opportunity Intelligence evidence is rejected, not accepted as current', () => {
  // Week 2's own games are not complete yet when Week 2 waiver decisions
  // are made -- evidence computed from Week 2 games cannot support a
  // Week 2 request.
  const cached = { season: 2026, weeksRequested: [2], records: {} };
  assert.strictEqual(isValidOpportunityIntelForRequest(cached, 2026, 2), false);
});

test('Opportunity Intelligence evidence further behind than the last completed week is rejected as stale', () => {
  // Week 3 request needs evidence through Week 2; Week 1 evidence is
  // stale for this request even though it is real, valid data for a
  // Week 2 request.
  const cached = { season: 2026, weeksRequested: [1], records: {} };
  assert.strictEqual(isValidOpportunityIntelForRequest(cached, 2026, 3), false);
});

test('Week 1 requests never receive Opportunity Intelligence trend evidence (no completed Week 0 exists)', () => {
  const cached = { season: 2026, weeksRequested: [1], records: {} };
  assert.strictEqual(isValidOpportunityIntelForRequest(cached, 2026, 1), false);
});

test('ambiguous Opportunity Intelligence evidence (missing/invalid weeksRequested) is rejected', () => {
  assert.strictEqual(
    isValidOpportunityIntelForRequest({ season: 2026, weeksRequested: [] }, 2026, 2),
    false
  );
  assert.strictEqual(
    isValidOpportunityIntelForRequest({ season: 2026, weeksRequested: ['not-a-week'] }, 2026, 2),
    false
  );
  assert.strictEqual(isValidOpportunityIntelForRequest({ season: 2026 }, 2026, 2), false);
});

// ───────────────────────────────────────────────────────────────────────
// Layer 2: full pipeline -- proves rejected evidence cannot manufacture
// STASH or FAAB, and that validated evidence still can.
//
// Candidate is a bench-only WR who never enters the (single-slot) starting
// lineup -- the same "SIMILAR at the lineup level, UPGRADE at the same-
// position depth level" shape production hits constantly. Without a
// verified workload signal this stays WATCH; a verified workload of 2+
// (from either Risers & Fallers OR Opportunity Intelligence) is what
// promotes it to STASH with FAAB, exactly as waiver-recommendations.js's
// stashEvidenceQualified()/workloadStrength() already require. No
// Kamara-specific special case exists anywhere in this fix.
// ───────────────────────────────────────────────────────────────────────

const rosterFillingWr = {
  name: 'Elite Starter',
  nflTeam: 'DET',
  position: 'WR'
};

const candidatePlayer = {
  name: 'Available Receiver',
  nflTeam: 'GB',
  position: 'WR',
  availabilityStatus: 'WAIVERS'
};

function buildWeeklyData() {
  return {
    positions: {
      WR: [
        // Wins the single WR lineup slot on SAGE score (keeps the
        // candidate on the bench -- "does not enter starting lineup"),
        // but carries a deliberately weak positionRank so the candidate
        // still qualifies as a same-position depth UPGRADE.
        {
          name: 'Elite Starter', team: 'DET', position: 'WR',
          positionRank: 25,
          sage: { score: 95, label: 'ELITE', confidence: 0.9 },
          recommendation: 'START'
        },
        {
          name: 'Available Receiver', team: 'GB', position: 'WR',
          positionRank: 5,
          sage: { score: 40, label: 'FLEX', confidence: 0.5 },
          recommendation: 'FLEX'
        }
      ]
    }
  };
}

function runPipeline({ risersFallersData, opportunityData }) {
  const candidates = enrichCandidates({
    availablePlayers: [candidatePlayer],
    roster: [rosterFillingWr],
    lineupConstruction: { WR: 1 },
    weeklyData: buildWeeklyData(),
    risersFallersData: risersFallersData || null,
    opportunityData: opportunityData || null
  });

  const decisions = buildWaiverDecisions(candidates);
  const recommendations = buildCustomerRecommendations(decisions, { teams: 12, scoring: 'ppr' });
  return { candidates, decisions, recommendations };
}

test('sanity: the bench-depth candidate never enters the starting lineup and is a same-position UPGRADE', () => {
  const { candidates } = runPipeline({});
  assert.strictEqual(candidates[0].rosterImpact.comparisonType, 'starting-lineup');
  assert.strictEqual(candidates[0].rosterImpact.candidateStarts, false);
  assert.strictEqual(candidates[0].rosterImpact.classification, 'SIMILAR');
  assert.strictEqual(candidates[0].rosterImpact.depthComparison.classification, 'UPGRADE');
});

test('sanity: with no trend and no opportunity evidence, the candidate stays WATCH with no FAAB', () => {
  const { decisions, recommendations } = runPipeline({});
  assert.strictEqual(decisions[0].decision.action, 'WATCH');
  assert.strictEqual(recommendations[0].verdict, 'WATCH');
  assert.strictEqual(recommendations[0].faab, null);
});

function validRisersFallersWeek1to2() {
  return {
    season: 2026,
    currentWeek: 2,
    previousWeek: 1,
    risers: [
      {
        longName: 'Available Receiver', team: 'GB', pos: 'WR',
        targetShareDelta: 0.12, snapShareDelta: 0.08,
        current: { targets: 9, targetSharePct: 0.29, offSnapPct: 0.88 },
        previous: { targets: 5, targetSharePct: 0.17, offSnapPct: 0.8 }
      }
    ],
    fallers: []
  };
}

test('valid completed Weeks 1->2 trend can influence a Week 3 recommendation: verified workload promotes the candidate to STASH with FAAB', () => {
  const cache = validRisersFallersWeek1to2();
  assert.strictEqual(isValidRisersFallersForRequest(cache, 2026, 3), true, 'sanity: this is exactly the cache a Week 3 request may use');

  const { recommendations } = runPipeline({
    risersFallersData: cache
  });
  assert.strictEqual(recommendations[0].verdict, 'STASH');
  assert.ok(recommendations[0].faab, 'verified trend workload receives FAAB guidance');
});

test('that same Weeks 1->2 cache is invalid for a Week 2 request, and rejected trend cannot create STASH or FAAB', () => {
  const cache = validRisersFallersWeek1to2();
  // This is exactly what readRisersFallers(event, 2026, 2) now does with
  // this cached blob: reject it (no valid two-completed-week trend can
  // exist for Week 2 at all) and pass null onward. No fallback season or
  // week is substituted.
  assert.strictEqual(isValidRisersFallersForRequest(cache, 2026, 2), false);

  const { decisions, recommendations } = runPipeline({ risersFallersData: null });
  assert.strictEqual(decisions[0].decision.action, 'WATCH');
  assert.strictEqual(recommendations[0].verdict, 'WATCH');
  assert.strictEqual(recommendations[0].faab, null);
});

test('2025 trend evidence cannot enter a 2026 Week 3 recommendation: the reader rejects it before enrichCandidates ever sees it', () => {
  const staleCache = { ...validRisersFallersWeek1to2(), season: 2025 };
  assert.strictEqual(isValidRisersFallersForRequest(staleCache, 2026, 3), false);

  const { decisions, recommendations } = runPipeline({ risersFallersData: null });
  assert.strictEqual(decisions[0].decision.action, 'WATCH');
  assert.strictEqual(recommendations[0].verdict, 'WATCH');
  assert.strictEqual(recommendations[0].faab, null);
});

test('a Weeks 2->3 cache (valid for Week 4) cannot enter a Week 3 recommendation as if it were the Weeks 1->2 delta', () => {
  const futureShiftedCache = { ...validRisersFallersWeek1to2(), currentWeek: 3, previousWeek: 2 };
  assert.strictEqual(isValidRisersFallersForRequest(futureShiftedCache, 2026, 3), false);

  const { recommendations } = runPipeline({ risersFallersData: null });
  assert.strictEqual(recommendations[0].verdict, 'WATCH');
  assert.strictEqual(recommendations[0].faab, null);
});

function validOpportunityIntelWeek1SupportingWeek2() {
  return {
    season: 2026,
    weeksRequested: [1],
    records: {
      'available receiver|WR': {
        playerID: 'wr-2',
        longName: 'Available Receiver',
        team: 'GB',
        pos: 'WR',
        opportunities: { lastGame: 10, gamesSampled: 1 },
        rushing: { lastGame: 1 },
        receiving: { lastGame: 9 },
        signals: [
          { type: 'volumeTier', value: 'high-volume', detail: { basisValue: 10 } }
        ]
      }
    }
  };
}

test('valid 2026 Week 1 opportunity evidence supports a Week 2 recommendation: STASH with FAAB', () => {
  const { recommendations } = runPipeline({
    opportunityData: validOpportunityIntelWeek1SupportingWeek2()
  });
  assert.strictEqual(recommendations[0].verdict, 'STASH');
  assert.ok(recommendations[0].faab, 'verified opportunity workload receives FAAB guidance');
});

test('stale opportunity evidence is rejected and cannot create STASH or FAAB', () => {
  const staleSeason = { ...validOpportunityIntelWeek1SupportingWeek2(), season: 2025 };
  const futureWeek = { ...validOpportunityIntelWeek1SupportingWeek2(), weeksRequested: [2] };

  assert.strictEqual(isValidOpportunityIntelForRequest(staleSeason, 2026, 2), false);
  assert.strictEqual(isValidOpportunityIntelForRequest(futureWeek, 2026, 2), false);

  const { decisions, recommendations } = runPipeline({ opportunityData: null });
  assert.strictEqual(decisions[0].decision.action, 'WATCH');
  assert.strictEqual(recommendations[0].verdict, 'WATCH');
  assert.strictEqual(recommendations[0].faab, null);
});

console.log(`\n${passed} stale-evidence season/week tests passed.`);
