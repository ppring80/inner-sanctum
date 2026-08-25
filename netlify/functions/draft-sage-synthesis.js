// draft-sage-synthesis.js
// SAGE Step 5 v2.1 — Explainable Draft Synthesis + Context Intelligence
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
//
// v2.1 COMPATIBILITY FIX:
// Step 2's production draftOpportunityProfile uses:
//   workload.level
//   evidence.level
//
// Earlier Step 5 code looked only for:
//   workload.label
//   evidence.label
//
// This version accepts BOTH shapes so the real Step 2 values flow into
// SAGE without changing any Opportunity calculation or recommendation rule.

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
        // Step 2 production shape = .level
        // Legacy/test shape = .label
        workload:
          text(
            workload.level ||
            workload.label
          ),

        direction:
          text(
            direction.label
          ),

        style:
          text(
            style.label
          ),

        // Step 2 production shape = .level
        // Legacy/test shape = .label
        evidence:
          text(
            evidence.level ||
            evidence.label
          )
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
            'Stable Role' ||
          s.direction ===
            'Softening Role'
        )
      );
    }

    // A declining role is NOT weak by itself.
    //
    // High Volume + Decreasing Role remains
    // meaningful Opportunity evidence but
    // receives a caution flag.
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
        (
          s.direction ===
            'Decreasing Role' ||
          s.direction ===
            'Sustained Decline'
        )
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
        s.evidence ===
          'Limited Sample' ||
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
          'Softening Role'
      ) {
        reasons.push(
          'recent role has softened but volume remains strong'
        );
      } else if (
        opportunity.direction ===
          'Decreasing Role'
      ) {
        reasons.push(
          'recent role trend warrants caution'
        );
      } else if (
        opportunity.direction ===
          'Sustained Decline'
      ) {
        reasons.push(
          'role decline has persisted across longer windows'
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
    // STRONG + NOW EXPLANATION
    // -----------------------------------

    // Preserve the existing recommendation logic while making the headline
    // explanation reflect the evidence that actually produced NOW pressure.
    // No new score, threshold, ranking rule, or recommendation branch is added.
    function buildStrongNowExplanation(
      opportunity,
      market,
      scarcity
    ) {
      var opportunityLead;

      if (
        opportunity.direction ===
          'Increasing Role'
      ) {
        opportunityLead =
          'High-volume opportunity is paired with an increasing role';
      } else if (
        opportunity.direction ===
          'Stable Role'
      ) {
        opportunityLead =
          'High-volume opportunity is backed by a stable role';
      } else if (
        opportunity.direction ===
          'Softening Role'
      ) {
        opportunityLead =
          'Workload remains high even though the recent role has softened';
      } else {
        opportunityLead =
          'The opportunity profile is strong';
      }

      var marketNow =
        marketPushesNow(
          market
        );

      var scarcityNow =
        scarcityPushesNow(
          scarcity
        );

      if (
        marketNow &&
        scarcityNow
      ) {
        return (
          opportunityLead +
          ', while both the market and positional scarcity make waiting risky.'
        );
      }

      if (
        market.outlook ===
          'Market Leans Gone'
      ) {
        if (
          market.value ===
            'Discount'
        ) {
          return (
            opportunityLead +
            ', and he is available at a favorable price even though waiting risks losing him before your next pick.'
          );
        }

        return (
          opportunityLead +
          ', and waiting risks losing him before your next pick.'
        );
      }

      if (
        market.value ===
          'Discount'
      ) {
        return (
          opportunityLead +
          ', and he is already available at a favorable price relative to his ADP.'
        );
      }

      if (
        scarcityNow
      ) {
        return (
          opportunityLead +
          ', and comparable positional opportunity is unlikely to remain at your next turn.'
        );
      }

      return (
        opportunityLead +
        ', and waiting carries meaningful timing risk.'
      );
    }

    // -----------------------------------
    // EVIDENCE-RESPONSIVE EXPLANATIONS
    // -----------------------------------

    // Consumer-facing only: no score, threshold, branch, code, or ranking
    // changes. These helpers simply describe the evidence already used by
    // the existing recommendation branch.
    function opportunityLead(s) {
      if (s.workload === 'High Volume' && s.direction === 'Increasing Role') {
        return 'High-volume usage is paired with an increasing role';
      }
      if (s.workload === 'High Volume' && s.direction === 'Stable Role') {
        return 'High-volume usage is backed by a stable role';
      }
      if (s.workload === 'High Volume' && s.direction === 'Softening Role') {
        return 'Workload remains high even though the recent role has softened';
      }
      if (s.workload === 'Moderate Volume' && s.direction === 'Increasing Role') {
        return 'Moderate volume is trending upward';
      }
      if (s.workload === 'Moderate Volume' && s.direction === 'Stable Role') {
        return 'The player has a stable, moderate-volume role';
      }
      if (s.workload === 'Role Player') {
        return 'The current workload is still that of a role player';
      }
      if (s.direction === 'Decreasing Role' || s.direction === 'Sustained Decline') {
        return 'Recent role direction is a caution signal';
      }
      return s.workload
        ? 'The current workload is ' + s.workload.toLowerCase()
        : 'The Opportunity profile is mixed';
    }

    function contextUpsidePhrase(context) {
      if (context.role === 'Improved') {
        return 'current context points to improved role opportunity';
      }
      if (context.environment === 'Positive') {
        return 'the surrounding environment has improved';
      }
      if (context.rookie === 'High') {
        return 'the rookie-impact case is strong';
      }
      if (context.rookie === 'Moderate') {
        return 'the rookie-impact case adds meaningful upside';
      }
      return 'current context adds credible upside';
    }

    function contextDownsidePhrase(context) {
      if (context.role === 'Reduced') {
        return 'current context points to reduced role opportunity';
      }
      if (context.environment === 'Negative') {
        return 'the surrounding environment adds downside';
      }
      return 'current context adds meaningful downside';
    }

    function nowPressurePhrase(market, scarcity) {
      var marketGone = market.outlook === 'Market Leans Gone';
      var discount = market.value === 'Discount';
      var scarce = scarcity.cost === 'High';

      if (marketGone && scarce) {
        return 'both the market and positional scarcity make waiting risky';
      }
      if (marketGone && discount) {
        return 'he is available at a favorable price, but waiting still risks losing him before your next pick';
      }
      if (marketGone) {
        return 'waiting risks losing him before your next pick';
      }
      if (scarce) {
        return 'comparable positional opportunity may not remain at your next turn';
      }
      if (discount) {
        return 'he is already available at a favorable price relative to his ADP';
      }
      return 'the timing evidence creates a meaningful reason to act now';
    }

    function waitRoomPhrase(market, scarcity) {
      var marketReturn = market.outlook === 'Market Says He May Return';
      var depth = scarcity.cost === 'Low';

      if (marketReturn && depth) {
        return 'both the market and positional depth give you room to wait';
      }
      if (marketReturn) {
        return 'the market suggests he may still be available at your next turn';
      }
      if (depth) {
        return 'comparable positional options are projected to remain available';
      }
      if (market.value === 'Ahead of Market') {
        return 'selecting him here would mean paying ahead of his ADP';
      }
      if (market.value === 'At Market') {
        return 'the timing evidence does not create a strong reason to force the pick';
      }
      return 'the available timing evidence leaves the decision flexible';
    }

    function buildNowPressureExplanation(opportunity, market, scarcity) {
      return opportunityLead(opportunity) + ', but ' + nowPressurePhrase(market, scarcity) + '.';
    }

    function buildFlexibleExplanation(opportunity, market, scarcity) {
      return opportunityLead(opportunity) + ', while ' + waitRoomPhrase(market, scarcity) + '.';
    }

    function buildStrongWaitExplanation(opportunity, market, scarcity) {
      return opportunityLead(opportunity) + ', while ' + waitRoomPhrase(market, scarcity) + '.';
    }

    function buildStrongConsiderationExplanation(opportunity, market, scarcity) {
      return opportunityLead(opportunity) + ', but ' + waitRoomPhrase(market, scarcity) + '.';
    }

    function buildStrongContextDownExplanation(opportunity, context) {
      return opportunityLead(opportunity) + ', but ' + contextDownsidePhrase(context) + '.';
    }

    function buildCautionContextUpExplanation(opportunity, context) {
      return opportunityLead(opportunity) + ', but ' + contextUpsidePhrase(context) + ' and provides a credible reason the future role may improve.';
    }

    function buildCautionContextDownExplanation(opportunity, context) {
      return opportunityLead(opportunity) + ', and ' + contextDownsidePhrase(context) + '.';
    }

    function buildCautionNowExplanation(opportunity, market, scarcity) {
      return opportunityLead(opportunity) + ', but ' + nowPressurePhrase(market, scarcity) + '.';
    }

    function buildCautionExplanation(opportunity) {
      return opportunityLead(opportunity) + ', and recent opportunity has weakened enough to reduce conviction.';
    }

    function buildLimitedEvidenceExplanation(context) {
      if (contextSupportsUpside(context)) {
        return 'The available Opportunity sample is limited, but ' + contextUpsidePhrase(context) + '.';
      }
      return 'The available Opportunity sample is limited, and current context does not add enough support for a confident recommendation.';
    }

    function buildWeakContextNowExplanation(opportunity, context, market, scarcity) {
      return opportunityLead(opportunity) + ', but ' + contextUpsidePhrase(context) + ' and ' + nowPressurePhrase(market, scarcity) + '.';
    }

    function buildWeakWaitExplanation(opportunity, market, scarcity) {
      return opportunityLead(opportunity) + ', while ' + waitRoomPhrase(market, scarcity) + '.';
    }

    function buildWeakAheadMarketExplanation(opportunity) {
      return opportunityLead(opportunity) + ', and selecting him here would mean paying ahead of his ADP.';
    }

    function buildContextDownWaitExplanation(opportunity, context, market, scarcity) {
      return opportunityLead(opportunity) + ', while ' + contextDownsidePhrase(context) + ' and ' + waitRoomPhrase(market, scarcity) + '.';
    }

    function buildContextUpExplanation(opportunity, context) {
      return opportunityLead(opportunity) + ', while ' + contextUpsidePhrase(context) + '.';
    }

    function buildRookieStrongNowExplanation(context, market, scarcity) {
      return 'NFL history is limited, but ' + contextUpsidePhrase(context) + ', and ' + nowPressurePhrase(market, scarcity) + '.';
    }

    function buildRookieConsiderExplanation(context) {
      return 'NFL history is limited, but ' + contextUpsidePhrase(context) + ' and provides a legitimate case for immediate fantasy impact.';
    }

    function buildRookieNeedsEvidenceExplanation() {
      return 'NFL history is limited, and current context does not provide enough support for a confident recommendation yet.';
    }

    // sage-recommend intentionally shows only the first two reasons. Reorder
    // existing reasons so those two represent both the player's Opportunity
    // case and the evidence that actually drives the action/wait decision.
    function prioritizeReasons(reasons, code, opportunity, market, scarcity) {
      var all = Array.isArray(reasons) ? reasons.slice() : [];
      var first = [];
      function add(reason) {
        if (all.indexOf(reason) !== -1 && first.indexOf(reason) === -1) first.push(reason);
      }
      function opportunityReason() {
        if (opportunity.direction === 'Decreasing Role') return 'recent role trend warrants caution';
        if (opportunity.direction === 'Sustained Decline') return 'role decline has persisted across longer windows';
        if (opportunity.workload) return opportunity.workload + ' workload';
        if (opportunity.direction === 'Increasing Role') return 'role is increasing';
        if (opportunity.direction === 'Stable Role') return 'role is stable';
        if (opportunity.direction === 'Softening Role') return 'recent role has softened but volume remains strong';
        return '';
      }
      function nowReason() {
        if (market.outlook === 'Market Leans Gone') return 'market says waiting carries risk';
        if (scarcity.cost === 'High') return 'high cost of waiting at the position';
        if (market.value === 'Discount') return 'available at a discount';
        return '';
      }
      function waitReason() {
        if (market.outlook === 'Market Says He May Return') return 'market gives room to wait';
        if (scarcity.cost === 'Low') return 'later positional depth remains';
        if (market.value === 'Ahead of Market') return 'priced ahead of market';
        return '';
      }

      add(opportunityReason());
      if (code === 'take-now' || code === 'consider-now' || code === 'strong-consideration') {
        add(nowReason());
      } else if (code === 'can-wait' || code === 'flexible' || code === 'wait' || code === 'pass-for-now') {
        add(waitReason());
      }

      all.forEach(add);
      return first;
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
          buildRookieStrongNowExplanation(
            context,
            market,
            scarcity
          );
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
          buildRookieConsiderExplanation(
            context
          );
      }

      else if (
        noHistory
      ) {
        recommendation =
          'Needs More Evidence';

        code =
          'needs-more-evidence';

        explanation =
          buildRookieNeedsEvidenceExplanation();
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
          buildStrongContextDownExplanation(
            opportunity,
            context
          );
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
          buildStrongNowExplanation(
            opportunity,
            market,
            scarcity
          );
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
          buildStrongWaitExplanation(
            opportunity,
            market,
            scarcity
          );
      }

      else if (
        strong
      ) {
        recommendation =
          'Strong Consideration';

        code =
          'strong-consideration';

        explanation =
          buildStrongConsiderationExplanation(
            opportunity,
            market,
            scarcity
          );
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
          buildCautionContextUpExplanation(
            opportunity,
            context
          );
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
          buildCautionContextDownExplanation(
            opportunity,
            context
          );
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
          buildCautionNowExplanation(
            opportunity,
            market,
            scarcity
          );
      }

      else if (
        caution
      ) {
        recommendation =
          'Caution';

        code =
          'caution';

        explanation =
          buildCautionExplanation(
            opportunity
          );
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
          buildLimitedEvidenceExplanation(
            context
          );
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
          buildWeakContextNowExplanation(
            opportunity,
            context,
            market,
            scarcity
          );
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
          buildWeakWaitExplanation(
            opportunity,
            market,
            scarcity
          );
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
          buildWeakAheadMarketExplanation(
            opportunity
          );
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
          buildContextDownWaitExplanation(
            opportunity,
            context,
            market,
            scarcity
          );
      }

      else if (
        nowPressure
      ) {
        recommendation =
          'Consider Now';

        code =
          'consider-now';

        explanation =
          buildNowPressureExplanation(
            opportunity,
            market,
            scarcity
          );
      }

      else if (
        contextUp
      ) {
        recommendation =
          'Consider';

        code =
          'consider';

        explanation =
          buildContextUpExplanation(
            opportunity,
            context
          );
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
          buildFlexibleExplanation(
            opportunity,
            market,
            scarcity
          );
      }

      else {
        recommendation =
          'Flexible';

        code =
          'flexible';

        explanation =
          buildFlexibleExplanation(
            opportunity,
            market,
            scarcity
          );
      }

      return {
        recommendation:
          recommendation,

        code:
          code,

        explanation:
          explanation,

        reasons:
          prioritizeReasons(
            buildReasons(
              opportunity,
              market,
              scarcity,
              context
            ),
            code,
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
