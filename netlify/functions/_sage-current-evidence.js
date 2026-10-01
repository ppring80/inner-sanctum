"use strict";

const ALLOWED_TYPES = new Set([
  "TEAM_TENDENCY",
  "PLAYER_ROLE",
  "INJURY_STATUS",
  "USAGE",
  "SCHEME",
  "MATCHUP",
  "COACHING_CHANGE",
  "LINEUP_CONTEXT"
]);

const SOURCE_TIERS = new Set(["primary", "trusted-data", "trusted-reporting", "analytical"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeCurrentEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Current evidence must be an object.");
  }

  const type = clean(input.type);
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("Unsupported current-evidence type.");
  }

  const sourceTier = clean(input.sourceTier);
  if (!SOURCE_TIERS.has(sourceTier)) {
    throw new Error("Current evidence requires a recognized source tier.");
  }

  const source = clean(input.source);
  const claim = clean(input.claim);
  const observedAt = clean(input.observedAt);
  if (!source || !claim || !observedAt) {
    throw new Error("Current evidence requires source, claim, and observedAt.");
  }

  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) {
    throw new Error("observedAt must be a valid date/time.");
  }

  const sample = input.sample && typeof input.sample === "object" && !Array.isArray(input.sample)
    ? { ...input.sample }
    : null;

  return {
    type,
    sourceTier,
    source,
    sourceUrl: clean(input.sourceUrl) || null,
    claim,
    observedAt: new Date(observedMs).toISOString(),
    season: Number.isFinite(Number(input.season)) ? Number(input.season) : null,
    week: Number.isFinite(Number(input.week)) ? Number(input.week) : null,
    team: clean(input.team) || null,
    player: clean(input.player) || null,
    metric: clean(input.metric) || null,
    value: input.value ?? null,
    unit: clean(input.unit) || null,
    sample,
    contradicts: input.contradicts === true,
    note: clean(input.note) || null
  };
}

function assessEvidenceFreshness(evidence, now = new Date()) {
  const observed = new Date(evidence.observedAt);
  const ageHours = (now.getTime() - observed.getTime()) / 3600000;
  const fastMoving = new Set(["INJURY_STATUS", "PLAYER_ROLE", "USAGE", "LINEUP_CONTEXT"]);
  const maxAgeHours = fastMoving.has(evidence.type) ? 72 : 24 * 14;

  return {
    ageHours: Number(ageHours.toFixed(1)),
    maxAgeHours,
    fresh: ageHours >= 0 && ageHours <= maxAgeHours,
    rule: fastMoving.has(evidence.type)
      ? "fast-moving evidence"
      : "structural/tendency evidence"
  };
}

function buildCurrentEvidencePacket(inputs, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const normalized = (inputs || []).map(normalizeCurrentEvidence);
  const evidence = normalized.map((item) => ({
    ...item,
    freshness: assessEvidenceFreshness(item, now)
  }));

  const stale = evidence.filter((item) => !item.freshness.fresh);
  const contradictions = evidence.filter((item) => item.contradicts);

  return {
    source: "Super SAGE Current Evidence Layer",
    evidence,
    stale,
    contradictions,
    canChangeProductionRanking: false,
    readyForReasoning:
      evidence.length > 0 &&
      stale.length === 0 &&
      contradictions.length === 0,
    guardrails: [
      "Every current claim requires a named source and observation time.",
      "Fast-moving injury/role/usage evidence expires faster than structural scheme evidence.",
      "Sample metadata is preserved when supplied.",
      "Contradictory evidence is surfaced, not silently reconciled.",
      "Current evidence does not itself change Weekly SAGE rankings."
    ]
  };
}

module.exports = {
  ALLOWED_TYPES,
  SOURCE_TIERS,
  normalizeCurrentEvidence,
  assessEvidenceFreshness,
  buildCurrentEvidencePacket
};
