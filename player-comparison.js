// player-comparison.js
// ═══════════════════════════════════════════════════════════════════
// SHARED TWO-PLAYER COMPARISON ENGINE — The Inner Sanctum (Aug 15 2026)
//
// WHY THIS FILE EXISTS: both /compare (compare.html) and the Draft
// Command Center's Compare feature (draft.html) independently
// implemented "which of these 2 players is better" as a single line:
//   winner = a.adp < b.adp ? a : b;
// with all other player data (team, injury, experience) added to the
// Oracle's sentence purely decoratively, AFTER the winner was already
// decided by ADP alone. An Aug 15 2026 audit confirmed neither page's
// Oracle commentary ever influenced or explained a genuine multi-factor
// decision -- it explained a coin flip. This file is the fix: ONE
// comparison engine, called by both pages, that computes a structured,
// multi-factor result FIRST. Oracle prose (still owned separately by
// each page, to preserve each page's voice/layout) explains this
// engine's output -- it does not independently choose a winner anymore.
//
// LOCATION CHOICE: a new standalone file, not added to
// shared-player-data.js. That file's own header is explicit that it
// exists for player POOL/fallback DATA (the PLAYER_POOL fallback list,
// Sleeper/Tank01 live-data fetchers) -- comparison/recommendation
// BUSINESS LOGIC is a different concern and doesn't belong mixed into
// a data-sourcing file. Loaded the same way shared-player-data.js
// already is site-wide: a script tag with src="/player-comparison.js",
// defining plain global functions (this app has no bundler/ES module
// system anywhere -- matching the existing convention exactly, not
// introducing a new one).
//
// SCOPE (v1, per explicit instruction): ADP, injury/status, ADP-derived
// tier (informational only -- see TIER FACTOR below), scoring format
// (accepted as an input, currently zero-weight -- see SCORING FORMAT
// below), bye week (zero weight, informational only). NO workload/
// opportunity data, NO Tank01 box-score calls, NO projections -- those
// don't exist yet anywhere in this codebase (confirmed by a separate
// Aug 15 2026 diagnostic). The `workload` factor slot below is a
// documented extension point only -- unused, no fetching, no logic.
//
// THE ENGINE CONTAINS NO ORACLE PROSE. It returns structured facts.
// Presentation (the "In 38 seasons..." voice, sentence construction)
// stays in each page's own Oracle function, which now READS this
// engine's output instead of computing its own winner.
// ═══════════════════════════════════════════════════════════════════

// ── Scoring constants — REASONED STARTING VALUES, NOT EMPIRICALLY
// DERIVED. There is no historical outcome data anywhere in this
// codebase to fit these against (that's a much bigger project). These
// are deliberate, documented, and meant to be revisited -- not
// arbitrary numbers buried silently in the algorithm. Every constant
// below is used in exactly one place, named for what it controls, so
// changing the model later means changing a named constant, not
// hunting through the scoring logic. ──────────────────────────────
var CMP_BASELINE = 50; // both players start even; factors add points toward whichever side they favor -- never subtract from the other side (this matches the illustrative schema's scoreA/scoreB not summing to a fixed total)

// ADP is the dominant signal, per explicit instruction. Uses a LOG-scale
// gap (ln(worseADP) - ln(betterADP)), not a raw pick-count difference,
// because a 1-pick gap between ADP 1 and 2 is enormous while a 1-pick
// gap between ADP 200 and 201 is nothing -- log scale means the SAME
// proportional ADP difference (e.g. "twice as highly drafted") produces
// the same score impact regardless of where in the draft it occurs.
// This is a standard, explainable way to represent relative value; it
// is still a chosen model, not a measured one.
var CMP_ADP_SCALE = 15;      // multiplier on the log-gap to turn it into points
var CMP_ADP_MAX_POINTS = 40; // hard cap -- keeps ADP dominant but not the ONLY thing that can ever matter, and keeps injury's max well below this so injury alone can never overturn a huge ADP gap (see INJURY FACTOR)

// Injury/status point penalties, applied to the affected player's own
// side (i.e. this many points effectively shift toward their opponent).
// Values are ordered by real-world severity as this app's own injury
// badge system already ranks them (see draft.html's INJ_SEV, added
// during the Aug 15 2026 Oracle fix) -- reused here for consistency,
// not reinvented. Deliberately capped well below CMP_ADP_MAX_POINTS
// (40) so a Questionable/minor tag can influence a CLOSE comparison
// without ever overwhelming a large ADP advantage, per explicit
// instruction: "Do not let a minor/questionable designation
// automatically overwhelm a very large ADP advantage."
var CMP_INJURY_POINTS = { Out: 12, IR: 12, Doubtful: 8, Questionable: 4, PUP: 6 };

// Tier and bye week intentionally have NO score weight in v1 -- see
// the TIER FACTOR and BYE WEEK FACTOR comments below for why. Scoring
// format also carries no weight in v1 -- see SCORING FORMAT FACTOR.

// Confidence thresholds, relative to CMP_ADP_MAX_POINTS's scale so
// "strong" requires a real fraction of the maximum possible ADP-driven
// swing, not just any nonzero gap. This is RECOMMENDATION-STRENGTH
// terminology, not a statistical probability -- there is no model here
// that would justify a probability claim, and the words below are
// deliberately chosen to avoid implying one.
var CMP_CONFIDENCE_CLOSE_MAX = 6;     // gap < this => 'close'
var CMP_CONFIDENCE_MODERATE_MAX = 16; // gap < this (and >= close max) => 'moderate'; gap >= this => 'strong'

// Same TIER_CUTS table already used in draft.html for its Stream
// badges. Deliberately DUPLICATED, not imported -- draft.html's copy
// drives an unrelated, pre-existing UI feature (Stream badges shown on
// every player row, not just in comparisons) and touching that file's
// existing tier machinery to point at this new file was avoidable
// scope this task didn't ask for. Same duplication-with-documented-
// reason pattern already established in this codebase (see adp.js's
// MISSING_DEF_FALLBACK, duplicated from shared-player-data.js's
// PLAYER_POOL.DEF for the identical cross-file reason). If the tier
// cutoffs are ever revised, update both copies.
var CMP_TIER_CUTS = { QB: [3, 6, 9, 15], RB: [4, 8, 12, 18, 25], WR: [5, 10, 16, 24, 35], TE: [4, 8, 12, 20], K: [5, 12], DEF: [4, 8, 15] };

function cmpTier(rank, pos) {
  var cuts = CMP_TIER_CUTS[pos] || [5, 10, 20];
  for (var i = 0; i < cuts.length; i++) { if (rank <= cuts[i]) return i + 1; }
  return cuts.length + 1;
}

function cmpClassifyStrength(points, maxPoints) {
  if (!points || maxPoints <= 0) return 'negligible';
  var ratio = points / maxPoints;
  if (ratio >= 0.5) return 'strong';
  if (ratio >= 0.2) return 'moderate';
  return 'slight';
}

// ═══════════════════════════════════════════════════════════════════
// compareTwoPlayers(playerA, playerB, options)
//
// INPUT SHAPE per player (fields beyond name/pos/adp are OPTIONAL --
// omit whatever a given caller genuinely doesn't have; the engine
// skips any factor whose required input is missing rather than
// guessing):
//   {
//     name: string,                 REQUIRED
//     pos: string,                  REQUIRED (e.g. 'QB','RB','WR','TE','K','DEF')
//     adp: number,                  REQUIRED
//     team: string,                 optional -- only used for the bye-week factor
//     positionRank: number,         optional, 1-based rank within their OWN position
//                                   by ADP -- used only for the tier factor. Omit
//                                   if unknown; the tier factor is skipped, not guessed.
//     injury: {                     optional -- omit entirely if truly unknown
//       known: boolean,             REQUIRED if `injury` is present at all. Must be
//                                   true only when the CALLER can positively confirm
//                                   this player's status (present in a live roster
//                                   cache), false if genuinely unresolved. Per
//                                   explicit instruction, unknown must never be
//                                   silently treated as healthy -- that distinction
//                                   is the caller's responsibility to report honestly;
//                                   see the two integration notes in draft.html and
//                                   compare.html for how each page populates this.
//       designation: string|null    e.g. 'Out','IR','Doubtful','Questionable','PUP',
//                                   or null/'' for confirmed no designation (healthy).
//                                   Only meaningful when known===true.
//     }
//   }
//
// options: { scoring: 'ppr'|'half-ppr'|'standard' } -- accepted and
// passed through to the SCORING FORMAT factor below. In v1 this input
// is READ but contributes zero score weight and produces no reason --
// see that factor's comment for why. Structurally present now so a
// real adjustment can be added later without changing the engine's
// call signature.
//
// RETURNS:
//   {
//     winner: playerA|playerB|null,   null only when isTie
//     loser:  playerB|playerA|null,   null only when isTie
//     scoreA: number,
//     scoreB: number,
//     confidence: 'tie'|'close'|'moderate'|'strong',
//     isTie: boolean,                 true only on an EXACT score tie
//     reasons: [ { factor, advantage: 'A'|'B'|null, strength, detail } ]
//   }
//
// No Oracle prose anywhere in this function or file.
// ═══════════════════════════════════════════════════════════════════
function compareTwoPlayers(playerA, playerB, options) {
  options = options || {};
  var scoreA = CMP_BASELINE;
  var scoreB = CMP_BASELINE;
  var reasons = [];

  // ── FACTOR: ADP (always applied — the dominant baseline signal) ──
  var adpA = playerA.adp, adpB = playerB.adp;
  var gap = Math.abs(adpA - adpB);
  var logGap = Math.log(Math.max(adpB, 0.1)) - Math.log(Math.max(adpA, 0.1)); // positive => A has the lower (better) ADP
  var adpPoints = Math.min(CMP_ADP_MAX_POINTS, Math.abs(logGap) * CMP_ADP_SCALE);
  var adpAdvantage = null;
  if (logGap > 0) { scoreA += adpPoints; adpAdvantage = 'A'; }
  else if (logGap < 0) { scoreB += adpPoints; adpAdvantage = 'B'; }
  reasons.push({
    factor: 'adp',
    advantage: adpAdvantage,
    strength: adpAdvantage ? cmpClassifyStrength(adpPoints, CMP_ADP_MAX_POINTS) : 'negligible',
    detail: { adpA: adpA, adpB: adpB, gap: gap }
  });

  // ── FACTOR: injury/status ──────────────────────────────────────
  // Only applied to a side whose caller explicitly reported known:true.
  // A missing `injury` object, or known:false, means genuinely unknown
  // to us -- never treated as "healthy". Both a real designation AND a
  // confirmed-clean status are informative enough to report (matching
  // the requested "no injury downgrade" style reason for a confirmed-
  // healthy favored player) -- only fully-unknown-on-both-sides
  // produces no injury reason at all.
  var injA = playerA.injury, injB = playerB.injury;
  var knownA = !!(injA && injA.known);
  var knownB = !!(injB && injB.known);
  var desigA = knownA ? (injA.designation || null) : null;
  var desigB = knownB ? (injB.designation || null) : null;
  var penA = (desigA && CMP_INJURY_POINTS[desigA]) || 0;
  var penB = (desigB && CMP_INJURY_POINTS[desigB]) || 0;
  if (penA > 0) scoreB += penA; // A's penalty is a relative advantage for B
  if (penB > 0) scoreA += penB;
  if (knownA || knownB) {
    var injAdvantage = null;
    if (penA > penB) injAdvantage = 'B';
    else if (penB > penA) injAdvantage = 'A';
    reasons.push({
      factor: 'injury',
      advantage: injAdvantage,
      strength: injAdvantage ? cmpClassifyStrength(Math.abs(penA - penB), Math.max(CMP_INJURY_POINTS.Out, 1)) : 'negligible',
      detail: {
        statusA: knownA ? (desigA || 'Healthy') : 'Unknown',
        statusB: knownB ? (desigB || 'Healthy') : 'Unknown'
      }
    });
  }

  // ── FACTOR: position/tier context (INFORMATIONAL ONLY — zero score
  // weight, by design). Tier is DERIVED from the same ADP rank the ADP
  // factor above already scored; giving it its own point weight too
  // would double-count that one signal under two names, which the
  // brief explicitly warned against. Its value is as an explanatory
  // lens on the ADP gap (same tier vs a real tier break vs a cross-
  // position call), not as an independent vote. ─────────────────────
  if (playerA.positionRank && playerB.positionRank) {
    var samePos = playerA.pos === playerB.pos;
    if (samePos) {
      var tierA = cmpTier(playerA.positionRank, playerA.pos);
      var tierB = cmpTier(playerB.positionRank, playerB.pos);
      reasons.push({
        factor: 'tier',
        advantage: null, // never a score-driver -- see comment above
        strength: 'informational',
        detail: { samePosition: true, tierA: tierA, tierB: tierB, sameTier: tierA === tierB }
      });
    } else {
      reasons.push({
        factor: 'tier',
        advantage: null,
        strength: 'informational',
        detail: { samePosition: false, posA: playerA.pos, posB: playerB.pos }
      });
    }
  }

  // ── FACTOR: scoring format (accepted as an input; ZERO weight and
  // NO reason emitted in v1). We do not have any per-player signal
  // (target share, reception volume -- that's the not-yet-built
  // workload data) that would justify a defensible PPR/Half-PPR/
  // Standard adjustment for THESE two specific players. Applying a
  // blanket position-based PPR bonus (e.g. "give pass-catchers +N in
  // PPR") with no player-specific backing would itself be exactly the
  // kind of silently-invented weight this task said not to bury in
  // production code -- so this factor is intentionally a documented
  // no-op until real per-player usage data exists. The `scoring`
  // input is still read and validated here so the call signature
  // never needs to change when that data arrives. ───────────────────
  var scoring = options.scoring; // read, currently unused -- see comment above

  // ── FACTOR: bye week (ZERO score weight — informational only when
  // relevant). Per explicit instruction, bye week should never
  // meaningfully move the recommendation; a shared bye is genuinely
  // useful roster-construction information regardless, so it's
  // reported as a reason with no score effect when both sides share
  // one, and silently skipped otherwise. ─────────────────────────────
  if (playerA.bye && playerB.bye && playerA.bye === playerB.bye) {
    reasons.push({
      factor: 'bye',
      advantage: null,
      strength: 'informational',
      detail: { sharedBye: playerA.bye }
    });
  }

  // ── FUTURE EXTENSION POINT (not implemented): a `workload` factor
  // (opp_last_game / opp_avg_last_3 / opp_avg_last_5 / opp_trend /
  // games_sampled) would slot in here exactly like the injury factor
  // above -- read an optional `playerA.workload`/`playerB.workload`
  // object, skip entirely if absent, add bounded points capped well
  // under CMP_ADP_MAX_POINTS, push one reason entry if it had an
  // effect. No Tank01/box-score code belongs in this file even then --
  // this engine should only ever consume an already-normalized
  // workload object, the same way it consumes already-normalized
  // injury data today. Intentionally unimplemented per explicit
  // instruction; this comment is the entire "workload" footprint of
  // this file for now.

  // ── Resolve winner/loser/confidence ────────────────────────────
  var finalGap = Math.abs(scoreA - scoreB);
  var isTie = finalGap < 1e-9;

  var confidence;
  if (isTie) confidence = 'tie';
  else if (finalGap < CMP_CONFIDENCE_CLOSE_MAX) confidence = 'close';
  else if (finalGap < CMP_CONFIDENCE_MODERATE_MAX) confidence = 'moderate';
  else confidence = 'strong';

  var winner = null, loser = null;
  if (!isTie) {
    winner = scoreA > scoreB ? playerA : playerB;
    loser = winner === playerA ? playerB : playerA;
  }

  return {
    winner: winner,
    loser: loser,
    scoreA: scoreA,
    scoreB: scoreB,
    confidence: confidence,
    isTie: isTie,
    reasons: reasons
  };
}
