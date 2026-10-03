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
      verdict: slot.starter ? "START" : "NO CALL",
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
    return presentation.starters.map((s) => ({ slot: s.slot, player: s.player, confidence: s.confidence }));
  }
  return presentation.rows.map((r) => ({ slot: r.slotLabel, player: r.playerName, confidence: r.confidenceLabel }));
}

module.exports = { toMcpLineup, toWebsiteLineup, decisionOf };
