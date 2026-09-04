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
//     degraded: [ {name, pos, missing: ["opportunity"|"context", ...]} ],
//     rosterAdvisory: [
//       {
//         pos: "TE",
//         classification: "SAFE_TO_WAIT" | "MONITOR" | "PRIORITY_NOW",
//         label: "Comfortable Waiting" | "Keep Monitoring" |
//                "Consider Addressing Soon",
//         message: "...",
//         representativeOptions: ["...", "...", "..."],
//         remainingAtPosition: number,
//         remainingDedicatedNeeded: number
//       },
//       ... one entry per meaningful open position, or [] if none
//     ]
//   }
//
// rosterAdvisory (Phase 2 addition) is a SEPARATE, roster-LEVEL field --
// not attached to any individual recommendation, and computed entirely
// independently of `evaluated`/`recommendations`/`degraded` above. It
// NEVER changes ranking, code, explanation, or reasons for any player.
// See netlify/functions/draft-roster-advisory.js for the full design
// rationale. Empty array whenever rosterContext is absent/malformed or
// every starting position is already filled -- same backward-
// compatibility guarantee Phase 1's rosterContextNote already
// established for missing rosterContext.
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


// Reuse the production signed-cookie verifier directly rather than
// duplicating session-signature logic here.
const {
  handler: verifySessionHandler
} = require("./verify-session");

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
  buildRecommendation,
  marketSignals,
  scarcitySignals
} = require("./draft-sage-synthesis");

// Phase 2 addition: roster-LEVEL strategy advisory, entirely separate
// from the per-player synthesis above. Pure, synchronous, no Blobs
// dependency of its own -- see draft-roster-advisory.js's own header
// for the full design rationale (why raw currentPool, why not a direct
// buildDraftScarcityProfile call here).
const {
  buildRosterAdvisory
} = require("./draft-roster-advisory");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

async function hasFullAcolyteAccess(event) {
  try {
    const result =
      await verifySessionHandler({
        ...event,
        httpMethod: "GET",
        body: null
      });

    if (
      !result ||
      result.statusCode !== 200
    ) {
      return false;
    }

    const data =
      typeof result.body === "string"
        ? JSON.parse(
            result.body || "{}"
          )
        : (result.body || {});

    return data.fullAccess === true;
  } catch (err) {
    console.log(
      "SAGE auth verification failed:",
      err && err.message
        ? err.message
        : String(err)
    );

    return false;
  }
}

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
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(
      /[\u2018\u2019\u02bc']/g,
      ""
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function playerKey(player) {
  return (
    normalizePlayerName(
      player &&
      player.name
    ) +
    "|" +
    String(
      player &&
      player.pos
        ? player.pos
        : ""
    ).toUpperCase()
  );
}

function getOpportunityRecord(
  opportunityCache,
  player
) {
  if (
    !opportunityCache ||
    !player
  ) {
    return null;
  }

  const key =
    playerKey(player);

  if (
    opportunityCache.byPlayer &&
    opportunityCache.byPlayer[
      key
    ]
  ) {
    return opportunityCache
      .byPlayer[key];
  }

  if (
    Array.isArray(
      opportunityCache.players
    )
  ) {
    return (
      opportunityCache.players.find(
        function (record) {
          return (
            playerKey(record) ===
            key
          );
        }
      ) || null
    );
  }

  return null;
}

function getContextRecord(
  contextCache,
  player
) {
  if (
    !contextCache ||
    !player
  ) {
    return null;
  }

  const key =
    playerKey(player);

  if (
    contextCache.byPlayer &&
    contextCache.byPlayer[
      key
    ]
  ) {
    return contextCache.byPlayer[
      key
    ];
  }

  if (
    Array.isArray(
      contextCache.players
    )
  ) {
    return (
      contextCache.players.find(
        function (record) {
          return (
            playerKey(record) ===
            key
          );
        }
      ) || null
    );
  }

  return null;
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

  if (!record) {
    return null;
  }

  if (
    record.contextProfile &&
    typeof record.contextProfile ===
      "object"
  ) {
    return record.contextProfile;
  }

  return record;
}

function attachAdp(
  opportunityRecord,
  player
) {
  if (
    !opportunityRecord ||
    !player
  ) {
    return null;
  }

  return {
    ...opportunityRecord,
    adp:
      Number.isFinite(
        Number(player.adp)
      )
        ? Number(player.adp)
        : null
  };
}

function buildOpportunityPool(
  opportunityCache,
  players
) {
  return (
    Array.isArray(players)
      ? players
      : []
  )
    .map(
      function (player) {
        return attachAdp(
          getOpportunityRecord(
            opportunityCache,
            player
          ),
          player
        );
      }
    )
    .filter(Boolean);
}

// ── Plain-language Context augmentation helpers ─────────────────────
//
// These fields are additive and customer-facing only. They never alter
// synthesis, ordering, codes, or reasons.
//
// buildFootballContext() uses only real fields already present in the
// cached Opportunity snapshot. No inference beyond direct value-to-copy
// mapping.
//
// If sufficient evidence is absent, return null and let the frontend
// gracefully omit the field.
function buildFootballContext(
  opportunityRecord
) {
  if (!opportunityRecord) {
    return null;
  }

  const parts = [];

  const role =
    opportunityRecord.role ||
    opportunityRecord.depthRole ||
    opportunityRecord.roleLabel ||
    null;

  const team =
    opportunityRecord.team ||
    null;

  const snapShare =
    Number(
      opportunityRecord.snapShare
    );

  const targetShare =
    Number(
      opportunityRecord.targetShare
    );

  const carryShare =
    Number(
      opportunityRecord.carryShare
    );

  if (role) {
    parts.push(String(role));
  }

  if (team) {
    parts.push(
      "for " + String(team)
    );
  }

  if (
    Number.isFinite(snapShare)
  ) {
    parts.push(
      "playing " +
      Math.round(
        snapShare * 100
      ) +
      "% of snaps"
    );
  }

  if (
    Number.isFinite(targetShare)
  ) {
    parts.push(
      "with a " +
      Math.round(
        targetShare * 100
      ) +
      "% target share"
    );
  } else if (
    Number.isFinite(carryShare)
  ) {
    parts.push(
      "with a " +
      Math.round(
        carryShare * 100
      ) +
      "% carry share"
    );
  }

  if (!parts.length) {
    return null;
  }

  let text =
    parts.join(", ");

  text =
    text.charAt(0).toUpperCase() +
    text.slice(1);

  if (!/[.!?]$/.test(text)) {
    text += ".";
  }

  return text;
}

// Customer-facing timing phrase based only on Market + Scarcity outputs.
// This deliberately avoids exposing raw internal field names/scores.
function buildDraftOutlookPhrase(
  marketProfile,
  scarcityProfile
) {
  if (
    !marketProfile &&
    !scarcityProfile
  ) {
    return null;
  }

  const signals = [];

  const market =
    marketSignals(
      marketProfile || {}
    ) || [];

  const scarcity =
    scarcitySignals(
      scarcityProfile || {}
    ) || [];

  if (
    Array.isArray(market) &&
    market.length
  ) {
    signals.push(
      market[0]
    );
  }

  if (
    Array.isArray(scarcity) &&
    scarcity.length
  ) {
    signals.push(
      scarcity[0]
    );
  }

  if (!signals.length) {
    return null;
  }

  return signals
    .slice(0, 2)
    .join(" ");
}

// Context-note display text from the already-computed production Context
// profile. Use only explicit, customer-safe text fields if present.
function buildUniqueContextNote(
  contextProfile
) {
  if (
    !contextProfile ||
    typeof contextProfile !==
      "object"
  ) {
    return null;
  }

  const candidateFields = [
    contextProfile.note,
    contextProfile.contextNote,
    contextProfile.summary,
    contextProfile.label,
    contextProfile.outlook
  ];

  for (
    let i = 0;
    i < candidateFields.length;
    i++
  ) {
    const value =
      candidateFields[i];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

// ── Roster-context validation / note helper ─────────────────────────
//
// Phase 1 is intentionally conservative:
//   - only uses remainingDedicated,
//   - only appends a note when the recommended player's dedicated slot
//     is already filled,
//   - only points to a genuinely-open OTHER position,
//   - only names a real evaluated candidate already present in this
//     request,
//   - never changes ordering or synthesis.
function normalizeRosterContext(
  rosterContext
) {
  if (
    !rosterContext ||
    typeof rosterContext !==
      "object"
  ) {
    return null;
  }

  const remainingDedicated =
    rosterContext.remainingDedicated;

  if (
    !remainingDedicated ||
    typeof remainingDedicated !==
      "object"
  ) {
    return null;
  }

  const normalized = {};

  [
    "QB",
    "RB",
    "WR",
    "TE",
    "K",
    "DEF"
  ].forEach(
    function (pos) {
      const value =
        Number(
          remainingDedicated[
            pos
          ]
        );

      if (
        Number.isFinite(value)
      ) {
        normalized[pos] =
          Math.max(
            0,
            Math.floor(value)
          );
      }
    }
  );

  if (
    !Object.keys(normalized)
      .length
  ) {
    return null;
  }

  return {
    remainingDedicated:
      normalized
  };
}

function buildRosterContextNote(
  recommendedPlayer,
  evaluated,
  rosterContext
) {
  const normalized =
    normalizeRosterContext(
      rosterContext
    );

  if (
    !normalized ||
    !recommendedPlayer ||
    !recommendedPlayer.pos
  ) {
    return null;
  }

  const recPos =
    String(
      recommendedPlayer.pos
    ).toUpperCase();

  const remaining =
    normalized
      .remainingDedicated;

  if (
    !Object.prototype
      .hasOwnProperty.call(
        remaining,
        recPos
      )
  ) {
    return null;
  }

  if (
    remaining[recPos] > 0
  ) {
    return null;
  }

  const openPositions =
    Object.keys(remaining)
      .filter(
        function (pos) {
          return (
            pos !== recPos &&
            remaining[pos] > 0
          );
        }
      );

  if (!openPositions.length) {
    return null;
  }

  const alternative =
    (
      Array.isArray(evaluated)
        ? evaluated
        : []
    ).find(
      function (candidate) {
        if (
          !candidate ||
          !candidate.player
        ) {
          return false;
        }

        const pos =
          String(
            candidate.player.pos ||
            ""
          ).toUpperCase();

        return (
          openPositions.indexOf(
            pos
          ) !== -1
        );
      }
    );

  if (
    !alternative ||
    !alternative.player ||
    !alternative.player.name
  ) {
    return null;
  }

  return (
    "Roster note: your " +
    recPos +
    " starter slot is already filled, while another starting need remains open. " +
    String(
      alternative.player.name
    ) +
    " is also available in this candidate group."
  );
}

// ── Core candidate evaluation ───────────────────────────────────────
function evaluateCandidate(
  opportunityCache,
  contextCache,
  player,
  currentPool,
  nextTurnPool,
  currentPick,
  nextUserPick
) {
  const missing = [];

  const opportunityRecord =
    getOpportunityRecord(
      opportunityCache,
      player
    );

  const opportunityProfile =
    opportunityRecord
      ? buildDraftOpportunityProfile(
          opportunityRecord
        )
      : null;

  if (!opportunityProfile) {
    missing.push(
      "opportunity"
    );
  }

  const marketProfile =
    buildDraftMarketProfile({
      adp:
        Number.isFinite(
          Number(player.adp)
        )
          ? Number(player.adp)
          : null,

      currentPick:
        currentPick,

      nextUserPick:
        nextUserPick
    });

  const scarcityProfile =
    buildDraftScarcityProfile({
      candidate:
        attachAdp(
          opportunityRecord,
          player
        ),

      currentPool:
        currentPool,

      nextTurnPool:
        nextTurnPool
    });

  const contextProfile =
    getProductionContextProfile(
      contextCache,
      player
    );

  if (!contextProfile) {
    missing.push(
      "context"
    );
  }

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
    player:
      player,

    adp:
      Number.isFinite(
        Number(player.adp)
      )
        ? Number(player.adp)
        : Infinity,

    sage:
      sage,

    missing:
      missing
  };
}

// Scoring-specific ADP is the primary objective market guardrail.
// SAGE code only breaks EXACT same-ADP ties.
function compareEvaluatedCandidates(
  a,
  b
) {
  const adpA =
    Number.isFinite(a.adp)
      ? a.adp
      : Infinity;

  const adpB =
    Number.isFinite(b.adp)
      ? b.adp
      : Infinity;

  if (adpA !== adpB) {
    return adpA - adpB;
  }

  const codeA =
    codeRank(
      a &&
      a.sage
        ? a.sage.code
        : null
    );

  const codeB =
    codeRank(
      b &&
      b.sage
        ? b.sage.code
        : null
    );

  if (codeA !== codeB) {
    return codeA - codeB;
  }

  return normalizePlayerName(
    a &&
    a.player
      ? a.player.name
      : ""
  ).localeCompare(
    normalizePlayerName(
      b &&
      b.player
        ? b.player.name
        : ""
    )
  );
}

// ── Request / response helpers ──────────────────────────────────────
function jsonResponse(
  statusCode,
  body
) {
  return {
    statusCode:
      statusCode,

    headers:
      CORS_HEADERS,

    body:
      JSON.stringify(body)
  };
}

function parseBody(event) {
  if (
    !event ||
    !event.body
  ) {
    return {};
  }

  if (
    typeof event.body ===
      "object"
  ) {
    return event.body;
  }

  return JSON.parse(
    event.body
  );
}

function normalizeCandidate(
  player
) {
  if (
    !player ||
    typeof player !==
      "object"
  ) {
    return null;
  }

  const name =
    typeof player.name ===
      "string"
      ? player.name.trim()
      : "";

  const pos =
    typeof player.pos ===
      "string"
      ? player.pos
          .trim()
          .toUpperCase()
      : "";

  if (
    !name ||
    !pos
  ) {
    return null;
  }

  const adp =
    Number(player.adp);

  return {
    name:
      name,

    pos:
      pos,

    team:
      typeof player.team ===
        "string" &&
      player.team.trim()
        ? player.team.trim()
        : null,

    adp:
      Number.isFinite(adp)
        ? adp
        : null
  };
}

function normalizePlayerArray(
  value,
  maxItems
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  const out = [];

  for (
    let i = 0;
    i < value.length;
    i++
  ) {
    if (
      Number.isFinite(
        Number(maxItems)
      ) &&
      out.length >= maxItems
    ) {
      break;
    }

    const player =
      normalizeCandidate(
        value[i]
      );

    if (player) {
      out.push(player);
    }
  }

  return out;
}

// ── Handler ─────────────────────────────────────────────────────────
exports.handler =
  async function (
    event
  ) {
    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      return {
        statusCode:
          200,

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

    // Paid Draft Command Center intelligence must be authorized at the
    // server boundary. The client-side preview/passcode gate is not an
    // entitlement mechanism and is deliberately ignored here.
    const fullAccess =
      await hasFullAcolyteAccess(
        event
      );

    if (!fullAccess) {
      return jsonResponse(
        403,
        {
          error:
            "Founding Acolyte access required."
        }
      );
    }

    try {
      connectLambda(event);

      const body =
        parseBody(event);

      const candidates =
        normalizePlayerArray(
          body.candidates,
          MAX_CANDIDATES
        );

      if (
        !candidates.length
      ) {
        return jsonResponse(
          400,
          {
            error:
              "candidates is required and must contain at least one valid player."
          }
        );
      }

      const currentPick =
        Number(
          body.currentPick
        );

      const nextUserPick =
        Number(
          body.nextUserPick
        );

      if (
        !Number.isFinite(
          currentPick
        ) ||
        !Number.isFinite(
          nextUserPick
        )
      ) {
        return jsonResponse(
          400,
          {
            error:
              "currentPick and nextUserPick are required numbers."
          }
        );
      }

      const currentPoolInput =
        normalizePlayerArray(
          body.currentPool,
          null
        );

      const nextTurnPoolInput =
        normalizePlayerArray(
          body.nextTurnPool,
          null
        );

      const effectiveCurrentPool =
        currentPoolInput.length
          ? currentPoolInput
          : candidates;

      const effectiveNextTurnPool =
        nextTurnPoolInput;

      const rosterContext =
        normalizeRosterContext(
          body.rosterContext
        );

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
          opportunityStore.get(
            "latest",
            {
              type:
                "json"
            }
          ),

          contextStore.get(
            "latest",
            {
              type:
                "json"
            }
          )
        ]);

      if (
        !opportunityCache
      ) {
        return jsonResponse(
          503,
          {
            error:
              "Opportunity intelligence cache unavailable."
          }
        );
      }

      if (
        !contextCache
      ) {
        return jsonResponse(
          503,
          {
            error:
              "Context intelligence cache unavailable."
          }
        );
      }

      // Build the pool objects ONCE, reused across every candidate's
      // Scarcity call.
      const currentPool =
        buildOpportunityPool(
          opportunityCache,
          effectiveCurrentPool
        );

      const nextTurnPool =
        buildOpportunityPool(
          opportunityCache,
          effectiveNextTurnPool
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

                // Original, UNMODIFIED SAGE synthesis explanation --
                // restored to its plain value. Its role as the
                // customer-facing football description is superseded
                // by footballContext/draftOutlook below, but it is
                // kept exactly as buildRecommendation() produced it as
                // the existing safe fallback string.
                explanation:
                  e.sage.explanation,

                // 1/3/10 CUSTOMER EXPLANATION V1 -- additive fields,
                // computed from the same already-loaded evidence.
                footballContext:
                  buildFootballContext(
                    getOpportunityRecord(
                      opportunityCache,
                      e.player
                    )
                  ),

                draftOutlook:
                  buildDraftOutlookPhrase(
                    buildDraftMarketProfile({
                      adp:
                        e.adp,

                      currentPick:
                        currentPick,

                      nextUserPick:
                        nextUserPick
                    }),

                    buildDraftScarcityProfile({
                      candidate:
                        attachAdp(
                          getOpportunityRecord(
                            opportunityCache,
                            e.player
                          ),
                          e.player
                        ),

                      currentPool:
                        currentPool,

                      nextTurnPool:
                        nextTurnPool
                    })
                  ),

                contextNote:
                  buildUniqueContextNote(
                    getProductionContextProfile(
                      contextCache,
                      e.player
                    )
                  ),

                reasons:
                  Array.isArray(
                    e.sage.reasons
                  )
                    ? e.sage.reasons.slice(
                        0,
                        2
                      )
                    : [],

                rosterContextNote:
                  buildRosterContextNote(
                    e.player,
                    evaluated,
                    rosterContext
                  )
              };
            }
          );

      let rosterAdvisory = [];

      try {
        rosterAdvisory =
          rosterContext
            ? buildRosterAdvisory({
                rosterContext:
                  rosterContext,

                currentPool:
                  effectiveCurrentPool
              })
            : [];
      } catch (err) {
        console.log(
          "Roster advisory error:",
          err &&
          err.message
            ? err.message
            : String(err)
        );

        rosterAdvisory = [];
      }

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
            degraded,

          rosterAdvisory:
            Array.isArray(
              rosterAdvisory
            )
              ? rosterAdvisory
              : []
        }
      );
    } catch (err) {
      console.log(
        "sage-recommend handler error:",
        err &&
        err.stack
          ? err.stack
          : err
      );

      return jsonResponse(
        500,
        {
          error:
            "SAGE recommendation failed.",

          detail:
            err &&
            err.message
              ? err.message
              : String(err)
        }
      );
    }
  };
