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
  return (Array.isArray(decisions) ? decisions : [])
    .map(decorateDecision)
    .filter((item) => item.verdict !== 'INELIGIBLE')
    .sort((a, b) => {
      const verdictDiff = verdictPriority(a.verdict) - verdictPriority(b.verdict);
      if (verdictDiff !== 0) return verdictDiff;

      const aRank = Number(a?.evidence?.sage?.positionRank);
      const bRank = Number(b?.evidence?.sage?.positionRank);
      const safeA = Number.isFinite(aRank) ? aRank : Number.MAX_SAFE_INTEGER;
      const safeB = Number.isFinite(bRank) ? bRank : Number.MAX_SAFE_INTEGER;
      if (safeA !== safeB) return safeA - safeB;

      return String(a.name || '').localeCompare(String(b.name || ''));
    });
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
  summarizeCustomerRecommendations
};
