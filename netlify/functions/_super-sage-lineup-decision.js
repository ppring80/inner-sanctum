"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — LINEUP DECISION LAYER
// ═══════════════════════════════════════════════════════════════════════
//
// Decides lineup slots from the evidence record, then explains each slot
// ONLY from the evidence that decided it.
//
// Principles (no new SAGE score, no tuned weights):
//   * Within a position, Weekly SAGE order decides (positionRank).
//   * Across positions (FLEX-type slots), the "established" option is the one
//     with the stronger position-calibrated standing: Weekly SAGE's OWN tier
//     (START / FLEX / SIT, already position-calibrated by the rankings) and
//     depth inside that tier. This is an ordering of existing Weekly SAGE
//     output, never displayed or used as a player-quality score.
//   * A cross-position displacement of the established option must pass a
//     conservative gate. Provider projections are ONE provenance-labelled,
//     common-unit evidence source and are never sufficient alone. Observed
//     workload, matchup and unvalidated signals are context: explained, never
//     decisive. Only registry-promoted forward signals can carry a
//     displacement. Missing evidence keeps the established option; it never
//     triggers a raw-score or alternative-ranking fallback.
//   * Confidence is categorical and rule-based (see confidenceFor()).
// ═══════════════════════════════════════════════════════════════════════

//   * BASELINE VALIDITY runs before any ordering: a Weekly SAGE rank is a
//     prior. Fresh verified current-state evidence can mark it VALID,
//     REASSESS, INVALID or UNAVAILABLE (see _super-sage-baseline-validity.js)
//     without changing the rank or applying a numeric penalty.
//   * Cross-position challenges are classified ORDINARY / SURPRISING /
//     PROHIBITED. A sourced projection may resolve an otherwise ORDINARY
//     comparison when the complete current evidence is coherent and the
//     difference exceeds the CALIBRATED projection-noise band; a projection
//     never overrides contradictory evidence. While the band is UNCALIBRATED,
//     ORDINARY comparisons fall back to the forward-evidence gate.
//   * Observed workload describes an established role (consistency check
//     only). Role expansion requires promoted, verified forward evidence.
//   * Scope is START/SIT. A bench decision never implies DROP.

const { SIGNALS, signalStatus, isDecisionActive } = require("./_super-sage-signal-registry.js");
const { POLICY, projectionBandFor } = require("./_super-sage-decision-policy.js");
const { assessBaselineValidity, tierProjectionMedians } = require("./_super-sage-baseline-validity.js");
const { observedEvidenceFor, ROLE_LEVEL_ORDER } = require("./_super-sage-opportunity-evidence.js");

const TIER_ORDER = { START: 0, FLEX: 1, SIT: 2 };

const upper = (v) => String(v == null ? "" : v).trim().toUpperCase();
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/* ------------------------------------------------------------------ */
/* Evidence packet                                                     */
/* ------------------------------------------------------------------ */

function projectionEvidence(row, request) {
  const projection = row && row.projection;
  const points = num(row && row.projectedPoints);
  if (points === null) return { admissible: false, reason: "No projection available." };
  if (!projection || !projection.source) {
    return { admissible: false, points, reason: "Projection has no provenance (source/scoring/week)." };
  }
  if (request.scoring && projection.scoring && upper(projection.scoring) !== upper(request.scoring)) {
    return { admissible: false, points, reason: `Projection scoring ${projection.scoring} does not match ${request.scoring}.` };
  }
  if (request.week && projection.week != null && Number(projection.week) !== Number(request.week)) {
    return { admissible: false, points, reason: `Projection is for week ${projection.week}, not ${request.week}.` };
  }
  return {
    admissible: true,
    points,
    source: projection.source,
    scoring: projection.scoring || request.scoring || null,
    week: projection.week != null ? Number(projection.week) : null,
    fresh: projection.fresh === true,
    updatedAt: projection.updatedAt || null
  };
}

// Availability evidence from every source family, each with source/asOf/fresh.
function statusEvidenceFor(candidate, row, request) {
  const items = [];
  const meta = request.availabilityMeta || {};
  const prodFresh = meta.fresh !== false;
  if (candidate.rosterStatus) {
    items.push({ family: "provider-roster", source: "Provider roster", status: upper(candidate.rosterStatus),
      asOf: candidate.rosterStatusAsOf || null, fresh: candidate.rosterStatusFresh !== false });
  }
  if (row) {
    const injury = upper(row.injuryStatus);
    const status = injury || (row.availabilityVerified === false || upper(row.status) === "UNVERIFIED" ? "UNVERIFIED"
      : row.availabilityVerified === true ? "ACTIVE" : "");
    if (status) items.push({ family: "production-availability", source: "Inner Sanctum availability", status, asOf: meta.updatedAt || null, fresh: prodFresh });
  }
  if (candidate.inactiveRow) {
    items.push({ family: "production-inactive", source: candidate.inactiveRow.source || "Inner Sanctum inactive list",
      status: upper(candidate.inactiveRow.status), asOf: meta.updatedAt || null, fresh: prodFresh });
  }
  (request.statusUpdates || []).filter((u) => normalizeName(u.name) === normalizeName(candidate.name)
    && upper(u.position || candidate.position) === upper(candidate.position)).forEach((u) => {
    items.push({ family: u.family || "verified-update", source: u.source || "Verified status update", status: upper(u.status), asOf: u.asOf || null, fresh: u.fresh !== false });
  });
  return items;
}

function buildEvidencePacket(candidate, request) {
  const row = candidate.row || null;
  const rosterStatus = upper(candidate.rosterStatus);
  const injuryStatus = upper(row && row.injuryStatus);

  const opp = row && row.components && row.components.opportunity && row.components.opportunity.opportunities;
  const stateChanges = [];
  if (row && row.environmentContext) {
    stateChanges.push({
      type: row.environmentContext.type || "ENVIRONMENT_CHANGE",
      status: row.environmentContext.status || "REASSESS",
      verified: true,
      magnitudeValidated: false,
      note: row.environmentContext.note || null
    });
  }
  if (row && row.roleContext) {
    stateChanges.push({
      type: "ROLE_CHANGE",
      status: row.roleContext.status || "REASSESS",
      verified: true,
      redistributionVerified: row.roleContext.projectionRecalculated === true,
      magnitudeValidated: false,
      note: row.roleContext.note || null
    });
  }

  const signals = (Array.isArray(row && row.superSageSignals) ? row.superSageSignals : []).map((signal) => ({
    id: signal.id,
    direction: signal.direction === "down" ? "down" : "up",
    verified: signal.verified === true,
    note: signal.note || null,
    status: signalStatus(signal.id, request.registry),
    decisionActive: isDecisionActive(signal, candidate.position, request.registry)
  }));

  const confidenceLabel = row ? (row.sage && row.sage.confidenceLabel) || row.sageConfidenceLabel || null : null;
  const uncertainty = [];
  stateChanges.filter((s) => s.type === "ROLE_CHANGE" && !s.redistributionVerified)
    .forEach(() => uncertainty.push({ code: "UNVERIFIED_REDISTRIBUTION", text: "backfield role change with unverified redistribution" }));
  stateChanges.filter((s) => s.type === "QB_AVAILABILITY_CHANGE")
    .forEach(() => uncertainty.push({ code: "QB_ENVIRONMENT_CHANGE", text: "changed quarterback environment (no validated magnitude)" }));
  if (confidenceLabel && /limited|low/i.test(String(confidenceLabel))) uncertainty.push({ code: "LIMITED_SAGE_CONFIDENCE", text: "limited Weekly SAGE confidence" });
  const positionRank = num(row && (row.positionRank != null ? row.positionRank : row.rank));
  const tier = row && TIER_ORDER[upper(row.recommendation)] !== undefined ? upper(row.recommendation) : null;
  if (row && (positionRank === null || tier === null)) uncertainty.push({ code: "MISSING_WEEKLY_SAGE_STANDING", text: "missing Weekly SAGE rank or tier" });

  return {
    name: candidate.name,
    position: upper(candidate.position || (row && row.position)),
    team: (row && row.team) || candidate.team || null,
    matched: Boolean(row),
    availability: { rosterStatus: rosterStatus || null, injuryStatus: injuryStatus || null, statusEvidence: statusEvidenceFor(candidate, row, request),
      effectiveStatus: null, conflict: null, unavailable: false, questionable: false },
    baseline: {
      positionRank,
      tier,
      rankingValue: num(row && (row.rankingScore != null ? row.rankingScore : row.sage && row.sage.rankingScore)),
      confidenceLabel
    },
    ...observedRoleEvidence(candidate, row, opp, signals, stateChanges, request),
    expectedOpportunity: signals.filter((s) => s.decisionActive),
    stateChanges,
    forwardSignals: signals,
    matchup: row ? (row.matchup && typeof row.matchup === "object" ? row.matchup.label || row.matchup.signal || null : row.matchupStrength || row.matchup || null) : null,
    projection: row ? projectionEvidence(row, request) : { admissible: false, reason: "Player not matched to Weekly SAGE." },
    uncertainty,
    standing: null,
    baselineValidity: null
  };
}

// Observed workload -> observedOpportunity + establishedRole; role expansion
// only from promoted, verified forward signals.
function observedRoleEvidence(candidate, row, legacyOpp, signals, stateChanges, request) {
  const promotedExpansion = signals.filter((s) => s.decisionActive && s.direction === "up");
  const verifiedRoleChange = stateChanges.find((c) => c.type === "ROLE_CHANGE") || null;
  if (request.opportunity) {
    return observedEvidenceFor(request.opportunity, { name: candidate.name, position: candidate.position || (row && row.position), promotedExpansion, verifiedRoleChange });
  }
  const base = observedEvidenceFor(null, { name: candidate.name, position: candidate.position, promotedExpansion, verifiedRoleChange });
  if (!legacyOpp) return base;
  return {
    ...base,
    observedOpportunity: { label: "observed", avgLast3: num(legacyOpp.avgLast3), lastGame: num(legacyOpp.lastGame != null ? legacyOpp.lastGame : legacyOpp.mostRecent),
      source: "row components (legacy)", provenance: null },
    establishedRole: { status: "NOT_ASSESSED", level: null, description: null, reason: "Legacy row workload has no producer sample-size or volume label." }
  };
}

// Applies the baseline-validity stage and its availability consequences.
function applyBaselineValidity(packet, tierMedians, request) {
  const validity = assessBaselineValidity({
    statusEvidence: packet.availability.statusEvidence,
    stateChanges: packet.stateChanges,
    projection: packet.projection,
    standing: packet.standing,
    position: packet.position,
    tierMedians: tierMedians[packet.position] || {},
    policy: request.policy
  });
  packet.baselineValidity = validity;
  const eff = validity.effectiveStatus;
  packet.availability.effectiveStatus = eff;
  packet.availability.conflict = validity.conflict;
  packet.availability.unavailable = validity.state === "UNAVAILABLE";
  packet.availability.questionable = Boolean(eff && (eff.status === "DOUBTFUL" || eff.status === "QUESTIONABLE"));
  if (packet.availability.questionable) {
    packet.stateChanges.push({ type: "INJURY_DESIGNATION", status: eff.reported, verified: true, magnitudeValidated: false,
      note: `${packet.name} carries a ${eff.reported} designation (${eff.source}).` });
    packet.uncertainty.unshift({ code: "INJURY_DESIGNATION", text: `${eff.reported} injury designation` });
  }
  if (eff && eff.status === "UNVERIFIED") packet.uncertainty.push({ code: "AVAILABILITY_UNVERIFIED", text: "availability not verified" });
  if (validity.conflict && validity.state !== "UNAVAILABLE") {
    packet.stateChanges.push({ type: "AVAILABILITY_CONFLICT", status: "CONFLICT", verified: true, magnitudeValidated: false,
      note: `Availability sources disagree: ${validity.conflict.map((c) => `${c.source} ${c.status}`).join(" vs ")}; the most severe fresh status (${eff.status}) applies.` });
  }
  return packet;
}

/* ------------------------------------------------------------------ */
/* Position-calibrated standing (ordering only)                        */
/* ------------------------------------------------------------------ */

function tierBounds(rankings) {
  const bounds = {};
  Object.entries((rankings && rankings.positions) || {}).forEach(([position, rows]) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const tier = upper(row && row.recommendation);
      const rank = num(row && (row.positionRank != null ? row.positionRank : row.rank));
      if (TIER_ORDER[tier] === undefined || rank === null) return;
      const key = upper(position);
      bounds[key] = bounds[key] || {};
      const b = bounds[key][tier] || { min: rank, max: rank };
      b.min = Math.min(b.min, rank);
      b.max = Math.max(b.max, rank);
      bounds[key][tier] = b;
    });
  });
  return bounds;
}

function standingFor(packet, bounds) {
  const { positionRank, tier } = packet.baseline;
  if (positionRank === null || tier === null) return null;
  const b = bounds[packet.position] && bounds[packet.position][tier];
  const depth = b && b.max > b.min ? (positionRank - b.min) / (b.max - b.min + 1) : 0;
  return { tier, tierIndex: TIER_ORDER[tier], depth: Math.max(0, Math.min(0.999, depth)), positionRank };
}

function compareStanding(a, b) {
  if (!a.standing && !b.standing) return 0;
  if (!a.standing) return 1;
  if (!b.standing) return -1;
  return (a.standing.tierIndex - b.standing.tierIndex) || (a.standing.depth - b.standing.depth);
}

/* ------------------------------------------------------------------ */
/* Conservative cross-position displacement gate                       */
/* ------------------------------------------------------------------ */

function evaluateDisplacement(challenger, incumbent) {
  const conditions = [];
  const notAdmissible = [];

  const tierOk = Boolean(challenger.standing && incumbent.standing && challenger.standing.tierIndex <= incumbent.standing.tierIndex);
  conditions.push({
    code: "TIER", passed: tierOk,
    detail: !challenger.standing ? `${challenger.name} has no Weekly SAGE standing.`
      : tierOk ? `${challenger.name} is in the same or a stronger Weekly SAGE tier.`
      : `${challenger.name} (${challenger.standing.tier}) is in a weaker Weekly SAGE tier than ${incumbent.name} (${incumbent.standing.tier}).`
  });

  const cp = challenger.projection, ip = incumbent.projection;
  const projectionOk = cp.admissible && ip.admissible && cp.points > ip.points;
  conditions.push({
    code: "COMMON_UNIT_PROJECTION", passed: projectionOk,
    detail: !cp.admissible || !ip.admissible
      ? `No provenance-labelled projection for ${[!cp.admissible ? challenger.name : null, !ip.admissible ? incumbent.name : null].filter(Boolean).join(" and ")}.`
      : `${cp.source} projection: ${challenger.name} ${cp.points.toFixed(1)} vs ${incumbent.name} ${ip.points.toFixed(1)}.`
  });

  const supporting = [
    ...challenger.forwardSignals.filter((s) => s.decisionActive && s.direction === "up").map((s) => ({ player: challenger.name, ...s })),
    ...incumbent.forwardSignals.filter((s) => s.decisionActive && s.direction === "down").map((s) => ({ player: incumbent.name, ...s }))
  ];
  conditions.push({
    code: "VALIDATED_FORWARD_EVIDENCE", passed: supporting.length > 0,
    detail: supporting.length
      ? supporting.map((s) => `${s.player}: promoted signal ${s.id}`).join("; ")
      : `No promoted, verified forward signal supports ${challenger.name} over ${incumbent.name}.`,
    supporting
  });

  const incumbentCodes = new Set(incumbent.uncertainty.map((u) => u.code));
  const extraUncertainty = challenger.uncertainty.filter((u) => !incumbentCodes.has(u.code));
  conditions.push({
    code: "NO_ADDED_UNCERTAINTY", passed: extraUncertainty.length === 0,
    detail: extraUncertainty.length ? `${challenger.name} adds uncertainty: ${extraUncertainty.map((u) => u.text).join(", ")}.` : `${challenger.name} adds no uncertainty beyond ${incumbent.name}.`,
    extraUncertainty
  });

  // Evidence that was considered but cannot carry a displacement.
  if (challenger.observedOpportunity && challenger.observedOpportunity.avgLast3 !== null) {
    notAdmissible.push({ code: "OBSERVED_OPPORTUNITY", player: challenger.name, value: challenger.observedOpportunity.avgLast3,
      reason: "Observed workload describes an established role; it is not a forecast of role expansion (Turbine #5 V1/V2 rejected)." });
  }
  if (challenger.observedOpportunity && challenger.observedOpportunity.observedTrend === "expanding" && !challenger.roleExpansion.validated) {
    notAdmissible.push({ code: "ROLE_EXPANSION_UNVALIDATED", player: challenger.name, value: "expanding (observed)",
      reason: "An observed expanding trend is not validated evidence that workload will grow beyond the established role." });
  }
  if (challenger.matchup) {
    notAdmissible.push({ code: "MATCHUP", player: challenger.name, value: challenger.matchup, reason: "Matchup is context, not evidence of workload." });
  }
  challenger.forwardSignals.filter((s) => !s.decisionActive).forEach((s) => notAdmissible.push({
    code: "UNPROMOTED_SIGNAL", player: challenger.name, value: s.id, reason: `Signal status is ${s.status}; only promoted signals may decide.` }));
  challenger.stateChanges.filter((s) => s.type === "ROLE_CHANGE").forEach((s) => notAdmissible.push({
    code: "UNVALIDATED_STATE_CHANGE", player: challenger.name, value: s.type,
    reason: s.redistributionVerified ? "State change has no validated magnitude." : "Role change is verified; redistribution is not." }));

  return { passed: conditions.every((c) => c.passed), conditions, notAdmissible };
}

/* ------------------------------------------------------------------ */
/* Cross-position comparison class (burden proportional to surprise)   */
/* ------------------------------------------------------------------ */

const freshAdmissible = (p) => p.projection.admissible && p.projection.fresh === true;

function classifyComparison(challenger, incumbent) {
  const cv = challenger.baselineValidity ? challenger.baselineValidity.state : "VALID";
  const iv = incumbent.baselineValidity ? incumbent.baselineValidity.state : "VALID";
  if (cv === "INVALID" || cv === "UNAVAILABLE") return { comparisonClass: "PROHIBITED", reasons: [`${challenger.name}'s baseline is ${cv}.`] };
  if (!challenger.standing || !incumbent.standing) return { comparisonClass: "PROHIBITED", reasons: ["A Weekly SAGE standing is missing."] };
  const tierGap = challenger.standing.tierIndex - incumbent.standing.tierIndex;
  if (tierGap >= 2) return { comparisonClass: "PROHIBITED", reasons: [`${challenger.name} is two or more Weekly SAGE tiers weaker.`] };

  const reasons = [];
  if (tierGap === 1) reasons.push(`${challenger.name} is one Weekly SAGE tier weaker (${challenger.standing.tier} vs ${incumbent.standing.tier}).`);
  if (cv !== "VALID") reasons.push(`${challenger.name}'s baseline is under ${cv}.`);
  if (iv !== "VALID") reasons.push(`${incumbent.name}'s baseline is under ${iv}.`);
  if (!freshAdmissible(challenger) || !freshAdmissible(incumbent)) reasons.push("Fresh, sourced projections are not available for both players.");
  else if (!(challenger.projection.points > incumbent.projection.points)) reasons.push(`The fresh projection does not favour ${challenger.name}.`);
  const incumbentCodes = new Set(incumbent.uncertainty.map((u) => u.code));
  const extra = challenger.uncertainty.filter((u) => !incumbentCodes.has(u.code));
  if (extra.length) reasons.push(`${challenger.name} adds uncertainty: ${extra.map((u) => u.text).join(", ")}.`);
  const cr = challenger.establishedRole || {}, ir = incumbent.establishedRole || {};
  if (cr.status !== "ESTABLISHED" || ir.status !== "ESTABLISHED") {
    reasons.push(`Established-role evidence is incomplete (${challenger.name}: ${cr.status || "none"}; ${incumbent.name}: ${ir.status || "none"}).`);
  } else if (ROLE_LEVEL_ORDER[cr.level] > ROLE_LEVEL_ORDER[ir.level]) {
    reasons.push(`Observed workload contradicts the challenge: ${challenger.name}'s established role (${cr.level}) is below ${incumbent.name}'s (${ir.level}).`);
  }
  return { comparisonClass: reasons.length ? "SURPRISING" : "ORDINARY", reasons };
}

// Resolve one cross-position challenge under its class's burden.
function resolveChallenge(challenger, incumbent, request) {
  const gate = evaluateDisplacement(challenger, incumbent);
  const { comparisonClass, reasons } = classifyComparison(challenger, incumbent);
  const out = { ...gate, comparisonClass, classReasons: reasons, band: null };
  if (comparisonClass === "PROHIBITED") return { ...out, passed: false, resolution: "PROHIBITED" };
  if (comparisonClass === "ORDINARY") {
    const band = projectionBandFor(request.policy, { scoring: request.scoring, positions: [challenger.position, incumbent.position], source: challenger.projection.source });
    const gap = challenger.projection.points - incumbent.projection.points;
    out.band = { ...band, gap: Math.round(gap * 100) / 100 };
    if (band.calibrated && gap > band.value) return { ...out, passed: true, resolution: "CURRENT_EVIDENCE_COMPARISON" };
    if (gate.passed) return { ...out, passed: true, resolution: "FORWARD_EVIDENCE_GATE" };
    return { ...out, passed: false, resolution: band.calibrated ? "ORDINARY_WITHIN_NOISE_BAND" : "ORDINARY_UNRESOLVED_UNCALIBRATED" };
  }
  return { ...out, passed: gate.passed, resolution: "FORWARD_EVIDENCE_GATE" };
}

/* ------------------------------------------------------------------ */
/* Confidence (categorical, rule-based)                                */
/* ------------------------------------------------------------------ */

function confidenceFor(starter, comparator, decidedBy) {
  const rules = [];
  if (!starter.standing) { rules.push("starter has no Weekly SAGE standing"); return { label: "Limited", rules }; }
  if (decidedBy === "INVALID_BASELINE_ONLY_OPTION") return { label: "Limited", rules: ["the only legal option has a suspended (INVALID) baseline"] };
  if (starter.baselineValidity && starter.baselineValidity.state === "REASSESS") rules.push("starter's Weekly SAGE baseline is under REASSESS");
  if (decidedBy === "BASELINE_TIE") rules.push("baseline standing tie");
  if (starter.uncertainty.length >= 2) rules.push("starter carries multiple uncertainty items");
  if (comparator && !comparator.standing) rules.push("comparator has no Weekly SAGE standing");
  if (rules.length) return { label: "Limited", rules };
  const strongerTier = comparator && comparator.standing && starter.standing.tierIndex < comparator.standing.tierIndex;
  const displaced = decidedBy === "DISPLACEMENT_GATE_PASSED" || decidedBy === "CURRENT_EVIDENCE_COMPARISON";
  if (strongerTier && starter.uncertainty.length === 0 && !displaced) {
    return { label: "Strong", rules: ["starter is in a stronger Weekly SAGE tier with no uncertainty"] };
  }
  if (starter.uncertainty.length) rules.push(`starter uncertainty: ${starter.uncertainty.map((u) => u.text).join(", ")}`);
  if (!strongerTier) rules.push("same Weekly SAGE tier as the comparator");
  if (displaced) rules.push("decided by a cross-position displacement");
  if (decidedBy === "BASELINE_REASSESSED") rules.push("comparator's standing was suspended from governing by current evidence");
  return { label: "Moderate", rules };
}

/* ------------------------------------------------------------------ */
/* Lineup decision                                                      */
/* ------------------------------------------------------------------ */

function expandSlots(slots) {
  const out = [];
  (slots || []).forEach((slot) => {
    const count = Math.max(1, Number(slot.count) || 1);
    for (let i = 0; i < count; i += 1) {
      out.push({ slotLabel: slot.slotLabel, eligiblePositions: (slot.eligiblePositions || []).map(upper) });
    }
  });
  // Narrowest eligibility first: fixed-position slots before FLEX-type slots.
  return out.map((s, i) => ({ ...s, order: i })).sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length || a.order - b.order);
}

function withinPositionOrder(a, b) {
  const ra = a.baseline.positionRank, rb = b.baseline.positionRank;
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  return ra - rb;
}

// Missing evidence never creates a ranking. If the best legal option has no
// Weekly SAGE standing and it is not the ONLY legal option, SAGE makes no call
// for the slot instead of picking by an arbitrary key.
function insufficientEvidence(orderedEligible) {
  if (orderedEligible[0].standing || orderedEligible.length === 1) return null;
  return { starter: null, comparator: null, decidedBy: "INSUFFICIENT_EVIDENCE", gate: null, blockedChallengers: [],
    candidates: orderedEligible.filter((p) => !p.standing) };
}

const validityOf = (p) => (p.baselineValidity ? p.baselineValidity.state : "VALID");

// REASSESS removes the benefit of the doubt: a VALID same-position rival in
// the same or next tier with a higher fresh, sourced projection goes ahead.
function reassessYield(ordered) {
  const top = ordered[0];
  if (!top || validityOf(top) !== "REASSESS" || !top.standing || !freshAdmissible(top)) return null;
  return ordered.slice(1).find((p) => p.position === top.position && validityOf(p) === "VALID" && p.standing
    && p.standing.tierIndex <= top.standing.tierIndex + 1 && freshAdmissible(p) && p.projection.points > top.projection.points) || null;
}

// "Gives way" means set aside for this slot: the next established option is
// re-derived by standing among the remaining candidates. A rival never
// inherits the reassessed leader's place in the ordering (no dependence on an
// irrelevant alternative).
function setAsideReassessed(ordered) {
  const setAside = [];
  let list = ordered;
  while (list.length && reassessYield(list.filter((p) => p.position === list[0].position))) {
    setAside.push(list[0]);
    list = list.filter((p) => p !== list[0]);
  }
  return { list, setAside };
}

// INVALID baselines never order anyone; they start only when no other legal option exists.
function invalidOnlyOption(eligibleAll, order) {
  const invalid = eligibleAll.filter((p) => validityOf(p) === "INVALID").sort(order);
  if (!invalid.length) return null;
  return { starter: invalid[0], comparator: invalid[1] || null, decidedBy: "INVALID_BASELINE_ONLY_OPTION", gate: null, blockedChallengers: [] };
}

function decideFixedSlot(slot, pool) {
  const order = (a, b) => withinPositionOrder(a, b) || (stableKey(a) < stableKey(b) ? -1 : stableKey(a) > stableKey(b) ? 1 : 0);
  const eligibleAll = pool.filter((p) => slot.eligiblePositions.includes(p.position));
  const eligible = eligibleAll.filter((p) => validityOf(p) !== "INVALID").sort(order);
  if (!eligible.length) return invalidOnlyOption(eligibleAll, order);
  const noCall = insufficientEvidence(eligible);
  if (noCall) return noCall;
  const { list, setAside } = setAsideReassessed(eligible);
  let starter = list[0];
  let decidedBy = setAside.length ? "BASELINE_REASSESSED" : starter.standing ? "WITHIN_POSITION_ORDER" : "UNRANKED_FILL";
  let promoted = null;
  const reassessedFrom = setAside[0] || null;
  // A promoted, verified forward signal is the only thing that may reorder a position.
  const challenger = list.slice(1).find((p) => p.forwardSignals.some((s) => s.decisionActive && s.direction === "up")) || null;
  if (challenger && !starter.forwardSignals.some((s) => s.decisionActive && s.direction === "up")) {
    promoted = challenger.forwardSignals.find((s) => s.decisionActive && s.direction === "up");
    starter = challenger;
    decidedBy = "PROMOTED_SIGNAL";
  }
  const comparator = reassessedFrom || list.find((p) => p !== starter) || null;
  return { starter, comparator, decidedBy, gate: null, blockedChallengers: [], promotedSignal: promoted, reassessedFrom };
}

// Order for the established FLEX option. Ranks are only compared WITHIN a
// position. An exact cross-position standing tie is broken by admissible
// common-unit projection (a tie has no established option to displace), and
// otherwise by a stable key so the result never depends on input order.
function flexBaselineOrder(a, b) {
  const byStanding = compareStanding(a, b);
  if (byStanding) return byStanding;
  if (a.position === b.position) return withinPositionOrder(a, b);
  if (a.projection.admissible && b.projection.admissible && a.projection.points !== b.projection.points) {
    return b.projection.points - a.projection.points;
  }
  return stableKey(a) < stableKey(b) ? -1 : stableKey(a) > stableKey(b) ? 1 : 0;
}

function stableKey(p) {
  return `${p.position}|${String(p.name || "").toLowerCase()}|${p.team || ""}`;
}

function decideFlexSlot(slot, pool, request) {
  const eligibleAll = pool.filter((p) => slot.eligiblePositions.includes(p.position));
  if (!eligibleAll.length) return null;
  const eligible = eligibleAll.filter((p) => validityOf(p) !== "INVALID");
  if (!eligible.length) return invalidOnlyOption(eligibleAll, flexBaselineOrder);
  const sorted = eligible.slice().sort(flexBaselineOrder);
  const noCall = insufficientEvidence(sorted);
  if (noCall) return noCall;
  const { list: ordered, setAside } = setAsideReassessed(sorted);
  const reassessedFrom = setAside[0] || null;
  const incumbent = ordered[0];
  let decidedBy = incumbent.standing ? "ESTABLISHED_BASELINE" : "UNRANKED_FILL";
  const tied = ordered[1] && incumbent.standing && compareStanding(incumbent, ordered[1]) === 0 && incumbent.position !== ordered[1].position;
  if (tied) decidedBy = "BASELINE_TIE";

  const evaluations = [];
  ordered.forEach((challenger) => {
    if (challenger === incumbent || challenger.position === incumbent.position) return; // same-position order is Weekly SAGE's own.
    evaluations.push({ challenger, result: resolveChallenge(challenger, incumbent, request) });
  });
  const passing = evaluations.filter((e) => e.result.passed);
  if (passing.length) {
    const winner = passing.slice().sort((a, b) =>
      (freshAdmissible(b.challenger) ? b.challenger.projection.points : -Infinity) - (freshAdmissible(a.challenger) ? a.challenger.projection.points : -Infinity)
      || compareStanding(a.challenger, b.challenger))[0];
    return { starter: winner.challenger, comparator: incumbent,
      decidedBy: winner.result.resolution === "CURRENT_EVIDENCE_COMPARISON" ? "CURRENT_EVIDENCE_COMPARISON" : "DISPLACEMENT_GATE_PASSED",
      gate: winner.result, blockedChallengers: evaluations.filter((e) => e !== winner) };
  }
  // The most relevant blocked challenger is the one a reader would most expect
  // to start: the strongest common-unit projection among cross-position
  // challengers, otherwise the next established option.
  const byProjection = evaluations.filter((e) => e.challenger.projection.admissible)
    .sort((a, b) => b.challenger.projection.points - a.challenger.projection.points);
  const mostRelevant = byProjection[0] || evaluations[0] || null;
  const comparator = mostRelevant ? mostRelevant.challenger : (reassessedFrom || ordered[1] || null);
  return { starter: incumbent, comparator, decidedBy: evaluations.length && decidedBy === "ESTABLISHED_BASELINE" ? "ESTABLISHED_BASELINE_PRESERVED" : decidedBy,
    gate: mostRelevant ? mostRelevant.result : null, blockedChallengers: evaluations, reassessedFrom };
}

function decideLineup({ rankings, candidates, slots, scoring, season, week, registry = SIGNALS, policy = POLICY, opportunity = null, statusUpdates = [] }) {
  const availabilityMeta = (rankings && rankings.metadata && rankings.metadata.availability) || {};
  const request = { scoring, season, week, registry, policy, opportunity, statusUpdates, availabilityMeta };
  const bounds = tierBounds(rankings);
  const tierMedians = tierProjectionMedians(rankings, request);
  const packets = (candidates || []).map((c) => {
    const packet = buildEvidencePacket(c, request);
    packet.standing = standingFor(packet, bounds);
    return applyBaselineValidity(packet, tierMedians, request);
  });
  const unavailable = packets.filter((p) => p.availability.unavailable);
  const unmatched = packets.filter((p) => !p.matched && !p.availability.unavailable);
  let pool = packets.filter((p) => p.matched && !p.availability.unavailable);

  const records = [];
  const unfilled = [];
  expandSlots(slots).forEach((slot) => {
    const decision = slot.eligiblePositions.length === 1 ? decideFixedSlot(slot, pool) : decideFlexSlot(slot, pool, request);
    if (!decision) { unfilled.push({ slotLabel: slot.slotLabel, eligiblePositions: slot.eligiblePositions }); return; }
    if (decision.starter) pool = pool.filter((p) => p !== decision.starter);
    records.push({
      slotLabel: slot.slotLabel,
      eligiblePositions: slot.eligiblePositions,
      starter: decision.starter,
      comparator: decision.comparator,
      decidedBy: decision.decidedBy,
      gate: decision.gate,
      blockedChallengers: (decision.blockedChallengers || []).map((e) => ({ name: e.challenger.name, position: e.challenger.position,
        comparisonClass: e.result.comparisonClass || null, resolution: e.result.resolution || null, classReasons: e.result.classReasons || [],
        failed: e.result.conditions.filter((c) => !c.passed).map((c) => c.code) })),
      reassessedFrom: decision.reassessedFrom || null,
      promotedSignal: decision.promotedSignal || null,
      candidates: decision.candidates || null,
      confidence: decision.starter
        ? confidenceFor(decision.starter, decision.comparator, decision.decidedBy)
        : { label: "None", rules: ["no legal option has Weekly SAGE standing"] }
    });
  });

  const benchWatch = pool.filter((p) => p.stateChanges.length).map((p) => ({ name: p.name, position: p.position, stateChanges: p.stateChanges }));
  return { request: { scoring, season, week }, slots: records, bench: pool, unavailable, unmatched, unfilled, benchWatch, packets, policy, opportunity };
}

/* ------------------------------------------------------------------ */
/* 1/3/10 explanation — derived ONLY from the decision record          */
/* ------------------------------------------------------------------ */

const label = (p) => p.standing ? `${p.position}${p.baseline.positionRank}, ${p.standing.tier} tier` : `${p.position}, no Weekly SAGE standing`;

function explainSlot(record) {
  if (record.decidedBy === "INSUFFICIENT_EVIDENCE") {
    const names = record.candidates.map((p) => p.name);
    return {
      slot: record.slotLabel,
      headline: `NO SUPER SAGE CALL for ${record.slotLabel} — evidence missing`,
      why: [`Weekly SAGE has no rank or tier for ${names.join(", ")}. SAGE will not choose between them without evidence.`],
      materialFacts: [...new Set(record.candidates.flatMap((p) => p.stateChanges.map((ch) => ch.note ? `${p.name}: ${ch.note}` : null)).filter(Boolean))],
      whatCouldChange: [`Weekly SAGE rankings for ${names.join(", ")}.`],
      confidence: "None",
      decidedBy: record.decidedBy
    };
  }
  const s = record.starter, c = record.comparator;
  const why = [];
  const whatCouldChange = [];
  const materialFacts = [];

  const validityText = (p) => p.baselineValidity.triggers.map((t) => t.detail).join(" ");
  const r = record.reassessedFrom;
  if (r) {
    why.push(`${r.name} (${label(r)}) leads in Weekly SAGE, but that standing is under REASSESS and was set aside for this slot: ${validityText(r)}`);
    why.push(`A VALID ${r.position} with a higher fresh projection was available, so ${r.name}'s standing no longer gets the benefit of the doubt.`);
    whatCouldChange.push(`${r.name}'s current-state evidence clearing would restore that standing's authority.`);
  }
  if (record.decidedBy === "BASELINE_REASSESSED") {
    why.push(`Next by Weekly SAGE: ${s.name} (${label(s)}, baseline ${s.baselineValidity.state}, fresh projection ${freshAdmissible(s) ? s.projection.points.toFixed(1) : "n/a"}).`);
  } else if (record.decidedBy === "INVALID_BASELINE_ONLY_OPTION") {
    why.push(`${s.name} is the only legal option for ${record.slotLabel}, but the Weekly SAGE standing is suspended (INVALID): ${validityText(s)}`);
  } else if (record.decidedBy === "CURRENT_EVIDENCE_COMPARISON") {
    why.push(`${s.name} (${label(s)}) starts over ${c.name} (${label(c)}) in an ORDINARY comparison: same tier, both baselines VALID, no added uncertainty, consistent established roles.`);
    why.push(`The fresh ${s.projection.source} projection (${s.projection.points.toFixed(1)} vs ${c.projection.points.toFixed(1)}) exceeds the calibrated noise band (${record.gate.band.value}).`);
  }
  if (["BASELINE_REASSESSED", "INVALID_BASELINE_ONLY_OPTION", "CURRENT_EVIDENCE_COMPARISON"].includes(record.decidedBy)) {
    // handled above; FLEX reassessments also explain the cross-position comparison below.
    if (record.decidedBy === "BASELINE_REASSESSED" && record.gate && record.comparator && record.comparator !== r) crossPositionLines(record, why, whatCouldChange);
  } else if (record.decidedBy === "WITHIN_POSITION_ORDER") {
    why.push(c ? `${s.name} (${label(s)}) ranks ahead of ${c.name} (${label(c)}) in Weekly SAGE.` : `${s.name} is the strongest available ${s.position} in Weekly SAGE (${label(s)}).`);
  } else if (record.decidedBy === "PROMOTED_SIGNAL") {
    why.push(`${s.name} starts on a promoted, verified forward signal: ${record.promotedSignal.id}.`);
  } else if (record.decidedBy === "UNRANKED_FILL") {
    why.push(`${s.name} is the only remaining legal option for ${record.slotLabel}. Weekly SAGE has no standing for this player.`);
  } else if (record.decidedBy === "DISPLACEMENT_GATE_PASSED") {
    why.push(`${s.name} (${label(s)}) displaces ${c.name} (${label(c)}). Every displacement condition passed:`);
    record.gate.conditions.forEach((cond) => why.push(cond.detail));
  } else {
    why.push(c
      ? `${s.name} holds the stronger established Weekly SAGE standing (${label(s)}) than ${c.name} (${label(c)}).`
      : `${s.name} holds the strongest Weekly SAGE standing for ${record.slotLabel} (${label(s)}).`);
    if (record.decidedBy === "BASELINE_TIE") why.push(`Their Weekly SAGE standings are tied; this is a close call.`);
    if (record.gate && c) crossPositionLines(record, why, whatCouldChange);
  }

  [s, c].filter(Boolean).forEach((p) => p.stateChanges.forEach((change) => {
    if (change.note) materialFacts.push(`${p.name}: ${change.note}`);
  }));
  [s, c].filter(Boolean).forEach((p) => (p.baselineValidity ? p.baselineValidity.triggers : [])
    .filter((t) => ["PROJECTION_CONTRADICTS_STANDING", "NEAR_ZERO_PROJECTION", "STALE_STATUS", "AVAILABILITY_UNVERIFIED"].includes(t.code))
    .forEach((t) => materialFacts.push(`${p.name}: ${t.detail}`)));
  s.stateChanges.filter((ch) => ch.type === "QB_AVAILABILITY_CHANGE")
    .forEach(() => whatCouldChange.push(`Material new ${s.team || "team"} offensive evidence after the quarterback change.`));
  if (s.availability.questionable) whatCouldChange.push(`${s.name}'s ${s.availability.effectiveStatus.reported} designation resolving to OUT.`);

  return {
    slot: record.slotLabel,
    headline: c ? `START ${s.name.toUpperCase()} over ${c.name.toUpperCase()} — ${record.confidence.label} edge` : `START ${s.name.toUpperCase()}`,
    why,
    materialFacts: [...new Set(materialFacts)],
    whatCouldChange: [...new Set(whatCouldChange)],
    confidence: record.confidence.label,
    decidedBy: record.decidedBy
  };
}

function crossPositionLines(record, why, whatCouldChange) {
  const s = record.starter, c = record.comparator, gate = record.gate;
  if (gate.comparisonClass) {
    why.push(`Comparison class with ${c.name}: ${gate.comparisonClass}${gate.classReasons && gate.classReasons.length ? ` (${gate.classReasons.join(" ")})` : ""}.`);
  }
  if (gate.resolution === "ORDINARY_UNRESOLVED_UNCALIBRATED") {
    why.push("This is an ORDINARY comparison, but the projection-noise band is not yet calibrated, so the projection cannot resolve it; the established option stays.");
  } else if (gate.resolution === "ORDINARY_WITHIN_NOISE_BAND") {
    why.push(`The projection difference (${gate.band.gap}) is within the calibrated noise band (${gate.band.value}); the established option stays.`);
  }
  const failed = gate.conditions.filter((cond) => !cond.passed);
  if (gate.resolution === "PROHIBITED") why.push(`Starting ${c.name} instead is not permitted: ${gate.classReasons.join(" ")}`);
  else if (failed.length) why.push(`Starting ${c.name} instead would bench a different position and is not supported: ${failed.map((f) => f.detail).join(" ")}`);
  gate.notAdmissible.filter((n) => n.code === "OBSERVED_OPPORTUNITY")
    .forEach((n) => why.push(`${n.player}'s ${n.value.toFixed(1)} recent opportunities per game are observed workload, not a verified forecast of a larger role; at most they describe an established role.`));
  failed.forEach((f) => {
    if (f.code === "COMMON_UNIT_PROJECTION") whatCouldChange.push(`A provenance-labelled projection showing ${c.name} ahead of ${s.name}.`);
    if (f.code === "VALIDATED_FORWARD_EVIDENCE") whatCouldChange.push(`Verified, validated evidence of a larger role for ${c.name}.`);
    if (f.code === "NO_ADDED_UNCERTAINTY") whatCouldChange.push(`Resolution of ${c.name}'s ${f.extraUncertainty.map((u) => u.text).join(", ")}.`);
    if (f.code === "TIER") whatCouldChange.push(`${c.name} moving into ${s.name}'s Weekly SAGE tier.`);
  });
  if (gate.resolution === "ORDINARY_UNRESOLVED_UNCALIBRATED") whatCouldChange.push("A calibrated projection-noise band (historical backtest).");
}

function explainLineup(decision) {
  return {
    slots: decision.slots.map(explainSlot),
    benchWatch: decision.benchWatch.map((b) => ({ player: b.name, position: b.position, notes: b.stateChanges.map((s) => s.note).filter(Boolean) }))
  };
}

/* ------------------------------------------------------------------ */
/* Shared decision record (the ONLY thing consumers receive)           */
/* ------------------------------------------------------------------ */
//
// Every in-season consumer — ChatGPT/MCP, Weekly Rankings, Start/Sit,
// Compare Players, Player Profile, Waiver/FAAB — consumes this record and
// only presents it. No consumer re-decides. The record is plain JSON so it can
// be returned by a Netlify function to the website unchanged.

const crypto = require("crypto");
const RECORD_SCHEMA_VERSION = 2;
const DECISION_SCOPE = "START_SIT";
const ROSTER_VALUE_NOTE = "This record decides START/SIT for this week only. A bench decision does not imply DROP; roster value (including contingent value) is not assessed here.";

const normalizeName = (v) => String(v || "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

// Shared roster -> Weekly SAGE row matching (playerID, else name + position).
function matchRosterToRankings(roster, rankings) {
  const rows = [];
  Object.entries((rankings && rankings.positions) || {}).forEach(([position, list]) => {
    (Array.isArray(list) ? list : []).forEach((row) => rows.push({ position: upper(row.position || position), row }));
  });
  const used = new Set();
  return (roster || []).map((entry) => {
    const position = upper(entry.position || (entry.eligiblePositions && entry.eligiblePositions[0]));
    const byId = entry.playerID ? rows.find((r) => !used.has(r) && String(r.row.playerID || "") === String(entry.playerID)) : null;
    const byName = byId || rows.find((r) => !used.has(r) && r.position === position && normalizeName(r.row.name) === normalizeName(entry.name));
    if (byName) used.add(byName);
    const inactiveList = (rankings && rankings.inactive && rankings.inactive[position]) || [];
    const inactiveRow = byName ? null : inactiveList.find((r) => (entry.playerID && String(r.playerID || "") === String(entry.playerID))
      || normalizeName(r.name) === normalizeName(entry.name)) || null;
    return { name: entry.name, position, team: entry.team || null, playerID: entry.playerID || null,
      rosterStatus: entry.rosterStatus || null, rosterStatusAsOf: entry.rosterStatusAsOf || null,
      row: byName ? byName.row : null, inactiveRow };
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
  }
  return value;
}

function publicPacket(p) {
  return p ? {
    name: p.name, position: p.position, team: p.team, matched: p.matched,
    availability: p.availability, baseline: p.baseline, standing: p.standing,
    observedOpportunity: p.observedOpportunity, expectedOpportunity: p.expectedOpportunity,
    stateChanges: p.stateChanges, forwardSignals: p.forwardSignals, matchup: p.matchup,
    projection: p.projection, uncertainty: p.uncertainty,
    baselineValidity: p.baselineValidity, establishedRole: p.establishedRole, roleExpansion: p.roleExpansion
  } : null;
}

/**
 * The single decision authority entry point.
 * Same roster + scoring + week + evidence => identical record (and decisionId).
 */
function buildLineupDecisionRecord({ rankings, roster, slots, scoring, season, week, registry = SIGNALS, policy = POLICY, opportunity = null, statusUpdates = [] }) {
  const candidates = matchRosterToRankings(roster, rankings);
  const decision = decideLineup({ rankings, candidates, slots, scoring, season, week, registry, policy, opportunity, statusUpdates });
  const rosterKeys = new Set(candidates.map((c) => `${normalizeName(c.name)}|${c.position}`));
  const explanation = explainLineup(decision);
  const inputs = canonical({
    season: Number(season), week: Number(week), scoring: String(scoring || ""),
    slots: (slots || []).map((s) => ({ slotLabel: s.slotLabel, eligiblePositions: (s.eligiblePositions || []).map(upper), count: Number(s.count) || 1 })),
    roster: candidates.map((c) => ({ name: c.name, position: c.position, rosterStatus: c.rosterStatus, rosterStatusAsOf: c.rosterStatusAsOf, row: c.row, inactiveRow: c.inactiveRow }))
      .sort((a, b) => (a.position + a.name < b.position + b.name ? -1 : 1)),
    availabilityMeta: (rankings && rankings.metadata && rankings.metadata.availability) || null,
    policy: { version: policy.version, band: policy.projectionNoiseBand, nearZero: policy.nearZeroProjection },
    opportunity: opportunity ? { status: opportunity.status, provenance: opportunity.provenance || null,
      records: Object.fromEntries(Object.entries(opportunity.records || {}).filter(([k]) => rosterKeys.has(k))) } : null,
    statusUpdates: (statusUpdates || []).map((u) => ({ ...u })),
    tierBounds: tierBounds(rankings),
    registry: Object.fromEntries(Object.entries(registry).map(([id, sig]) => [id, sig.status]))
  });
  const decisionId = crypto.createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
  return JSON.parse(JSON.stringify({
    schemaVersion: RECORD_SCHEMA_VERSION,
    evidenceType: "super-sage-lineup-decision",
    decisionId,
    request: { season: Number(season), week: Number(week), scoring },
    decisionScope: DECISION_SCOPE,
    rosterValue: { assessed: false, note: ROSTER_VALUE_NOTE },
    policy: { version: policy.version, projectionNoiseBand: policy.projectionNoiseBand.status, nearZeroProjection: policy.nearZeroProjection.status },
    observedOpportunity: opportunity ? { status: opportunity.status, reason: opportunity.reason || null, provenance: opportunity.provenance || null }
      : { status: "NOT_SUPPLIED", reason: "No observed-opportunity source was supplied.", provenance: null },
    slots: decision.slots.map((r, i) => ({
      slotLabel: r.slotLabel,
      eligiblePositions: r.eligiblePositions,
      starter: publicPacket(r.starter),
      comparator: publicPacket(r.comparator),
      decidedBy: r.decidedBy,
      gate: r.gate,
      reassessedFrom: r.reassessedFrom ? r.reassessedFrom.name : null,
      blockedChallengers: r.blockedChallengers,
      promotedSignal: r.promotedSignal,
      candidates: r.candidates ? r.candidates.map(publicPacket) : null,
      confidence: r.confidence,
      explanation: explanation.slots[i]
    })),
    bench: decision.bench.map((p) => ({ ...publicPacket(p), lineupStatus: "BENCH", rosterImplication: "NONE" })),
    unavailable: decision.unavailable.map(publicPacket),
    unmatched: decision.unmatched.map((p) => ({ name: p.name, position: p.position })),
    unfilled: decision.unfilled,
    benchWatch: explanation.benchWatch
  }));
}

module.exports = {
  buildLineupDecisionRecord,
  matchRosterToRankings,
  RECORD_SCHEMA_VERSION,
  DECISION_SCOPE,
  classifyComparison,
  resolveChallenge,
  decideLineup,
  explainLineup,
  explainSlot,
  buildEvidencePacket,
  evaluateDisplacement,
  tierBounds,
  standingFor,
  confidenceFor,
  TIER_ORDER
};
