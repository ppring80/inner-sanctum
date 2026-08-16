// draft-sage-synthesis.js
// SAGE Step 5 — Explainable Draft Synthesis
//
// Pure, additive decision layer.
// It consumes already-built Step 2 (Opportunity), Step 3 (Market),
// and Step 4 (Scarcity) outputs. It does not recalculate those layers.
//
// Consumer question:
//   "Given the evidence we already have, what should I do with this player now?"
//
// Design rules:
// - No hidden numeric score.
// - No positional bias.
// - No ranking override just because ADP says so.
// - Missing/uncertain evidence reduces conviction instead of being guessed through.
// - Recommendation + reasons are produced from explicit, inspectable rules.

(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SanctumDraftSageSynthesis = factory();
  }
}(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  function text(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function opportunitySignals(profile) {
    profile = profile || {};

    var workload =
      profile.workload || {};

    var direction =
      profile.roleDirection || {};

    var style =
      profile.roleStyle || {};

    var evidence =
      profile.evidence || {};

    return {
      workload:
        text(workload.label),

      direction:
        text(direction.label),

      style:
        text(style.label),

      evidence:
        text(evidence.label)
    };
  }

  function marketSignals(profile) {
    profile =
      profile || {};

    var value =
      profile.marketValue || {};

    var outlook =
      profile.returnOutlook || {};

    return {
      value:
        text(value.label),

      outlook:
        text(outlook.label)
    };
  }

  function scarcitySignals(profile) {
    profile =
      profile || {};

    var cost =
      profile.costOfWaiting || {};

    return {
      cost:
        text(cost.label)
    };
  }

  function isStrongOpportunity(s) {
    return (
      s.workload === 'High Volume' &&
      (
        s.direction === 'Increasing Role' ||
        s.direction === 'Stable Role'
      )
    );
  }

  function isWeakOpportunity(s) {
    return (
      s.workload === 'Role Player' ||
      s.direction === 'Decreasing Role'
    );
  }

  function isLimitedEvidence(s) {
    return (
      s.evidence === 'Limited' ||
      s.evidence === 'No NFL History' ||
      s.workload === 'No NFL History' ||
      s.direction === 'Not Enough Data Yet'
    );
  }

  function marketPushesNow(s) {
    return (
      s.value === 'Discount' ||
      s.outlook === 'Market Leans Gone'
    );
  }

  function marketAllowsWait(s) {
    return (
      s.outlook ===
      'Market Says He May Return'
    );
  }

  function scarcityPushesNow(s) {
    return (
      s.cost === 'High'
    );
  }

  function scarcityAllowsWait(s) {
    return (
      s.cost === 'Low'
    );
  }

  function uncertaintyPresent(
    opportunity,
    market,
    scarcity
  ) {
    return (
      isLimitedEvidence(opportunity) ||
      market.value ===
        'Market Value Unknown' ||
      market.outlook ===
        'Return Outlook Unknown' ||
      scarcity.cost ===
        'Unknown' ||
      scarcity.cost ===
        'Uncertain'
    );
  }

  function buildReasons(
    opportunity,
    market,
    scarcity
  ) {
    var reasons = [];

    if (opportunity.workload) {
      reasons.push(
        opportunity.workload +
        ' workload'
      );
    }

    if (opportunity.direction) {
      reasons.push(
        opportunity.direction.toLowerCase()
      );
    }

    if (
      market.value ===
      'Discount'
    ) {
      reasons.push(
        'available at a discount'
      );
    } else if (
      market.value ===
      'Ahead of Market'
    ) {
      reasons.push(
        'priced ahead of market'
      );
    } else if (
      market.value ===
      'At Market'
    ) {
      reasons.push(
        'priced near market'
      );
    }

    if (
      market.outlook ===
      'Market Leans Gone'
    ) {
      reasons.push(
        'market risk if you wait'
      );
    } else if (
      market.outlook ===
      'Market Says He May Return'
    ) {
      reasons.push(
        'market gives room to wait'
      );
    }

    if (
      scarcity.cost ===
      'High'
    ) {
      reasons.push(
        'high cost of waiting at the position'
      );
    } else if (
      scarcity.cost ===
      'Moderate'
    ) {
      reasons.push(
        'moderate cost of waiting at the position'
      );
    } else if (
      scarcity.cost ===
      'Low'
    ) {
      reasons.push(
        'later positional depth remains'
      );
    } else if (
      scarcity.cost ===
      'Uncertain'
    ) {
      reasons.push(
        'scarcity read is uncertain'
      );
    }

    return reasons;
  }

  function buildRecommendation(input) {
    input =
      input || {};

    var opportunity =
      opportunitySignals(
        input.opportunityProfile
      );

    var market =
      marketSignals(
        input.marketProfile
      );

    var scarcity =
      scarcitySignals(
        input.scarcityProfile
      );

    var strong =
      isStrongOpportunity(
        opportunity
      );

    var weak =
      isWeakOpportunity(
        opportunity
      );

    var nowPressure =
      marketPushesNow(market) ||
      scarcityPushesNow(scarcity);

    var waitRoom =
      marketAllowsWait(market) &&
      scarcityAllowsWait(scarcity);

    var uncertain =
      uncertaintyPresent(
        opportunity,
        market,
        scarcity
      );

    var recommendation;
    var code;
    var explanation;

    if (
      uncertain &&
      !strong
    ) {
      recommendation =
        'Needs More Evidence';

      code =
        'needs-more-evidence';

      explanation =
        'The available evidence is not strong enough for a confident draft recommendation.';
    } else if (
      strong &&
      nowPressure
    ) {
      recommendation =
        'Take Now';

      code =
        'take-now';

      explanation =
        'Strong opportunity is paired with meaningful risk in waiting.';
    } else if (
      strong &&
      waitRoom
    ) {
      recommendation =
        'Can Wait';

      code =
        'can-wait';

      explanation =
        'The player has a strong role, but the market and positional depth give you room to wait.';
    } else if (
      strong
    ) {
      recommendation =
        'Strong Consideration';

      code =
        'strong-consideration';

      explanation =
        'The opportunity profile is strong, but the timing evidence is mixed.';
    } else if (
      weak &&
      waitRoom
    ) {
      recommendation =
        'Wait';

      code =
        'wait';

      explanation =
        'The current role is not strong enough to justify forcing the pick when alternatives may remain.';
    } else if (
      weak &&
      market.value ===
        'Ahead of Market'
    ) {
      recommendation =
        'Pass For Now';

      code =
        'pass-for-now';

      explanation =
        'The role is not strong enough to justify paying ahead of market.';
    } else if (
      nowPressure &&
      !weak
    ) {
      recommendation =
        'Consider Now';

      code =
        'consider-now';

      explanation =
        'Waiting carries meaningful market or positional risk, even though the opportunity case is not dominant.';
    } else {
      recommendation =
        'Flexible';

      code =
        'flexible';

      explanation =
        'No single evidence layer is strong enough to force the decision.';
    }

    return {
      recommendation:
        recommendation,

      code:
        code,

      explanation:
        explanation,

      reasons:
        buildReasons(
          opportunity,
          market,
          scarcity
        ),

      evidence: {
        opportunity:
          opportunity,

        market:
          market,

        scarcity:
          scarcity
      }
    };
  }

  return {
    opportunitySignals:
      opportunitySignals,

    marketSignals:
      marketSignals,

    scarcitySignals:
      scarcitySignals,

    isStrongOpportunity:
      isStrongOpportunity,

    isWeakOpportunity:
      isWeakOpportunity,

    buildRecommendation:
      buildRecommendation
  };
}));
