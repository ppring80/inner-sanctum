// netlify/functions/sage-context-validation.js
//
// SAGE — CONTEXT DIRECTIONAL VALIDATION
//
// PHASE 2D
//
// PURPOSE:
// Validate that production Context Intelligence influences SAGE
// in the intended direction without changing Opportunity,
// Market, or Scarcity inputs.
//
// For each player:
//
//   CONTROL RUN
//     Opportunity + Market + Scarcity + NO Context
//
//   CONTEXT RUN
//     SAME Opportunity + SAME Market + SAME Scarcity
//     + production Context profile
//
// The difference between those two SAGE outputs is attributable
// to Context.
//
// READ-ONLY.
// DOES NOT write Blobs.
// DOES NOT modify SAGE.
// DOES NOT modify Context.
//
// IMPORTANT:
// - ADP is read from context-intel/latest.
// - Veterans use real Opportunity Intelligence when available.
// - A rookie with no historical Opportunity record receives an
//   explicit "No NFL History" Opportunity profile.
// - No NFL production is fabricated.
//
// VALIDATION ARCHETYPES:
//
//   A.J. Brown
//     Positive environment / similar role
//
//   Ashton Jeanty
//     Positive environment / improved role
//
//   Jeremiyah Love
//     High-impact rookie / No NFL History
//
//   Rachaad White
//     Neutral environment / reduced role
//
//   Chase Brown
//     Baseline-only control

const {
  getStore,
  connectLambda
} = require("@netlify/blobs");

const {
  buildDraftOpportunityProfile
} = require("./draft-opportunity-profile");

const {
  buildDraftMarketProfile
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};


// ------------------------------------------------------------
// VALIDATION PLAYERS
// ------------------------------------------------------------

const VALIDATION_PLAYERS = [
  {
    name:
      "A.J. Brown",

    pos:
      "WR",

    archetype:
      "positive-environment",

    expectedContext: {
      environmentChange:
        "Positive",

      roleOpportunity:
        "Similar",

      rookieImpact:
        "Not Applicable",

      contextConfidence:
        "Strong"
    }
  },

  {
    name:
      "Ashton Jeanty",

    pos:
      "RB",

    archetype:
      "positive-role",

    expectedContext: {
      environmentChange:
        "Positive",

      roleOpportunity:
        "Improved",

      rookieImpact:
        "Not Applicable",

      contextConfidence:
        "Strong"
    }
  },

  {
    name:
      "Jeremiyah Love",

    pos:
      "RB",

    archetype:
      "high-impact-rookie",

    expectedContext: {
      environmentChange:
        "Neutral",

      roleOpportunity:
        "Uncertain",

      rookieImpact:
        "High",

      contextConfidence:
        "Strong"
    }
  },

  {
    name:
      "Rachaad White",

    pos:
      "RB",

    archetype:
      "reduced-role",

    expectedContext: {
      environmentChange:
        "Neutral",

      roleOpportunity:
        "Reduced",

      rookieImpact:
        "Not Applicable",

      contextConfidence:
        "Strong"
    }
  },

  {
    name:
      "Chase Brown",

    pos:
      "RB",

    archetype:
      "baseline-control",

    expectedContext:
      null
  }
];


// ------------------------------------------------------------
// PLAYER IDENTITY
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
// CACHE LOOKUPS
// ------------------------------------------------------------

function getOpportunityRecord(
  opportunityCache,
  player
) {
  const records =
    opportunityCache &&
    opportunityCache.records
      ? opportunityCache.records
      : {};

  return (
    records[
      playerKey(
        player.name,
        player.pos
      )
    ] ||
    null
  );
}


function getContextRecord(
  contextCache,
  player
) {
  const records =
    contextCache &&
    contextCache.records
      ? contextCache.records
      : {};

  return (
    records[
      playerKey(
        player.name,
        player.pos
      )
    ] ||
    null
  );
}


// ------------------------------------------------------------
// LABEL EXTRACTION
// ------------------------------------------------------------

function profileLabel(
  profile,
  field
) {
  if (
    !profile ||
    !profile[field]
  ) {
    return null;
  }

  if (
    typeof profile[field] ===
    "string"
  ) {
    return profile[field];
  }

  if (
    typeof profile[field].label ===
    "string"
  ) {
    return profile[field].label;
  }

  return null;
}


// ------------------------------------------------------------
// CONTEXT EXPECTATION CHECK
// ------------------------------------------------------------

function validateContextProfile(
  contextRecord,
  expected
) {
  if (!expected) {
    return {
      passed:
        (
          !contextRecord ||
          contextRecord.contextStatus !==
            "context-profiled"
        ),

      expected:
        "baseline-only",

      actualStatus:
        contextRecord
          ? contextRecord.contextStatus
          : "missing"
    };
  }


  if (
    !contextRecord ||
    contextRecord.contextStatus !==
      "context-profiled" ||
    !contextRecord.contextProfile
  ) {
    return {
      passed:
        false,

      expected:
        expected,

      actualStatus:
        contextRecord
          ? contextRecord.contextStatus
          : "missing"
    };
  }


  const profile =
    contextRecord.contextProfile;


  const actual = {
    environmentChange:
      profileLabel(
        profile,
        "environmentChange"
      ),

    roleOpportunity:
      profileLabel(
        profile,
        "roleOpportunity"
      ),

    rookieImpact:
      profileLabel(
        profile,
        "rookieImpact"
      ),

    contextConfidence:
      profileLabel(
        profile,
        "contextConfidence"
      )
  };


  return {
    passed:
      (
        actual.environmentChange ===
          expected.environmentChange &&

        actual.roleOpportunity ===
          expected.roleOpportunity &&

        actual.rookieImpact ===
          expected.rookieImpact &&

        actual.contextConfidence ===
          expected.contextConfidence
      ),

    expected:
      expected,

    actual:
      actual
  };
}


// ------------------------------------------------------------
// ADP
//
// ADP comes from context-intel/latest because Opportunity records
// do not carry market ADP.
// ------------------------------------------------------------

function getContextAdp(
  contextRecord
) {
  if (!contextRecord) {
    return null;
  }

  const value =
    Number(
      contextRecord.adp
    );

  return Number.isFinite(
    value
  )
    ? value
    : null;
}


// ------------------------------------------------------------
// ROOKIE / NO NFL HISTORY PROFILE
//
// This is NOT manufactured production.
//
// It explicitly tells Step 5:
//   there is no NFL Opportunity history.
//
// draft-sage-synthesis.js already contains a dedicated
// No NFL History branch.
// ------------------------------------------------------------

function buildNoNFLHistoryOpportunityProfile(
  player
) {
  return {
    player: {
      playerID:
        player &&
        player.playerID
          ? player.playerID
          : null,

      longName:
        player &&
        player.longName
          ? player.longName
          : null,

      pos:
        player &&
        player.pos
          ? player.pos
          : null
    },

    workload: {
      level:
        "No NFL History"
    },

    roleDirection: {
      label:
        "No NFL History"
    },

    roleStyle: {
      label:
        "No NFL History"
    },

    evidence: {
      level:
        "Limited"
    }
  };
}


// ------------------------------------------------------------
// BUILD SHARED OPPORTUNITY PROFILE
// ------------------------------------------------------------

function buildSharedOpportunityProfile(
  opportunityRecord,
  contextRecord
) {
  if (opportunityRecord) {
    return {
      source:
        "production-opportunity",

      profile:
        buildDraftOpportunityProfile(
          opportunityRecord
        )
    };
  }


  if (
    contextRecord &&
    contextRecord.isRookie ===
      true
  ) {
    return {
      source:
        "explicit-no-nfl-history",

      profile:
        buildNoNFLHistoryOpportunityProfile(
          {
            playerID:
              contextRecord.playerID,

            longName:
              contextRecord.longName,

            pos:
              contextRecord.pos
          }
        )
    };
  }


  return {
    source:
      "missing",

    profile:
      null
  };
}


// ------------------------------------------------------------
// SCARCITY UNIVERSE
//
// Use Opportunity cache records where historical Opportunity exists.
// Join ADP from context cache.
//
// Rookie Context records without Opportunity history can still be
// added to the universe as market-visible candidates.
// ------------------------------------------------------------

function buildScarcityUniverse(
  opportunityCache,
  contextCache
) {
  const opportunityRecords =
    opportunityCache &&
    opportunityCache.records
      ? opportunityCache.records
      : {};

  const contextRecords =
    contextCache &&
    contextCache.records
      ? contextCache.records
      : {};

  const universe = [];


  Object.keys(
    contextRecords
  ).forEach(function(key) {
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

    const adp =
      getContextAdp(
        contextRecord
      );

    if (adp === null) {
      return;
    }


    const opportunityRecord =
      opportunityRecords[key] ||
      null;


    if (opportunityRecord) {
      universe.push(
        Object.assign(
          {},
          opportunityRecord,
          {
            adp:
              adp,

            longName:
              opportunityRecord.longName ||
              contextRecord.longName,

            pos:
              opportunityRecord.pos ||
              contextRecord.pos
          }
        )
      );

      return;
    }


    // Rookie/no-history market-visible record.
    universe.push({
      playerID:
        contextRecord.playerID ||
        null,

      longName:
        contextRecord.longName,

      pos:
        contextRecord.pos,

      adp:
        adp,

      workload: {
        level:
          "No NFL History"
      },

      roleDirection: {
        label:
          "No NFL History"
      },

      evidence: {
        level:
          "Limited"
      }
    });
  });


  return universe
    .slice()
    .sort(function(a, b) {
      return (
        Number(a.adp) -
        Number(b.adp)
      );
    });
}


// ------------------------------------------------------------
// DIAGNOSTIC DRAFT STATE
//
// Each player is tested around his own current market price.
//
// CONTROL and CONTEXT runs use identical timing inputs.
// ------------------------------------------------------------

function buildDiagnosticDraftState(
  adp
) {
  if (
    !Number.isFinite(
      Number(adp)
    )
  ) {
    return null;
  }

  const numeric =
    Number(
      adp
    );

  const currentPick =
    Math.max(
      1,
      Math.round(
        numeric
      )
    );

  return {
    adp:
      numeric,

    currentPick:
      currentPick,

    nextUserPick:
      currentPick +
      24
  };
}


// ------------------------------------------------------------
// SCARCITY WINDOWS
// ------------------------------------------------------------

function buildScarcityPools(
  universe,
  state
) {
  if (
    !state ||
    !Array.isArray(
      universe
    )
  ) {
    return {
      currentPool:
        [],

      nextTurnPool:
        []
    };
  }


  const currentPool =
    universe.filter(
      function(record) {
        const adp =
          Number(
            record.adp
          );

        return (
          Number.isFinite(adp) &&
          adp >=
            (
              state.currentPick -
              6
            ) &&
          adp <=
            (
              state.currentPick +
              12
            )
        );
      }
    );


  const nextTurnPool =
    universe.filter(
      function(record) {
        const adp =
          Number(
            record.adp
          );

        return (
          Number.isFinite(adp) &&
          adp >=
            (
              state.nextUserPick -
              6
            ) &&
          adp <=
            (
              state.nextUserPick +
              12
            )
        );
      }
    );


  return {
    currentPool:
      currentPool,

    nextTurnPool:
      nextTurnPool
  };
}


// ------------------------------------------------------------
// CANDIDATE RECORD FOR SCARCITY
// ------------------------------------------------------------

function buildScarcityCandidate(
  opportunityRecord,
  contextRecord,
  adp
) {
  if (opportunityRecord) {
    return Object.assign(
      {},
      opportunityRecord,
      {
        adp:
          adp
      }
    );
  }


  return {
    playerID:
      contextRecord
        ? contextRecord.playerID
        : null,

    longName:
      contextRecord
        ? contextRecord.longName
        : null,

    pos:
      contextRecord
        ? contextRecord.pos
        : null,

    adp:
      adp,

    workload: {
      level:
        "No NFL History"
    },

    roleDirection: {
      label:
        "No NFL History"
    },

    evidence: {
      level:
        "Limited"
    }
  };
}


// ------------------------------------------------------------
// ONE PLAYER — CONTROL vs CONTEXT
// ------------------------------------------------------------

function buildPlayerTest(
  opportunityCache,
  contextCache,
  universe,
  player
) {
  const contextRecord =
    getContextRecord(
      contextCache,
      player
    );


  const contextValidation =
    validateContextProfile(
      contextRecord,
      player.expectedContext
    );


  if (!contextRecord) {
    return {
      player:
        player,

      status:
        "missing-context-record",

      contextValidation:
        contextValidation,

      control:
        null,

      withContext:
        null
    };
  }


  const adp =
    getContextAdp(
      contextRecord
    );


  if (adp === null) {
    return {
      player:
        player,

      status:
        "missing-adp",

      contextValidation:
        contextValidation,

      control:
        null,

      withContext:
        null
    };
  }


  const opportunityRecord =
    getOpportunityRecord(
      opportunityCache,
      player
    );


  const opportunityResult =
    buildSharedOpportunityProfile(
      opportunityRecord,
      contextRecord
    );


  if (!opportunityResult.profile) {
    return {
      player:
        player,

      status:
        "missing-opportunity-and-not-rookie",

      contextValidation:
        contextValidation,

      control:
        null,

      withContext:
        null
    };
  }


  const state =
    buildDiagnosticDraftState(
      adp
    );


  const opportunityProfile =
    opportunityResult.profile;


  const marketProfile =
    buildDraftMarketProfile({
      adp:
        state.adp,

      currentPick:
        state.currentPick,

      nextUserPick:
        state.nextUserPick
    });


  const pools =
    buildScarcityPools(
      universe,
      state
    );


  const candidate =
    buildScarcityCandidate(
      opportunityRecord,
      contextRecord,
      adp
    );


  const scarcityProfile =
    buildDraftScarcityProfile({
      candidate:
        candidate,

      currentPool:
        pools.currentPool,

      nextTurnPool:
        pools.nextTurnPool
    });


  const productionContextProfile =
    contextRecord.contextStatus ===
      "context-profiled"
      ? contextRecord.contextProfile
      : null;


  // ----------------------------------------------------------
  // CONTROL RUN
  // ----------------------------------------------------------

  const controlSage =
    buildRecommendation({
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile,

      contextProfile:
        null
    });


  // ----------------------------------------------------------
  // CONTEXT RUN
  // ----------------------------------------------------------

  const contextSage =
    buildRecommendation({
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile,

      contextProfile:
        productionContextProfile
    });


  return {
    player: {
      name:
        player.name,

      pos:
        player.pos,

      archetype:
        player.archetype,

      playerID:
        contextRecord.playerID ||
        (
          opportunityRecord
            ? opportunityRecord.playerID
            : null
        ),

      team:
        contextRecord.team ||
        null,

      adp:
        adp,

      marketRank:
        contextRecord.marketRank ||
        null
    },

    status:
      "ok",

    opportunitySource:
      opportunityResult.source,

    diagnosticState: {
      currentPick:
        state.currentPick,

      nextUserPick:
        state.nextUserPick,

      currentPoolCount:
        pools.currentPool.length,

      nextTurnPoolCount:
        pools.nextTurnPool.length
    },

    contextStatus:
      contextRecord.contextStatus,

    contextValidation:
      contextValidation,

    contextProfile:
      productionContextProfile,


    // --------------------------------------------------------
    // THESE INPUTS ARE IDENTICAL IN BOTH SAGE RUNS
    // --------------------------------------------------------

    sharedInputs: {
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile
    },


    control: {
      contextApplied:
        false,

      sage:
        controlSage
    },


    withContext: {
      contextApplied:
        !!productionContextProfile,

      sage:
        contextSage
    },


    delta: {
      recommendationChanged:
        (
          controlSage &&
          contextSage &&
          controlSage.code !==
            contextSage.code
        ),

      controlRecommendation:
        controlSage
          ? controlSage.recommendation
          : null,

      contextRecommendation:
        contextSage
          ? contextSage.recommendation
          : null,

      explanationChanged:
        (
          controlSage &&
          contextSage &&
          controlSage.explanation !==
            contextSage.explanation
        ),

      reasonsChanged:
        JSON.stringify(
          controlSage
            ? controlSage.reasons
            : null
        ) !==
        JSON.stringify(
          contextSage
            ? contextSage.reasons
            : null
        )
    }
  };
}


// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------

function buildSummary(
  results
) {
  const okResults =
    results.filter(
      function(result) {
        return (
          result.status ===
          "ok"
        );
      }
    );


  const contextValidationFailures =
    results.filter(
      function(result) {
        return (
          !result.contextValidation ||
          result.contextValidation.passed !==
            true
        );
      }
    );


  const changedByContext =
    okResults.filter(
      function(result) {
        return (
          result.delta &&
          (
            result.delta.recommendationChanged ||
            result.delta.explanationChanged ||
            result.delta.reasonsChanged
          )
        );
      }
    );


  const unchanged =
    okResults.filter(
      function(result) {
        return (
          result.delta &&
          !result.delta.recommendationChanged &&
          !result.delta.explanationChanged &&
          !result.delta.reasonsChanged
        );
      }
    );


  return {
    validationPlayerCount:
      results.length,

    successfulPlayerCount:
      okResults.length,

    contextValidationFailureCount:
      contextValidationFailures.length,

    contextChangedSageCount:
      changedByContext.length,

    contextUnchangedSageCount:
      unchanged.length,

    contextChangedPlayers:
      changedByContext.map(
        function(result) {
          return {
            name:
              result.player.name,

            archetype:
              result.player.archetype,

            controlRecommendation:
              result.delta.controlRecommendation,

            contextRecommendation:
              result.delta.contextRecommendation,

            recommendationChanged:
              result.delta.recommendationChanged,

            explanationChanged:
              result.delta.explanationChanged,

            reasonsChanged:
              result.delta.reasonsChanged
          };
        }
      ),

    unchangedPlayers:
      unchanged.map(
        function(result) {
          return {
            name:
              result.player.name,

            archetype:
              result.player.archetype
          };
        }
      )
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


      const universe =
        buildScarcityUniverse(
          opportunityCache,
          contextCache
        );


      const results =
        VALIDATION_PLAYERS.map(
          function(player) {
            return buildPlayerTest(
              opportunityCache,
              contextCache,
              universe,
              player
            );
          }
        );


      const summary =
        buildSummary(
          results
        );


      const allPlayersSuccessful =
        summary.successfulPlayerCount ===
        summary.validationPlayerCount;


      return {
        statusCode:
          (
            summary.contextValidationFailureCount ===
              0 &&
            allPlayersSuccessful
          )
            ? 200
            : 409,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              validation:
                "SAGE Context Directional Validation",

              phase:
                "2D-v2",

              methodology: {
                description:
                  "Each player is run through SAGE twice with identical Opportunity, Market, and Scarcity profiles. The second run adds only the production Context profile.",

                control:
                  "Opportunity + Market + Scarcity",

                treatment:
                  "Opportunity + Market + Scarcity + Context",

                adpSource:
                  "context-intel/latest",

                rookieOpportunityRule:
                  "If a rookie has no production Opportunity record, use an explicit No NFL History profile rather than fabricating NFL production.",

                hiddenNumericContextScore:
                  false
              },

              opportunityComputedAt:
                opportunityCache.computedAt ||
                null,

              contextComputedAt:
                contextCache.computedAt ||
                null,

              contextPhase:
                contextCache.phase ||
                null,

              contextPopulationCount:
                contextCache.populationCount ||
                null,

              contextProfiledCount:
                contextCache.contextProfiledCount ||
                0,

              summary:
                summary,

              results:
                results
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
                "SAGE Context directional validation failed",

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

module.exports.VALIDATION_PLAYERS =
  VALIDATION_PLAYERS;

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.normalizePosition =
  normalizePosition;

module.exports.playerKey =
  playerKey;

module.exports.getOpportunityRecord =
  getOpportunityRecord;

module.exports.getContextRecord =
  getContextRecord;

module.exports.profileLabel =
  profileLabel;

module.exports.validateContextProfile =
  validateContextProfile;

module.exports.getContextAdp =
  getContextAdp;

module.exports.buildNoNFLHistoryOpportunityProfile =
  buildNoNFLHistoryOpportunityProfile;

module.exports.buildSharedOpportunityProfile =
  buildSharedOpportunityProfile;

module.exports.buildScarcityUniverse =
  buildScarcityUniverse;

module.exports.buildDiagnosticDraftState =
  buildDiagnosticDraftState;

module.exports.buildScarcityPools =
  buildScarcityPools;

module.exports.buildScarcityCandidate =
  buildScarcityCandidate;

module.exports.buildPlayerTest =
  buildPlayerTest;

module.exports.buildSummary =
  buildSummary;
