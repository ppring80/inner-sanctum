"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — PREGAME EVIDENCE LEDGER
// ═══════════════════════════════════════════════════════════════════════
//
// Purpose: from now on, accumulate temporally valid PREGAME evidence so the
// projection-noise band (and every other policy) can later be calibrated by
// backtest without leakage. This module does NOT calibrate anything.
//
// An entry is an immutable as-of snapshot of what Super SAGE could know before
// kickoff: season/week/scoring, every ranked player's Tank01 projection with
// its source timestamp, Weekly SAGE rank/tier/confidence, availability and
// injury state, material state changes, the observed-opportunity provenance
// (with the weeks actually observed), the promoted forward signals, and any
// Super SAGE decision fingerprints — plus the generation time.
//
// Rules:
//   * entries are append-only: the writer uses a conditional create
//     (onlyIfNew) and never overwrites an existing key;
//   * an entry is refused if generated at or after the stated first kickoff;
//   * an entry carries a content hash; outcomes are NEVER written here
//     (outcomes join later, by key, in a separate store/process).
//
// NOT WIRED: no scheduled function or production consumer imports this yet.
// ═══════════════════════════════════════════════════════════════════════

const crypto = require("crypto");
const { SIGNALS } = require("./_super-sage-signal-registry.js");

const LEDGER_SCHEMA_VERSION = 1;
const LEDGER_STORE_NAME = "super-sage-pregame-ledger";
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
  }
  return value;
}
const sha256 = (v) => crypto.createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const orNull = (v) => (v === undefined ? null : v);

function playerEntry(row, position, lineupEligible) {
  const sage = row.sage || {};
  const p = row.projection && typeof row.projection === "object" ? row.projection : null;
  const stateChanges = [row.roleContext, row.environmentContext, row.teamContext]
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ type: orNull(c.type) || (c === row.roleContext ? "ROLE_CHANGE" : null), status: orNull(c.status), note: orNull(c.note),
      projectionRecalculated: orNull(c.projectionRecalculated), rankRecalculated: orNull(c.rankRecalculated) }));
  return {
    playerID: orNull(row.playerID), name: orNull(row.name), team: orNull(row.team || row.currentTeam), position,
    opponent: orNull(row.opponent), gameID: orNull(row.gameID), gameDate: orNull(row.gameDate), gameTime: orNull(row.gameTime),
    lineupEligible,
    weeklySage: {
      rank: orNull(row.rank), recommendation: orNull(row.recommendation),
      confidenceLabel: orNull(row.sageConfidenceLabel || sage.confidenceLabel),
      rankingScore: orNull(row.rankingScore != null ? row.rankingScore : sage.rankingScore)
    },
    projection: p ? { points: orNull(p.points), source: orNull(p.source), updatedAt: orNull(p.updatedAt), scoring: orNull(p.scoring),
      week: orNull(p.week), fresh: orNull(p.fresh) } : null,
    availability: { status: orNull(row.status), injuryStatus: orNull(row.injuryStatus), availabilityVerified: orNull(row.availabilityVerified),
      source: orNull(row.availabilitySource || row.source), description: orNull(row.injuryDescription || row.reason) },
    stateChanges
  };
}

/**
 * Build one immutable pregame ledger entry.
 * Required: rankings (a Weekly SAGE rankings response), generatedAt (ISO).
 * Optional: firstKickoff (ISO) — the entry is refused if generatedAt is not
 * strictly before it; opportunity (fromSnapshot/loadObservedOpportunity result);
 * decisionRecords (Super SAGE records); registry.
 */
function buildPregameLedgerEntry({ rankings, generatedAt, firstKickoff = null, opportunity = null, decisionRecords = [], registry = SIGNALS } = {}) {
  if (!rankings || !rankings.positions) throw new Error("Pregame ledger entry requires a Weekly SAGE rankings response.");
  const at = Date.parse(generatedAt);
  if (!Number.isFinite(at)) throw new Error("Pregame ledger entry requires a valid generatedAt timestamp.");
  if (firstKickoff != null) {
    const kickoff = Date.parse(firstKickoff);
    if (!Number.isFinite(kickoff)) throw new Error("firstKickoff is unparsable.");
    if (at >= kickoff) throw new Error(`Refused: generatedAt ${generatedAt} is not before the first kickoff ${firstKickoff}; this would not be pregame evidence.`);
  }
  const players = [];
  POSITIONS.forEach((pos) => {
    (rankings.positions[pos] || []).forEach((row) => players.push(playerEntry(row, pos, true)));
    ((rankings.inactive && rankings.inactive[pos]) || []).forEach((row) => players.push(playerEntry(row, pos, false)));
  });
  const promoted = Object.entries(registry).filter(([, s]) => s.status === "promoted").map(([id, s]) => ({ id, positions: s.positions || [] }));
  const meta = rankings.metadata || {};
  const body = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    evidenceType: "super-sage-pregame-ledger",
    season: String(rankings.season), week: Number(rankings.targetWeek), seasonType: orNull(rankings.seasonType), scoring: String(rankings.scoring),
    generatedAt: new Date(at).toISOString(),
    firstKickoff: firstKickoff ? new Date(Date.parse(firstKickoff)).toISOString() : null,
    pregameVerified: firstKickoff != null,
    sources: {
      rankingsGeneratedAt: orNull(rankings.generatedAt),
      rankingsComplete: orNull(meta.complete),
      projections: meta.projections ? { source: orNull(meta.projections.source), updatedAt: orNull(meta.projections.updatedAt), fresh: orNull(meta.projections.fresh),
        matched: orNull(meta.projections.matched), missing: orNull(meta.projections.missing) } : null,
      availability: meta.availability ? { source: orNull(meta.availability.source), updatedAt: orNull(meta.availability.updatedAt), fresh: orNull(meta.availability.fresh) } : null,
      gameEligibility: meta.gameEligibility ? { rule: orNull(meta.gameEligibility.rule), exclusionsApplied: orNull(meta.gameEligibility.exclusionsApplied) } : null,
      observedOpportunity: opportunity ? { status: orNull(opportunity.status), reason: orNull(opportunity.reason), provenance: orNull(opportunity.provenance) } : null
    },
    promotedForwardSignals: promoted,
    decisions: (decisionRecords || []).map((r) => ({
      decisionId: orNull(r.decisionId), schemaVersion: orNull(r.schemaVersion), decisionScope: orNull(r.decisionScope),
      slots: (r.slots || []).map((s) => ({ slotLabel: s.slotLabel, starter: s.starter ? s.starter.name : null, comparator: s.comparator ? s.comparator.name : null,
        decidedBy: s.decidedBy, decisionState: orNull(s.decisionState), confidence: s.confidence ? s.confidence.label : null,
        resolution: s.gate ? orNull(s.gate.resolution) : null }))
    })),
    players
  };
  return { ...body, contentHash: sha256(body) };
}

function verifyLedgerEntry(entry) {
  if (!entry || entry.evidenceType !== "super-sage-pregame-ledger") return false;
  const { contentHash, ...body } = entry;
  return contentHash === sha256(body);
}

// Keys sort chronologically and never collide for distinct content.
function ledgerKey(entry) {
  return `pregame/${entry.season}/w${String(entry.week).padStart(2, "0")}/${entry.scoring}/${entry.generatedAt}-${entry.contentHash.slice(0, 12)}`;
}

/** Append one entry. Never overwrites: an existing key is reported, not replaced. */
async function writePregameLedgerEntry(store, entry) {
  if (!store || typeof store.setJSON !== "function") throw new Error("A Blobs store with setJSON is required.");
  if (!verifyLedgerEntry(entry)) throw new Error("Refused: ledger entry content hash does not verify.");
  const key = ledgerKey(entry);
  const result = await store.setJSON(key, entry, { onlyIfNew: true });
  return result && result.modified === false
    ? { written: false, key, reason: "An entry already exists at this key; ledger entries are never overwritten." }
    : { written: true, key };
}

module.exports = { LEDGER_SCHEMA_VERSION, LEDGER_STORE_NAME, buildPregameLedgerEntry, verifyLedgerEntry, ledgerKey, writePregameLedgerEntry };
