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
// Leakage guard: the authority is the underlying observations, never the
// cache's own metadata. A cache is admissible for target week W only if EVERY
// raw game in EVERY record (_rawGames[].week and the game date in gameID) is
// from season S, before week W, and not dated after the cache was computed
// (or after an optional decision cutoff). weeksRequested is recorded for
// provenance but proves nothing: a rolling cache declares only the week it
// last refreshed. If temporal safety cannot be established, it fails closed.
// ═══════════════════════════════════════════════════════════════════════

const STORE_NAME = "opportunity-intel";
const ROLE_LEVEL_ORDER = { "high-volume": 0, "moderate-volume": 1, "role-player": 2 };

// Records are keyed exactly as the producer keys them. Use the reader's
// exported copy, documented as byte-identical to the producer's normalizer.
const { normalizePlayerName } = require("./opportunity-intel.js");
const normalizeName = (v) => normalizePlayerName(String(v || ""));
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const isoDay = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10).replace(/-/g, "") : null;
};

/**
 * Derive the evidence window from the raw observations and validate it for a
 * target season/week. Options: decisionCutoff (ISO time; games on/after its
 * date are rejected). Returns { ok, observedWeeks, observedDateRange, ... }.
 */
function validateSnapshot(snapshot, { season, week, decisionCutoff = null } = {}) {
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!snapshot || typeof snapshot !== "object" || !snapshot.records || typeof snapshot.records !== "object") return fail("No opportunity records in snapshot.");
  if (snapshot.season == null) return fail("Snapshot does not state its season; temporal safety cannot be established.");
  if (String(snapshot.season) !== String(season)) return fail(`Snapshot season ${snapshot.season} does not match ${season}.`);
  const targetWeek = Number(week);
  if (!Number.isFinite(targetWeek)) return fail("Target week is not a number.");
  const computedDay = isoDay(snapshot.computedAt);
  if (!computedDay) return fail("Snapshot computedAt is missing or unparsable; temporal safety cannot be established.");
  const cutoffDay = decisionCutoff == null ? null : isoDay(decisionCutoff);
  if (decisionCutoff != null && !cutoffDay) return fail("Decision cutoff is unparsable.");
  if (cutoffDay && computedDay > cutoffDay) return fail(`Snapshot was computed (${snapshot.computedAt}) after the decision cutoff (${decisionCutoff}).`);

  const seasonYear = Number(season);
  const weeks = new Set();
  let minDay = null, maxDay = null, games = 0;
  const problems = [];
  const entries = Object.entries(snapshot.records);
  if (!entries.length) return fail("Snapshot has no player records.");
  for (const [key, record] of entries) {
    const raw = record && record._rawGames;
    if (!Array.isArray(raw)) { problems.push(`${key}: no _rawGames`); continue; }
    for (const g of raw) {
      games += 1;
      const w = Number(g && g.week);
      const day = /^\d{8}/.test(String(g && g.gameID)) ? String(g.gameID).slice(0, 8) : null;
      if (!Number.isInteger(w) || w < 1) { problems.push(`${key}: raw game without a valid week (${JSON.stringify(g)})`); continue; }
      if (!day) { problems.push(`${key}: raw game without a dated gameID (${JSON.stringify(g)})`); continue; }
      const year = Number(day.slice(0, 4));
      if (year !== seasonYear && year !== seasonYear + 1) problems.push(`${key}: game ${g.gameID} is outside season ${season}`);
      if (w >= targetWeek) problems.push(`${key}: game ${g.gameID} is week ${w}, at or after decision week ${targetWeek} (leakage)`);
      if (day > computedDay) problems.push(`${key}: game ${g.gameID} is dated after the snapshot was computed (${snapshot.computedAt}) — future-dated observation`);
      if (cutoffDay && day >= cutoffDay) problems.push(`${key}: game ${g.gameID} is on or after the decision cutoff (${decisionCutoff})`);
      weeks.add(w);
      if (!minDay || day < minDay) minDay = day;
      if (!maxDay || day > maxDay) maxDay = day;
    }
  }
  if (problems.length) return fail(`Temporal safety not established: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? `; and ${problems.length - 3} more` : ""}.`, { problems });
  if (!games) return fail("Snapshot contains no raw game observations; temporal safety cannot be established.");
  const observedWeeks = [...weeks].sort((a, b) => a - b);
  const declared = (Array.isArray(snapshot.weeksRequested) ? snapshot.weeksRequested : []).map(Number).filter(Number.isFinite);
  return {
    ok: true,
    observedWeeks,
    observedDateRange: { first: minDay, last: maxDay },
    rawGamesChecked: games,
    declaredWeeksRequested: declared,
    declaredMatchesObserved: declared.length === observedWeeks.length && declared.every((w, i) => w === observedWeeks[i])
  };
}

function fromSnapshot(snapshot, { season, week, key = "snapshot", store = "fixture", decisionCutoff = null } = {}) {
  const check = validateSnapshot(snapshot, { season, week, decisionCutoff });
  if (!check.ok) return { status: "REJECTED", reason: check.reason, provenance: { store, key }, records: {} };
  return {
    status: "AVAILABLE",
    provenance: {
      store, key,
      season: String(snapshot.season),
      computedAt: snapshot.computedAt,
      weeksIncluded: check.observedWeeks,
      observedDateRange: check.observedDateRange,
      rawGamesChecked: check.rawGamesChecked,
      temporalAuthority: "_rawGames[].week and gameID date",
      declaredWeeksRequested: check.declaredWeeksRequested,
      declaredMatchesObserved: check.declaredMatchesObserved,
      decisionCutoff: decisionCutoff || null
    },
    records: snapshot.records
  };
}

/**
 * Load the as-of-week window from the Blob store. Tries the exact pre-week
 * window key, then "latest"; each is accepted only if it passes the guard.
 * Never throws: failures return an explicit gap.
 */
async function loadObservedOpportunity({ season, week, store, decisionCutoff = null }) {
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
    const loaded = fromSnapshot(snapshot, { season, week, key, store: STORE_NAME, decisionCutoff });
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
