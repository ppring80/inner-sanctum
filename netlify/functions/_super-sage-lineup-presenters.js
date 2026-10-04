"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — LINEUP PRESENTERS
// ═══════════════════════════════════════════════════════════════════════
//
// Presentation ONLY. Each function maps the shared Super SAGE decision record
// (built by _super-sage-lineup-decision.js) into one surface's shape. They
// must never sort, filter, score or otherwise re-decide: the order and the
// starters come from the record. This file deliberately imports nothing from
// the decision layer; tests/super-sage-decision-parity.test.js enforces that.
//
// Presentation may differ. Decision logic may not.
// ═══════════════════════════════════════════════════════════════════════

function requireRecord(record) {
  if (!record || record.evidenceType !== "super-sage-lineup-decision" || !Array.isArray(record.slots)) {
    throw new Error("A Super SAGE lineup decision record is required.");
  }
  return record;
}

// ChatGPT / MCP: compact 1/3/10 initial response per slot.
const validityOf = (p) => (p && p.baselineValidity ? p.baselineValidity.state : null);
const classOf = (slot) => (slot.gate && slot.gate.comparisonClass ? slot.gate.comparisonClass : null);

function toMcpLineup(record) {
  requireRecord(record);
  return {
    decisionId: record.decisionId,
    scope: record.decisionScope || null,
    rosterValueNote: record.rosterValue ? record.rosterValue.note : null,
    starters: record.slots.map((slot) => ({
      slot: slot.slotLabel,
      player: slot.starter ? slot.starter.name : null,
      position: slot.starter ? slot.starter.position : null,
      team: slot.starter ? slot.starter.team : null,
      noCallCandidates: slot.candidates ? slot.candidates.map((p) => p.name) : null,
      versus: slot.comparator ? slot.comparator.name : null,
      confidence: slot.confidence.label,
      decisionState: slot.decisionState || null,
      hasValidatedEdge: slot.hasValidatedEdge !== false,
      baseline: validityOf(slot.starter),
      comparisonClass: classOf(slot),
      headline: slot.explanation.headline,
      why: slot.explanation.why,
      materialFacts: slot.explanation.materialFacts,
      whatCouldChange: slot.explanation.whatCouldChange
    })),
    bench: record.bench.map((p) => ({ player: p.name, position: p.position, team: p.team, status: "BENCH" })),
    unavailable: record.unavailable.map((p) => ({ player: p.name, position: p.position, status: p.availability.rosterStatus || p.availability.injuryStatus })),
    watch: record.benchWatch
  };
}

// theinnersanctum.xyz (Weekly Rankings lineup view, Start/Sit): table rows.
function toWebsiteLineup(record) {
  requireRecord(record);
  return {
    decisionId: record.decisionId,
    scope: record.decisionScope || null,
    rosterValueNote: record.rosterValue ? record.rosterValue.note : null,
    rows: record.slots.map((slot, index) => ({
      order: index + 1,
      slotLabel: slot.slotLabel,
      playerName: slot.starter ? slot.starter.name : null,
      pos: slot.starter ? slot.starter.position : null,
      team: slot.starter ? slot.starter.team || "—" : "—",
      verdict: !slot.starter ? "NO CALL" : slot.decisionState === "PROVISIONAL_UNRESOLVED" ? "START (PROVISIONAL)" : slot.decisionState === "CLOSE_CALL_WITHIN_NOISE" ? "START (CLOSE CALL)" : "START",
      decisionState: slot.decisionState || null,
      hasValidatedEdge: slot.hasValidatedEdge !== false,
      noCallCandidates: slot.candidates ? slot.candidates.map((p) => p.name) : null,
      confidenceLabel: slot.confidence.label,
      baselineState: validityOf(slot.starter),
      comparisonClass: classOf(slot),
      summary: slot.explanation.headline,
      details: {
        why: slot.explanation.why,
        material: slot.explanation.materialFacts,
        couldChange: slot.explanation.whatCouldChange
      }
    })),
    benchRows: record.bench.map((p) => ({ playerName: p.name, pos: p.position, team: p.team || "—", verdict: "BENCH" })),
    unavailableRows: record.unavailable.map((p) => ({ playerName: p.name, pos: p.position, verdict: "OUT" })),
    watch: record.benchWatch
  };
}

// The decision a presentation expresses, in a surface-neutral form. Used by
// parity tests to prove every consumer expresses the same decision.
function decisionOf(presentation) {
  if (Array.isArray(presentation.starters)) {
    return presentation.starters.map((s) => ({ slot: s.slot, player: s.player, confidence: s.confidence, decisionState: s.decisionState, hasValidatedEdge: s.hasValidatedEdge }));
  }
  return presentation.rows.map((r) => ({ slot: r.slotLabel, player: r.playerName, confidence: r.confidenceLabel, decisionState: r.decisionState, hasValidatedEdge: r.hasValidatedEdge }));
}


// ───────────────────────────────────────────────────────────────────────
// 1/3/10 customer answer — derived ONLY from the decision record (and the
// shared service's evidence status). Presentation: no ranking, no confidence
// recomputation, no reinterpretation. Deeper evidence stays in the record.
// ───────────────────────────────────────────────────────────────────────

const TRIGGER_PHRASE = {
  STATUS_DOUBTFUL: "listed Doubtful", STATUS_QUESTIONABLE: "listed Questionable", STATUS_UNAVAILABLE: "ruled out",
  NEAR_ZERO_PROJECTION: "near-zero projection", PROJECTION_CONTRADICTS_STANDING: "projection far below his ranking tier",
  QB_ENVIRONMENT_CHANGE: "quarterback change", ROLE_CHANGE: "role change with unverified share",
  SOURCE_CONFLICT: "conflicting status reports", AVAILABILITY_UNVERIFIED: "availability not verified", STALE_STATUS: "stale status report"
};
const STATE_TAG = { PROVISIONAL_UNRESOLVED: "provisional", CLOSE_CALL_WITHIN_NOISE: "close call" };
const shortName = (p) => (p ? p.name : "—");
const rankLabel = (p) => (p && p.baseline && p.baseline.positionRank != null ? `${p.position}${p.baseline.positionRank}` : (p ? p.position : ""));

// SUPER SAGE PRODUCT CONTRACT V1
// Customer-facing explanations must make non-obvious decisions understandable,
// not merely expose which internal rule fired. Everything here is presentation
// of evidence already frozen in the decision record; it never re-decides.
const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(1) : null;
function evidenceSnapshot(p) {
  if (!p) return [];
  const bits = [];
  const rank = rankLabel(p);
  if (rank) bits.push(rank + (p.baseline && p.baseline.tier ? `/${p.baseline.tier}` : ""));
  if (p.projection && p.projection.value != null) bits.push(`projection ${fmt(p.projection.value)}`);
  if (p.observedOpportunity && p.observedOpportunity.avgLast3 != null) {
    bits.push(`${fmt(p.observedOpportunity.avgLast3)} recent opportunities/game`);
  }
  if (p.establishedRole && p.establishedRole.status === "ESTABLISHED" && p.establishedRole.level) {
    bits.push(`${p.establishedRole.level} established role`);
  }
  if (p.matchup && p.matchup.label) bits.push(`${p.matchup.label} matchup`);
  return bits;
}
function decisionEvidenceLine(slot) {
  if (!slot || !slot.starter || !slot.comparator) return null;
  const a = evidenceSnapshot(slot.starter);
  const b = evidenceSnapshot(slot.comparator);
  if (!a.length && !b.length) return null;
  return `${slot.starter.name}: ${a.join(", ")}. ${slot.comparator.name}: ${b.join(", ")}.`;
}

function statusLine(p) {
  const a = (p && p.availability) || {};
  if (!a.injuryStatus) return null;
  return `Status: ${a.injuryStatus}${a.injuryDescription ? ` — ${a.injuryDescription}` : ""}${a.availabilityVerified === false ? " (availability not verified)" : ""}`;
}

function toCustomerAnswer(record, evidenceStatus = null) {
  requireRecord(record);
  const decided = record.slots.filter((s) => s.starter);
  const lineup = decided.map((s) => `${s.slotLabel} ${shortName(s.starter)}${STATE_TAG[s.decisionState] ? ` (${STATE_TAG[s.decisionState]})` : ""}`);
  const noEdge = decided.filter((s) => s.hasValidatedEdge === false);
  const noCall = record.slots.filter((s) => !s.starter);
  const oneSecond = [
    `Start: ${lineup.join(" · ")}`,
    noCall.length || noEdge.length
      ? `${decided.length - noEdge.length} decided${noEdge.length ? `, ${noEdge.length} provisional (no validated edge)` : ""}${noCall.length ? `, ${noCall.length} no call (evidence missing)` : ""}.`
      : `All ${decided.length} slots decided.`
  ];

  // 3 seconds: only the reasons that drove the important decisions.
  const three = [];
  const narrated = new Set();
  decided.forEach((s) => {
    if (s.decidedBy === "BASELINE_REASSESSED" && s.reassessedFrom && !narrated.has(s.reassessedFrom)) {
      narrated.add(s.reassessedFrom);
      const leader = s.comparator && s.comparator.name === s.reassessedFrom ? s.comparator : null;
      const triggers = leader && leader.baselineValidity ? leader.baselineValidity.triggers.map((t) => TRIGGER_PHRASE[t.code]).filter(Boolean) : [];
      three.push(`${s.reassessedFrom}${leader ? ` (${rankLabel(leader)})` : ""} is set aside this week: current evidence contradicts his ranking${triggers.length ? ` (${[...new Set(triggers)].join(", ")})` : ""}. ${shortName(s.starter)} starts instead.`);
    } else if (s.decisionState === "PROVISIONAL_UNRESOLVED" && s.comparator) {
      const evidence = decisionEvidenceLine(s);
      three.push(`${shortName(s.starter)} over ${shortName(s.comparator)} is PROVISIONAL — no validated edge. ${evidence ? evidence + " " : ""}${shortName(s.comparator)} projects higher, but SAGE cannot yet prove that advantage exceeds normal projection error. This is a conservative hold, not proof that ${shortName(s.starter)} is the better play.`);
    } else if (s.decisionState === "CLOSE_CALL_WITHIN_NOISE" && s.comparator) {
      three.push(`${shortName(s.starter)} over ${shortName(s.comparator)} is a close call: the projection gap is within normal error.`);
    } else if (s.decidedBy === "DISPLACEMENT_GATE_PASSED" || s.decidedBy === "CURRENT_EVIDENCE_COMPARISON") {
      const evidence = decisionEvidenceLine(s);
      three.push(`${shortName(s.starter)} starts over ${shortName(s.comparator)} on complete, coherent current evidence.${evidence ? " " + evidence : ""}`);
    }
  });
  if (noCall.length) three.push(`No call for ${noCall.map((s) => s.slotLabel).join(", ")}: Weekly SAGE has no standing for the candidates.`);

  // 10 seconds: material state changes, provisional calls, what could change.
  const ten = [];
  const firstSentence = (t) => { const m = String(t).match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : String(t); };
  (record.benchWatch || []).forEach((w) => { if (w.notes && w.notes.length) ten.push(`${w.player}: ${firstSentence(w.notes[0])}`); });
  decided.forEach((s) => { const line = statusLine(s.starter); if (line) ten.push(`${shortName(s.starter)} — ${line}`); });
  // Non-obvious calls get a compact evidence comparison in the 10-second layer.
  decided.filter((s) => s.comparator && (s.hasValidatedEdge === false || s.confidence.label === "Limited" || s.decidedBy === "BASELINE_REASSESSED"))
    .forEach((s) => {
      const line = decisionEvidenceLine(s);
      if (line) ten.push(`Evidence: ${line}`);
    });
  const could = [...new Set(decided.filter((s) => s.hasValidatedEdge === false || s.decidedBy === "BASELINE_REASSESSED")
    .flatMap((s) => s.explanation.whatCouldChange))].slice(0, 4);
  could.forEach((c) => ten.push(`Could change: ${c}`));
  const workloadNoted = decided.some((s) => s.gate && (s.gate.notAdmissible || []).some((n) => n.code === "OBSERVED_OPPORTUNITY"));
  if (workloadNoted) ten.push("Recent workload describes each player's established role; it is not treated as a forecast of a bigger role.");
  ten.push("Bench is a start/sit call for this week only — it does not mean drop.");
  if (evidenceStatus) Object.entries(evidenceStatus).filter(([, t]) => t && t.status !== "AVAILABLE")
    .forEach(([name, t]) => ten.push(`Evidence ${t.status.toLowerCase()} — ${name}: ${t.detail}${t.effect ? ` ${t.effect}` : ""}`));

  return { decisionId: record.decisionId, oneSecond, threeSeconds: three.slice(0, 3), tenSeconds: ten, deeperEvidenceAvailable: true };
}

function customerAnswerText(answer) {
  return [...answer.oneSecond, "", ...answer.threeSeconds.map((l) => `• ${l}`), "", ...answer.tenSeconds.map((l) => `– ${l}`)].join("\n").trim();
}

// MCP starter/bench rows from the record (presentation only).
function toMcpStartersFromRecord(record) {
  requireRecord(record);
  return record.slots.filter((s) => s.starter).map((s) => ({
    // Compatibility presentation only: preserve the established public MCP
    // contract while the richer shared-authority detail stays in superSage.
    slotLabel: s.slotLabel,
    eligiblePositions: Array.isArray(s.eligiblePositions) ? s.eligiblePositions : [],
    // Internal aliases retained for existing parity/airtight regression consumers.
    slot: s.slotLabel,
    playerID: null,
    player: s.starter.name,
    position: s.starter.position || null,
    team: s.starter.team || null,
    recommendation: s.starter.baseline ? s.starter.baseline.tier || null : null,
    sageLabel: null,
    matchup: s.starter.matchup || null,
    rosterStatus: s.starter.availability
      ? s.starter.availability.rosterStatus || s.starter.availability.injuryStatus || null
      : null,
    weeklySage: rankLabel(s.starter),
    tier: s.starter.baseline ? s.starter.baseline.tier : null,
    decisionState: s.decisionState,
    hasValidatedEdge: s.hasValidatedEdge !== false,
    confidence: s.confidence.label,
    versus: s.comparator ? s.comparator.name : null,
    // Material state changes are never hidden behind opt-in detail.
    reason: [s.explanation.headline, ...s.explanation.why.slice(0, 2), ...s.explanation.materialFacts, statusLine(s.starter)]
      .filter(Boolean).join(" ") || null
  }));
}

module.exports = { toMcpLineup, toWebsiteLineup, decisionOf, toCustomerAnswer, customerAnswerText, toMcpStartersFromRecord };
