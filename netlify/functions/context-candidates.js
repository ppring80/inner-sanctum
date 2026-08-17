// netlify/functions/context-candidates.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 2F
// CONTEXT CANDIDATE DISCOVERY v2
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
// ------------------------------------------------------------
// CORE PHILOSOPHY
// ------------------------------------------------------------
//
// Candidate discovery and data diagnostics are NOT the same thing.
//
// A candidate signal means:
//
//   "There is an objective reason this player's current situation
//    deserves Context evidence review."
//
// A diagnostic means:
//
//   "The available production data does not contain enough historical
//    information to make this type of comparison."
//
// Missing data by itself must NEVER create a Context candidate.
//
// ------------------------------------------------------------
// PHASE 2F v2 CANDIDATE TRIGGERS
// ------------------------------------------------------------
//
// 1. Rookie in the live 256-player population without reviewed
//    Context evidence.
//
// Future candidate triggers may include:
//
// - objectively verified team change
// - objectively verified quarterback change
// - coaching / coordinator change
// - depth-chart change
// - material injury return
// - offensive-line change
//
// BUT only after we have a reliable source for detecting those events.
//
// ------------------------------------------------------------
// DIAGNOSTICS ONLY
// ------------------------------------------------------------
//
// - Opportunity record missing
// - historical team unavailable
// - existing Context evidence
//
// None of those conditions creates a new review candidate.
//
// READ-ONLY.

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
// HISTORICAL TEAM EXTRACTION
//
// IMPORTANT:
//
// The Phase 2F v1 run proved that the current Opportunity cache
// generally does NOT contain historical team information.
//
// Therefore historical-team availability is now DIAGNOSTIC ONLY.
//
// It must never create a candidate by itself.
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
// EVIDENCE INDEX
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
// CANDIDATE SIGNALS
//
// These signals ARE allowed to create needsReview = true.
// ------------------------------------------------------------

const CANDIDATE_SIGNALS = {
  ROOKIE:
    "rookie-context-review"
};


// ------------------------------------------------------------
// DIAGNOSTIC SIGNALS
//
// These NEVER create a candidate by themselves.
// ------------------------------------------------------------

const DIAGNOSTIC_SIGNALS = {
  EXISTING_EVIDENCE:
    "existing-context-evidence",

  NO_OPPORTUNITY_HISTORY:
    "no-opportunity-history",

  HISTORICAL_TEAM_UNAVAILABLE:
    "historical-team-unavailable",

  HISTORICAL_TEAM_AVAILABLE:
    "historical-team-available",

  POTENTIAL_TEAM_DIFFERENCE:
    "potential-team-difference"
};


// ------------------------------------------------------------
// BUILD ONE DISCOVERY RECORD
// ------------------------------------------------------------

function buildDiscoveryRecord(
  key,
  contextRecord,
  opportunityRecord,
  evidenceRecord
) {
  const candidateSignals = [];
  const diagnostics = [];


  const currentTeam =
    normalizeTeam(
      contextRecord &&
      contextRecord.team
    );


  const historicalTeam =
    getOpportunityTeam(
      opportunityRecord
    );


  const isRookie =
    !!(
      contextRecord &&
      contextRecord.isRookie ===
        true
    );


  // ----------------------------------------------------------
  // EXISTING EVIDENCE
  //
  // Diagnostic only.
  //
  // A reviewed player is not a new candidate just because evidence
  // already exists.
  // ----------------------------------------------------------

  if (evidenceRecord) {
    diagnostics.push({
      code:
        DIAGNOSTIC_SIGNALS
          .EXISTING_EVIDENCE,

      description:
        "Player already has a reviewed Context evidence record."
    });
  }


  // ----------------------------------------------------------
  // OPPORTUNITY COVERAGE
  //
  // Diagnostic only.
  //
  // Missing historical Opportunity data is a coverage limitation,
  // not proof that Context changed.
  // ----------------------------------------------------------

  if (!opportunityRecord) {
    diagnostics.push({
      code:
        DIAGNOSTIC_SIGNALS
          .NO_OPPORTUNITY_HISTORY,

      description:
        "No matching historical Opportunity Intelligence record is available."
    });
  }


  // ----------------------------------------------------------
  // HISTORICAL TEAM COVERAGE
  //
  // Diagnostic only.
  // ----------------------------------------------------------

  if (
    opportunityRecord &&
    !historicalTeam
  ) {
    diagnostics.push({
      code:
        DIAGNOSTIC_SIGNALS
          .HISTORICAL_TEAM_UNAVAILABLE,

      description:
        "Historical Opportunity record exists, but it does not expose a comparable historical team value."
    });
  }


  if (
    opportunityRecord &&
    historicalTeam
  ) {
    diagnostics.push({
      code:
        DIAGNOSTIC_SIGNALS
          .HISTORICAL_TEAM_AVAILABLE,

      description:
        (
          "Historical Opportunity team is available: " +
          historicalTeam +
          "."
        )
    });
  }


  // ----------------------------------------------------------
  // POTENTIAL TEAM DIFFERENCE
  //
  // Still diagnostic in v2.
  //
  // Why?
  //
  // We have not yet proven that the Opportunity team's semantics
  // represent a trustworthy prior-team snapshot.
  //
  // If this condition begins appearing in production, we can inspect
  // those cases and promote this to a candidate trigger in a later
  // version.
  // ----------------------------------------------------------

  if (
    currentTeam &&
    historicalTeam &&
    currentTeam !==
      historicalTeam
  ) {
    diagnostics.push({
      code:
        DIAGNOSTIC_SIGNALS
          .POTENTIAL_TEAM_DIFFERENCE,

      description:
        (
          "Current team (" +
          currentTeam +
          ") differs from available Opportunity team (" +
          historicalTeam +
          "). Manual validation required before treating this as a team-change event."
        )
    });
  }


  // ----------------------------------------------------------
  // ROOKIE CANDIDATE
  //
  // This IS a real candidate trigger.
  //
  // A rookie in the current fantasy market may have no NFL history,
  // so Context can provide legitimate non-NFL evidence such as:
  //
  // - draft capital
  // - prospect quality
  // - expected immediate role
  //
  // If evidence already exists, the player is already reviewed and
  // should NOT be placed back in the candidate queue.
  // ----------------------------------------------------------

  if (
    isRookie &&
    !evidenceRecord
  ) {
    candidateSignals.push({
      code:
        CANDIDATE_SIGNALS.ROOKIE,

      description:
        "Rookie is present in the live draft population and does not yet have reviewed Context evidence."
    });
  }


  const needsReview =
    candidateSignals.length >
    0;


  const reviewStatus =
    evidenceRecord
      ? "evidence-exists"
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

      isRookie:
        isRookie,

      currentTeam:
        currentTeam ||
        null,

      historicalOpportunityTeam:
        historicalTeam ||
        null,

      adp:
        finiteNumber(
          contextRecord &&
          contextRecord.adp
        ),

      marketRank:
        finiteNumber(
          contextRecord &&
          contextRecord.marketRank
        )
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

    candidateSignals:
      candidateSignals,

    diagnostics:
      diagnostics
  };
}


// ------------------------------------------------------------
// SORT BY CURRENT MARKET RANK
//
// This does NOT rank Context.
//
// The population already comes from market ADP.
//
// Sorting only makes the review queue easier to consume.
// ------------------------------------------------------------

function marketSort(
  a,
  b
) {
  const aRank =
    a &&
    a.player &&
    a.player.marketRank !==
      null
      ? a.player.marketRank
      : 999999;


  const bRank =
    b &&
    b.player &&
    b.player.marketRank !==
      null
      ? b.player.marketRank
      : 999999;


  return (
    aRank -
    bRank
  );
}


// ------------------------------------------------------------
// COUNT SIGNALS
// ------------------------------------------------------------

function initializeCounts(
  definitions
) {
  const counts = {};


  Object.keys(
    definitions
  ).forEach(
    function(name) {
      counts[
        definitions[name]
      ] = 0;
    }
  );


  return counts;
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


  const records = [];


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


      records.push(
        buildDiscoveryRecord(
          key,
          contextRecord,
          opportunityRecord,
          evidenceRecord
        )
      );
    }
  );


  // ----------------------------------------------------------
  // TRUE CANDIDATE QUEUE
  // ----------------------------------------------------------

  const reviewQueue =
    records
      .filter(
        function(record) {
          return (
            record.needsReview ===
            true
          );
        }
      )
      .sort(
        marketSort
      );


  // ----------------------------------------------------------
  // EXISTING REVIEWED EVIDENCE
  // ----------------------------------------------------------

  const existingEvidence =
    records
      .filter(
        function(record) {
          return (
            record.evidence.exists ===
            true
          );
        }
      )
      .sort(
        marketSort
      );


  // ----------------------------------------------------------
  // UNFLAGGED POPULATION
  // ----------------------------------------------------------

  const unflagged =
    records
      .filter(
        function(record) {
          return (
            record.needsReview ===
              false &&
            record.evidence.exists ===
              false
          );
        }
      )
      .sort(
        marketSort
      );


  // ----------------------------------------------------------
  // CANDIDATE SIGNAL COUNTS
  // ----------------------------------------------------------

  const candidateSignalCounts =
    initializeCounts(
      CANDIDATE_SIGNALS
    );


  records.forEach(
    function(record) {
      record.candidateSignals.forEach(
        function(signal) {
          if (
            typeof candidateSignalCounts[
              signal.code
            ] !==
            "number"
          ) {
            candidateSignalCounts[
              signal.code
            ] = 0;
          }

          candidateSignalCounts[
            signal.code
          ]++;
        }
      );
    }
  );


  // ----------------------------------------------------------
  // DIAGNOSTIC COUNTS
  // ----------------------------------------------------------

  const diagnosticCounts =
    initializeCounts(
      DIAGNOSTIC_SIGNALS
    );


  records.forEach(
    function(record) {
      record.diagnostics.forEach(
        function(signal) {
          if (
            typeof diagnosticCounts[
              signal.code
            ] !==
            "number"
          ) {
            diagnosticCounts[
              signal.code
            ] = 0;
          }

          diagnosticCounts[
            signal.code
          ]++;
        }
      );
    }
  );


  // ----------------------------------------------------------
  // ROOKIE ACCOUNTING
  // ----------------------------------------------------------

  const rookiePopulation =
    records.filter(
      function(record) {
        return (
          record.player.isRookie ===
          true
        );
      }
    );


  const rookiesWithEvidence =
    rookiePopulation.filter(
      function(record) {
        return (
          record.evidence.exists ===
          true
        );
      }
    );


  const rookiesNeedingReview =
    rookiePopulation.filter(
      function(record) {
        return (
          record.needsReview ===
          true
        );
      }
    );


  return {
    populationCount:
      records.length,

    evidenceRegistryCount:
      Object.keys(
        evidenceIndex
      ).length,

    candidateReviewCount:
      reviewQueue.length,

    existingEvidenceCount:
      existingEvidence.length,

    unflaggedCount:
      unflagged.length,

    rookiePopulationCount:
      rookiePopulation.length,

    rookiesWithEvidenceCount:
      rookiesWithEvidence.length,

    rookiesNeedingReviewCount:
      rookiesNeedingReview.length,

    candidateSignalCounts:
      candidateSignalCounts,

    diagnosticCounts:
      diagnosticCounts,

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
                "2F-v2",

              methodology: {
                population:
                  "Current context-intel/latest population.",

                purpose:
                  "Identify players whose circumstances warrant objective Context evidence review.",

                candidateRule:
                  "Only positive discovery evidence creates candidates. Missing historical data is diagnostic only.",

                currentCandidateTriggers: [
                  "rookie-without-reviewed-context-evidence"
                ],

                diagnosticOnlyConditions: [
                  "existing-context-evidence",
                  "no-opportunity-history",
                  "historical-team-unavailable",
                  "historical-team-available",
                  "potential-team-difference"
                ],

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

              existingEvidenceCount:
                report.existingEvidenceCount,

              unflaggedCount:
                report.unflaggedCount,

              rookiePopulationCount:
                report.rookiePopulationCount,

              rookiesWithEvidenceCount:
                report.rookiesWithEvidenceCount,

              rookiesNeedingReviewCount:
                report.rookiesNeedingReviewCount,

              candidateSignalCounts:
                report.candidateSignalCounts,

              diagnosticCounts:
                report.diagnosticCounts,

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

module.exports.CANDIDATE_SIGNALS =
  CANDIDATE_SIGNALS;

module.exports.DIAGNOSTIC_SIGNALS =
  DIAGNOSTIC_SIGNALS;

module.exports.buildDiscoveryRecord =
  buildDiscoveryRecord;

module.exports.marketSort =
  marketSort;

module.exports.buildDiscoveryReport =
  buildDiscoveryReport;
