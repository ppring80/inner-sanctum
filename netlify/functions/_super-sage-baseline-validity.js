"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — BASELINE VALIDITY
// ═══════════════════════════════════════════════════════════════════════
//
// A Weekly SAGE rank is a PRIOR. This stage decides whether fresh, verified
// current-state evidence still lets that prior govern a decision. It never
// modifies a rank or score and never applies a numeric penalty.
//
//   UNAVAILABLE  fresh verified OUT-class status            -> REMOVED
//   INVALID      two independent fresh sources agree the    -> SUSPENDED
//                player will contribute little or nothing
//                (OUT-leaning status + near-zero projection)
//   REASSESS     any single material current-state item     -> GOVERNS WITHOUT
//                                                              BENEFIT OF DOUBT
//   VALID        no contradicting current evidence          -> GOVERNS
//
// Status precedence: within one source family the NEWEST report wins (so an
// upgrade is honoured); across families the MOST SEVERE fresh status wins and
// the disagreement is recorded as a conflict. Stale evidence can only trigger
// REASSESS. Missing evidence never triggers anything.
// ═══════════════════════════════════════════════════════════════════════

const { isNearZeroProjection } = require("./_super-sage-decision-policy.js");

const STATES = Object.freeze({ VALID: "VALID", REASSESS: "REASSESS", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" });
const AUTHORITY = Object.freeze({
  VALID: "GOVERNS",
  REASSESS: "GOVERNS_WITHOUT_BENEFIT_OF_DOUBT",
  INVALID: "SUSPENDED",
  UNAVAILABLE: "REMOVED"
});

const STATUS_CLASS = [
  ["UNAVAILABLE", ["IR", "OUT", "O", "SUSP", "SUSPENDED", "NFI", "PUP", "INACTIVE", "RESERVE", "NA"]],
  ["DOUBTFUL", ["D", "DOUBTFUL"]],
  ["QUESTIONABLE", ["Q", "QUESTIONABLE", "GTD"]],
  ["UNVERIFIED", ["UNVERIFIED"]],
  ["ACTIVE", ["ACTIVE", "HEALTHY", "A"]]
];
const SEVERITY = { UNAVAILABLE: 4, DOUBTFUL: 3, QUESTIONABLE: 2, UNVERIFIED: 1, ACTIVE: 0 };

function classifyStatus(raw) {
  const value = String(raw == null ? "" : raw).trim().toUpperCase();
  if (!value) return null;
  const hit = STATUS_CLASS.find(([, list]) => list.includes(value));
  return hit ? hit[0] : null;
}

const time = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : -Infinity; };

/**
 * Resolve the effective availability status from status evidence items:
 *   { family, source, status, asOf, fresh }
 */
function resolveStatus(items) {
  const usable = (items || []).map((i) => ({ ...i, statusClass: classifyStatus(i.status) })).filter((i) => i.statusClass);
  const byFamily = new Map();
  usable.forEach((item) => {
    const current = byFamily.get(item.family);
    const newer = !current || time(item.asOf) > time(current.asOf)
      || (time(item.asOf) === time(current.asOf) && SEVERITY[item.statusClass] > SEVERITY[current.statusClass]);
    if (newer) byFamily.set(item.family, item);
  });
  const latest = Array.from(byFamily.values());
  const fresh = latest.filter((i) => i.fresh !== false);
  const stale = latest.filter((i) => i.fresh === false);
  const effective = fresh.slice().sort((a, b) => SEVERITY[b.statusClass] - SEVERITY[a.statusClass] || a.family.localeCompare(b.family))[0] || null;
  const distinct = new Set(fresh.map((i) => i.statusClass));
  const conflict = distinct.size > 1 ? fresh.map((i) => ({ family: i.family, source: i.source, status: i.statusClass, asOf: i.asOf || null })) : null;
  const staleMoreSevere = stale.filter((i) => SEVERITY[i.statusClass] > (effective ? SEVERITY[effective.statusClass] : -1));
  return { effective, conflict, staleMoreSevere, families: latest };
}

/**
 * Assess one candidate's baseline.
 * @param {object} input
 *   statusEvidence  status evidence items (see resolveStatus)
 *   stateChanges    verified state changes from the evidence packet
 *   projection      projection evidence (admissible/points/fresh/source)
 *   standing        position-calibrated standing (tier/positionRank) or null
 *   position        player position
 *   tierMedians     { [tier]: median fresh projection } for this position
 *   policy          frozen decision policy
 */
function assessBaselineValidity({ statusEvidence, stateChanges = [], projection = {}, standing = null, position, tierMedians = {}, policy } = {}) {
  const triggers = [];
  const { effective, conflict, staleMoreSevere } = resolveStatus(statusEvidence);
  const effectiveClass = effective ? effective.statusClass : null;
  const freshProjection = projection && projection.admissible && projection.fresh === true;

  if (effectiveClass === "UNAVAILABLE") {
    triggers.push({ code: "STATUS_UNAVAILABLE", family: effective.family, detail: `${effective.source} lists ${effective.status}.`, asOf: effective.asOf || null });
    return result(STATES.UNAVAILABLE, triggers, conflict, effective);
  }

  // INVALID: corroboration of two independent fresh source families.
  const tierMedian = standing && Number.isFinite(tierMedians[standing.tier]) ? tierMedians[standing.tier] : null;
  if (effectiveClass === "DOUBTFUL" && freshProjection && isNearZeroProjection(policy, projection.points, tierMedian)) {
    triggers.push({ code: "STATUS_DOUBTFUL", family: effective.family, detail: `${effective.source} lists ${effective.status}.`, asOf: effective.asOf || null });
    triggers.push({ code: "NEAR_ZERO_PROJECTION", family: `projection:${projection.source}`,
      detail: `Fresh ${projection.source} projection is ${projection.points} (near-zero under the ${nearZeroRuleLabel(policy)} rule).`, asOf: projection.updatedAt || null });
    if (conflict) triggers.push({ code: "SOURCE_CONFLICT", family: "availability", detail: conflictText(conflict) });
    return result(STATES.INVALID, triggers, conflict, effective);
  }

  // REASSESS: any single material current-state item.
  if (effectiveClass === "DOUBTFUL") triggers.push({ code: "STATUS_DOUBTFUL", family: effective.family, detail: `${effective.source} lists ${effective.status}.`, asOf: effective.asOf || null });
  if (effectiveClass === "QUESTIONABLE") triggers.push({ code: "STATUS_QUESTIONABLE", family: effective.family, detail: `${effective.source} lists ${effective.status}.`, asOf: effective.asOf || null });
  if (effectiveClass === "UNVERIFIED") triggers.push({ code: "AVAILABILITY_UNVERIFIED", family: effective.family, detail: `${effective.source}: availability is not verified.`, asOf: effective.asOf || null });
  staleMoreSevere.forEach((s) => triggers.push({ code: "STALE_STATUS", family: s.family, detail: `Stale ${s.source} report lists ${s.status}; it cannot invalidate, only prompt reassessment.`, asOf: s.asOf || null }));
  if (conflict) triggers.push({ code: "SOURCE_CONFLICT", family: "availability", detail: conflictText(conflict) });
  stateChanges.filter((c) => c.type === "QB_AVAILABILITY_CHANGE").forEach((c) => triggers.push({ code: "QB_ENVIRONMENT_CHANGE", family: "environment", detail: c.note || "Verified quarterback availability change." }));
  stateChanges.filter((c) => c.type === "ROLE_CHANGE").forEach((c) => triggers.push({ code: "ROLE_CHANGE", family: "role",
    detail: c.redistributionVerified ? "Verified role change (redistribution verified)." : "Verified role change; redistribution not verified." }));

  // A fresh projection below the median of the next-lower tier at the same
  // position contradicts the standing (no constant: medians come from the
  // same rankings response).
  if (freshProjection && standing) {
    const lowerTier = { START: "FLEX", FLEX: "SIT" }[standing.tier];
    const lowerMedian = lowerTier ? tierMedians[lowerTier] : null;
    if (Number.isFinite(lowerMedian) && projection.points < lowerMedian) {
      triggers.push({ code: "PROJECTION_CONTRADICTS_STANDING", family: `projection:${projection.source}`,
        detail: `Fresh ${projection.source} projection ${projection.points} is below the ${position} ${lowerTier}-tier median (${round1(lowerMedian)}).`, asOf: projection.updatedAt || null });
    }
  }

  return result(triggers.length ? STATES.REASSESS : STATES.VALID, triggers, conflict, effective);
}

function result(state, triggers, conflict, effective) {
  return {
    state,
    authority: AUTHORITY[state],
    triggers,
    conflict: conflict || null,
    effectiveStatus: effective ? { status: effective.statusClass, reported: effective.status, family: effective.family, source: effective.source, asOf: effective.asOf || null } : null
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const nearZeroRuleLabel = (policy) => (policy && policy.nearZeroProjection && policy.nearZeroProjection.status === "CALIBRATED" ? "calibrated" : "uncalibrated exact-zero");
const conflictText = (conflict) => `Sources disagree: ${conflict.map((c) => `${c.source} ${c.status}`).join(" vs ")}; the most severe fresh status applies.`;

/** Median fresh, admissible projection per tier for every position. */
function tierProjectionMedians(rankings, request) {
  const out = {};
  Object.entries((rankings && rankings.positions) || {}).forEach(([position, rows]) => {
    const byTier = {};
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const tier = String(row && row.recommendation || "").toUpperCase();
      const p = row && row.projection;
      const points = Number(row && row.projectedPoints);
      if (!["START", "FLEX", "SIT"].includes(tier) || !p || !p.source || p.fresh !== true || !Number.isFinite(points)) return;
      if (request && request.scoring && p.scoring && String(p.scoring).toLowerCase() !== String(request.scoring).toLowerCase()) return;
      (byTier[tier] = byTier[tier] || []).push(points);
    });
    out[String(position).toUpperCase()] = Object.fromEntries(Object.entries(byTier).map(([tier, values]) => {
      const s = values.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return [tier, s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2];
    }));
  });
  return out;
}

module.exports = { STATES, AUTHORITY, assessBaselineValidity, resolveStatus, classifyStatus, tierProjectionMedians, SEVERITY };
