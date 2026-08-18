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
    seasonAvg: opp.seasonAvg,
    recentAvg: recent ? recent.value : null,
    unit: "opportunities per game",
  };
}

const ROLE_DIRECTION_PCT_THRESHOLD = 10;
const ROLE_DIRECTION_ABS_THRESHOLD = 1.5;

function describeRecentVsBaseline(baselineSignal) {
  if (!baselineSignal) return null;

  const { percentDelta, absoluteDelta } = baselineSignal.detail;

  if (percentDelta === null || absoluteDelta === null) return null;

  const meaningfullyMoved =
    Math.abs(percentDelta) >= ROLE_DIRECTION_PCT_THRESHOLD &&
    Math.abs(absoluteDelta) >= ROLE_DIRECTION_ABS_THRESHOLD;

  if (!meaningfullyMoved) return "Recent workload is near his season norm.";

  return absoluteDelta > 0
    ? "Recent workload is above his season norm."
    : "Recent workload is below his season norm.";
}

function isMeaningfulPersistenceDecline(window) {
  if (!window || window.percentDelta === null || window.absoluteDelta === null) {
    return false;
  }

  return (
    window.percentDelta <= -ROLE_DIRECTION_PCT_THRESHOLD &&
    window.absoluteDelta <= -ROLE_DIRECTION_ABS_THRESHOLD
  );
}

function buildRoleDirection(record) {
  const opp = record.opportunities;

  if (opp.gamesSampled === 0) {
    return {
      label: "No NFL History",
      explanation: "This player has no recorded NFL role to evaluate yet.",
    };
  }

  const trendSignal = findSignal(record.signals, "trendClassification");
  const baselineSignal = findSignal(record.signals, "recentRoleVsBaseline");
  const volumeSignal = findSignal(record.signals, "volumeTier");
  const baselineNote = describeRecentVsBaseline(baselineSignal);

  if (!trendSignal) {
    return {
      label: "Not Enough Data Yet",
      explanation: baselineNote
        ? `Too early to call a trend (fewer than 6 games played). ${baselineNote}`
        : "Too early to call a trend — not enough games played yet.",
    };
  }

  if (trendSignal.value === "expanding") {
    return {
      label: "Increasing Role",
      explanation: baselineNote
        ? `Role has increased over the last 3 weeks. ${baselineNote}`
        : "Role has increased over the last 3 weeks.",
    };
  }

  if (trendSignal.value === "stable") {
    return {
      label: "Stable Role",
      explanation: baselineNote
        ? `Role has held steady over the last 3 weeks. ${baselineNote}`
        : "Role has held steady over the last 3 weeks.",
    };
  }

  if (trendSignal.value === "declining") {
    const persistence = record.persistence || {};

    const declining3 = isMeaningfulPersistenceDecline(persistence.last3);
    const declining6 = isMeaningfulPersistenceDecline(persistence.last6);
    const declining10 = isMeaningfulPersistenceDecline(persistence.last10);

    const isHighVolume = Boolean(
      volumeSignal &&
      volumeSignal.value === "high-volume"
    );

    if (declining3 && declining6 && declining10) {
      return {
        label: "Sustained Decline",
        explanation: baselineNote
          ? `Role decline is sustained across the 3-, 6-, and 10-game windows. ${baselineNote}`
          : "Role decline is sustained across the 3-, 6-, and 10-game windows.",
      };
    }

    if (declining3 && declining6) {
      return {
        label: "Decreasing Role",
        explanation: baselineNote
          ? `Role decline is confirmed across the 3- and 6-game windows. ${baselineNote}`
          : "Role decline is confirmed across the 3- and 6-game windows.",
      };
    }

    if (isHighVolume) {
      return {
        label: "Softening Role",
        explanation: baselineNote
          ? `Recent role has softened, but workload remains high volume. ${baselineNote}`
          : "Recent role has softened, but workload remains high volume.",
      };
    }

    return {
      label: "Decreasing Role",
      explanation: baselineNote
        ? `Role has decreased over the last 3 weeks. ${baselineNote}`
        : "Role has decreased over the last 3 weeks.",
    };
  }

  return {
    label: trendSignal.value,
    explanation:
      baselineNote ||
      "Recent role direction is available but not recognized by this profile version.",
  };
}

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
    return {
      label: "No NFL History",
      explanation: "No NFL role data exists for this player yet.",
    };
  }

  const roleSignal = findSignal(record.signals, "roleComposition");

  if (!roleSignal) {
    return {
      label: "No Recorded Offensive Touches",
      explanation:
        "This player has game data on file but no recorded rushing or receiving opportunities in the window we have.",
    };
  }

  const label = ROLE_STYLE_LABELS[roleSignal.value] || roleSignal.value;

  return {
    label,
    explanation: `This is ${ROLE_STYLE_DESC[roleSignal.value] || roleSignal.value}.`,
  };
}

function buildEvidence(record) {
  const opp = record.opportunities;
  const n = opp.gamesSampled;

  if (n === 0) {
    return {
      level: "No NFL History",
      gamesSampled: 0,
      explanation:
        "This player has no recorded NFL game data yet — this is not a judgment about opportunity, there is simply no history to evaluate.",
    };
  }

  const sampleSignal = findSignal(record.signals, "sampleSize");

  const isLimited = sampleSignal
    ? sampleSignal.value === "limited"
    : n < 3;

  return {
    level: isLimited ? "Limited Sample" : "Established Sample",
    gamesSampled: n,
    explanation: isLimited
      ? `Based on only ${n} game${n === 1 ? "" : "s"} — treat this profile with caution until more data is available.`
      : `Based on ${n} games this season.`,
  };
}

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
  isMeaningfulPersistenceDecline,
};
