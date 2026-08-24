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
//
//     currentPool:  [{name, pos, adp}, ...]   OPTIONAL. Defaults to
//                   `candidates` if omitted. Fed to Scarcity's
//                   "currentPool". As of the Aug 17 2026 correction,
//                   Draft Command Center sends the BROADER available-
//                   player population here, not the same bounded slice
//                   as `candidates`.
//
//     nextTurnPool: [{name, pos, adp}, ...]   OPTIONAL. Defaults to [].
//                   Fed to Scarcity's "nextTurnPool".
//
//     currentPick:  number                    REQUIRED.
//
//     nextUserPick: number                    REQUIRED.
//
//     scoring:      string                    OPTIONAL. The scoring string
//                   itself is not consumed directly by the existing SAGE
//                   pillars. HOWEVER, Draft Command Center loads Tank01
//                   ADP using this scoring format before constructing the
//                   candidate/current/next-turn pools. Therefore each
//                   player's `adp` arriving here is already specific to
//                   Standard, Half-PPR, or PPR.
//
//                   Aug 18 2026 draft-readiness correction:
//                   recommendation SEQUENCE now preserves that scoring-
//                   specific market signal by sorting primarily on ADP.
//                   SAGE still evaluates every player and supplies the
//                   recommendation/action/explanation; its categorical
//                   code is used only as a secondary tie-break.
//
//     rosterContext: object                   OPTIONAL. Draft Command
//                   Center's computeRosterNeed() output (configured
//                   starting requirements, filled counts, remaining
//                   dedicated/flex slots). Phase 1 (this addition) never
//                   uses this to change ranking, code, or explanation --
//                   it is read ONLY to decide whether to append an
//                   additive, separate `rosterContextNote` to a
//                   recommendation (see RESPONSE below). If omitted,
//                   malformed, or inconclusive, behavior is byte-
//                   identical to before this field existed.
//   }
//
// ═══════════════════════════════════════════════════════════════════
// RESPONSE (200)
// ═══════════════════════════════════════════════════════════════════
//   {
//     computedAt: ISO string,
//     candidateCount: number,
//     recommendations: [
//       {
//         player: {name, pos, team},
//         adp: number,
//         recommendation: "Take Now",
//         code: "take-now",
//         explanation: "...",
//         reasons: ["...", "..."],
//         rosterContextNote: "..." | null
//       },
//       ... up to 5
//     ],
//     degraded: [ {name, pos, missing: ["opportunity"|"context", ...]} ]
//   }
//
// rosterContextNote (Phase 1 addition) is a SEPARATE, purely additive
// field -- never merged into `reasons`, never allowed to influence
// `code`/`explanation`/order. It is null unless: the recommended
// player's position has zero remaining dedicated starting slots per
// rosterContext, AND at least one other position still has an unmet
// dedicated slot, AND a real evaluated candidate at that other position
// exists in this same request's candidate pool. When present, its text
// identifies that real candidate by name only -- it never quotes SAGE's
// internal recommendation label for them (model-internals leakage), and
// never explains why the recommended player was chosen over them (the
// actual sort is ADP-primary, not a head-to-head value comparison
// between the two, so any such explanation would misdescribe what
// happened). No invented claim about draft-pool depth, and never framed
// as something SAGE "already factored into" the ranking above.
//
// No raw opportunityProfile/marketProfile/scarcityProfile/contextProfile
// object is ever sent to the browser -- only the already-plain-language
// synthesis output plus player identity/ADP.
//
// ═══════════════════════════════════════════════════════════════════
// ORDERING — AUG 18 2026 DRAFT-READINESS CORRECTION
// ═══════════════════════════════════════════════════════════════════
//
// PRIMARY ORDER:
//   scoring-specific ADP, ascending.
//
// WHY:
// Draft Command Center already requests a distinct Tank01 ADP feed for
// Standard, Half-PPR, or PPR. Live validation confirmed those feeds move
// players materially across formats. ADP is therefore our strongest
// currently-available objective signal of how the selected league scoring
// format changes relative player value.
//
// PREVIOUS BEHAVIOR:
// SAGE recommendation code had absolute ordering priority:
//
//   take-now > strong-consideration > consider-now > consider >
//   can-wait > flexible > caution > wait > pass-for-now >
//   needs-more-evidence
//
// ADP was used only when two players had the exact same SAGE code.
//
// That categorical compression could erase meaningful scoring-format
// movement. A player with much stronger format-specific ADP could be
// listed below a much later-market player solely because one was labeled
// "Strong Consideration" and the other "Take Now."
//
// CURRENT BEHAVIOR:
//   1. scoring-specific ADP
//   2. SAGE recommendation code, only when ADP is exactly equal
//   3. normalized player name, only for deterministic final stability
//
// SAGE IS NOT REMOVED:
// Every player is still evaluated through Opportunity + Market + Scarcity
// + Context + Synthesis. SAGE still determines the recommendation label,
// explanation and reasons shown to the consumer. This change affects only
// which evaluated players are presented first.
//
// This is deliberately the conservative draft-readiness behavior.
// A future hybrid model may allow SAGE evidence to move players around
// scoring-specific ADP within objectively validated boundaries, but no
// arbitrary numeric weighting is introduced here.
// ═══════════════════════════════════════════════════════════════════

const {
  getStore,
  connectLambda
} = require("@netlify/blobs");

const {
  buildDraftOpportunityProfile
} = require("./draft-opportunity-profile");

const {
  buildDraftMarketProfile,
  normalizeAdpToPick
} = require("./draft-market-profile");

const {
  buildDraftScarcityProfile
} = require("./draft-scarcity-profile");

const {
  buildRecommendation
} = require("./draft-sage-synthesis");

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

// SAGE's existing recommendation-code ordering remains useful as a
// SECONDARY tie-break when two candidates have exactly the same ADP.
// Lower index = stronger action language.
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
  const idx =
    CODE_RANK.indexOf(code);

  return idx === -1
    ? CODE_RANK.length
    : idx;
}

// ── Identical logic to sage-pick-validation.js's own helpers ─────────
//
// Aug 18 2026 fix (Ja'Marr Chase identity-normalization defect):
// explicit Unicode escapes cover ASCII apostrophe plus common smart
// apostrophe characters.

function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(
      /[.\u0027\u2018\u2019]/g,
      ""
    )
    .replace(
      /-/g,
      " "
    )
    .replace(
      /\b(jr|sr|ii|iii|iv)\b/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function playerKey(player) {
  return (
    normalizePlayerName(
      player.name
    ) +
    "|" +
    String(
      player.pos || ""
    ).toUpperCase()
  );
}

function getOpportunityRecord(
  cached,
  player
) {
  const records =
    cached &&
    cached.records
      ? cached.records
      : {};

  return (
    records[
      playerKey(player)
    ] ||
    null
  );
}

function getContextRecord(
  cached,
  player
) {
  const records =
    cached &&
    cached.records
      ? cached.records
      : {};

  return (
    records[
      playerKey(player)
    ] ||
    null
  );
}

function getProductionContextProfile(
  contextCache,
  player
) {
  const record =
    getContextRecord(
      contextCache,
      player
    );

  if (
    !record ||
    record.contextStatus !==
      "context-profiled"
  ) {
    return null;
  }

  return (
    record.contextProfile ||
    null
  );
}

function attachAdp(
  record,
  player
) {
  if (!record) {
    return null;
  }

  return Object.assign(
    {},
    record,
    {
      adp:
        player.adp
    }
  );
}

function buildOpportunityPool(
  opportunityCache,
  players
) {
  return (
    players ||
    []
  )
    .map(
      function (player) {
        const record =
          getOpportunityRecord(
            opportunityCache,
            player
          );

        if (!record) {
          return null;
        }

        return attachAdp(
          record,
          player
        );
      }
    )
    .filter(Boolean);
}

function isValidPlayerShape(p) {
  return Boolean(
    p &&
    typeof p === "object" &&
    typeof p.name ===
      "string" &&
    p.name.trim().length >
      0
  );
}

function jsonResponse(
  statusCode,
  body
) {
  return {
    statusCode,
    headers:
      CORS_HEADERS,
    body:
      JSON.stringify(
        body
      )
  };
}

// ── Deterministic recommendation ordering ─────────────────────────────
//
// Primary:
//   normalized market pick (nearest actual draft slot).
//
// Secondary:
//   SAGE category when players occupy the same market slot.
//
// Tertiary:
//   raw format-specific ADP when market slot + SAGE category are equal.
//
// Final:
//   normalized player name for stable deterministic output.
//
// This keeps ADP as the market guardrail without allowing fractional ADP
// differences inside the same draft slot to suppress SAGE evidence.
// No weighted score or invented tolerance band is created.

function compareEvaluatedCandidates(
  a,
  b
) {
  const adpA =
    Number.isFinite(
      a.adp
    )
      ? a.adp
      : Infinity;

  const adpB =
    Number.isFinite(
      b.adp
    )
      ? b.adp
      : Infinity;

  const marketPickA =
    normalizeAdpToPick(
      adpA
    );

  const marketPickB =
    normalizeAdpToPick(
      adpB
    );

  const sortableMarketPickA =
    marketPickA === null
      ? Infinity
      : marketPickA;

  const sortableMarketPickB =
    marketPickB === null
      ? Infinity
      : marketPickB;

  if (
    sortableMarketPickA !==
    sortableMarketPickB
  ) {
    return (
      sortableMarketPickA -
      sortableMarketPickB
    );
  }

  const rankDiff =
    codeRank(
      a.sage &&
      a.sage.code
    ) -
    codeRank(
      b.sage &&
      b.sage.code
    );

  if (
    rankDiff !== 0
  ) {
    return rankDiff;
  }

  if (
    adpA !== adpB
  ) {
    return (
      adpA -
      adpB
    );
  }

  return normalizePlayerName(
    a.player &&
    a.player.name
  ).localeCompare(
    normalizePlayerName(
      b.player &&
      b.player.name
    )
  );
}

// ── One candidate, full SAGE read ──────────────────────────────────────

function evaluateCandidate(
  opportunityCache,
  contextCache,
  player,
  currentPool,
  nextTurnPool,
  currentPick,
  nextUserPick
) {
  const rawRecord =
    getOpportunityRecord(
      opportunityCache,
      player
    );

  const contextProfile =
    getProductionContextProfile(
      contextCache,
      player
    );

  const missing = [];

  const marketProfile =
    buildDraftMarketProfile({
      adp:
        player.adp,

      currentPick:
        currentPick,

      nextUserPick:
        nextUserPick
    });

  if (!contextProfile) {
    missing.push(
      "context"
    );
  }

  if (!rawRecord) {
    missing.push(
      "opportunity"
    );

    const sage =
      buildRecommendation({
        opportunityProfile:
          null,

        marketProfile:
          marketProfile,

        scarcityProfile:
          null,

        contextProfile:
          contextProfile
      });

    return {
      player,
      adp:
        player.adp,
      sage,
      missing
    };
  }

  const record =
    attachAdp(
      rawRecord,
      player
    );

  const opportunityProfile =
    buildDraftOpportunityProfile(
      rawRecord
    );

  const scarcityProfile =
    buildDraftScarcityProfile({
      candidate:
        record,

      currentPool:
        currentPool,

      nextTurnPool:
        nextTurnPool
    });

  const sage =
    buildRecommendation({
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile,

      contextProfile:
        contextProfile
    });

  return {
    player,
    adp:
      player.adp,
    sage,
    missing
  };
}

// ── Optional roster-context annotation (Phase 1, additive only) ────────
//
// Read-only, informational annotation layered ON TOP OF the already-
// ranked/scored recommendations below. It NEVER changes which players
// are recommended, their order, their SAGE code, or their explanation --
// it can only ever add a separate, clearly-labeled note.
//
// IMPORTANT:
// - Before this change, SAGE never read or considered rosterContext at
//   all. This annotation is a new, separate layer added now -- it is
//   not, and must never be described as, something SAGE "already did."
// - The note identifies a real, already-evaluated candidate at the
//   unmet position by name only. It never quotes that candidate's
//   internal SAGE recommendation label to the customer, and never
//   explains why the recommended player was chosen over them -- the
//   actual sort is ADP-primary, not a head-to-head comparison between
//   these two specific candidates, so no such explanation would be
//   accurate.
// - If rosterContext is missing, malformed, or doesn't support a
//   confident read, this returns null and nothing is added. Behavior
//   when rosterContext is absent is therefore unchanged from before
//   this field existed.

const ROSTER_POSITION_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF"
];

function isPlainObject(
  value
) {
  return Boolean(
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  );
}

function buildRosterContextNote(
  recommendedPos,
  rosterContext,
  evaluatedPool
) {
  if (
    !isPlainObject(
      rosterContext
    ) ||
    !isPlainObject(
      rosterContext.remainingDedicated
    )
  ) {
    return null;
  }

  const remaining =
    rosterContext.remainingDedicated;

  const normalizedRecommendedPos =
    String(
      recommendedPos ||
      ""
    ).toUpperCase();

  const recommendedRemaining =
    remaining[
      normalizedRecommendedPos
    ];

  // Only speak up when the recommended position's dedicated starting
  // slots are confirmed fully filled (exactly 0 remaining). Any other
  // value -- including missing/unknown/undefined -- is treated as
  // "cannot confirm satisfied" and produces no note.
  if (
    recommendedRemaining !==
    0
  ) {
    return null;
  }

  const unmetPos =
    ROSTER_POSITION_ORDER.find(
      function (pos) {
        return (
          pos !==
            normalizedRecommendedPos &&
          Number.isFinite(
            remaining[
              pos
            ]
          ) &&
          remaining[
            pos
          ] >
            0
        );
      }
    );

  if (!unmetPos) {
    return null;
  }

  const representative =
    (
      evaluatedPool ||
      []
    ).find(
      function (e) {
        return (
          e &&
          e.player &&
          String(
            e.player.pos ||
            ""
          ).toUpperCase() ===
            unmetPos
        );
      }
    );

  if (
    !representative ||
    !representative.sage ||
    !representative.sage.recommendation
  ) {
    return null;
  }

  // Consumer-facing wording deliberately avoids quoting SAGE's internal
  // recommendation label (e.g. "Consider Now") for the OTHER position's
  // candidate -- that reads as model-internals leakage to a customer.
  // It also deliberately does NOT explain why the recommended player
  // was chosen over this one (e.g. "because it sees stronger value"):
  // the actual sort is ADP-primary, not a head-to-head value comparison
  // between these two specific candidates, so any such explanation
  // would misdescribe what the system actually did. It also does not
  // suggest SAGE is recommending the alternative, and does not imply
  // anything about that player's future availability. State the fact
  // (this real, identified alternative exists) and stop there.
  return (
    "Your " +
    unmetPos +
    " slot is still open. " +
    (
      representative.player.name ||
      "A player"
    ) +
    " (" +
    unmetPos +
    ") is currently available if you prefer to address that position now. This note is informational only and does not change the recommendation above."
  );
}

// ── Handler ────────────────────────────────────────────────────────────

exports.handler =
  async (event) => {
    connectLambda(
      event
    );

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      return {
        statusCode:
          204,

        headers:
          CORS_HEADERS,

        body:
          ""
      };
    }

    if (
      event.httpMethod !==
      "POST"
    ) {
      return jsonResponse(
        405,
        {
          error:
            "POST only"
        }
      );
    }

    let payload;

    try {
      payload =
        JSON.parse(
          event.body ||
          "{}"
        );
    } catch (e) {
      return jsonResponse(
        400,
        {
          error:
            "Invalid request body."
        }
      );
    }

    const rawCandidates =
      Array.isArray(
        payload.candidates
      )
        ? payload.candidates
        : [];

    const candidates =
      rawCandidates
        .filter(
          isValidPlayerShape
        )
        .slice(
          0,
          MAX_CANDIDATES
        );

    if (
      candidates.length ===
      0
    ) {
      return jsonResponse(
        200,
        {
          computedAt:
            new Date()
              .toISOString(),

          candidateCount:
            0,

          recommendations:
            [],

          degraded:
            []
        }
      );
    }

    const currentPoolInput =
      Array.isArray(
        payload.currentPool
      ) &&
      payload.currentPool.length >
        0
        ? payload.currentPool.filter(
            isValidPlayerShape
          )
        : candidates;

    const nextTurnPoolInput =
      Array.isArray(
        payload.nextTurnPool
      )
        ? payload.nextTurnPool.filter(
            isValidPlayerShape
          )
        : [];

    const currentPick =
      payload.currentPick;

    const nextUserPick =
      payload.nextUserPick;

    // Phase 1 addition: read-only. Never validated/filtered like
    // candidates/pools above -- buildRosterContextNote() does its own
    // defensive shape-checking and simply returns null for anything it
    // can't confidently use. Not touching this variable at all (e.g. if
    // it's undefined) produces identical behavior to before this field
    // existed.
    const rosterContext =
      payload.rosterContext;

    try {
      const opportunityStore =
        getStore({
          name:
            "opportunity-intel"
        });

      const contextStore =
        getStore({
          name:
            "context-intel"
        });

      const [
        opportunityCache,
        contextCache
      ] =
        await Promise.all([
          opportunityStore
            .get(
              "latest",
              {
                type:
                  "json"
              }
            )
            .catch(
              () => null
            ),

          contextStore
            .get(
              "latest",
              {
                type:
                  "json"
              }
            )
            .catch(
              () => null
            )
        ]);

      // Build the pool objects ONCE, reused across every candidate's
      // Scarcity call.
      const currentPool =
        buildOpportunityPool(
          opportunityCache,
          currentPoolInput
        );

      const nextTurnPool =
        buildOpportunityPool(
          opportunityCache,
          nextTurnPoolInput
        );

      const degraded = [];

      const evaluated =
        candidates.map(
          function (player) {
            const result =
              evaluateCandidate(
                opportunityCache,
                contextCache,
                player,
                currentPool,
                nextTurnPool,
                currentPick,
                nextUserPick
              );

            if (
              result.missing.length >
              0
            ) {
              degraded.push({
                name:
                  player.name,

                pos:
                  player.pos,

                missing:
                  result.missing
              });
            }

            return result;
          }
        );

      // AUG 19 2026:
      // Preserve the scoring-specific market slot as the primary guardrail.
      // Within the same normalized draft slot, SAGE category decides order;
      // raw ADP then breaks same-slot, same-category ties.
      evaluated.sort(
        compareEvaluatedCandidates
      );

      const recommendations =
        evaluated
          .slice(
            0,
            MAX_RECOMMENDATIONS
          )
          .map(
            function (e) {
              return {
                player: {
                  name:
                    e.player.name,

                  pos:
                    e.player.pos,

                  team:
                    e.player.team ||
                    null
                },

                adp:
                  e.adp,

                recommendation:
                  e.sage.recommendation,

                code:
                  e.sage.code,

                explanation:
                  e.sage.explanation,

                reasons:
                  Array.isArray(
                    e.sage.reasons
                  )
                    ? e.sage.reasons.slice(
                        0,
                        2
                      )
                    : [],

                // Phase 1 addition: purely additive, never influences
                // recommendation/code/explanation/order above. null
                // whenever rosterContext is absent or the conditions
                // for a confident note aren't met.
                rosterContextNote:
                  buildRosterContextNote(
                    e.player.pos,
                    rosterContext,
                    evaluated
                  )
              };
            }
          );

      return jsonResponse(
        200,
        {
          computedAt:
            new Date()
              .toISOString(),

          candidateCount:
            candidates.length,

          recommendations:
            recommendations,

          degraded:
            degraded
        }
      );
    } catch (err) {
      console.log(
        "sage-recommend error:",
        err.message
      );

      return jsonResponse(
        500,
        {
          error:
            "SAGE recommendations temporarily unavailable."
        }
      );
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
  compareEvaluatedCandidates,
  codeRank,
  CODE_RANK,
  isValidPlayerShape,
  isPlainObject,
  buildRosterContextNote,
  ROSTER_POSITION_ORDER
};
