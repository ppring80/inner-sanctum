// netlify/functions/sage-recommend.js
//
// SAGE → DRAFT COMMAND CENTER V1 — production recommendation endpoint.
//
// Modeled directly on sage-pick-validation.js's proven pillar/synthesis
// wiring (getOpportunityRecord/getContextRecord/getProductionContextProfile/
// attachAdp/playerKey/normalizePlayerName below are the same logic, same
// shape, deliberately duplicated rather than imported -- sage-pick-
// validation.js is explicitly a TEMPORARY diagnostic endpoint per its own
// header, and this is a production one; keeping them independent means
// deleting the diagnostic later can never silently break this). Same
// established pattern already used between oauth-callback.js and
// verify-session.js elsewhere in this codebase.
//
// Reuses, completely unmodified:
//   draft-opportunity-profile.js
//   draft-market-profile.js
//   draft-scarcity-profile.js
//   draft-context-profile.js
//   draft-sage-synthesis.js
// and reads the real "opportunity-intel" / "context-intel" Blobs caches
// exactly as sage-pick-validation.js already does. No pillar calculation,
// no SAGE synthesis logic, and no Context evidence changed by this file.
//
// UNLIKE sage-pick-validation.js (GET, frozen hardcoded state), this is a
// POST endpoint that accepts REAL Draft Command Center context, since a
// live draft's candidate list/pick numbers can't fit cleanly in a query
// string and change every pick.
//
// ═══════════════════════════════════════════════════════════════════
// REQUEST  (POST, JSON body)
// ═══════════════════════════════════════════════════════════════════
//   {
//     candidates:   [{name, pos, adp}, ...]   REQUIRED. The bounded set
//                   (~20-30) of currently-available players to evaluate
//                   and rank. Draft Command Center is expected to send
//                   its own top-N-by-ADP slice, not the full pool.
//     currentPool:  [{name, pos, adp}, ...]   OPTIONAL. Defaults to
//                   `candidates` if omitted. Fed to Scarcity's
//                   "currentPool". As of the Aug 17 2026 correction,
//                   Draft Command Center sends the BROADER available-
//                   player population here, not the same bounded slice
//                   as `candidates` -- this endpoint's own interface
//                   never needed to change for that fix, since it
//                   already treated currentPool as independent input;
//                   only draft.html's request construction did.
//     nextTurnPool: [{name, pos, adp}, ...]   OPTIONAL. Defaults to [].
//                   Fed to Scarcity's "nextTurnPool". Draft Command
//                   Center is expected to derive this itself (players
//                   beyond however many picks happen before the user's
//                   next turn) -- this endpoint does not compute it.
//                   Also sent as the broader projected pool, not a
//                   bounded slice, as of the same correction.
//     currentPick:  number                    REQUIRED.
//     nextUserPick: number                    REQUIRED.
//     scoring:      string                    OPTIONAL. Accepted and
//                   echoed back in the response for forward
//                   compatibility, but NOT currently consumed by any
//                   pillar -- none of Market/Opportunity/Scarcity/
//                   Context/Synthesis read a scoring-format input today.
//                   Flagged explicitly rather than silently dropped.
//   }
//
// ═══════════════════════════════════════════════════════════════════
// RESPONSE (200)
// ═══════════════════════════════════════════════════════════════════
//   {
//     computedAt: ISO string,
//     candidateCount: number,        // how many candidates were evaluated
//     recommendations: [
//       {
//         player: {name, pos, team},   // team passed through if supplied
//         adp: number,
//         recommendation: "Take Now", // plain-language label, unmodified
//         code: "take-now",           // SAGE's own existing code, unmodified
//         explanation: "...",         // plain-language, unmodified
//         reasons: ["...", "..."]     // plain-language, unmodified, capped
//       },
//       ... up to 5, deterministic order (see ORDERING below)
//     ],
//     degraded: [ {name, pos, missing: ["opportunity"|"context", ...]} ]
//       // informational only -- which candidates were missing pillar
//       // data and therefore evaluated with a graceful null for that
//       // pillar, never exposed as raw profile objects.
//   }
//
// No raw opportunityProfile/marketProfile/scarcityProfile/contextProfile
// object is ever sent to the browser -- only the already-plain-language
// synthesis output plus player identity/ADP.
//
// ═══════════════════════════════════════════════════════════════════
// ORDERING -- NOT a new hidden numeric score. SAGE's own `code` values
// (from draft-sage-synthesis.js, unmodified, enumerated by direct
// inspection of the real file) are given a fixed ORDINAL rank -- a
// reviewable position in a list, not a computed number derived from any
// pillar's internals:
//   take-now > strong-consideration > consider-now > consider >
//   can-wait > flexible > caution > wait > pass-for-now >
//   needs-more-evidence
// This ordering reflects the codes' own plain-English meaning (SAGE
// already decided the category; this only decides how the ten existing
// categories are listed relative to each other). Within the same code,
// the tie-break is ascending ADP -- an existing, objective, already-
// present field, exactly as instructed.
// ═══════════════════════════════════════════════════════════════════

const { getStore, connectLambda } = require("@netlify/blobs");

const { buildDraftOpportunityProfile } = require("./draft-opportunity-profile");
const { buildDraftMarketProfile } = require("./draft-market-profile");
const { buildDraftScarcityProfile } = require("./draft-scarcity-profile");
const { buildRecommendation } = require("./draft-sage-synthesis");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

// Bound the candidate list server-side too, defense-in-depth against a
// caller sending more than intended -- Draft Command Center is expected
// to already send ~20-30, this just guarantees the endpoint itself
// never does unbounded pillar work regardless of what's sent.
const MAX_CANDIDATES = 40;
const MAX_RECOMMENDATIONS = 5;

// Fixed ordinal rank of SAGE's own existing recommendation codes -- see
// the ORDERING note above. Lower index = higher priority. Any code not
// in this list (should not happen given the real synthesis module, but
// handled defensively) sorts last, before nothing.
const CODE_RANK = [
  "take-now",
  "strong-consideration",
  "consider-now",
  "consider",
  "can-wait",
  "flexible",
  "caution",
  "wait",
  "pass-for-now",
  "needs-more-evidence"
];
function codeRank(code) {
  const idx = CODE_RANK.indexOf(code);
  return idx === -1 ? CODE_RANK.length : idx;
}

// ── Identical logic to sage-pick-validation.js's own helpers (see file
// header for why this is a deliberate duplicate, not an import). ──
// Aug 18 2026 fix (Ja'Marr Chase identity-normalization defect): the
// apostrophe class below is written with explicit \u escapes
// deliberately -- the original version, `[.''']`, LOOKED like it
// covered three different apostrophe styles but all three characters
// were actually the identical ASCII U+0027 typed three times (a real,
// confirmed defect, verified by direct Unicode codepoint inspection).
// Explicit escapes make each character unambiguous at a glance and
// prevent that exact mistake from silently recurring here again.
// Covers: U+0027 (ASCII apostrophe), U+2019 (right single quotation
// mark / the common "smart quote" a data source or CMS can produce),
// U+2018 (left single quotation mark, included for symmetry/safety).
function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.\u0027\u2018\u2019]/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function playerKey(player) {
  return normalizePlayerName(player.name) + "|" + String(player.pos || "").toUpperCase();
}

function getOpportunityRecord(cached, player) {
  const records = cached && cached.records ? cached.records : {};
  return records[playerKey(player)] || null;
}

function getContextRecord(cached, player) {
  const records = cached && cached.records ? cached.records : {};
  return records[playerKey(player)] || null;
}

function getProductionContextProfile(contextCache, player) {
  const record = getContextRecord(contextCache, player);
  if (!record || record.contextStatus !== "context-profiled") return null;
  return record.contextProfile || null;
}

function attachAdp(record, player) {
  if (!record) return null;
  return Object.assign({}, record, { adp: player.adp });
}

function buildOpportunityPool(opportunityCache, players) {
  return (players || [])
    .map(function (player) {
      const record = getOpportunityRecord(opportunityCache, player);
      if (!record) return null;
      return attachAdp(record, player);
    })
    .filter(Boolean);
}

function isValidPlayerShape(p) {
  return Boolean(p && typeof p === "object" && typeof p.name === "string" && p.name.trim().length > 0);
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ── One candidate, full SAGE read -- same wiring shape as
// sage-pick-validation.js's buildPlayerValidation(), adapted to accept
// real currentPick/nextUserPick instead of a frozen constant. ──
function evaluateCandidate(opportunityCache, contextCache, player, currentPool, nextTurnPool, currentPick, nextUserPick) {
  const rawRecord = getOpportunityRecord(opportunityCache, player);
  const contextProfile = getProductionContextProfile(contextCache, player);
  const missing = [];

  const marketProfile = buildDraftMarketProfile({
    adp: player.adp,
    currentPick: currentPick,
    nextUserPick: nextUserPick
  });

  if (!contextProfile) missing.push("context");

  if (!rawRecord) {
    missing.push("opportunity");
    const sage = buildRecommendation({
      opportunityProfile: null,
      marketProfile: marketProfile,
      scarcityProfile: null,
      contextProfile: contextProfile
    });
    return { player, adp: player.adp, sage, missing };
  }

  const record = attachAdp(rawRecord, player);
  const opportunityProfile = buildDraftOpportunityProfile(rawRecord);
  const scarcityProfile = buildDraftScarcityProfile({
    candidate: record,
    currentPool: currentPool,
    nextTurnPool: nextTurnPool
  });

  const sage = buildRecommendation({
    opportunityProfile: opportunityProfile,
    marketProfile: marketProfile,
    scarcityProfile: scarcityProfile,
    contextProfile: contextProfile
  });

  return { player, adp: player.adp, sage, missing };
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "POST only" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Invalid request body." });
  }

  const rawCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidates = rawCandidates.filter(isValidPlayerShape).slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    return jsonResponse(200, {
      computedAt: new Date().toISOString(),
      candidateCount: 0,
      recommendations: [],
      degraded: []
    });
  }

  const currentPoolInput = Array.isArray(payload.currentPool) && payload.currentPool.length > 0
    ? payload.currentPool.filter(isValidPlayerShape)
    : candidates;
  const nextTurnPoolInput = Array.isArray(payload.nextTurnPool)
    ? payload.nextTurnPool.filter(isValidPlayerShape)
    : [];

  const currentPick = payload.currentPick;
  const nextUserPick = payload.nextUserPick;

  try {
    const opportunityStore = getStore({ name: "opportunity-intel" });
    const contextStore = getStore({ name: "context-intel" });

    const [opportunityCache, contextCache] = await Promise.all([
      opportunityStore.get("latest", { type: "json" }).catch(() => null),
      contextStore.get("latest", { type: "json" }).catch(() => null)
    ]);

    // Build the pool objects ONCE, reused across every candidate's
    // Scarcity call -- same real opportunity records, not rebuilt per
    // candidate.
    const currentPool = buildOpportunityPool(opportunityCache, currentPoolInput);
    const nextTurnPool = buildOpportunityPool(opportunityCache, nextTurnPoolInput);

    const degraded = [];
    const evaluated = candidates.map(function (player) {
      const result = evaluateCandidate(
        opportunityCache,
        contextCache,
        player,
        currentPool,
        nextTurnPool,
        currentPick,
        nextUserPick
      );
      if (result.missing.length > 0) {
        degraded.push({ name: player.name, pos: player.pos, missing: result.missing });
      }
      return result;
    });

    evaluated.sort(function (a, b) {
      const rankDiff = codeRank(a.sage.code) - codeRank(b.sage.code);
      if (rankDiff !== 0) return rankDiff;
      const adpA = Number.isFinite(a.adp) ? a.adp : Infinity;
      const adpB = Number.isFinite(b.adp) ? b.adp : Infinity;
      return adpA - adpB;
    });

    const recommendations = evaluated.slice(0, MAX_RECOMMENDATIONS).map(function (e) {
      return {
        player: { name: e.player.name, pos: e.player.pos, team: e.player.team || null },
        adp: e.adp,
        recommendation: e.sage.recommendation,
        code: e.sage.code,
        explanation: e.sage.explanation,
        reasons: Array.isArray(e.sage.reasons) ? e.sage.reasons.slice(0, 2) : []
      };
    });

    return jsonResponse(200, {
      computedAt: new Date().toISOString(),
      candidateCount: candidates.length,
      recommendations: recommendations,
      degraded: degraded
    });
  } catch (err) {
    console.log("sage-recommend error:", err.message);
    return jsonResponse(500, { error: "SAGE recommendations temporarily unavailable." });
  }
};

// Exported for direct unit testing of the pure logic, independent of the
// live Blobs caches.
module.exports._test = {
  normalizePlayerName,
  playerKey,
  getOpportunityRecord,
  getContextRecord,
  getProductionContextProfile,
  attachAdp,
  buildOpportunityPool,
  evaluateCandidate,
  codeRank,
  CODE_RANK,
  isValidPlayerShape
};
