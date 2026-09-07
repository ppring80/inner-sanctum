'use strict';

// netlify/functions/fix-my-team.js
//
// INNER SANCTUM — FIX MY TEAM AGGREGATOR
// --------------------------------------
// Compresses provider-neutral waiver intelligence into a small set of
// customer-facing roster opportunities. It delegates evidence gathering to
// waiver-candidates.js and decision classification to waiver-decision.js.
//
// This function does NOT:
// - recalculate Weekly SAGE
// - invent league availability
// - submit add/drop or waiver transactions
// - calculate FAAB
// - create a new numeric waiver score

const { buildWaiverDecisions, summarizeDecisions } = require('./waiver-decision');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
  : ['https://theinnersanctum.xyz'];

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin'
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function jsonResponse(statusCode, body, origin) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(body)
  };
}

function getBaseUrl(event) {
  const headers = event.headers || {};
  const proto =
    headers['x-forwarded-proto'] ||
    headers['X-Forwarded-Proto'] ||
    'https';
  const host = headers.host || headers.Host;

  if (!host) {
    throw new Error('Could not determine host.');
  }

  return `${proto}://${host}`;
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function opportunityPriority(action) {
  return {
    ADD: 0,
    WATCH: 1,
    REVIEW: 2
  }[action] ?? 9;
}

function sagePositionRank(item) {
  const rank = Number(item?.evidence?.sage?.positionRank);
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
}

function toOpportunity(item) {
  const weakest = item?.evidence?.rosterImpact?.weakestComparable || null;
  const trend = item?.evidence?.trend || null;

  return {
    action: item?.decision?.action || 'REVIEW',
    actionable: Boolean(item?.decision?.actionable),
    name: item?.name || '',
    position: item?.position || null,
    team: item?.team || null,
    availabilityStatus: item?.availabilityStatus || null,
    providerPlayerId: item?.providerPlayerId || null,
    reasons: Array.isArray(item?.decision?.reasons) ? item.decision.reasons : [],
    sage: item?.evidence?.sage || null,
    trend,
    rosterImpact: item?.evidence?.rosterImpact || null,
    replaceCandidate: weakest
      ? {
          name: weakest.name || null,
          position: weakest.position || null,
          team: weakest.team || null,
          sage: weakest.sage || null
        }
      : null,
    percentOwned:
      item?.evidence?.percentOwned === undefined ? null : item.evidence.percentOwned
  };
}

function buildFixMyTeamSummary(decisions, limit) {
  const safeLimit = normalizeLimit(limit);
  const all = Array.isArray(decisions) ? decisions : [];
  const counts = summarizeDecisions(all);

  const opportunities = all
    .filter((item) => ['ADD', 'WATCH', 'REVIEW'].includes(item?.decision?.action))
    .slice()
    .sort((a, b) => {
      const priority =
        opportunityPriority(a?.decision?.action) -
        opportunityPriority(b?.decision?.action);
      if (priority !== 0) return priority;

      const rank = sagePositionRank(a) - sagePositionRank(b);
      if (rank !== 0) return rank;

      return String(a?.name || '').localeCompare(String(b?.name || ''));
    })
    .slice(0, safeLimit)
    .map(toOpportunity);

  return {
    status: counts.add > 0 ? 'ACTION_AVAILABLE' : counts.watch > 0 ? 'WATCHLIST' : 'NO_CLEAR_UPGRADE',
    counts,
    opportunities,
    topOpportunity: opportunities.length ? opportunities[0] : null
  };
}

async function fetchWaiverCandidates(event, body) {
  const baseUrl = getBaseUrl(event);
  const response = await fetch(
    `${baseUrl}/.netlify/functions/waiver-candidates`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    }
  );

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok || !data) {
    throw new Error(
      (data && (data.error || data.detail)) ||
      `Waiver candidates unavailable (HTTP ${response.status}).`
    );
  }

  return data;
}

exports.handler = async function (event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';

  if (!isOriginAllowed(origin)) {
    return jsonResponse(403, { error: 'Forbidden' }, origin);
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, origin);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return jsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  try {
    const waiverData = await fetchWaiverCandidates(event, body);
    const decisions = buildWaiverDecisions(waiverData.candidates || []);
    const summary = buildFixMyTeamSummary(decisions, body.limit);

    return jsonResponse(
      200,
      {
        evidenceType: 'fix-my-team',
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        provider: waiverData.provider || body.provider || null,
        season: waiverData.season || body.season || null,
        week: waiverData.week || body.week || null,
        status: summary.status,
        counts: summary.counts,
        opportunities: summary.opportunities,
        topOpportunity: summary.topOpportunity,
        metadata: {
          waiverCandidateSchemaVersion: waiverData.schemaVersion || null,
          availablePlayersReceived:
            waiverData?.metadata?.availablePlayersReceived ?? null,
          candidatesEvaluated: decisions.length,
          opportunityLimit: normalizeLimit(body.limit),
          availabilityMeta: waiverData?.metadata?.availabilityMeta || null,
          methodology:
            'Provider availability remains authoritative. Fix My Team compresses existing waiver decisions into ADD/WATCH/REVIEW opportunities and does not calculate a new waiver score.'
        }
      },
      origin
    );
  } catch (error) {
    return jsonResponse(
      502,
      {
        error: 'Fix My Team could not be produced.',
        detail: error && error.message ? error.message : 'Unknown error.'
      },
      origin
    );
  }
};

exports._test = {
  normalizeLimit,
  opportunityPriority,
  sagePositionRank,
  toOpportunity,
  buildFixMyTeamSummary
};
