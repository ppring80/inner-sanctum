// draft-market-profile.js
// SAGE Step 3 — Market Value
//
// Pure, additive calculation layer. It does not read or mutate draft.html state.
// Consumer question: "Am I getting this player at a good price?"
//
// Design rule: no invented +/- pick thresholds.
// We normalize ADP to the nearest draft slot for plain-language comparison,
// then compare that market slot with (a) the current pick and (b) the user's
// next deterministic pick, when one exists.

(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SanctumDraftMarketProfile = factory();
  }
}(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  function finiteNumber(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function positiveInteger(v) {
    var n = finiteNumber(v);
    if (n === null) return null;
    n = Math.round(n);
    return n > 0 ? n : null;
  }

  function normalizeAdpToPick(adp) {
    var n = finiteNumber(adp);
    if (n === null || n <= 0 || n >= 900) return null;
    return Math.max(1, Math.round(n));
  }

  function buildMarketValue(adp, currentPick) {
    var marketPick = normalizeAdpToPick(adp);
    var current = positiveInteger(currentPick);

    if (marketPick === null || current === null) {
      return {
        label: 'Market Value Unknown',
        code: 'unknown',
        marketPick: marketPick,
        currentPick: current,
        picksVsMarket: null,
        explanation: 'Not enough market data to compare this pick with ADP.'
      };
    }

    // Positive = player has lasted past his market slot (a discount).
    // Negative = selecting him before his market slot (ahead of market).
    var picksVsMarket = current - marketPick;

    if (picksVsMarket > 0) {
      return {
        label: 'Discount',
        code: 'discount',
        marketPick: marketPick,
        currentPick: current,
        picksVsMarket: picksVsMarket,
        explanation: 'Available ' + picksVsMarket + ' pick' +
          (picksVsMarket === 1 ? '' : 's') + ' later than his ADP.'
      };
    }

    if (picksVsMarket < 0) {
      var early = Math.abs(picksVsMarket);

      return {
        label: 'Ahead of Market',
        code: 'ahead-of-market',
        marketPick: marketPick,
        currentPick: current,
        picksVsMarket: picksVsMarket,
        explanation: 'You would be taking him ' + early + ' pick' +
          (early === 1 ? '' : 's') + ' ahead of his ADP.'
      };
    }

    return {
      label: 'At Market',
      code: 'at-market',
      marketPick: marketPick,
      currentPick: current,
      picksVsMarket: 0,
      explanation: 'This pick is right at his ADP.'
    };
  }

  function buildReturnOutlook(adp, currentPick, nextUserPick) {
    var marketPick = normalizeAdpToPick(adp);
    var current = positiveInteger(currentPick);
    var next = positiveInteger(nextUserPick);

    if (marketPick === null) {
      return {
        label: 'Return Outlook Unknown',
        code: 'unknown',
        marketPick: null,
        nextUserPick: next,
        picksUntilNextTurn:
          (current !== null && next !== null && next >= current)
            ? next - current
            : null,
        marketCushion: null,
        explanation: 'No usable ADP is available for a next-pick read.'
      };
    }

    if (current === null || next === null || next <= current) {
      return {
        label: 'No Next-Pick Read',
        code: 'no-next-pick',
        marketPick: marketPick,
        nextUserPick: next,
        picksUntilNextTurn: null,
        marketCushion: null,
        explanation:
          'Your next deterministic pick is not available for this draft state.'
      };
    }

    var picksUntilNextTurn = next - current;

    // Positive = ADP slot occurs before user's next pick.
    // Negative = ADP slot occurs after user's next pick.
    var marketCushion = next - marketPick;

    if (marketPick < next) {
      return {
        label: 'Market Leans Gone',
        code: 'market-leans-gone',
        marketPick: marketPick,
        nextUserPick: next,
        picksUntilNextTurn: picksUntilNextTurn,
        marketCushion: marketCushion,
        explanation:
          'His ADP comes before your next pick, so waiting carries real market risk.'
      };
    }

    return {
      label: 'Market Says He May Return',
      code: 'market-may-return',
      marketPick: marketPick,
      nextUserPick: next,
      picksUntilNextTurn: picksUntilNextTurn,
      marketCushion: marketCushion,
      explanation:
        'His ADP is at or after your next pick, so the market gives you room to wait.'
    };
  }

  function buildDraftMarketProfile(input) {
    input = input || {};

    var adp = finiteNumber(input.adp);
    var currentPick = positiveInteger(input.currentPick);
    var nextUserPick = positiveInteger(input.nextUserPick);

    return {
      marketValue: buildMarketValue(adp, currentPick),
      returnOutlook: buildReturnOutlook(
        adp,
        currentPick,
        nextUserPick
      ),
      context: {
        adp: adp,
        currentPick: currentPick,
        nextUserPick: nextUserPick,
        adpSource: input.adpSource || null
      }
    };
  }

  return {
    normalizeAdpToPick: normalizeAdpToPick,
    buildMarketValue: buildMarketValue,
    buildReturnOutlook: buildReturnOutlook,
    buildDraftMarketProfile: buildDraftMarketProfile
  };
}));
