'use strict';

// netlify/functions/waiver-recommendations.js
//
// Customer-facing orchestration for Available For You.
// Reuses the existing provider-authoritative waiver candidate service and
// conservative decision layer. No transaction is submitted and no FAAB value
// is invented here.

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

  // 2026 Week 1 opens Thursday, September 10. Keep this fallback scoped
  // strictly to the 2026 regular season so provider week fields always win.
  const weekOneStart = Date.UTC(2026, 8, 10);
  const weekNineteenStart = weekOneStart + (18 * 7 * 24 * 60 * 60 * 1000);
  const currentUtcDate = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  );

  if (currentUtcDate < weekOneStart || currentUtcDate >= weekNineteenStart) {
    return null;
  }

  return Math.floor((currentUtcDate - weekOneStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function resolveWaiverWeek(body, now = new Date()) {
  const connection = body?.connection && typeof body.connection === 'object'
    ? body.connection
    : {};
  const league = connection?.league && typeof connection.league === 'object'
    ? connection.league
    : {};

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
    league?.scoringPeriod
  );

  const resolvedProviderWeek = validWeek(providerWeek);
  if (resolvedProviderWeek) return resolvedProviderWeek;

  const season = Number(firstPresent(
    body?.season,
    connection?.season,
    league?.season,
    now.getUTCFullYear()
  ));

  return season === 2026 ? derive2026RegularSeasonWeek(now) : null;
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
  const trend = item?.evidence?.trend?.direction || null;

  if (action === 'ADD') return 'ADD_NOW';
  if (action === 'WATCH' && trend === 'RISER') return 'STASH';
  if (action === 'WATCH') return 'WATCH';
  if (action === 'PASS') return 'PASS';
  return 'REVIEW';
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

function decorateDecision(item) {
  const verdict = customerVerdict(item);
  const weakest = item?.evidence?.rosterImpact?.weakestComparable || null;
  const sage = item?.evidence?.sage || null;
  const trend = item?.evidence?.trend || null;

  return {
    ...item,
    verdict,
    customerActionable: verdict === 'ADD_NOW',
    swapFor:
      verdict === 'ADD_NOW' && weakest?.name
        ? {
            name: weakest.name,
            position: weakest.position || null,
            team: weakest.team || null
          }
        : null,
    quickRead: {
      weeklyRank:
        sage?.position && sage?.positionRank
          ? `${sage.position}${sage.positionRank}`
          : null,
      weeklyRecommendation: sage?.recommendation || null,
      opponent: sage?.opponent || null,
      trend: trend?.direction || null,
      percentOwned:
        item?.evidence?.percentOwned === undefined
          ? null
          : item.evidence.percentOwned
    }
  };
}

function buildCustomerRecommendations(decisions) {
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
    .map(decorateDecision)
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
  const recommendations = buildCustomerRecommendations(rawDecisions);

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
          'Provider availability is authoritative. ADD NOW requires a safe Weekly SAGE match and a demonstrated roster upgrade. STASH is reserved for similar roster value with a rising opportunity trend. WATCH and PASS remain conservative when evidence does not justify an add.',
        limitations: [
          'No FAAB amount is calculated.',
          'No transaction is submitted.',
          'Current upgrade proof uses the existing same-position Weekly SAGE roster comparison; FLEX-aware incremental lineup optimization remains a separate SAGE enhancement.'
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
