'use strict';

// netlify/functions/waiver-recommendations.js
//
// Customer-facing orchestration for Available For You.
// Reuses the existing provider-authoritative waiver candidate service and
// conservative decision layer. No transaction is submitted. FAAB guidance is
// a bounded percentage derived only from recommendation evidence and league
// context supplied to this endpoint.

const waiverCandidates = require('./waiver-candidates.js');
const { resolveCurrentNFLWeek } = require('./_current-nfl-week.js');
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

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function connectedFaabBudget(connection) {
  const settings = connection?.settings || connection?.league?.settings || {};
  const league = connection?.league || {};
  const candidates = [
    settings?.faabBudget,
    settings?.originalFaabBudget,
    settings?.waiverBudget,
    settings?.acquisitionBudget,
    settings?.waivers?.budget,
    settings?.waiver?.budget,
    league?.faabBudget,
    league?.originalFaabBudget,
    league?.waiverBudget,
    connection?.faabBudget,
    connection?.originalFaabBudget
  ];
  for (const value of candidates) {
    const budget = positiveInteger(value);
    if (budget) return budget;
  }
  return null;
}

function resolveFaabBudget(body) {
  const connection = body?.connection && typeof body.connection === 'object'
    ? body.connection
    : {};
  const connected = connectedFaabBudget(connection);
  if (connected) return { budget: connected, source: 'connected-league-settings' };
  const supplied = positiveInteger(body?.originalFaabBudget);
  if (supplied) return { budget: supplied, source: 'user-provided' };
  return { budget: null, source: 'unknown' };
}

function pctToDollars(percentage, budget) {
  const pct = Number(percentage);
  return Number.isFinite(pct) && positiveInteger(budget)
    ? Math.round(positiveInteger(budget) * pct / 100)
    : null;
}

function addDollarGuidance(item, budget) {
  if (!item?.faab) return item;
  return {
    ...item,
    faab: {
      ...item.faab,
      valueDollars: pctToDollars(item.faab.valuePct, budget),
      recommendedDollars: pctToDollars(item.faab.recommendedPct, budget),
      aggressiveDollars: pctToDollars(item.faab.aggressivePct, budget),
      originalBudget: positiveInteger(budget)
    }
  };
}

function matchingCoverageAdequate(metadata) {
  const rosterPlayersReceived = Number(metadata?.rosterPlayersReceived) || 0;
  const rosterIdentified = Number(metadata?.rosterIdentified) || 0;
  const rosterMatchCoverage = Number(metadata?.rosterMatchCoverage) || 0;
  return rosterPlayersReceived > 0 && rosterIdentified >= 3 && rosterMatchCoverage >= 0.5;
}

function buildWeekEvidenceMessages(targetWeekValue, evidenceWeekValue, fallbackValue) {
  const targetWeek = validWeek(targetWeekValue);
  const evidenceWeek = validWeek(evidenceWeekValue) || targetWeek;
  const historicalFallbackUsed = Boolean(
    fallbackValue || (targetWeek && evidenceWeek && targetWeek !== evidenceWeek)
  );
  return [
    `Target recommendation week: ${targetWeek}.`,
    `Weekly SAGE evidence week: ${evidenceWeek}.`,
    `Historical fallback used: ${historicalFallbackUsed ? 'true' : 'false'}.`
  ];
}

function derive2026RegularSeasonWeek(now) {
  return resolveCurrentNFLWeek(now, 2026);
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

  // Never tell a customer to act immediately from market price alone. FAAB can
  // now be supported by a credible weekly rank, but ADD NOW still requires
  // verified workload or a material roster-relative projection gain.
  if (action === 'ADD') {
    return Math.max(workloadStrength(item), projectionStrength(item)) > 0
      ? 'ADD_NOW'
      : 'REVIEW';
  }
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
  NO_BID: { valuePct: 0, recommendedPct: 0, aggressivePct: 1 },
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
  const position = normalizedCoveragePosition(item?.position);
  const rank = finiteNumber(item?.evidence?.sage?.positionRank);
  const trend = item?.evidence?.trend?.direction || item?.evidence?.opportunity?.direction || null;
  const starts = item?.evidence?.rosterImpact?.candidateStarts === true;

  // Weekly rank is market evidence even when a player is not a meaningful
  // upgrade for this particular roster. Keep the qualifying range broad
  // enough to price normal 12-team waiver pools while excluding deep names.
  const rankCeiling = { QB: 24, RB: 60, WR: 60, TE: 24, K: 16, DEF: 16 }[position];
  const credibleWeeklyRank = rank !== null && Number.isFinite(rankCeiling) && rank <= rankCeiling;

  // Ownership, trend labels, and league size can refine a bid but cannot create
  // one. Verified workload, projection gain, or a credible Weekly SAGE rank can.
  if (Math.max(workload, projection) === 0) {
    return credibleWeeklyRank ? 'SPECULATIVE' : 'NO_BID';
  }

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
  if (value === 0) return 0;
  return Math.max(1, Math.round(value * multiplier));
}

function buildFaabGuidance(item, verdict, context = {}) {
  // Price the player independently from the roster-action verdict. A player
  // can be a WATCH, REVIEW, or PASS for this specific roster and still have a
  // defensible market bid when provider projections or verified workload
  // supply enough evidence. The evidence gate below still prevents invented
  // bids when those inputs are absent.
  const marketBand = faabMarketBand(item, verdict);
  const band = FAAB_MARKET_BANDS[marketBand];
  const basis = [];
  const teams = Number(context?.teams);
  const scoring = normalizeScoring(context?.scoring);
  const position = String(item?.position || '').toUpperCase();
  const workload = workloadStrength(item);
  const gain = projectionGain(item);
  const weeklyRank = finiteNumber(item?.evidence?.sage?.positionRank);
  const percentOwned = finiteNumber(item?.evidence?.percentOwned);
  const marketMultiplier = faabMarketMultiplier(position, teams, scoring);

  if (workload > 0) basis.push(`verified workload level ${workload}/3`);
  if (gain !== null && gain >= 2) basis.push(`${gain.toFixed(1)} projected-point roster gain`);
  if (weeklyRank !== null) basis.push(`${position}${weeklyRank} Weekly SAGE market rank`);
  if (marketBand === 'NO_BID') basis.push('no verified market signal; zero-dollar claim only');
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
  const requestedVerdict = customerVerdict(item);
  const rosterImpact = item?.evidence?.rosterImpact || null;
  const weakest = rosterImpact?.weakestComparable || null;
  const sage = item?.evidence?.sage || null;
  const trend = item?.evidence?.trend || null;
  const opportunity = item?.evidence?.opportunity || null;

  const depthWeakest = rosterImpact?.depthComparison?.weakestComparable || weakest;
  const requestedClaim = ['ADD_NOW', 'STASH'].includes(requestedVerdict);
  const hasLegalDrop = Boolean(depthWeakest?.name);
  // Customer-facing claims are actionable only as complete add/drop pairs.
  // A candidate without a specific legal drop remains REVIEW and receives no
  // bidding advice, even if its internal roster-impact evidence is positive.
  const verdict = requestedClaim && !hasLegalDrop ? 'REVIEW' : requestedVerdict;
  const claimRecommended = ['ADD_NOW', 'STASH'].includes(verdict);
  const faab = claimRecommended
    ? buildFaabGuidance(item, verdict, context)
    : null;
  return {
    ...item,
    verdict,
    recommended: recommendedCandidate(item, verdict),
    opportunity,
    customerActionable: claimRecommended,
    faab,
    swapFor:
      claimRecommended && depthWeakest?.name
        ? {
            name: depthWeakest.name,
            position: depthWeakest.position || null,
            team: depthWeakest.team || null
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
  const resolvedEvent = withResolvedWeek(event);
  let requestBody = {};
  try { requestBody = JSON.parse(resolvedEvent?.body || '{}'); } catch (_) {}
  const budgetResolution = resolveFaabBudget(requestBody);
  const candidateResponse = await waiverCandidates.handler(resolvedEvent);

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
  const builtRecommendations = buildCustomerRecommendations(rawDecisions, {
    teams: candidateBody.teams || candidateBody.metadata?.teams || null,
    scoring: candidateBody.scoring || candidateBody.metadata?.scoring || null
  });
  const rosterPlayersReceived = Number(candidateBody.metadata?.rosterPlayersReceived) || 0;
  const rosterIdentified = Number(candidateBody.metadata?.rosterIdentified) || 0;
  const rosterSageMatched = Number(candidateBody.metadata?.rosterSageMatched) || 0;
  const rosterMatchCoverage = Number(candidateBody.metadata?.rosterMatchCoverage) || 0;
  const coverageAdequate = matchingCoverageAdequate(candidateBody.metadata);
  const recommendations = builtRecommendations.map((item) => {
    const safeItem = coverageAdequate ? item : {
      ...item,
      verdict: item.verdict === 'PASS' ? 'PASS' : 'REVIEW',
      recommended: false,
      customerActionable: false,
      swapFor: null,
      lineupFor: null,
      benchFor: null,
      faab: null,
      decision: {
        ...(item.decision || {}),
        action: item.verdict === 'PASS' ? 'PASS' : 'REVIEW',
        actionable: false,
        reasonCode: 'MATCHING_COVERAGE_INADEQUATE',
        reasons: ['Connected-roster identity coverage is inadequate for a safe add/drop recommendation.']
      }
    };
    const actionableItem = ['ADD_NOW', 'STASH'].includes(safeItem.verdict) && safeItem.swapFor?.name
      ? safeItem
      : { ...safeItem, faab: null };
    return addDollarGuidance(actionableItem, budgetResolution.budget);
  });

  const weekEvidenceMessages = buildWeekEvidenceMessages(
    candidateBody.week,
    candidateBody.metadata?.sageSourceWeek,
    candidateBody.metadata?.sageFallbackUsed
  );

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
        matchingCoverage: {
          adequate: coverageAdequate,
          rosterPlayersReceived,
          rosterIdentified,
          rosterSageMatched,
          rosterMatchCoverage
        },
        originalFaabBudget: budgetResolution.budget,
        faabBudgetSource: budgetResolution.source,
        needsOriginalFaabBudget: budgetResolution.budget === null,
        methodology:
          'Provider availability is authoritative. ADD NOW requires a safe Weekly SAGE match and a demonstrated lineup upgrade. FAAB uses verified workload and roster-relative projection gain to select a calibrated market band, then adjusts for league depth and relevant scoring; trend labels and roster percentage cannot create a bid.',
        limitations: [
          ...weekEvidenceMessages,
          budgetResolution.budget === null
            ? 'Original FAAB budget is unknown. Ask the user for it; until supplied, show percentage-only guidance.'
            : `Dollar guidance uses the ${budgetResolution.source} original FAAB budget.`,
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
  ownershipComponent,
  workloadStrength,
  stashEvidenceQualified,
  connectedFaabBudget,
  resolveFaabBudget,
  addDollarGuidance,
  matchingCoverageAdequate,
  buildWeekEvidenceMessages
};
