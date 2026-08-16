// draft-sage-synthesis.js
// SAGE Step 5 v2 — Explainable Draft Synthesis + Context Intelligence
//
// Pure, additive decision layer.
//
// Consumes:
//   Step 2 — Opportunity
//   Step 3 — Market
//   Step 4 — Scarcity
//   Context Intelligence
//
// Consumer question:
//   "Given everything we know, what should I do with this player now?"
//
// DESIGN RULES:
// - No hidden numeric score.
// - No positional bias.
// - No ADP-only recommendation.
// - A declining historical role is a CAUTION signal, not an automatic rejection.
// - Positive context may explain why historical Opportunity is less predictive.
// - Context never erases historical evidence.
// - Rookies can be considered without fabricated NFL production.
// - Missing evidence reduces conviction rather than being guessed through.

(function(root, factory){
  if (
    typeof module === 'object' &&
    module.exports
  ) {
    module.exports = factory();
  } else {
    root.SanctumDraftSageSynthesis =
      factory();
  }
}(
  typeof self !== 'undefined'
    ? self
    : this,
  function(){
    'use strict';

    function text(v) {
      return typeof v === 'string'
        ? v.trim()
        : '';
    }

    // -----------------------------------
    // STEP 2 — Opportunity
    // -----------------------------------

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

    // -----------------------------------
    // STEP 3 — Market
    // -----------------------------------

    function marketSignals(profile) {
      profile = profile || {};

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

    // -----------------------------------
    // STEP 4 — Scarcity
    // -----------------------------------

    function scarcitySignals(profile) {
      profile = profile || {};

      var cost =
        profile.costOfWaiting || {};

      return {
        cost:
          text(cost.label)
      };
    }

    // -----------------------------------
    // CONTEXT INTELLIGENCE
    // -----------------------------------

    function contextSignals(profile) {
      profile = profile || {};

      var environment =
        profile.environmentChange || {};

      var role =
        profile.roleOpportunity || {};

      var rookie =
        profile.rookieImpact || {};

      var confidence =
        profile.contextConfidence || {};

      return {
        environment:
          text(environment.label),

        role:
          text(role.label),

        rookie:
          text(rookie.label),

        confidence:
          text(confidence.label)
      };
    }

    // -----------------------------------
    // OPPORTUNITY INTERPRETATION
    // -----------------------------------

    function isStrongOpportunity(s) {
      return (
        s.workload === 'High Volume' &&
        (
          s.direction ===
            'Increasing Role' ||
          s.direction ===
            'Stable Role'
        )
      );
    }

    // IMPORTANT:
    // A declining role is NOT weak by itself.
    //
    // Example:
    // High Volume + Decreasing Role
    // remains meaningful Opportunity evidence,
    // but receives a caution flag.
    function isWeakOpportunity(s) {
      return (
        s.workload ===
        'Role Player'
      );
    }

    function isOpportunityCaution(s) {
      return (
        (
          s.workload ===
            'High Volume' ||
          s.workload ===
            'Moderate Volume'
        ) &&
        s.direction ===
          'Decreasing Role'
      );
    }

    function hasNoNFLHistory(s) {
      return (
        s.workload ===
          'No NFL History' ||
        s.direction ===
          'No NFL History'
      );
    }

    function isLimitedEvidence(s) {
      return (
        s.evidence ===
          'Limited' ||
        s.direction ===
          'Not Enough Data Yet'
      );
    }

    // -----------------------------------
    // MARKET INTERPRETATION
    // -----------------------------------

    function marketPushesNow(s) {
      return (
        s.value ===
          'Discount' ||
        s.outlook ===
          'Market Leans Gone'
      );
    }

    function marketAllowsWait(s) {
      return (
        s.outlook ===
          'Market Says He May Return'
      );
    }

    // -----------------------------------
    // SCARCITY INTERPRETATION
    // -----------------------------------

    function scarcityPushesNow(s) {
      return (
        s.cost ===
          'High'
      );
    }

    function scarcityAllowsWait(s) {
      return (
        s.cost ===
          'Low'
      );
    }

    // -----------------------------------
    // CONTEXT INTERPRETATION
    // -----------------------------------

    function contextConfidenceUseful(s) {
      return (
        s.confidence ===
          'Strong' ||
        s.confidence ===
          'Moderate'
      );
    }

    function contextSupportsUpside(s) {
      if (
        !contextConfidenceUseful(s)
      ) {
        return false;
      }

      return (
        s.environment ===
          'Positive' ||
        s.role ===
          'Improved' ||
        s.rookie ===
          'High' ||
        s.rookie ===
          'Moderate'
      );
    }

    function contextStronglyPositive(s) {
      if (
        s.confidence !==
        'Strong'
      ) {
        return false;
      }

      return (
        s.environment ===
          'Positive' ||
        s.role ===
          'Improved' ||
        s.rookie ===
          'High'
      );
    }

    function contextNegative(s) {
      return (
        (
          s.environment ===
            'Negative' ||
          s.role ===
            'Reduced'
        ) &&
        contextConfidenceUseful(s)
      );
    }

    // -----------------------------------
    // UNCERTAINTY
    // -----------------------------------

    function timingUncertain(
      market,
      scarcity
    ) {
      return (
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

    // -----------------------------------
    // PLAIN-LANGUAGE REASONS
    // -----------------------------------

    function buildReasons(
      opportunity,
      market,
      scarcity,
      context
    ) {
      var reasons = [];

      if (
        opportunity.workload
      ) {
        reasons.push(
          opportunity.workload +
          ' workload'
        );
      }

      if (
        opportunity.direction ===
          'Increasing Role'
      ) {
        reasons.push(
          'role is increasing'
        );
      } else if (
        opportunity.direction ===
          'Stable Role'
      ) {
        reasons.push(
          'role is stable'
        );
      } else if (
        opportunity.direction ===
          'Decreasing Role'
      ) {
        reasons.push(
          'recent role trend warrants caution'
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
          'market says waiting carries risk'
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
          'positional scarcity is uncertain'
        );
      }

      if (
        context.environment ===
          'Positive'
      ) {
        reasons.push(
          'environment change is favorable'
        );
      } else if (
        context.environment ===
          'Negative'
      ) {
        reasons.push(
          'environment change adds downside'
        );
      }

      if (
        context.role ===
          'Improved'
      ) {
        reasons.push(
          'role opportunity improved'
        );
      } else if (
        context.role ===
          'Reduced'
      ) {
        reasons.push(
          'role opportunity declined'
        );
      }

      if (
        context.rookie ===
          'High'
      ) {
        reasons.push(
          'high-impact rookie profile'
        );
      } else if (
        context.rookie ===
          'Moderate'
      ) {
        reasons.push(
          'meaningful rookie impact case'
        );
      }

      return reasons;
    }

    // -----------------------------------
    // SYNTHESIS
    // -----------------------------------

    function buildRecommendation(input) {
      input = input || {};

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

      var context =
        contextSignals(
          input.contextProfile
        );

      var strong =
        isStrongOpportunity(
          opportunity
        );

      var weak =
        isWeakOpportunity(
          opportunity
        );

      var caution =
        isOpportunityCaution(
          opportunity
        );

      var noHistory =
        hasNoNFLHistory(
          opportunity
        );

      var limited =
        isLimitedEvidence(
          opportunity
        );

      var contextUp =
        contextSupportsUpside(
          context
        );

      var contextStrongUp =
        contextStronglyPositive(
          context
        );

      var contextDown =
        contextNegative(
          context
        );

      var nowPressure =
        marketPushesNow(
          market
        ) ||
        scarcityPushesNow(
          scarcity
        );

      var waitRoom =
        marketAllowsWait(
          market
        ) &&
        scarcityAllowsWait(
          scarcity
        );

      var recommendation;
      var code;
      var explanation;

      // ---------------------------------
      // ROOKIE / NO NFL HISTORY
      // ---------------------------------

      if (
        noHistory &&
        contextStrongUp &&
        nowPressure
      ) {
        recommendation =
          'Strong Consideration';

        code =
          'strong-consideration';

        explanation =
          'NFL history is limited or unavailable, but strong contextual evidence supports immediate fantasy relevance and waiting carries risk.';
      }

      else if (
        noHistory &&
        contextUp
      ) {
        recommendation =
          'Consider';

        code =
          'consider';

        explanation =
          'NFL history is limited or unavailable, but contextual evidence provides a legitimate case for immediate fantasy impact.';
      }

      else if (
        noHistory
      ) {
        recommendation =
          'Needs More Evidence';

        code =
          'needs-more-evidence';

        explanation =
          'There is not enough NFL Opportunity evidence or contextual support for a confident recommendation yet.';
      }

      // ---------------------------------
      // STRONG HISTORICAL OPPORTUNITY
      // ---------------------------------

      else if (
        strong &&
        contextDown
      ) {
        recommendation =
          'Strong Consideration';

        code =
          'strong-consideration';

        explanation =
          'The historical opportunity profile is strong, but current context introduces meaningful downside risk.';
      }

      else if (
        strong &&
        nowPressure
      ) {
        recommendation =
          'Take Now';

        code =
          'take-now';

        explanation =
          'Strong opportunity is paired with meaningful risk in waiting.';
      }

      else if (
        strong &&
        waitRoom
      ) {
        recommendation =
          'Can Wait';

        code =
          'can-wait';

        explanation =
          'The player has a strong role, but the market and positional depth give you room to wait.';
      }

      else if (
        strong
      ) {
        recommendation =
          'Strong Consideration';

        code =
          'strong-consideration';

        explanation =
          'The opportunity profile is strong, but the timing evidence does not force the decision.';
      }

      // ---------------------------------
      // DECLINING ROLE = CAUTION,
      // NOT AUTOMATIC WEAKNESS
      // ---------------------------------

      else if (
        caution &&
        contextStrongUp
      ) {
        recommendation =
          'Strong Consideration';

        code =
          'strong-consideration';

        explanation =
          'Recent opportunity has weakened, but strong contextual evidence gives a credible reason the future role may differ from the historical trend.';
      }

      else if (
        caution &&
        contextDown
      ) {
        recommendation =
          waitRoom
            ? 'Wait'
            : 'Caution';

        code =
          waitRoom
            ? 'wait'
            : 'caution';

        explanation =
          'Recent opportunity has weakened and the current context adds additional downside.';
      }

      else if (
        caution &&
        nowPressure
      ) {
        recommendation =
          'Consider Now';

        code =
          'consider-now';

        explanation =
          'Recent role direction warrants caution, but waiting also carries meaningful market or positional risk.';
      }

      else if (
        caution
      ) {
        recommendation =
          'Caution';

        code =
          'caution';

        explanation =
          'The player remains relevant, but recent opportunity has weakened enough to reduce conviction.';
      }

      // ---------------------------------
      // LIMITED EVIDENCE
      // ---------------------------------

      else if (
        limited &&
        !contextUp
      ) {
        recommendation =
          'Needs More Evidence';

        code =
          'needs-more-evidence';

        explanation =
          'The available Opportunity evidence is limited and Context does not provide enough support to increase conviction.';
      }

      // ---------------------------------
      // TRUE WEAK OPPORTUNITY
      // ---------------------------------

      else if (
        weak &&
        contextStrongUp &&
        nowPressure
      ) {
        recommendation =
          'Consider Now';

        code =
          'consider-now';

        explanation =
          'Historical opportunity is limited, but strong contextual improvement and timing pressure keep the player in consideration.';
      }

      else if (
        weak &&
        waitRoom
      ) {
        recommendation =
          'Wait';

        code =
          'wait';

        explanation =
          'The current role is not strong enough to justify forcing the pick when alternatives may remain.';
      }

      else if (
        weak &&
        market.value ===
          'Ahead of Market'
      ) {
        recommendation =
          'Pass For Now';

        code =
          'pass-for-now';

        explanation =
          'The current role does not justify paying ahead of market.';
      }

      // ---------------------------------
      // MODERATE / MIXED PROFILE
      // ---------------------------------

      else if (
        contextDown &&
        waitRoom
      ) {
        recommendation =
          'Wait';

        code =
          'wait';

        explanation =
          'The evidence does not justify forcing the pick while negative context and later alternatives remain.';
      }

      else if (
        nowPressure
      ) {
        recommendation =
          'Consider Now';

        code =
          'consider-now';

        explanation =
          'Waiting carries meaningful market or positional risk, even though the Opportunity case is not dominant.';
      }

      else if (
        contextUp
      ) {
        recommendation =
          'Consider';

        code =
          'consider';

        explanation =
          'The historical profile is mixed, but Context provides additional upside evidence.';
      }

      else if (
        timingUncertain(
          market,
          scarcity
        )
      ) {
        recommendation =
          'Flexible';

        code =
          'flexible';

        explanation =
          'The available evidence does not provide enough timing clarity to force the decision.';
      }

      else {
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
            scarcity,
            context
          ),

        evidence: {
          opportunity:
            opportunity,

          market:
            market,

          scarcity:
            scarcity,

          context:
            context
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

      contextSignals:
        contextSignals,

      isStrongOpportunity:
        isStrongOpportunity,

      isWeakOpportunity:
        isWeakOpportunity,

      isOpportunityCaution:
        isOpportunityCaution,

      contextSupportsUpside:
        contextSupportsUpside,

      contextStronglyPositive:
        contextStronglyPositive,

      contextNegative:
        contextNegative,

      buildRecommendation:
        buildRecommendation
    };
  }
));
