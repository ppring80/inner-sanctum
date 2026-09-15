'use strict';

// netlify/functions/waiver-decision.js
//
// INNER SANCTUM — CONSERVATIVE WAIVER DECISION LAYER
// --------------------------------------------------
// Converts the evidence already produced by waiver-candidates.js into a
// plain-language action classification. It does NOT calculate a new score,
// change Weekly SAGE, invent league availability, calculate FAAB, or submit
// transactions.
//
// Provider availability remains the gate. A player can only receive an ADD
// action when all of the following are true:
//   1. the provider explicitly reports FREE_AGENT / FREEAGENT / WAIVERS;
//   2. the player matched Weekly SAGE safely;
//   3. the candidate has a real same-position roster comparison; and
//   4. the candidate ranks ahead of the weakest comparable roster player.
//
// Trend evidence is supporting context only. A RISER can strengthen the
// explanation, but trend can never turn a non-upgrade into an ADD.

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (arguments[i] !== undefined && arguments[i] !== null) {
      return arguments[i];
    }
  }
  return undefined;
}

function normalizeAvailabilityStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'FREEAGENT') return 'FREE_AGENT';
  return status;
}

function isAvailable(candidate) {
  return ['FREE_AGENT', 'WAIVERS'].includes(
    normalizeAvailabilityStatus(
      firstDefined(candidate?.availabilityStatus, candidate?.status)
    )
  );
}

function buildReasons(candidate) {
  const reasons = [];
  const sage = candidate?.sage || null;
  const trend = candidate?.trend || null;
  const impact = candidate?.rosterImpact || null;
  const weakest = impact?.weakestComparable || null;

  if (sage?.position && sage?.positionRank) {
    reasons.push(`Weekly SAGE: ${sage.position}${sage.positionRank}`);
  }

  if (impact?.comparisonType === 'starting-lineup' && impact?.candidateStarts) {
    const slot = impact.targetSlot || 'starting lineup';
    reasons.push(
      weakest?.name
        ? `Projects into ${slot} over ${weakest.name}`
        : `Projects into an open ${slot} spot`
    );
    if (Number.isFinite(impact.projectionDelta)) {
      reasons.push(`Provider projection improves the lineup by ${impact.projectionDelta.toFixed(1)} points`);
    }
  }

  if (
    impact?.classification === 'UPGRADE' &&
    impact?.comparisonType !== 'starting-lineup' &&
    weakest?.name &&
    weakest?.sage?.positionRank
  ) {
    reasons.push(
      `Ranks ahead of ${weakest.name} (${weakest.sage.position || sage?.position || ''}${weakest.sage.positionRank})`
    );
  }

  if (trend?.direction === 'RISER') {
    reasons.push('Opportunity trend is rising');
  } else if (trend?.direction === 'FALLER') {
    reasons.push('Opportunity trend is falling');
  }

  if (sage?.recommendation) {
    reasons.push(`Weekly recommendation: ${String(sage.recommendation).toUpperCase()}`);
  }

  return reasons;
}

function meaningfulUpgradeEvidence(candidate) {
  const sage = candidate?.sage || null;
  const impact = candidate?.rosterImpact || null;
  const weakestSage = impact?.weakestComparable?.sage || null;
  const candidateRank = Number(sage?.positionRank);
  const rosterRank = Number(weakestSage?.positionRank);
  const candidateScore = Number(sage?.sageScore);
  const rosterScore = Number(weakestSage?.sageScore);

  // Week 1 is an ADP baseline, not a current-week SAGE evaluation. A baseline
  // rank edge may support review, but can never justify telling a customer to
  // drop an established roster player.
  if (sage?.baselineEvidenceType === 'week1-adp-baseline') return false;

  if (!Number.isFinite(candidateRank) || !Number.isFinite(rosterRank)) return false;
  if (!Number.isFinite(candidateScore) || !Number.isFinite(rosterScore)) return false;

  // Cross-position FLEX/SUPERFLEX comparisons use SAGE score, not positional
  // rank. A WR rank and RB rank are not directly comparable.
  if (impact?.comparisonType === 'starting-lineup') {
    return impact.candidateStarts === true &&
      Number(impact.lineupValueDelta) > 0 &&
      candidateScore - rosterScore >= 5;
  }

  return rosterRank - candidateRank >= 8 && candidateScore - rosterScore >= 5;
}

function classifyCandidate(candidate) {
  if (!candidate || !isAvailable(candidate)) {
    return {
      action: 'INELIGIBLE',
      actionable: false,
      reasonCode: 'NOT_PROVIDER_AVAILABLE',
      reasons: []
    };
  }

  if (!candidate?.identity?.sageMatched || !candidate?.sage) {
    return {
      action: 'REVIEW',
      actionable: false,
      reasonCode: 'SAGE_UNMATCHED',
      reasons: ['Provider reports this player available, but Weekly SAGE identity was not safely matched.']
    };
  }

  const impact = candidate?.rosterImpact?.classification || 'UNKNOWN';

  if (impact === 'UPGRADE') {
    if (!meaningfulUpgradeEvidence(candidate)) {
      return {
        action: 'REVIEW',
        actionable: false,
        reasonCode: 'UPGRADE_EVIDENCE_INSUFFICIENT',
        reasons: buildReasons(candidate).concat([
          'A weekly rank edge alone is not enough evidence to recommend dropping a rostered player.'
        ])
      };
    }
    return {
      action: 'ADD',
      actionable: true,
      reasonCode: 'ROSTER_UPGRADE',
      reasons: buildReasons(candidate)
    };
  }

  if (impact === 'SIMILAR') {
    const depthComparison = candidate?.rosterImpact?.depthComparison || null;
    if (
      candidate?.rosterImpact?.comparisonType === 'starting-lineup' &&
      candidate?.rosterImpact?.candidateStarts === false &&
      depthComparison?.classification === 'DOWNGRADE'
    ) {
      return {
        action: 'PASS',
        actionable: false,
        reasonCode: 'ROSTER_DEPTH_DOWNGRADE',
        reasons: buildReasons(candidate).concat([
          'Does not enter the starting lineup and ranks behind the weakest comparable roster player.'
        ])
      };
    }
    return {
      action: 'WATCH',
      actionable: false,
      reasonCode: 'SIMILAR_TO_ROSTER',
      reasons: buildReasons(candidate)
    };
  }

  if (impact === 'DOWNGRADE') {
    return {
      action: 'PASS',
      actionable: false,
      reasonCode: 'ROSTER_DOWNGRADE',
      reasons: buildReasons(candidate)
    };
  }

  return {
    action: 'REVIEW',
    actionable: false,
    reasonCode: 'ROSTER_COMPARISON_UNAVAILABLE',
    reasons: buildReasons(candidate)
  };
}

function actionPriority(action) {
  return {
    ADD: 0,
    WATCH: 1,
    REVIEW: 2,
    PASS: 3,
    INELIGIBLE: 4
  }[action] ?? 9;
}

function positionRank(candidate) {
  const rank = Number(candidate?.sage?.positionRank);
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
}

function buildWaiverDecisions(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      providerPlayerId: candidate?.providerPlayerId || null,
      name: candidate?.name || '',
      position: candidate?.position || candidate?.sage?.position || null,
      team: candidate?.team || null,
      availabilityStatus: normalizeAvailabilityStatus(candidate?.availabilityStatus),
      decision: classifyCandidate(candidate),
      evidence: {
        sage: candidate?.sage || null,
        trend: candidate?.trend || null,
        rosterImpact: candidate?.rosterImpact || null,
        percentOwned:
          candidate?.percentOwned === undefined ? null : candidate.percentOwned,
        providerProjectedPoints:
          candidate?.providerProjectedPoints === undefined
            ? null
            : candidate.providerProjectedPoints
      }
    }))
    .sort((a, b) => {
      const priorityDiff =
        actionPriority(a.decision.action) - actionPriority(b.decision.action);
      if (priorityDiff !== 0) return priorityDiff;

      const rankDiff = positionRank(a.evidence) - positionRank(b.evidence);
      if (rankDiff !== 0) return rankDiff;

      return String(a.name).localeCompare(String(b.name));
    });
}

function summarizeDecisions(decisions) {
  const summary = {
    add: 0,
    watch: 0,
    review: 0,
    pass: 0,
    ineligible: 0,
    actionable: 0
  };

  (Array.isArray(decisions) ? decisions : []).forEach((item) => {
    const action = String(item?.decision?.action || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, action)) {
      summary[action] += 1;
    }
    if (item?.decision?.actionable) {
      summary.actionable += 1;
    }
  });

  return summary;
}

module.exports = {
  buildWaiverDecisions,
  summarizeDecisions,
  classifyCandidate,
  _test: {
    normalizeAvailabilityStatus,
    isAvailable,
    buildReasons,
    meaningfulUpgradeEvidence,
    classifyCandidate,
    actionPriority,
    buildWaiverDecisions,
    summarizeDecisions
  }
};
