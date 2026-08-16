// draft-context-profile.js
// SAGE Context Intelligence v1
//
// Pure, additive context layer.
//
// Consumer questions:
// - Has the player's environment materially changed?
// - Has the player's role opportunity improved or declined?
// - If the player is a rookie, how strong is the immediate-impact case?
// - How much confidence do we have in the context evidence?
//
// IMPORTANT:
// - This module does NOT modify Opportunity Intelligence.
// - It does NOT manufacture NFL production for rookies.
// - It does NOT contain ADP logic.
// - It does NOT contain the 256-player population rule.
// - It does NOT create a hidden numeric score.

(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SanctumDraftContextProfile = factory();
  }
}(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  function text(v) {
    return typeof v === 'string'
      ? v.trim()
      : '';
  }

  function bool(v) {
    return v === true;
  }

  function normalizeEvidence(input) {
    input = input || {};

    return {
      isRookie:
        bool(input.isRookie),

      changedTeam:
        bool(input.changedTeam),

      coachingChange:
        bool(input.coachingChange),

      quarterbackChange:
        bool(input.quarterbackChange),

      offensiveLineChange:
        text(input.offensiveLineChange),

      roleChange:
        text(input.roleChange),

      depthChartChange:
        text(input.depthChartChange),

      prospectTier:
        text(input.prospectTier),

      draftCapitalTier:
        text(input.draftCapitalTier),

      receivingProfile:
        text(input.receivingProfile),

      environmentDirection:
        text(input.environmentDirection),

      roleDirection:
        text(input.roleDirection),

      notes:
        Array.isArray(input.notes)
          ? input.notes.slice()
          : []
    };
  }

  function environmentChange(evidence) {
    if (!evidence) {
      return 'Uncertain';
    }

    if (
      evidence.environmentDirection ===
      'positive'
    ) {
      return 'Positive';
    }

    if (
      evidence.environmentDirection ===
      'negative'
    ) {
      return 'Negative';
    }

    if (
      evidence.environmentDirection ===
      'neutral'
    ) {
      return 'Neutral';
    }

    var changed =
      evidence.changedTeam ||
      evidence.coachingChange ||
      evidence.quarterbackChange ||
      !!evidence.offensiveLineChange;

    return changed
      ? 'Uncertain'
      : 'Neutral';
  }

  function roleOpportunity(evidence) {
    if (!evidence) {
      return 'Uncertain';
    }

    if (
      evidence.roleDirection ===
      'improved'
    ) {
      return 'Improved';
    }

    if (
      evidence.roleDirection ===
      'reduced'
    ) {
      return 'Reduced';
    }

    if (
      evidence.roleDirection ===
      'similar'
    ) {
      return 'Similar';
    }

    if (
      evidence.depthChartChange ===
      'improved'
    ) {
      return 'Improved';
    }

    if (
      evidence.depthChartChange ===
      'reduced'
    ) {
      return 'Reduced';
    }

    if (
      evidence.roleChange ===
      'improved'
    ) {
      return 'Improved';
    }

    if (
      evidence.roleChange ===
      'reduced'
    ) {
      return 'Reduced';
    }

    if (
      evidence.roleChange ===
      'similar'
    ) {
      return 'Similar';
    }

    return 'Uncertain';
  }

  function rookieImpact(evidence) {
    if (
      !evidence ||
      !evidence.isRookie
    ) {
      return 'Not Applicable';
    }

    if (
      evidence.prospectTier ===
        'elite' ||
      evidence.draftCapitalTier ===
        'premium'
    ) {
      return 'High';
    }

    if (
      evidence.prospectTier ===
        'strong' ||
      evidence.draftCapitalTier ===
        'day-one' ||
      evidence.receivingProfile ===
        'strong'
    ) {
      return 'Moderate';
    }

    return 'Developmental';
  }

  function contextConfidence(evidence) {
    if (!evidence) {
      return 'Limited';
    }

    var evidenceCount = 0;

    if (
      evidence.environmentDirection
    ) {
      evidenceCount++;
    }

    if (
      evidence.roleDirection
    ) {
      evidenceCount++;
    }

    if (
      evidence.depthChartChange
    ) {
      evidenceCount++;
    }

    if (
      evidence.roleChange
    ) {
      evidenceCount++;
    }

    if (
      evidence.prospectTier
    ) {
      evidenceCount++;
    }

    if (
      evidence.draftCapitalTier
    ) {
      evidenceCount++;
    }

    if (
      evidence.receivingProfile
    ) {
      evidenceCount++;
    }

    if (
      evidence.notes.length
    ) {
      evidenceCount++;
    }

    if (
      evidenceCount >= 3
    ) {
      return 'Strong';
    }

    if (
      evidenceCount >= 1
    ) {
      return 'Moderate';
    }

    return 'Limited';
  }

  function buildContextReasons(
    evidence,
    outputs
  ) {
    var reasons = [];

    if (
      evidence.changedTeam
    ) {
      reasons.push(
        'changed teams'
      );
    }

    if (
      evidence.coachingChange
    ) {
      reasons.push(
        'coaching environment changed'
      );
    }

    if (
      evidence.quarterbackChange
    ) {
      reasons.push(
        'quarterback environment changed'
      );
    }

    if (
      outputs.environmentChange ===
      'Positive'
    ) {
      reasons.push(
        'environment change is favorable'
      );
    } else if (
      outputs.environmentChange ===
      'Negative'
    ) {
      reasons.push(
        'environment change is unfavorable'
      );
    }

    if (
      outputs.roleOpportunity ===
      'Improved'
    ) {
      reasons.push(
        'role opportunity improved'
      );
    } else if (
      outputs.roleOpportunity ===
      'Reduced'
    ) {
      reasons.push(
        'role opportunity reduced'
      );
    }

    if (
      outputs.rookieImpact ===
      'High'
    ) {
      reasons.push(
        'high-impact rookie profile'
      );
    } else if (
      outputs.rookieImpact ===
      'Moderate'
    ) {
      reasons.push(
        'meaningful rookie impact case'
      );
    }

    return reasons;
  }

  function buildDraftContextProfile(input) {
    input = input || {};

    var evidence =
      normalizeEvidence(
        input.evidence || input
      );

    var outputs = {
      environmentChange:
        environmentChange(
          evidence
        ),

      roleOpportunity:
        roleOpportunity(
          evidence
        ),

      rookieImpact:
        rookieImpact(
          evidence
        ),

      contextConfidence:
        contextConfidence(
          evidence
        )
    };

    return {
      player: {
        playerID:
          input.playerID || null,

        longName:
          input.longName ||
          input.name ||
          null,

        pos:
          text(
            input.pos
          ).toUpperCase() ||
          null
      },

      environmentChange: {
        label:
          outputs.environmentChange
      },

      roleOpportunity: {
        label:
          outputs.roleOpportunity
      },

      rookieImpact: {
        label:
          outputs.rookieImpact
      },

      contextConfidence: {
        label:
          outputs.contextConfidence
      },

      reasons:
        buildContextReasons(
          evidence,
          outputs
        ),

      evidence:
        evidence
    };
  }

  return {
    normalizeEvidence:
      normalizeEvidence,

    environmentChange:
      environmentChange,

    roleOpportunity:
      roleOpportunity,

    rookieImpact:
      rookieImpact,

    contextConfidence:
      contextConfidence,

    buildDraftContextProfile:
      buildDraftContextProfile
  };
}));
