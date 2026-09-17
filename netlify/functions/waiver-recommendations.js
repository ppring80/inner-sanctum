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
  const projectionFallbackUpgrade =
    ['week1-adp-baseline', 'provider-projection-fallback']
      .includes(item?.evidence?.sage?.baselineEvidenceType) &&
    Number.isFinite(candidateProjection) &&
    Number.isFinite(weakestDepthProjection) &&
    candidateProjection > weakestDepthProjection;
  const meaningfulDepthUpgrade =
    (impact?.comparisonType === 'same-position-fallback' ||
      (impact?.comparisonType === 'starting-lineup' && impact?.candidateStarts === false)) &&
    depth?.classification === 'UPGRADE' &&
    (projectionFallbackUpgrade || (
      Number.isFinite(candidateRank) &&
      Number.isFinite(weakestDepthRank) &&
      weakestDepthRank - candidateRank >= 8
    ));

  if (action === 'ADD') return 'ADD_NOW';
  if (action === 'WATCH' && meaningfulDepthUpgrade && stashEvidenceQualified(item)) {
    return 'STASH';
  }
  if (action === 'WATCH') return 'WATCH';
  if (action === 'PASS' && ['K', 'DEF'].includes(normalizedCoveragePosition(item?.position)) &&
    positionCoverageQualified(item)) {
    // Kicker and defense are weekly streaming positions. Keep credible top-10
    // options reviewable even when the user's current starter projects higher;
    // the roster-impact explanation still discloses that there is no upgrade.
    return 'REVIEW';
  }
  if (action === 'PASS') return 'PASS';
  return 'REVIEW';
}

function normalizeScoring(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

const FAAB_MARKET_BANDS = Object.freeze({
  // Calibrated to public redraft-waiver guidance: low-confidence depth adds
  // are low-single-digit bids; only verified breakout usage plus a material
  // starting-lineup gain reaches the teens. These are market anchors, not
  // additive bonuses, so weak evidence cannot accumulate into a premium bid.
  SPECULATIVE: { valuePct: 1, recommendedPct: 1, aggressivePct: 2 },
  DEPTH_STASH: { valuePct: 2, recommendedPct: 3, aggressivePct: 5 },
  PRIORITY_STASH: { valuePct: 4, recommendedPct: 6, aggressivePct: 9 },
  LINEUP_ADD: { valuePct: 5, recommendedPct: 8, aggressivePct: 12 },
  BREAKOUT: { valuePct: 9, recommendedPct: 14, aggressivePct: 20 }
});

function finiteNumber(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

function projectionGain(item) {
  const impact = item?.evidence?.rosterImpact || null;
  const direct = finiteNumber(impact?.projectionDelta);
  if (direct !== null) return direct;

  const candidate = finiteNumber(item?.evidence?.providerProjectedPoints);
  const weakest = finiteNumber(
    impact?.depthComparison?.weakestComparable?.projectedPoints ??
    impact?.weakestComparable?.projectedPoints
  );
  return candidate !== null && weakest !== null ? candidate - weakest : null;
}

function workloadStrength(item) {
  const position = String(item?.position || '').toUpperCase();
  if (!['RB', 'WR', 'TE'].includes(position)) return 0;

  const opportunity = item?.evidence?.opportunity || {};
  const trend = item?.evidence?.trend || {};
  const opportunities = finiteNumber(opportunity.lastGameOpportunities);
  const carries = finiteNumber(opportunity.lastGameCarries);
  const targets = finiteNumber(opportunity.lastGameTargets ?? trend.currentTargets);
  const snaps = finiteNumber(trend.currentSnapShare);
  let strength = 0;

  if (position === 'RB') {
    const touches = opportunities !== null
      ? opportunities
      : (carries !== null || targets !== null ? (carries || 0) + (targets || 0) : null);
    if (touches !== null && touches >= 15) strength = 3;
    else if (touches !== null && touches >= 9) strength = 2;
    else if (touches !== null && touches >= 4) strength = 1;
  } else {
    if (targets !== null && targets >= 8) strength = 3;
    else if (targets !== null && targets >= 5) strength = 2;
    else if (targets !== null && targets >= 3) strength = 1;
  }

  if (snaps !== null && snaps >= 65) strength = Math.max(strength, 2);
  else if (snaps !== null && snaps >= 35) strength = Math.max(strength, 1);
  return strength;
}

function projectionStrength(item) {
  const impact = item?.evidence?.rosterImpact || null;
  const gain = projectionGain(item);
  if (gain === null || gain < 2) return 0;

  const starts = impact?.comparisonType === 'starting-lineup' && impact?.candidateStarts === true;
  if (starts) {
    if (gain >= 6) return 3;
    if (gain >= 3) return 2;
    return 1;
  }
  if (gain >= 5) return 2;
  return 1;
}

function stashEvidenceQualified(item) {
  const position = String(item?.position || '').toUpperCase();
  const workload = workloadStrength(item);
  const projection = projectionStrength(item);
  const weekOneBaseline = item?.evidence?.sage?.baselineEvidenceType === 'week1-adp-baseline';

  if (['RB', 'WR', 'TE'].includes(position)) {
    // Skill-position depth adds need an observed role. A projection comparison
    // alone can qualify only before real workload exists in the Week 1 baseline.
    return workload >= 2 ||
      (weekOneBaseline && projection >= 2);
  }
  // QB/K/DEF have no RB/WR/TE workload signal, so require a clear projection gain.
  return projection >= 2;
}

function normalizedCoveragePosition(position) {
  const value = String(position || '').toUpperCase();
  if (value === 'PK') return 'K';
  if (value === 'DST') return 'DEF';
  return value;
}

function positionCoverageQualified(item) {
  const position = normalizedCoveragePosition(item?.position);
  const rank = finiteNumber(item?.evidence?.sage?.positionRank);
  const projected = finiteNumber(item?.evidence?.providerProjectedPoints);
  const rankCeiling = { QB: 12, TE: 12, K: 10, DEF: 10 }[position];
  const projectionFloor = { QB: 10, TE: 4, K: 5, DEF: 5 }[position];

  // These positions do not produce the RB/WR workload evidence used by the
  // main gate (and TE usage can be sparse). Preserve only credible weekly
  // options: a startable positional rank plus a usable provider projection.
  return Number.isFinite(rankCeiling) && rank !== null && rank <= rankCeiling &&
    projected !== null && projected >= projectionFloor;
}

function recommendedCandidate(item, verdict) {
  if (['ADD_NOW', 'STASH'].includes(verdict)) return true;
  if (item?.active === false || verdict === 'PASS') return false;
  if (!['WATCH', 'REVIEW'].includes(verdict)) return false;

  const position = normalizedCoveragePosition(item?.position);
  const workload = workloadStrength(item);
  const projection = projectionStrength(item);
  if (['RB', 'WR'].includes(position)) {
    return verdict === 'WATCH' && (workload >= 2 || projection >= 2);
  }
  if (position === 'TE') {
    if (positionCoverageQualified(item)) return true;
    if (verdict !== 'WATCH') return false;
    return workload >= 2 || projection >= 2;
  }
  return positionCoverageQualified(item) || (verdict === 'WATCH' && projection >= 2);
}

function faabMarketBand(item, verdict) {
  const workload = workloadStrength(item);
  const projection = projectionStrength(item);
  const trend = item?.evidence?.trend?.direction || item?.evidence?.opportunity?.direction || null;
  const starts = item?.evidence?.rosterImpact?.candidateStarts === true;

  // A label, position, league size, or ownership percentage can refine real
  // evidence, but can never manufacture a bid by itself.
  if (Math.max(workload, projection) === 0) return null;

  if (verdict === 'ADD_NOW') {
    if (starts && projection >= 3 && workload >= 2 && trend === 'RISER') return 'BREAKOUT';
    if (starts && projection >= 2) return 'LINEUP_ADD';
    return 'PRIORITY_STASH';
  }

  if (workload >= 3 && projection >= 1) return 'PRIORITY_STASH';
  if ((workload >= 2 && projection >= 1) || projection >= 2) return 'DEPTH_STASH';
  return 'SPECULATIVE';
}

function faabMarketMultiplier(position, teams, scoring) {
  let multiplier = 1;
  if (Number.isFinite(teams)) {
    if (teams <= 8) multiplier *= 0.75;
    else if (teams <= 10) multiplier *= 0.85;
    else if (teams >= 14) multiplier *= 1.15;
  }
  if (['ppr', 'full-ppr', '1-ppr'].includes(scoring) && ['WR', 'TE'].includes(position)) {
    multiplier *= 1.1;
  }
  return multiplier;
}

function marketAdjustedPct(value, multiplier) {
  return Math.max(1, Math.round(value * multiplier));
}

function buildFaabGuidance(item, verdict, context = {}) {
  if (!['ADD_NOW', 'STASH'].includes(verdict)) return null;

  const marketBand = faabMarketBand(item, verdict);
  if (!marketBand) return null;

  const band = FAAB_MARKET_BANDS[marketBand];
  const basis = [];
  const teams = Number(context?.teams);
  const scoring = normalizeScoring(context?.scoring);
  const position = String(item?.position || '').toUpperCase();
  const workload = workloadStrength(item);
  const gain = projectionGain(item);
  const percentOwned = finiteNumber(item?.evidence?.percentOwned);
  const marketMultiplier = faabMarketMultiplier(position, teams, scoring);

  if (workload > 0) basis.push(`verified workload level ${workload}/3`);
  if (gain !== null && gain >= 2) basis.push(`${gain.toFixed(1)} projected-point roster gain`);
  if (Number.isFinite(teams)) basis.push(`${teams}-team market adjustment`);
  if (marketMultiplier !== faabMarketMultiplier(position, teams, '')) {
    basis.push(`${scoring} positional adjustment`);
  }
  if (percentOwned !== null) basis.push(`${Math.round(percentOwned)}% provider rostered (context only)`);

  return {
    budgetBasis: 'original-budget-percent',
    archetype: marketBand,
    valuePct: marketAdjustedPct(band.valuePct, marketMultiplier),
    recommendedPct: marketAdjustedPct(band.recommendedPct, marketMultiplier),
    aggressivePct: marketAdjustedPct(band.aggressivePct, marketMultiplier),
    confidence: workload > 0 && projectionStrength(item) > 0 ? 'HIGH' : 'MEDIUM',
    evidence: {
      workloadStrength: workload,
      projectionStrength: projectionStrength(item),
      projectionGain: gain,
      position,
      marketMultiplier
    },
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
    recommended: recommendedCandidate(item, verdict),
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
      rosterImpact?.classification === 'UPGRADE' &&
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
          'Provider availability is authoritative. ADD NOW requires a safe Weekly SAGE match and a demonstrated lineup upgrade. FAAB uses verified workload and roster-relative projection gain to select a calibrated market band, then adjusts for league depth and relevant scoring; trend labels and roster percentage cannot create a bid.',
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
