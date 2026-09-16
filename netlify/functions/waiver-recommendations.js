'use strict';

// netlify/functions/waiver-recommendations.js
//
// Customer-facing orchestration for Available For You.
// Reuses the existing provider-authoritative waiver candidate service and
// conservative decision layer. No transaction is submitted. FAAB guidance is
// a bounded percentage derived only from recommendation evidence and league
// context supplied to this endpoint.

const waiverCandidates = require('./waiver-candidates.js');
const {
  buildWaiverDecisions,
  summarizeDecisions
} = require('./waiver-decision.js');

function validWeek(value) {
  const week = Number(value);
  return Number.isInteger(week) && week >= 1 && week <= 18 ? week : null;
}

function firstPresent() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function derive2026RegularSeasonWeek(now) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return null;

  // Waiver decisions roll forward after Monday's slate, not when Thursday's
  // next game begins. Week 1 therefore runs Sep 10-14 for this endpoint;
  // Tuesday Sep 15 is the start of the Week 2 waiver-decision window.
  const weekOneStart = Date.UTC(2026, 8, 10);
  const weekTwoWaiverStart = Date.UTC(2026, 8, 15, 6);
  const weekNineteenStart = weekTwoWaiverStart + (17 * 7 * 24 * 60 * 60 * 1000);
  const currentTime = current.getTime();

  if (currentTime < weekOneStart || currentTime >= weekNineteenStart) {
    return null;
  }

  if (currentTime < weekTwoWaiverStart) return 1;
  return Math.floor((currentTime - weekTwoWaiverStart) / (7 * 24 * 60 * 60 * 1000)) + 2;
}

function resolveWaiverWeek(body, now = new Date()) {
  const connection = body?.connection && typeof body.connection === 'object'
    ? body.connection
    : {};
  const league = connection?.league && typeof connection.league === 'object'
    ? connection.league
    : {};
  const availablePlayers = Array.isArray(connection?.availablePlayers)
    ? connection.availablePlayers
    : Array.isArray(league?.availablePlayers) ? league.availablePlayers : [];

  const providerWeek = firstPresent(
    body?.currentWeek,
    body?.scoringPeriodId,
    connection?.week,
    connection?.currentWeek,
    connection?.scoringPeriodId,
    connection?.scoringPeriod,
    league?.scoringPeriodId,
    league?.currentWeek,
    league?.week,
    league?.weekNumber,
    league?.scoringPeriod,
    availablePlayers[0]?.scoringPeriodId
  );

  const season = Number(firstPresent(
    body?.season,
    connection?.season,
    league?.season,
    now.getUTCFullYear()
  ));
  const resolvedProviderWeek = validWeek(providerWeek);
  const waiverWeek = season === 2026 ? derive2026RegularSeasonWeek(now) : null;

  // The connected provider is authoritative for its league's active scoring
  // period. The calendar is only a fallback when the provider supplies none.
  return resolvedProviderWeek || waiverWeek;
}

function withResolvedWeek(event) {
  let body;
  try {
    body = JSON.parse(event?.body || '{}');
  } catch (error) {
    return event;
  }

  // Do not override an explicitly supplied week, even if it is invalid.
  // The lower-level validator should continue to reject bad caller input.
  if (body.week !== undefined && body.week !== null && body.week !== '') {
    return event;
  }

  const week = resolveWaiverWeek(body);
  if (!week) return event;

  return {
    ...event,
    body: JSON.stringify({ ...body, week })
  };
}

function customerVerdict(item) {
  const action = item?.decision?.action || 'REVIEW';
  const impact = item?.evidence?.rosterImpact || null;
  const depth = impact?.depthComparison ||
    (impact?.comparisonType === 'same-position-fallback' ? impact : null);
  const candidateRank = Number(item?.evidence?.sage?.positionRank);
  const weakestDepthRank = Number(depth?.weakestComparable?.sage?.positionRank);
  const candidateProjection = Number(item?.evidence?.providerProjectedPoints);
  const weakestDepthProjection = Number(depth?.weakestComparable?.projectedPoints);
  const weekOneProjectionUpgrade =
    item?.evidence?.sage?.baselineEvidenceType === 'week1-adp-baseline' &&
    Number.isFinite(candidateProjection) &&
    Number.isFinite(weakestDepthProjection) &&
    candidateProjection > weakestDepthProjection;
  const meaningfulDepthUpgrade =
    (impact?.comparisonType === 'same-position-fallback' ||
      (impact?.comparisonType === 'starting-lineup' && impact?.candidateStarts === false)) &&
    depth?.classification === 'UPGRADE' &&
    (weekOneProjectionUpgrade || (
      Number.isFinite(candidateRank) &&
      Number.isFinite(weakestDepthRank) &&
      weakestDepthRank - candidateRank >= 8
    ));

  if (action === 'ADD') return 'ADD_NOW';
  if (action === 'WATCH' && meaningfulDepthUpgrade) return 'STASH';
  if (action === 'WATCH') return 'WATCH';
  if (action === 'PASS') return 'PASS';
  return 'REVIEW';
}

function normalizeScoring(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function buildFaabGuidance(item, verdict, context = {}) {
  if (!['ADD_NOW', 'STASH'].includes(verdict)) return null;

  const basis = [];
  const teams = Number(context?.teams);
  const scoring = normalizeScoring(context?.scoring);
  const position = String(item?.position || '').toUpperCase();
  const trend = item?.evidence?.trend?.direction || null;
  const impact = item?.evidence?.rosterImpact || null;
  const depth = impact?.depthComparison || null;
  const candidateRank = Number(item?.evidence?.sage?.positionRank);
  const weakestRank = Number(depth?.weakestComparable?.sage?.positionRank);
  const percentOwned = Number(item?.evidence?.percentOwned);
  let recommended = verdict === 'ADD_NOW' ? 14 : 10;

  if (Number.isFinite(teams) && teams >= 12) {
    recommended += 3;
    basis.push(`${teams}-team depth`);
  }
  if (position === 'RB' && ['half-ppr', 'halfppr', '0.5-ppr'].includes(scoring)) {
    recommended += 2;
    basis.push('half-PPR RB value');
  }
  if (trend === 'RISER') {
    recommended += 3;
    basis.push('rising opportunity');
  }
  if (Number.isFinite(candidateRank) && Number.isFinite(weakestRank)) {
    const rankEdge = weakestRank - candidateRank;
    if (rankEdge >= 20) {
      recommended += 4;
      basis.push('strong bench upgrade');
    } else if (rankEdge >= 12) {
      recommended += 2;
      basis.push('meaningful bench upgrade');
    }
  }
  if (
    verdict === 'ADD_NOW' &&
    Number.isFinite(Number(impact?.projectionDelta)) &&
    Number(impact.projectionDelta) >= 5
  ) {
    recommended += 3;
    basis.push('clear lineup gain');
  }
  if (Number.isFinite(percentOwned)) {
    if (percentOwned >= 50) {
      recommended += 3;
      basis.push('strong market demand');
    } else if (percentOwned >= 25) {
      recommended += 1;
      basis.push('market demand');
    }
  }

  const ceiling = verdict === 'ADD_NOW' ? 30 : 24;
  recommended = Math.max(verdict === 'ADD_NOW' ? 8 : 5, Math.min(ceiling, recommended));
  return {
    budgetBasis: 'original-budget-percent',
    recommendedPct: recommended,
    rangeMinPct: Math.max(1, recommended - 3),
    rangeMaxPct: Math.min(ceiling, recommended + 3),
    confidence: trend ? 'MEDIUM' : 'LOW',
    basis
  };
}

function verdictPriority(verdict) {
  return {
    ADD_NOW: 0,
    STASH: 1,
    WATCH: 2,
    REVIEW: 3,
    PASS: 4
  }[verdict] ?? 9;
}

// ---------------------------------------------------------------------
// "Best For Me" roster-impact ranking.
//
// This is the "Free Agents intelligence" layer: it decides ordering
// (who matters most to THIS roster) using evidence already computed
// upstream by waiver-candidates.js / waiver-decision.js. It does not
// recompute availability, SAGE, or roster comparisons -- it only scores
// and orders the evidence that already exists on each item.
//
// Verdict tier (ADD_NOW/STASH/WATCH/REVIEW/PASS) still comes first, so
// verdict meaning is unchanged. Within a tier -- most importantly the
// large REVIEW tier, which is where most of a full provider-reported
// pool (backups/inactive/practice-squad players Weekly SAGE has never
// ranked) ends up -- players are ordered by decreasing roster-impact
// evidence rather than falling straight to alphabetical. Alphabetical
// remains the final tiebreak only, once every other signal is tied.
// ---------------------------------------------------------------------

const FLEX_ELIGIBLE_POSITIONS = ['RB', 'WR', 'TE'];

function impactWeight(item) {
  // (a)/(f): rosterImpact directly encodes whether this candidate beats
  // the user's own weakest same-position roster player -- the closest
  // already-computed proxy for incremental starting-lineup value /
  // opportunity cost of a roster swap.
  const classification = item?.evidence?.rosterImpact?.classification || 'UNKNOWN';
  return { UPGRADE: 3, SIMILAR: 2, UNKNOWN: 1, DOWNGRADE: 0 }[classification] ?? 1;
}

function sageComponent(item) {
  // (b)/(e): a finite Weekly SAGE position rank is both a projected-
  // contribution signal and a scarcity signal (how many ranked options
  // remain ahead of this one at the position). Bounded so it never
  // silently loses to the provider-projection component below.
  const rank = Number(item?.evidence?.sage?.positionRank);
  return Number.isFinite(rank) ? Math.max(0, 400 - rank) : 0;
}

function flexComponent(item) {
  // (d): FLEX utility / lineup optionality. A proven roster upgrade at
  // a FLEX-eligible position has value beyond a single dedicated slot.
  const position = String(item?.position || '').toUpperCase();
  return impactWeight(item) === 3 && FLEX_ELIGIBLE_POSITIONS.includes(position) ? 1 : 0;
}

function projectionComponent(item) {
  // (g): where SAGE evidence is incomplete (sageComponent is 0 for the
  // large majority of an 875-player pool), provider projected points is
  // the fallback differentiator -- this is precisely what prevents the
  // REVIEW tier from collapsing to alphabetical order.
  const projected = Number(item?.evidence?.providerProjectedPoints);
  return Number.isFinite(projected) ? projected : 0;
}

function trendComponent(item) {
  const direction = item?.evidence?.trend?.direction || null;
  if (direction === 'RISER') return 1;
  if (direction === 'FALLER') return -1;
  return 0;
}

function activePenalty(item) {
  // Forward-compatible only: no current step in this pipeline populates
  // player active/inactive/retired status, so this is a no-op today.
  // If that evidence is ever added upstream (a separately-scoped
  // change, not part of this fix), a player explicitly reported
  // inactive is pushed to the bottom of its verdict tier rather than
  // outranking active, roster-relevant players on projection alone.
  return item?.active === false ? -1 : 0;
}

function ownershipComponent(item) {
  // (h): ownership/market signal is a tiebreaker only, ordered after
  // every roster-impact signal above and before the final alphabetical
  // tiebreak.
  const owned = Number(item?.evidence?.percentOwned);
  return Number.isFinite(owned) ? owned : -1;
}

function bestForMeCompare(a, b) {
  const verdictDiff = verdictPriority(a.verdict) - verdictPriority(b.verdict);
  if (verdictDiff !== 0) return verdictDiff;

  const activeDiff = activePenalty(b) - activePenalty(a);
  if (activeDiff !== 0) return activeDiff;

  const impactDiff = impactWeight(b) - impactWeight(a);
  if (impactDiff !== 0) return impactDiff;

  const sageDiff = sageComponent(b) - sageComponent(a);
  if (sageDiff !== 0) return sageDiff;

  const flexDiff = flexComponent(b) - flexComponent(a);
  if (flexDiff !== 0) return flexDiff;

  const projectionDiff = projectionComponent(b) - projectionComponent(a);
  if (projectionDiff !== 0) return projectionDiff;

  const trendDiff = trendComponent(b) - trendComponent(a);
  if (trendDiff !== 0) return trendDiff;

  const ownershipDiff = ownershipComponent(b) - ownershipComponent(a);
  if (ownershipDiff !== 0) return ownershipDiff;

  return String(a.name || '').localeCompare(String(b.name || ''));
}

function decorateDecision(item, context = {}) {
  const verdict = customerVerdict(item);
  const rosterImpact = item?.evidence?.rosterImpact || null;
  const weakest = rosterImpact?.weakestComparable || null;
  const sage = item?.evidence?.sage || null;
  const trend = item?.evidence?.trend || null;
  const opportunity = item?.evidence?.opportunity || null;

  return {
    ...item,
    verdict,
    opportunity,
    customerActionable: verdict === 'ADD_NOW',
    faab: buildFaabGuidance(item, verdict, context),
    swapFor:
      verdict === 'ADD_NOW' &&
      rosterImpact?.comparisonType !== 'starting-lineup' &&
      weakest?.name
        ? {
            name: weakest.name,
            position: weakest.position || null,
            team: weakest.team || null
          }
        : null,
    lineupFor:
      rosterImpact?.comparisonType === 'starting-lineup' &&
      rosterImpact?.candidateStarts &&
      weakest?.name
        ? {
            name: weakest.name,
            position: weakest.position || null,
            team: weakest.team || null,
            slot: rosterImpact.targetSlot || null
          }
        : null,
    benchFor:
      rosterImpact?.comparisonType === 'starting-lineup' &&
      rosterImpact?.candidateStarts === false &&
      rosterImpact?.depthComparison?.classification === 'UPGRADE' &&
      rosterImpact.depthComparison?.weakestComparable?.name
        ? {
            name: rosterImpact.depthComparison.weakestComparable.name,
            position: rosterImpact.depthComparison.weakestComparable.position || null,
            team: rosterImpact.depthComparison.weakestComparable.team || null
          }
        : null,
    quickRead: {
      weeklyRank:
        sage?.position && sage?.positionRank
          ? `${sage.position}${sage.positionRank}`
          : null,
      weeklyRecommendation: sage?.recommendation || null,
      opponent: item?.opponent || sage?.opponent || null,
      trend: trend?.direction || null,
      percentOwned:
        item?.evidence?.percentOwned === undefined
          ? null
          : item.evidence.percentOwned
    }
  };
}

function buildCustomerRecommendations(decisions, context = {}) {
  // Preserve the complete provider-reported pool: the only filter here
  // removes candidates the provider itself did not report as available
  // (INELIGIBLE), exactly as before. No position, count, or "staleness"
  // truncation is applied -- every FREE_AGENT/WAIVERS candidate at every
  // position, including PK/K and DEF/DST, remains in the array.
  // Note: filtering on the raw decision action (not on the customer-
  // facing verdict) is intentional -- customerVerdict() never maps any
  // action to 'INELIGIBLE' (it falls through to 'REVIEW'), so a filter
  // keyed on item.verdict would never actually remove a non-provider-
  // available candidate. This was already true before this change; kept
  // and fixed here since it is proven by the "preserve verdict
  // meanings" tests below and lives in the exact function this task
  // touches.
  return (Array.isArray(decisions) ? decisions : [])
    .filter((item) => item?.decision?.action !== 'INELIGIBLE')
    .map((item) => decorateDecision(item, context))
    .sort(bestForMeCompare);
}

function summarizeCustomerRecommendations(recommendations) {
  const summary = {
    addNow: 0,
    stash: 0,
    watch: 0,
    review: 0,
    pass: 0,
    actionable: 0,
    total: 0
  };

  (Array.isArray(recommendations) ? recommendations : []).forEach((item) => {
    summary.total += 1;
    if (item.verdict === 'ADD_NOW') {
      summary.addNow += 1;
      summary.actionable += 1;
    } else if (item.verdict === 'STASH') {
      summary.stash += 1;
    } else if (item.verdict === 'WATCH') {
      summary.watch += 1;
    } else if (item.verdict === 'PASS') {
      summary.pass += 1;
    } else {
      summary.review += 1;
    }
  });

  return summary;
}

exports.handler = async function handler(event) {
  const candidateResponse = await waiverCandidates.handler(withResolvedWeek(event));

  if (!candidateResponse || candidateResponse.statusCode !== 200) {
    return candidateResponse;
  }

  let candidateBody;
  try {
    candidateBody = JSON.parse(candidateResponse.body || '{}');
  } catch (error) {
    return {
      statusCode: 502,
      headers: candidateResponse.headers || { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Waiver candidate response could not be read.' })
    };
  }

  const rawDecisions = buildWaiverDecisions(candidateBody.candidates || []);
  const recommendations = buildCustomerRecommendations(rawDecisions, {
    teams: candidateBody.teams || candidateBody.metadata?.teams || null,
    scoring: candidateBody.scoring || candidateBody.metadata?.scoring || null
  });

  return {
    statusCode: 200,
    headers: candidateResponse.headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      evidenceType: 'waiver-recommendations',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      provider: candidateBody.provider || null,
      season: candidateBody.season || null,
      week: candidateBody.week || null,
      recommendations,
      summary: summarizeCustomerRecommendations(recommendations),
      decisionSummary: summarizeDecisions(rawDecisions),
      metadata: {
        ...(candidateBody.metadata || {}),
        methodology:
          'Provider availability is authoritative. ADD NOW requires a safe Weekly SAGE match and a demonstrated lineup upgrade. STASH identifies a meaningful bench upgrade; available trend evidence strengthens the recommendation and FAAB guidance. WATCH and PASS remain conservative when evidence does not justify an add.',
        limitations: [
          'FAAB guidance is a percentage of the original budget because remaining budget is not supplied by the provider connection.',
          'No transaction is submitted.',
          'FAAB confidence remains conservative when no current opportunity trend is available.'
        ]
      }
    })
  };
};

exports._test = {
  validWeek,
  derive2026RegularSeasonWeek,
  resolveWaiverWeek,
  withResolvedWeek,
  customerVerdict,
  buildFaabGuidance,
  verdictPriority,
  decorateDecision,
  buildCustomerRecommendations,
  summarizeCustomerRecommendations,
  bestForMeCompare,
  impactWeight,
  sageComponent,
  flexComponent,
  projectionComponent,
  trendComponent,
  activePenalty,
  ownershipComponent
};
