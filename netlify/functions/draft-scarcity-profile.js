// draft-scarcity-profile.js
// SAGE Step 4 — Replacement & Scarcity Intelligence
//
// Pure, additive calculation layer.
// It does not read or mutate draft.html state.
// It does not decide whom to draft.
//
// Consumer question:
// "If I pass on this position now, how much comparable opportunity
//  am I risking before my next turn?"
//
// IMPORTANT:
// - No positional bias is hard-coded.
// - No ADP simulation is performed here.
// - The caller supplies the CURRENT available pool and the NEXT-TURN
//   market pool/window.
// - "Comparable opportunity" means SAME OR BETTER existing Step 2
//   volumeTier at the same position.
// - Missing Opportunity Intelligence is treated as UNKNOWN, never as bad.
//
// This module consumes existing Step 2 signals only:
//   volumeTier, trendClassification, roleComposition, sampleSize.
//
// Step 4 describes cost of waiting. It does NOT make the draft pick.

(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SanctumDraftScarcityProfile = factory();
  }
}(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  var VOLUME_RANK = {
    'role-player': 1,
    'moderate-volume': 2,
    'high-volume': 3
  };

  function signal(record, type) {
    if (!record || !Array.isArray(record.signals)) return null;

    for (var i = 0; i < record.signals.length; i++) {
      if (
        record.signals[i] &&
        record.signals[i].type === type
      ) {
        return record.signals[i];
      }
    }

    return null;
  }

  function signalValue(record, type) {
    var s = signal(record, type);
    return s ? s.value : null;
  }

  function volumeTier(record) {
    return signalValue(record, 'volumeTier');
  }

  function volumeRank(record) {
    var tier = volumeTier(record);

    return Object.prototype.hasOwnProperty.call(
      VOLUME_RANK,
      tier
    )
      ? VOLUME_RANK[tier]
      : null;
  }

  function trend(record) {
    return signalValue(
      record,
      'trendClassification'
    );
  }

  function roleStyle(record) {
    return signalValue(
      record,
      'roleComposition'
    );
  }

  function sampleSize(record) {
    return signalValue(
      record,
      'sampleSize'
    );
  }

  function normalizePos(pos) {
    return String(pos || '')
      .trim()
      .toUpperCase();
  }

  function playerName(record) {
    return (
      record &&
      (record.longName || record.name)
    ) || null;
  }

  function samePlayer(a, b) {
    if (!a || !b) return false;

    if (a.playerID && b.playerID) {
      return (
        String(a.playerID) ===
        String(b.playerID)
      );
    }

    return (
      playerName(a) === playerName(b) &&
      normalizePos(a.pos) ===
        normalizePos(b.pos)
    );
  }

  function samePosition(record, pos) {
    return (
      normalizePos(record && record.pos) ===
      normalizePos(pos)
    );
  }

  function isKnownOpportunity(record) {
    return volumeRank(record) !== null;
  }

  function isComparable(candidate, other) {
    var candidateRank =
      volumeRank(candidate);

    var otherRank =
      volumeRank(other);

    if (
      candidateRank === null ||
      otherRank === null
    ) {
      return false;
    }

    if (
      normalizePos(candidate.pos) !==
      normalizePos(other.pos)
    ) {
      return false;
    }

    return otherRank >= candidateRank;
  }

  function summarizeRecord(record) {
    if (!record) return null;

    var opp =
      record.opportunities || {};

    return {
      playerID:
        record.playerID || null,

      longName:
        playerName(record),

      pos:
        normalizePos(record.pos),

      adp:
        Number.isFinite(
          Number(record.adp)
        )
          ? Number(record.adp)
          : null,

      volumeTier:
        volumeTier(record),

      recentOpportunities:
        Number.isFinite(
          Number(opp.avgLast3)
        )
          ? Number(opp.avgLast3)
          : null,

      seasonOpportunities:
        Number.isFinite(
          Number(opp.seasonAvg)
        )
          ? Number(opp.seasonAvg)
          : null,

      trend:
        trend(record),

      roleStyle:
        roleStyle(record),

      sampleSize:
        sampleSize(record)
    };
  }

  function depthLabel(
    comparableCount,
    knownCount,
    unknownCount
  ) {
    if (
      knownCount === 0 &&
      unknownCount > 0
    ) {
      return 'Unknown';
    }

    if (comparableCount >= 2) {
      return 'Multiple Comparable Options';
    }

    if (comparableCount === 1) {
      return 'One Comparable Option';
    }

    return 'No Comparable Options';
  }

  function buildDepth(candidate, pool) {
    pool =
      Array.isArray(pool)
        ? pool
        : [];

    var pos =
      normalizePos(
        candidate &&
        candidate.pos
      );

    var samePos =
      pool.filter(function(p){
        return (
          p &&
          samePosition(p, pos) &&
          !samePlayer(p, candidate)
        );
      });

    var known =
      samePos.filter(
        isKnownOpportunity
      );

    var unknown =
      samePos.filter(function(p){
        return !isKnownOpportunity(p);
      });

    var comparable =
      known.filter(function(p){
        return isComparable(
          candidate,
          p
        );
      });

    return {
      position:
        pos,

      knownOptions:
        known.length,

      unknownOptions:
        unknown.length,

      comparableOptions:
        comparable.length,

      label:
        depthLabel(
          comparable.length,
          known.length,
          unknown.length
        ),

      comparablePlayers:
        comparable
          .slice()
          .sort(function(a, b){
            var aa =
              Number(a.adp);

            var bb =
              Number(b.adp);

            if (
              Number.isFinite(aa) &&
              Number.isFinite(bb)
            ) {
              return aa - bb;
            }

            return String(
              playerName(a) || ''
            ).localeCompare(
              String(
                playerName(b) || ''
              )
            );
          })
          .map(
            summarizeRecord
          ),

      unknownPlayers:
        unknown.map(
          summarizeRecord
        )
    };
  }

  function costOfWaiting(
    candidate,
    nextDepth
  ) {
    var candidateTier =
      volumeTier(candidate);

    if (!candidateTier) {
      return {
        label:
          'Unknown',

        code:
          'unknown',

        explanation:
          'The player does not have enough Opportunity Intelligence to measure replacement cost.'
      };
    }

    if (!nextDepth) {
      return {
        label:
          'Unknown',

        code:
          'unknown',

        explanation:
          'No next-turn opportunity pool was supplied.'
      };
    }

    if (
      nextDepth.comparableOptions >= 2
    ) {
      return {
        label:
          'Low',

        code:
          'low',

        explanation:
          'Multiple players with comparable ' +
          normalizePos(candidate.pos) +
          ' workload appear in the next-turn market pool.'
      };
    }

    if (
      nextDepth.comparableOptions === 1
    ) {
      return {
        label:
          'Moderate',

        code:
          'moderate',

        explanation:
          'Only one player with comparable ' +
          normalizePos(candidate.pos) +
          ' workload appears in the next-turn market pool.'
      };
    }

    if (
      nextDepth.unknownOptions > 0
    ) {
      return {
        label:
          'Uncertain',

        code:
          'uncertain',

        explanation:
          'No known comparable ' +
          normalizePos(candidate.pos) +
          ' workload appears in the next-turn pool, but missing Opportunity Intelligence prevents a firm scarcity call.'
      };
    }

    return {
      label:
        'High',

      code:
        'high',

      explanation:
        'No player with comparable ' +
        normalizePos(candidate.pos) +
        ' workload appears in the next-turn market pool.'
    };
  }

  function buildDraftScarcityProfile(
    input
  ) {
    input =
      input || {};

    var candidate =
      input.candidate || null;

    var currentPool =
      Array.isArray(
        input.currentPool
      )
        ? input.currentPool
        : [];

    var nextTurnPool =
      Array.isArray(
        input.nextTurnPool
      )
        ? input.nextTurnPool
        : [];

    if (!candidate) {
      return {
        position:
          null,

        candidate:
          null,

        depthNow:
          null,

        depthNextTurn:
          null,

        costOfWaiting: {
          label:
            'Unknown',

          code:
            'unknown',

          explanation:
            'No candidate player was supplied.'
        }
      };
    }

    var now =
      buildDepth(
        candidate,
        currentPool
      );

    var next =
      buildDepth(
        candidate,
        nextTurnPool
      );

    return {
      position:
        normalizePos(
          candidate.pos
        ),

      candidate:
        summarizeRecord(
          candidate
        ),

      depthNow:
        now,

      depthNextTurn:
        next,

      costOfWaiting:
        costOfWaiting(
          candidate,
          next
        )
    };
  }

  return {
    VOLUME_RANK:
      VOLUME_RANK,

    signal:
      signal,

    signalValue:
      signalValue,

    volumeTier:
      volumeTier,

    volumeRank:
      volumeRank,

    trend:
      trend,

    roleStyle:
      roleStyle,

    sampleSize:
      sampleSize,

    isKnownOpportunity:
      isKnownOpportunity,

    isComparable:
      isComparable,

    summarizeRecord:
      summarizeRecord,

    buildDepth:
      buildDepth,

    costOfWaiting:
      costOfWaiting,

    buildDraftScarcityProfile:
      buildDraftScarcityProfile
  };
}));
