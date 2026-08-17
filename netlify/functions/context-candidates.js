// netlify/functions/context-candidates.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 2F
// CONTEXT CANDIDATE DISCOVERY
//
// PURPOSE:
// Produce a read-only review queue showing which players in the
// live Context population may deserve Context investigation.
//
// IMPORTANT:
// - This does NOT create Context evidence.
// - This does NOT modify context-evidence.js.
// - This does NOT assign Positive / Negative direction.
// - This does NOT rank players.
// - This does NOT project fantasy production.
// - This does NOT write to Netlify Blobs.
// - This does NOT modify SAGE.
//
// Candidate discovery and Context evidence are intentionally separate:
//
//   256-player live population
//          |
//          v
//   candidate discovery
//          |
//          v
//   human / evidence review
//          |
//          v
//   context-evidence.js
//          |
//          v
//   draft-context-profile.js
//          |
//          v
//        SAGE
//
// PHASE 2F INITIAL SCOPE:
//
// The first version is deliberately conservative.
//
// It identifies:
//
// 1. Players already carrying validated Context evidence.
// 2. Players whose live team differs from the team represented in
//    their historical Opportunity Intelligence record.
// 3. Rookies / players with no historical Opportunity record.
// 4. Players in the live 256-player population for whom Opportunity
//    history is unavailable.
//
// A flag means:
//   "Investigate this player."
//
// It does NOT mean:
//   "This player's fantasy value increased or decreased."

const {
  getStore,
  connectLambda
} = require("@netlify/blobs");

const {
  getAllContextEvidence
} = require("./context-evidence");


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};


// ------------------------------------------------------------
// IDENTITY
// ------------------------------------------------------------

function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizePosition(pos) {
  return String(
    pos || ""
  )
    .trim()
    .toUpperCase();
}


function playerKey(
  name,
  pos
) {
  return (
    normalizePlayerName(
      name
    ) +
    "|" +
    normalizePosition(
      pos
    )
  );
}


// ------------------------------------------------------------
// TEAM NORMALIZATION
//
// Keep this consistent with Context integrity handling.
//
// Washington is the known provider-code exception:
//   WAS / WSH
//
// We normalize both to WAS.
// ------------------------------------------------------------

function normalizeTeam(team) {
  const value =
    String(
      team || ""
    )
      .trim()
      .toUpperCase();

  if (
    value === "WSH" ||
    value === "WAS"
  ) {
    return "WAS";
  }

  return value;
}


// ------------------------------------------------------------
// RECORD HELPERS
// ------------------------------------------------------------

function getContextRecords(
  contextCache
) {
  return (
    contextCache &&
    contextCache.records &&
    typeof contextCache.records ===
      "object"
  )
    ? contextCache.records
    : {};
}


function getOpportunityRecords(
  opportunityCache
) {
  return (
    opportunityCache &&
    opportunityCache.records &&
    typeof opportunityCache.records ===
      "object"
  )
    ? opportunityCache.records
    : {};
}


function finiteNumber(value) {
  const numeric =
    Number(
      value
    );

  return Number.isFinite(
    numeric
  )
    ? numeric
    : null;
}


// ------------------------------------------------------------
// TEAM EXTRACTION
//
// Opportunity cache structure may contain team in slightly
// different places depending on the production record.
//
// This helper is intentionally read-only and defensive.
// ------------------------------------------------------------

function getOpportunityTeam(
  record
) {
  if (!record) {
    return "";
  }

  const candidates = [
    record.team,
    record.teamAbv,
    record.teamAbbr,
    record.teamAbbreviation,
    record.currentTeam,
    record.player &&
      record.player.team,
    record.player &&
      record.player.teamAbv,
    record.player &&
      record.player.teamAbbr
  ];


  for (
    let i = 0;
    i < candidates.length;
    i++
  ) {
    const normalized =
      normalizeTeam(
        candidates[i]
      );

    if (normalized) {
      return normalized;
    }
  }


  return "";
}


// ------------------------------------------------------------
// EVIDENCE LOOKUP
// ------------------------------------------------------------

function buildEvidenceIndex() {
  const registry =
    getAllContextEvidence();

  const index = {};


  Object.keys(
    registry
  ).forEach(
    function(key) {
      index[key] =
        registry[key];
    }
  );


  return index;
}


// ------------------------------------------------------------
// SIGNAL DEFINITIONS
//
// These are discovery signals.
//
// NONE of these signals contain fantasy direction.
// ------------------------------------------------------------

const SIGNALS = {
  EXISTING_EVIDENCE:
    "existing-context-evidence",

  TEAM_CHANGE:
    "team-change-candidate",

  NO_OPPORTUNITY_HISTORY:
    "no-opportunity-history",

  POSSIBLE_ROOKIE:
    "possible-rookie",

  TEAM_UNKNOWN:
    "historical-team-unavailable"
};


// ------------------------------------------------------------
// BUILD ONE CANDIDATE
// ------------------------------------------------------------

function buildCandidate(
  key,
  contextRecord,
  opportunityRecord,
  evidenceRecord
) {
  const signals = [];


  const currentTeam =
    normalizeTeam(
      contextRecord &&
      contextRecord.team
    );


  const historicalTeam =
    getOpportunityTeam(
      opportunityRecord
    );


  // ----------------------------------------------------------
  // EXISTING VALIDATED EVIDENCE
  // ----------------------------------------------------------

  if (evidenceRecord) {
    signals.push({
      code:
        SIGNALS.EXISTING_EVIDENCE,

      description:
        "Player already has a reviewed Context evidence record."
    });
  }


  // ----------------------------------------------------------
  // NO HISTORICAL OPPORTUNITY
  // ----------------------------------------------------------

  if (!opportunityRecord) {
    signals.push({
      code:
        SIGNALS.NO_OPPORTUNITY_HISTORY,

      description:
        "Player is in the live Context population but has no matching historical Opportunity Intelligence record."
    });


    if (
      contextRecord &&
      contextRecord.isRookie ===
        true
    ) {
      signals.push({
        code:
          SIGNALS.POSSIBLE_ROOKIE,

        description:
          "Live Context record identifies the player as a rookie."
      });
    }
  }


  // ----------------------------------------------------------
  // HISTORICAL TEAM UNAVAILABLE
  //
  // We deliberately do NOT call this a team change.
  // ----------------------------------------------------------

  if (
    opportunityRecord &&
    currentTeam &&
    !historicalTeam
  ) {
    signals.push({
      code:
        SIGNALS.TEAM_UNKNOWN,

      description:
        "Historical Opportunity record exists, but no comparable historical team value was found."
    });
  }


  // ----------------------------------------------------------
  // OBJECTIVE TEAM CHANGE
  //
  // Only flag when BOTH team values exist.
  //
  // This says nothing about whether the change is good or bad.
  // ----------------------------------------------------------

  if (
    opportunityRecord &&
    currentTeam &&
    historicalTeam &&
    currentTeam !==
      historicalTeam
  ) {
    signals.push({
      code:
        SIGNALS.TEAM_CHANGE,

      description:
        (
          "Current live team (" +
          currentTeam +
          ") differs from historical Opportunity team (" +
          historicalTeam +
          ")."
        )
    });
  }


  const adp =
    finiteNumber(
      contextRecord &&
      contextRecord.adp
    );


  const marketRank =
    finiteNumber(
      contextRecord &&
      contextRecord.marketRank
    );


  const needsReview =
    signals.some(
      function(signal) {
        return (
          signal.code !==
          SIGNALS.EXISTING_EVIDENCE
        );
      }
    );


  const reviewStatus =
    evidenceRecord
      ? (
          needsReview
            ? "evidence-exists-review-change"
            : "evidence-exists"
        )
      : (
          needsReview
            ? "needs-evidence-review"
            : "no-candidate-signal"
        );


  return {
    key:
      key,

    player: {
      playerID:
        contextRecord &&
        contextRecord.playerID
          ? contextRecord.playerID
          : (
              opportunityRecord &&
              opportunityRecord.playerID
                ? opportunityRecord.playerID
                : null
            ),

      longName:
        contextRecord &&
        contextRecord.longName
          ? contextRecord.longName
          : (
              opportunityRecord &&
              opportunityRecord.longName
                ? opportunityRecord.longName
                : null
            ),

      pos:
        normalizePosition(
          contextRecord &&
          contextRecord.pos
            ? contextRecord.pos
            : (
                opportunityRecord
                  ? opportunityRecord.pos
                  : ""
              )
        ) || null,

      currentTeam:
        currentTeam ||
        null,

      historicalOpportunityTeam:
        historicalTeam ||
        null,

      adp:
        adp,

      marketRank:
        marketRank
    },

    evidence: {
      exists:
        !!evidenceRecord,

      expectedTeam:
        evidenceRecord
          ? normalizeTeam(
              evidenceRecord.expectedTeam
            ) || null
          : null
    },

    reviewStatus:
      reviewStatus,

    needsReview:
      needsReview,

    signals:
      signals
  };
}


// ------------------------------------------------------------
// BUILD DISCOVERY REPORT
// ------------------------------------------------------------

function buildDiscoveryReport(
  contextCache,
  opportunityCache
) {
  const contextRecords =
    getContextRecords(
      contextCache
    );

  const opportunityRecords =
    getOpportunityRecords(
      opportunityCache
    );

  const evidenceIndex =
    buildEvidenceIndex();


  const allRecords = [];


  Object.keys(
    contextRecords
  ).forEach(
    function(key) {
      const contextRecord =
        contextRecords[key];

      if (!contextRecord) {
        return;
      }


      const pos =
        normalizePosition(
          contextRecord.pos
        );


      if (
        ![
          "QB",
          "RB",
          "WR",
          "TE"
        ].includes(pos)
      ) {
        return;
      }


      const opportunityRecord =
        opportunityRecords[key] ||
        null;


      const evidenceRecord =
        evidenceIndex[key] ||
        null;


      allRecords.push(
        buildCandidate(
          key,
          contextRecord,
          opportunityRecord,
          evidenceRecord
        )
      );
    }
  );


  // ----------------------------------------------------------
  // REVIEW QUEUE
  //
  // Existing evidence records are included if another discovery
  // signal exists, allowing stale/change detection.
  //
  // Pure existing-evidence records are shown separately.
  // ----------------------------------------------------------

  const reviewQueue =
    allRecords
      .filter(
        function(record) {
          return (
            record.needsReview ===
            true
          );
        }
      )
      .sort(
        function(a, b) {
          const aRank =
            a.player.marketRank !==
              null
              ? a.player.marketRank
              : 999999;

          const bRank =
            b.player.marketRank !==
              null
              ? b.player.marketRank
              : 999999;

          return (
            aRank -
            bRank
          );
        }
      );


  const existingEvidence =
    allRecords
      .filter(
        function(record) {
          return (
            record.evidence.exists ===
            true
          );
        }
      )
      .sort(
        function(a, b) {
          const aRank =
            a.player.marketRank !==
              null
              ? a.player.marketRank
              : 999999;

          const bRank =
            b.player.marketRank !==
              null
              ? b.player.marketRank
              : 999999;

          return (
            aRank -
            bRank
          );
        }
      );


  // ----------------------------------------------------------
  // SIGNAL COUNTS
  // ----------------------------------------------------------

  const signalCounts = {};


  Object.keys(
    SIGNALS
  ).forEach(
    function(name) {
      signalCounts[
        SIGNALS[name]
      ] = 0;
    }
  );


  allRecords.forEach(
    function(record) {
      record.signals.forEach(
        function(signal) {
          if (
            typeof signalCounts[
              signal.code
            ] !==
            "number"
          ) {
            signalCounts[
              signal.code
            ] = 0;
          }

          signalCounts[
            signal.code
          ]++;
        }
      );
    }
  );


  const unflaggedCount =
    allRecords.filter(
      function(record) {
        return (
          record.needsReview ===
          false
        );
      }
    ).length;


  return {
    populationCount:
      allRecords.length,

    evidenceRegistryCount:
      Object.keys(
        evidenceIndex
      ).length,

    candidateReviewCount:
      reviewQueue.length,

    unflaggedCount:
      unflaggedCount,

    signalCounts:
      signalCounts,

    reviewQueue:
      reviewQueue,

    existingEvidence:
      existingEvidence
  };
}


// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

exports.handler =
  async function(event) {
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
      "GET"
    ) {
      return {
        statusCode:
          405,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify({
            error:
              "GET only"
          })
      };
    }


    try {
      const contextStore =
        getStore({
          name:
            "context-intel"
        });


      const opportunityStore =
        getStore({
          name:
            "opportunity-intel"
        });


      const [
        contextCache,
        opportunityCache
      ] =
        await Promise.all([
          contextStore.get(
            "latest",
            {
              type:
                "json"
            }
          ),

          opportunityStore.get(
            "latest",
            {
              type:
                "json"
            }
          )
        ]);


      if (!contextCache) {
        return {
          statusCode:
            404,

          headers:
            CORS_HEADERS,

          body:
            JSON.stringify(
              {
                error:
                  'No cached Context Intelligence data found for key "latest".'
              },
              null,
              2
            )
        };
      }


      if (!opportunityCache) {
        return {
          statusCode:
            404,

          headers:
            CORS_HEADERS,

          body:
            JSON.stringify(
              {
                error:
                  'No cached Opportunity Intelligence data found for key "latest".'
              },
              null,
              2
            )
        };
      }


      const report =
        buildDiscoveryReport(
          contextCache,
          opportunityCache
        );


      return {
        statusCode:
          200,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              check:
                "SAGE Context Candidate Discovery",

              phase:
                "2F",

              methodology: {
                population:
                  "Current context-intel/latest population.",

                purpose:
                  "Identify players whose circumstances may warrant objective Context evidence review.",

                candidateDoesNotMean:
                  "Positive, Negative, Improved, Reduced, Buy, Sell, Draft, or Fade.",

                directionAssigned:
                  false,

                hiddenNumericScore:
                  false,

                writesData:
                  false
              },

              contextComputedAt:
                contextCache.computedAt ||
                null,

              opportunityComputedAt:
                opportunityCache.computedAt ||
                null,

              populationCount:
                report.populationCount,

              evidenceRegistryCount:
                report.evidenceRegistryCount,

              candidateReviewCount:
                report.candidateReviewCount,

              unflaggedCount:
                report.unflaggedCount,

              signalCounts:
                report.signalCounts,

              reviewQueue:
                report.reviewQueue,

              existingEvidence:
                report.existingEvidence
            },
            null,
            2
          )
      };

    } catch (e) {
      return {
        statusCode:
          500,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              error:
                "SAGE Context candidate discovery failed",

              detail:
                e.message,

              stack:
                e.stack
            },
            null,
            2
          )
      };
    }
  };


// ------------------------------------------------------------
// PURE EXPORTS
// ------------------------------------------------------------

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.normalizePosition =
  normalizePosition;

module.exports.playerKey =
  playerKey;

module.exports.normalizeTeam =
  normalizeTeam;

module.exports.getContextRecords =
  getContextRecords;

module.exports.getOpportunityRecords =
  getOpportunityRecords;

module.exports.getOpportunityTeam =
  getOpportunityTeam;

module.exports.buildEvidenceIndex =
  buildEvidenceIndex;

module.exports.SIGNALS =
  SIGNALS;

module.exports.buildCandidate =
  buildCandidate;

module.exports.buildDiscoveryReport =
  buildDiscoveryReport;
