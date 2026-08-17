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
// The difference between those two SAGE outputs is therefore
// attributable to Context.
//
// READ-ONLY.
// DOES NOT write Blobs.
// DOES NOT modify SAGE.
// DOES NOT modify Context.
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
//     High-impact rookie
//
//   Rachaad White
//     Neutral environment / reduced role
//
//   Chase Brown
//     Baseline-only control
//
// IMPORTANT:
// This is a diagnostic endpoint, not a draft recommendation endpoint.
// Its purpose is to prove directional Context behavior.

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
// CACHE RECORD LOOKUPS
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
// ADP HELPERS
// ------------------------------------------------------------

function numericAdp(record) {
  if (!record) {
    return null;
  }

  const value =
    Number(
      record.adp
    );

  return Number.isFinite(
    value
  )
    ? value
    : null;
}


// ------------------------------------------------------------
// BUILD OPPORTUNITY UNIVERSE
//
// Scarcity uses real Opportunity records from the cache.
//
// We preserve the existing cached data and use current ADP.
// ------------------------------------------------------------

function buildOpportunityUniverse(
  opportunityCache
) {
  const records =
    opportunityCache &&
    opportunityCache.records
      ? opportunityCache.records
      : {};

  return Object.values(
    records
  )
    .filter(function(record) {
      if (!record) {
        return false;
      }

      const pos =
        normalizePosition(
          record.pos
        );

      return [
        "QB",
        "RB",
        "WR",
        "TE"
      ].includes(pos);
    })
    .filter(function(record) {
      return (
        numericAdp(
          record
        ) !==
        null
      );
    })
    .slice()
    .sort(function(a, b) {
      return (
        numericAdp(a) -
        numericAdp(b)
      );
    });
}


// ------------------------------------------------------------
// LOCAL MARKET WINDOW
//
// This diagnostic is not pretending all five players are available
// at the same actual draft pick.
//
// Instead, each player is evaluated at approximately their current
// market price.
//
// The important comparison is CONTROL vs CONTEXT for the SAME
// player. These market/scarcity inputs are identical in both runs.
// ------------------------------------------------------------

function buildDiagnosticDraftState(
  record
) {
  const adp =
    numericAdp(
      record
    );

  if (adp === null) {
    return null;
  }

  const currentPick =
    Math.max(
      1,
      Math.round(
        adp
      )
    );

  // 12-team diagnostic horizon:
  // approximately two rounds later.
  //
  // This value is used identically in the control and context runs.
  const nextUserPick =
    currentPick +
    24;

  return {
    adp:
      adp,

    currentPick:
      currentPick,

    nextUserPick:
      nextUserPick
  };
}


// ------------------------------------------------------------
// LOCAL SCARCITY WINDOWS
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
          numericAdp(
            record
          );

        return (
          adp !== null &&
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
          numericAdp(
            record
          );

        return (
          adp !== null &&
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
// ONE PLAYER — CONTROL vs CONTEXT
// ------------------------------------------------------------

function buildPlayerTest(
  opportunityCache,
  contextCache,
  universe,
  player
) {
  const opportunityRecord =
    getOpportunityRecord(
      opportunityCache,
      player
    );


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


  if (!opportunityRecord) {
    return {
      player:
        player,

      status:
        "missing-opportunity-intelligence",

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
      opportunityRecord
    );


  if (!state) {
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


  const opportunityProfile =
    buildDraftOpportunityProfile(
      opportunityRecord
    );


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


  const scarcityProfile =
    buildDraftScarcityProfile({
      candidate:
        opportunityRecord,

      currentPool:
        pools.currentPool,

      nextTurnPool:
        pools.nextTurnPool
    });


  // ----------------------------------------------------------
  // CONTROL
  //
  // Exact same player evidence, but Context intentionally absent.
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

  const productionContextProfile =
    contextRecord &&
    contextRecord.contextStatus ===
      "context-profiled"
      ? contextRecord.contextProfile
      : null;


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
        opportunityRecord.playerID ||
        (
          contextRecord
            ? contextRecord.playerID
            : null
        ),

      team:
        contextRecord
          ? contextRecord.team
          : null,

      adp:
        state.adp
    },

    status:
      "ok",

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
      contextRecord
        ? contextRecord.contextStatus
        : "missing-context-record",

    contextValidation:
      contextValidation,

    contextProfile:
      productionContextProfile,


    // These three profiles are shared by BOTH SAGE runs.
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


    // --------------------------------------------------------
    // DELTA
    //
    // Keep this intentionally simple and inspectable.
    // No hidden numeric score is introduced.
    // --------------------------------------------------------

    delta: {
      recommendationChanged:
        JSON.stringify(
          controlSage &&
          controlSage.recommendation
        ) !==
        JSON.stringify(
          contextSage &&
          contextSage.recommendation
        ),

      explanationChanged:
        JSON.stringify(
          controlSage &&
          controlSage.explanation
        ) !==
        JSON.stringify(
          contextSage &&
          contextSage.explanation
        ),

      reasonsChanged:
        JSON.stringify(
          controlSage &&
          controlSage.reasons
        ) !==
        JSON.stringify(
          contextSage &&
          contextSage.reasons
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


  return {
    validationPlayerCount:
      results.length,

    successfulPlayerCount:
      okResults.length,

    contextValidationFailureCount:
      contextValidationFailures.length,

    contextChangedSageCount:
      changedByContext.length,

    contextChangedPlayers:
      changedByContext.map(
        function(result) {
          return {
            name:
              result.player.name,

            archetype:
              result.player.archetype,

            recommendationChanged:
              result.delta.recommendationChanged,

            explanationChanged:
              result.delta.explanationChanged,

            reasonsChanged:
              result.delta.reasonsChanged
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
        buildOpportunityUniverse(
          opportunityCache
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


      return {
        statusCode:
          summary.contextValidationFailureCount ===
          0
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
                "2D",

              methodology: {
                description:
                  "Each player is run through SAGE twice with identical Opportunity, Market, and Scarcity profiles. The second run adds only the production Context profile.",

                control:
                  "Opportunity + Market + Scarcity",

                treatment:
                  "Opportunity + Market + Scarcity + Context",

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

module.exports.numericAdp =
  numericAdp;

module.exports.buildOpportunityUniverse =
  buildOpportunityUniverse;

module.exports.buildDiagnosticDraftState =
  buildDiagnosticDraftState;

module.exports.buildScarcityPools =
  buildScarcityPools;

module.exports.buildPlayerTest =
  buildPlayerTest;

module.exports.buildSummary =
  buildSummary;
