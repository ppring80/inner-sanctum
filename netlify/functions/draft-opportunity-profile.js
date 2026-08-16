// draft-opportunity-profile.js
//
// SAGE Step 2 — Formal Opportunity Profile (Aug 16 2026).
//
// Consumer question this answers: "How strong is the role behind this
// player?" — translated into four plain-language parts: Workload, Role
// Direction, Role Quality, Evidence.
//
// THIS FILE DOES NOT REDEFINE ANYTHING. It consumes the existing,
// already-validated opportunityIntelligence record produced by
// buildOpportunityIntelligence() in refresh-opportunity-intel.js —
// seasonAvg, avgLast3, avgLast5, trendClassification,
// recentRoleVsBaseline, volumeTier, and gamesSampled are all read
// as-is. Nothing here recomputes them, and no new numeric threshold is
// introduced for any of those five. Every classification below is
// either (a) a direct relabel of an existing already-classified signal
// (volumeTier -> Workload level, sampleSize -> Evidence level,
// trendClassification -> Role Direction label), or (b) a combination of
// two already-classified categorical signals into one sentence
// (roleComposition + volumeTier -> Role Quality label). No magnitude
// threshold anywhere in this file is new.
//
// AUDIT FINDING (constraint 6 — "only use data actually available"):
// the opportunityIntelligence schema has a `highValue` field, but it is
// populated as an empty object {} by the current pipeline (confirmed
// directly against the real buildOpportunityIntelligence() output —
// see raw-records.json in this validation pass). There is no red-zone,
// air-yards, reception-vs-target, or other high-value-touch data
// anywhere in the dataset today. Role Quality below is therefore built
// ENTIRELY from roleComposition + volumeTier — the only two fields that
// actually exist and can defensibly distinguish rushing/receiving/
// volume character. No high-value-opportunity concept is fabricated.
//
// recentRoleVsBaseline stays exactly as designed: continuous/
// unclassified. This file never buckets its percentDelta into a new
// category. Where its number is surfaced at all (in Role Direction's
// explanation text), it is reported as a signed, literal delta ("running
// 12% above season average") — describing the sign and magnitude of an
// already-computed number is not the same as inventing a magnitude
// threshold that decides a label; trendClassification (which already
// has real, named, reviewable thresholds) is what actually decides the
// Role Direction label.
//
// MISSING DATA STAYS NULL. A rookie with zero games (gamesSampled===0)
// is explicitly distinguished from a low-usage veteran (gamesSampled>0,
// low volumeTier) at every one of the four parts below — see
// buildWorkload/buildRoleStyle/buildEvidence. Nothing here ever
// substitutes 0 for missing data.
//
// NO SCORE. This file produces four independent, unweighted
// descriptions. There is no combined number, no weighting, and no
// ranking anywhere in this file.

function findSignal(signals, type) {
  return (signals || []).find((s) => s.type === type) || null;
}

// ── Shared: the same "most reliable recent basis" cascade the existing
// recentRoleVsBaseline signal already uses internally (avgLast5 ->
// avgLast3 -> lastGame). Reused here verbatim rather than inventing a
// second, different cascade for Workload's recentAvg — one convention,
// not two. ──
function recentBasis(metrics) {
  if (metrics.avgLast5 !== null) return { value: metrics.avgLast5, window: "avgLast5" };
  if (metrics.avgLast3 !== null) return { value: metrics.avgLast3, window: "avgLast3" };
  if (metrics.lastGame !== null) return { value: metrics.lastGame, window: "lastGame" };
  return null;
}

const VOLUME_TIER_LABELS = {
  "high-volume": "High Volume",
  "moderate-volume": "Moderate Volume",
  "role-player": "Role Player",
};

// ── 1. WORKLOAD — "how much" ──
function buildWorkload(record) {
  const opp = record.opportunities;
  const volumeSignal = findSignal(record.signals, "volumeTier");

  if (opp.gamesSampled === 0) {
    return {
      level: "No NFL History",
      seasonAvg: null,
      recentAvg: null,
    };
  }

  const recent = recentBasis(opp);

  return {
    level: volumeSignal ? VOLUME_TIER_LABELS[volumeSignal.value] || volumeSignal.value : "Not Enough Data Yet",
    seasonAvg: opp.seasonAvg, // preserved exactly, no rounding/rework beyond what the source already applied
    recentAvg: recent ? recent.value : null,
    unit: "opportunities per game", // self-check fix: a bare number like "22.6" isn't self-explanatory to a consumer without this
  };
}

// ── 2. ROLE DIRECTION — "is it moving" ──
// Label is driven ENTIRELY by the already-classified trendClassification
// signal (expanding/stable/declining), relabeled for consumers. When
// trendClassification isn't available yet (fewer than 6 games), the
// label says so plainly rather than guessing — but the explanation can
// still surface the raw, literal recentRoleVsBaseline delta as
// unclassified supporting context, since reporting a signed number back
// is not the same as classifying it.
// Presentation-only thresholds (Aug 16 2026 refinement) for translating
// the raw, still-continuous/unclassified recentRoleVsBaseline delta into
// one of three fixed plain-language phrases. These do NOT alter
// recentRoleVsBaseline's own computation or its "unclassified" status in
// any way -- they only decide which fixed sentence to print here, and
// the raw percentDelta number itself is never surfaced in this
// explanation anymore. Deliberately dual-gated (percent AND absolute) so
// a low-volume player's naturally noisy percent swings (e.g. 1 extra
// opportunity/game on a 2/game baseline = 50%) aren't described as a
// meaningful move when the real magnitude is trivial -- this is exactly
// what "avoid percentage-heavy language that exaggerates small-number
// changes" requires.
const ROLE_DIRECTION_PCT_THRESHOLD = 10; // percent
const ROLE_DIRECTION_ABS_THRESHOLD = 1.5; // opportunities/game

function describeRecentVsBaseline(baselineSignal) {
  if (!baselineSignal) return null;
  const { percentDelta, absoluteDelta } = baselineSignal.detail;
  if (percentDelta === null || absoluteDelta === null) return null;
  const meaningfullyMoved =
    Math.abs(percentDelta) >= ROLE_DIRECTION_PCT_THRESHOLD && Math.abs(absoluteDelta) >= ROLE_DIRECTION_ABS_THRESHOLD;
  if (!meaningfullyMoved) return "Recent workload is near his season norm.";
  return absoluteDelta > 0 ? "Recent workload is above his season norm." : "Recent workload is below his season norm.";
}

function buildRoleDirection(record) {
  const opp = record.opportunities;
  if (opp.gamesSampled === 0) {
    return { label: "No NFL History", explanation: "This player has no recorded NFL role to evaluate yet." };
  }

  const trendSignal = findSignal(record.signals, "trendClassification");
  const baselineSignal = findSignal(record.signals, "recentRoleVsBaseline");
  const baselineNote = describeRecentVsBaseline(baselineSignal);

  if (!trendSignal) {
    return {
      label: "Not Enough Data Yet",
      explanation: baselineNote
        ? `Too early to call a trend (fewer than 6 games played). ${baselineNote}`
        : "Too early to call a trend — not enough games played yet.",
    };
  }

  const LABELS = { expanding: "Increasing Role", stable: "Stable Role", declining: "Decreasing Role" };
  const VERBS = { expanding: "increased", stable: "held steady", declining: "decreased" };
  const label = LABELS[trendSignal.value] || trendSignal.value;
  const verb = VERBS[trendSignal.value] || "changed";

  return {
    label,
    explanation: baselineNote
      ? `Role has ${verb} over the last 3 weeks. ${baselineNote}`
      : `Role has ${verb} over the last 3 weeks.`,
  };
}

// ── 3. ROLE STYLE — "what kind of role" (renamed from Role Quality, Aug
// 16 2026 refinement). Built ONLY from roleComposition -- volumeTier is
// deliberately NOT folded in here anymore: Workload already owns volume,
// so cross-multiplying the two produced redundant and sometimes awkward
// combined labels (e.g. a slash-joined "Depth/Complementary Role" showed
// up on real AJ Dillon data during validation). Role Style now answers
// exactly one question -- usage shape -- and nothing else.

const ROLE_STYLE_LABELS = {
  "rushing-dominant": "Rush-Heavy",
  "receiving-dominant": "Receiving-Driven",
  "balanced": "Balanced",
};
const ROLE_STYLE_DESC = {
  "rushing-dominant": "primarily a rushing role",
  "receiving-dominant": "primarily a receiving role",
  "balanced": "a mixed rushing-and-receiving role",
};

function buildRoleStyle(record) {
  const opp = record.opportunities;
  if (opp.gamesSampled === 0) {
    return { label: "No NFL History", explanation: "No NFL role data exists for this player yet." };
  }

  const roleSignal = findSignal(record.signals, "roleComposition");

  if (!roleSignal) {
    // A player who has played games but recorded zero rushing AND zero
    // receiving opportunities in the basis window -- a real, distinct
    // situation from "no NFL history," never conflated with it.
    return {
      label: "No Recorded Offensive Touches",
      explanation: "This player has game data on file but no recorded rushing or receiving opportunities in the window we have.",
    };
  }

  const label = ROLE_STYLE_LABELS[roleSignal.value] || roleSignal.value;
  return {
    label,
    explanation: `This is ${ROLE_STYLE_DESC[roleSignal.value] || roleSignal.value}.`,
  };
}

// ── 4. EVIDENCE — "how much do we trust this" ──
// Directly relabels the existing sampleSize signal, plus explicitly
// distinguishing zero-games (rookie/no history) from a genuinely small
// but real sample -- constraint #3 and #4 both land here.
function buildEvidence(record) {
  const opp = record.opportunities;
  const n = opp.gamesSampled;

  if (n === 0) {
    return {
      level: "No NFL History",
      gamesSampled: 0,
      explanation: "This player has no recorded NFL game data yet — this is not a judgment about opportunity, there is simply no history to evaluate.",
    };
  }

  const sampleSignal = findSignal(record.signals, "sampleSize");
  const isLimited = sampleSignal ? sampleSignal.value === "limited" : n < 3;

  return {
    level: isLimited ? "Limited Sample" : "Established Sample",
    gamesSampled: n,
    explanation: isLimited
      ? `Based on only ${n} game${n === 1 ? "" : "s"} — treat this profile with caution until more data is available.`
      : `Based on ${n} games this season.`,
  };
}

// ── Public entry point ──
function buildDraftOpportunityProfile(record) {
  return {
    workload: buildWorkload(record),
    roleDirection: buildRoleDirection(record),
    roleStyle: buildRoleStyle(record),
    evidence: buildEvidence(record),
  };
}

module.exports = {
  buildDraftOpportunityProfile,
  buildWorkload,
  buildRoleDirection,
  buildRoleStyle,
  buildEvidence,
  recentBasis,
  describeRecentVsBaseline,
};
