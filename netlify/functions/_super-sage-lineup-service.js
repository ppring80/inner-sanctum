"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — SHARED LINEUP SERVICE (one Columbia, one decision authority)
// ═══════════════════════════════════════════════════════════════════════
//
// Every Start/Sit consumer (ChatGPT MCP get_lineup_recommendation, the
// website's connected/manual lineup) calls decideSharedLineup(). It:
//   1. resolves roster identity with the shared matcher
//      (_super-sage-roster-identity.js) and provider-aware roster statuses;
//   2. derives real kickoff cutoffs from the cached Weekly SAGE schedule
//      (_super-sage-kickoff.js);
//   3. loads observed opportunity through the shared temporal guard
//      (_super-sage-opportunity-evidence.js) with the real week cutoff;
//   4. hands everything to the frozen decision authority
//      (_super-sage-lineup-decision.js) and returns its record UNCHANGED.
//
// Consumers present the record. They never reorder, re-rank, recompute
// confidence, re-run FLEX logic, reinterpret baseline validity, add injury
// adjustments, or infer expected opportunity.
//
// Degradation is explicit: every tributary reports AVAILABLE / DEGRADED /
// UNAVAILABLE with its effect. Weekly SAGE unavailable means NO decision.
// No ledger write happens on this path, so a ledger failure can never block a
// customer decision.
// ═══════════════════════════════════════════════════════════════════════

const { buildLineupDecisionRecord } = require("./_super-sage-lineup-decision.js");
const { matchRoster, canonicalRosterStatus } = require("./_super-sage-roster-identity.js");
const { buildKickoffIndex, decisionCutoff, teamKickoffState } = require("./_super-sage-kickoff.js");
const { loadObservedOpportunity } = require("./_super-sage-opportunity-evidence.js");
const { buildLiveShadowComparison } = require("./_super-sage-live-shadow.js");

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const SERVICE_VERSION = 1;

function flattenRows(rankings) {
  const rows = [];
  POSITIONS.forEach((pos) => (rankings.positions[pos] || []).forEach((row) => rows.push({ ...row, position: String(row.position || pos).toUpperCase() })));
  return rows;
}

function tributary(status, detail, effect = null) { return { status, detail, effect }; }

function weeklySageStatus(rankings, rankingsError) {
  if (!rankings || !rankings.positions || typeof rankings.positions !== "object") {
    return tributary("UNAVAILABLE", rankingsError || "Weekly SAGE rankings were not available.", "No lineup decision is produced without Weekly SAGE.");
  }
  const failed = (rankings.metadata && rankings.metadata.positionsFailed) || [];
  return failed.length
    ? tributary("DEGRADED", `Weekly SAGE positions unavailable: ${failed.join(", ")}.`, "Players at those positions have no Weekly SAGE standing; SAGE makes no call between them rather than guessing.")
    : tributary("AVAILABLE", `Weekly SAGE generated ${rankings.generatedAt || "unknown time"}.`);
}

function projectionStatus(rankings) {
  const p = rankings.metadata && rankings.metadata.projections;
  if (!p || p.available === false) return tributary("UNAVAILABLE", "No sourced projections in this Weekly SAGE response.", "No comparison can be resolved by projection; projection-contradiction checks cannot fire.");
  if (p.fresh === false) return tributary("DEGRADED", `Projections are stale (${p.updatedAt || "unknown"}).`, "Stale projections are inadmissible as decision evidence.");
  return tributary("AVAILABLE", `${p.source || "Projection"} updated ${p.updatedAt || "unknown"}.`);
}

function availabilityStatus(rankings) {
  const a = rankings.metadata && rankings.metadata.availability;
  if (!a || a.available === false) return tributary("UNAVAILABLE", "Injury/status feed unavailable.", "Availability is treated as UNVERIFIED for every player (baseline REASSESS), never as healthy.");
  if (a.fresh === false) return tributary("DEGRADED", `Injury/status feed is stale (${a.updatedAt || "unknown"}).`, "Stale statuses can only prompt reassessment, never confirm availability.");
  return tributary("AVAILABLE", `${a.source || "Availability"} updated ${a.updatedAt || "unknown"}.`);
}

/**
 * @param rankings        Weekly SAGE rankings response (or null)
 * @param rankingsError   message when rankings could not be fetched
 * @param roster          [{ name, eligiblePositions[], team?, sageCompatibleId?, rosterStatus? }]
 * @param provider        roster provider (cbs/espn/yahoo/sleeper/...)
 * @param slots           [{ slotLabel, eligiblePositions[], count }]
 * @param schedule        cached Weekly SAGE schedule document (or null)
 * @param scheduleError   message when the schedule could not be read
 * @param opportunityStore Blobs store for "opportunity-intel" (or null)
 * @param now             Date (defaults to now)
 */
async function decideSharedLineup({ rankings = null, rankingsError = null, roster = [], provider = null, slots = [], season, week, scoring,
  schedule = null, scheduleError = null, opportunityStore = null, now = new Date(), shadowRecord = null, shadowCaseLabel = null } = {}) {
  const evidenceStatus = { weeklySage: weeklySageStatus(rankings, rankingsError) };
  if (evidenceStatus.weeklySage.status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", reason: "WEEKLY_SAGE_UNAVAILABLE", record: null, evidenceStatus, serviceVersion: SERVICE_VERSION };
  }
  if (!Array.isArray(slots) || !slots.length) {
    return { status: "UNAVAILABLE", reason: "LINEUP_REQUIREMENTS_UNAVAILABLE", record: null, evidenceStatus, serviceVersion: SERVICE_VERSION };
  }
  evidenceStatus.projections = projectionStatus(rankings);
  evidenceStatus.availability = availabilityStatus(rankings);

  // Real kickoffs.
  const index = buildKickoffIndex(schedule, { season, week });
  const weekCutoff = decisionCutoff(index);
  evidenceStatus.schedule = !index.ok
    ? tributary("UNAVAILABLE", scheduleError || index.reason, "No real kickoff cutoff: observed opportunity is still admitted only if every raw game is from an earlier week and not future-dated; per-team kickoff checks cannot run.")
    : weekCutoff.ok
      ? tributary("AVAILABLE", `First kickoff ${weekCutoff.cutoff} (${index.source.store} ${index.source.season} week ${index.source.week}).`)
      : tributary("DEGRADED", weekCutoff.reason, "The week's first kickoff is not established; affected teams' players are treated as availability-unverified.");

  // Identity (shared matcher) with provider-aware canonical statuses.
  const normalizedRoster = (roster || []).map((e) => ({ ...e, rosterStatus: canonicalRosterStatus(e.rosterStatus, provider) }));
  const matchedRoster = matchRoster(normalizedRoster, flattenRows(rankings));

  // Schedule-derived status evidence: never neutral.
  const statusUpdates = [];
  if (index.ok) {
    matchedRoster.matched.forEach(({ row }) => {
      const team = row.position === "DEF" ? (row.team || row.name) : row.team;
      const k = teamKickoffState(index, team, now);
      if (k.state === "KICKED_OFF") statusUpdates.push({ name: row.name, position: row.position, status: "INACTIVE", family: "schedule", source: `Schedule: ${k.gameID} kicked off ${k.kickoff} (lineup locked)`, asOf: k.kickoff });
      if (k.state === "UNKNOWN") statusUpdates.push({ name: row.name, position: row.position, status: "UNVERIFIED", family: "schedule", source: `Schedule: kickoff not established (${k.reason || "unknown"})`, asOf: null });
    });
  }

  // Observed opportunity through the shared temporal guard.
  const opportunity = opportunityStore
    ? await loadObservedOpportunity({ season, week, store: opportunityStore, decisionCutoff: weekCutoff.ok ? weekCutoff.cutoff : null })
    : { status: "UNAVAILABLE", reason: "No opportunity store provided.", provenance: null, records: {} };
  evidenceStatus.opportunity = opportunity.status === "AVAILABLE"
    ? tributary("AVAILABLE", `Observed weeks ${(opportunity.provenance.weeksIncluded || []).join(", ")} (computed ${opportunity.provenance.computedAt}).`)
    : tributary("UNAVAILABLE", opportunity.reason || opportunity.status, "No established-role evidence: cross-position comparisons are SURPRISING (established-role evidence incomplete), never neutral.");

  // When the service finds the injury/status feed unavailable (absent or
  // explicitly unavailable), the authority is told so explicitly; it then
  // treats availability as UNVERIFIED rather than as healthy. Player evidence
  // itself is not modified.
  const meta = rankings.metadata || {};
  const authorityRankings = evidenceStatus.availability.status === "UNAVAILABLE" && !(meta.availability && meta.availability.available === false)
    ? { ...rankings, metadata: { ...meta, availability: { ...(meta.availability || {}), available: false } } }
    : rankings;

  const record = buildLineupDecisionRecord({
    rankings: authorityRankings, slots, scoring, season, week, opportunity, statusUpdates, matchedRoster
  });
  // Observational only: production authority has already completed above.
  const shadowComparison = shadowRecord ? buildLiveShadowComparison({
    season, week, scoring, productionRecord: record, shadowRecord,
    decisionAt: now.toISOString(), caseLabel: shadowCaseLabel || null
  }) : null;
  return {
    status: "DECIDED",
    record,
    evidenceStatus,
    kickoff: index.ok ? { weekFirstKickoff: weekCutoff.ok ? weekCutoff.cutoff : null, source: index.source, unknownGames: index.unknownGames.map((g) => g.gameID) } : null,
    serviceVersion: SERVICE_VERSION,
    shadowComparison
  };
}

module.exports = { decideSharedLineup, SERVICE_VERSION };
