"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — OBSERVED OPPORTUNITY EVIDENCE
// ═══════════════════════════════════════════════════════════════════════
//
// Reads Inner Sanctum Opportunity Intelligence (Blob store "opportunity-intel",
// written by refresh-opportunity-intel.js) so observed workload reaches the
// shared Super SAGE evidence record BEFORE the decision.
//
//   observed               what happened (carries + targets per game)
//   establishedRole        stable historical workload DESCRIBING the player's
//                          existing role; usable only as a consistency check
//   roleExpansion          any claim that workload will grow beyond the
//                          established role. Claimed only by promoted,
//                          verified forward signals; observed trends never
//                          claim it.
//   expectedOpportunity    (decision layer) promoted signals only; never fed
//                          from this module.
//
// Leakage guard: a cache is admissible for target week W only if every week it
// includes is < W and its season matches.
// ═══════════════════════════════════════════════════════════════════════

const STORE_NAME = "opportunity-intel";
const ROLE_LEVEL_ORDER = { "high-volume": 0, "moderate-volume": 1, "role-player": 2 };

// Records are keyed exactly as the producer keys them. Use the reader's
// exported copy, documented as byte-identical to the producer's normalizer.
const { normalizePlayerName } = require("./opportunity-intel.js");
const normalizeName = (v) => normalizePlayerName(String(v || ""));
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Validate a raw opportunity cache object for a target season/week. */
function validateSnapshot(snapshot, { season, week }) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.records) return { ok: false, reason: "No opportunity records in snapshot." };
  const weeks = (Array.isArray(snapshot.weeksRequested) ? snapshot.weeksRequested : []).map(Number).filter(Number.isFinite);
  if (!weeks.length) return { ok: false, reason: "Snapshot does not declare the weeks it includes; cannot prove it predates the target week." };
  if (snapshot.season != null && String(snapshot.season) !== String(season)) return { ok: false, reason: `Snapshot season ${snapshot.season} does not match ${season}.` };
  const leaking = weeks.filter((w) => w >= Number(week));
  if (leaking.length) return { ok: false, reason: `Snapshot includes week(s) ${leaking.join(", ")} at or after target week ${week} (leakage).` };
  return { ok: true, weeks };
}

function fromSnapshot(snapshot, { season, week, key = "snapshot", store = "fixture" } = {}) {
  const check = validateSnapshot(snapshot, { season, week });
  if (!check.ok) return { status: "REJECTED", reason: check.reason, provenance: { store, key }, records: {} };
  return {
    status: "AVAILABLE",
    provenance: { store, key, season: String(snapshot.season != null ? snapshot.season : season), weeksIncluded: check.weeks, computedAt: snapshot.computedAt || null },
    records: snapshot.records
  };
}

/**
 * Load the as-of-week window from the Blob store. Tries the exact pre-week
 * window key, then "latest"; each is accepted only if it passes the guard.
 * Never throws: failures return an explicit gap.
 */
async function loadObservedOpportunity({ season, week, store }) {
  if (!store || typeof store.get !== "function") return { status: "UNAVAILABLE", reason: "No opportunity store provided.", provenance: null, records: {} };
  const priorWeeks = Array.from({ length: Math.max(0, Number(week) - 1) }, (_, i) => i + 1);
  const keys = [priorWeeks.length ? `window:${season}:${priorWeeks.join("-")}` : null, "latest"].filter(Boolean);
  const rejections = [];
  for (const key of keys) {
    let snapshot;
    try { snapshot = await store.get(key, { type: "json" }); } catch (error) {
      return { status: "UNAVAILABLE", reason: `Opportunity store read failed: ${error.message}`, provenance: { store: STORE_NAME, key }, records: {} };
    }
    if (!snapshot) { rejections.push(`${key}: not found`); continue; }
    const loaded = fromSnapshot(snapshot, { season, week, key, store: STORE_NAME });
    if (loaded.status === "AVAILABLE") return loaded;
    rejections.push(`${key}: ${loaded.reason}`);
  }
  return { status: "NO_AS_OF_WINDOW", reason: rejections.join("; "), provenance: { store: STORE_NAME, keysTried: keys }, records: {} };
}

const signalValue = (record, type) => {
  const hit = (Array.isArray(record && record.signals) ? record.signals : []).find((s) => s && s.type === type);
  return hit ? hit.value : null;
};
const volumeLabel = (record) => {
  const hit = (Array.isArray(record && record.signals) ? record.signals : []).find((s) => s && Object.prototype.hasOwnProperty.call(ROLE_LEVEL_ORDER, s.value));
  return hit ? hit.value : null;
};

/**
 * Evidence for one player. `promotedExpansion` is supplied by the decision
 * layer from registry-promoted signals; nothing in observed data sets it.
 */
function observedEvidenceFor(opportunity, { name, position, promotedExpansion = [], verifiedRoleChange = null }) {
  const key = `${normalizeName(name)}|${String(position || "").toUpperCase()}`;
  const record = opportunity && opportunity.status === "AVAILABLE" ? opportunity.records[key] : null;
  const roleExpansion = {
    claimed: promotedExpansion.length > 0,
    validated: promotedExpansion.length > 0,
    basis: promotedExpansion.length ? promotedExpansion.map((s) => `promoted signal ${s.id}`) : [],
    note: promotedExpansion.length
      ? "Role expansion supported by promoted, verified forward evidence."
      : verifiedRoleChange
        ? "A verified role change makes expansion possible, but no validated evidence forecasts its size."
        : "No validated evidence of role expansion."
  };
  if (!record) {
    return {
      observedOpportunity: null,
      establishedRole: { status: "NO_OBSERVED_DATA", level: null, description: null,
        reason: opportunity ? (opportunity.status === "AVAILABLE" ? "Player not present in the opportunity cache." : `Observed workload unavailable: ${opportunity.reason || opportunity.status}`) : "Observed workload not supplied." },
      roleExpansion
    };
  }
  const opp = record.opportunities || {};
  const sample = signalValue(record, "sampleSize");
  const level = volumeLabel(record);
  const games = record.persistence && num(record.persistence.gamesSampled);
  const observedOpportunity = {
    label: "observed",
    lastGame: num(opp.lastGame),
    avgLast3: num(opp.avgLast3),
    avgLast5: num(opp.avgLast5),
    gamesSampled: games,
    observedTrend: signalValue(record, "trendClassification"),
    observedTrendNote: "Observed pattern only; persistence and magnitude forecasts from observed workload are rejected (Turbine #5 V1/V2).",
    source: "Inner Sanctum Opportunity Intelligence",
    provenance: opportunity.provenance
  };
  const established = sample === "adequate" && level !== null;
  return {
    observedOpportunity,
    establishedRole: {
      status: established ? "ESTABLISHED" : "INSUFFICIENT_SAMPLE",
      level: established ? level : null,
      description: established
        ? `Established ${level} role: about ${observedOpportunity.avgLast3 != null ? observedOpportunity.avgLast3 : observedOpportunity.lastGame} opportunities per game recently.`
        : `Observed workload exists but the sample is ${sample || "unclassified"}; no established role is asserted.`,
      reason: established ? "Producer sample size adequate; position-calibrated volume label from the producer." : "Producer sample size is not adequate."
    },
    roleExpansion
  };
}

module.exports = { STORE_NAME, ROLE_LEVEL_ORDER, validateSnapshot, fromSnapshot, loadObservedOpportunity, observedEvidenceFor, normalizeName };
