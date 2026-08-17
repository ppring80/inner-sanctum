// netlify/functions/sage-pick-validation.js
//
// SAGE — PICK 13 VALIDATION ENDPOINT
//
// PHASE 2C — REAL CONTEXT INTEGRATION
//
// TEMPORARY, READ-ONLY diagnostic endpoint.
//
// PURPOSE:
// Freeze the real 12-team / full-PPR pick-13 test state and run the
// available production evidence through:
//
//   Step 2 — Opportunity
//   Step 3 — Market
//   Step 4 — Scarcity
//   Context Intelligence
//   Step 5 — SAGE Synthesis
//
// CONTEXT RULE:
// Context is read ONLY from the production "context-intel" Blob cache.
//
// No player-specific Context is manually injected here.
//
// If a player is:
//   contextStatus === "context-profiled"
// then their cached contextProfile is passed to SAGE.
//
// Otherwise:
//   contextProfile = null
//
// Nothing is written by this diagnostic endpoint.
// Nothing in draft.html is modified.

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
// FROZEN VALIDATION STATE
//
// 12-team snake
// Full PPR
// User drafts from slot 12
//
// Pick 12:
//   Ashton Jeanty — already selected
//
// Current decision:
//   Pick 13
//
// Next user turn:
//   Pick 36
// ------------------------------------------------------------

const VALIDATION_STATE = {
  leagueTeams: 12,
  scoring: "PPR",
  draftType: "snake",
  draftSlot: 12,

  currentPick: 13,
  nextUserPick: 36,

  rosterBeforePick: [
    {
      name: "Ashton Jeanty",
      pos: "RB",
      adp: 16.8
    }
  ]
};


// ------------------------------------------------------------
// REAL PICK-13 CANDIDATE SET
// ------------------------------------------------------------

const CANDIDATES = [
  {
    name: "A.J. Brown",
    pos: "WR",
    adp: 14.5
  },
  {
    name: "Nico Collins",
    pos: "WR",
    adp: 16.6
  },
  {
    name: "Chase Brown",
    pos: "RB",
    adp: 17.4
  },
  {
    name: "James Cook III",
    pos: "RB",
    adp: 17.7
  },
  {
    name: "Brock Bowers",
    pos: "TE",
    adp: 19.2
  },
  {
    name: "George Pickens",
    pos: "WR",
    adp: 20.3
  },
  {
    name: "Trey McBride",
    pos: "TE",
    adp: 20.4
  },
  {
    name: "Chris Olave",
    pos: "WR",
    adp: 21.1
  },
  {
    name: "De'Von Achane",
    pos: "RB",
    adp: 21.5
  },
  {
    name: "Rashee Rice",
    pos: "WR",
    adp: 22.2
  }
];


// ------------------------------------------------------------
// NEXT-TURN MARKET WINDOW
// ------------------------------------------------------------

const NEXT_TURN_POOL = [
  {
    name: "Tetairoa McMillan",
    pos: "WR",
    adp: 33.7
  },
  {
    name: "Tee Higgins",
    pos: "WR",
    adp: 35.1
  },
  {
    name: "Ladd McConkey",
    pos: "WR",
    adp: 36.1
  },
  {
    name: "Jaylen Waddle",
    pos: "WR",
    adp: 36.8
  },
  {
    name: "Emeka Egbuka",
    pos: "WR",
    adp: 37.1
  },
  {
    name: "Derrick Henry",
    pos: "RB",
    adp: 38.6
  },
  {
    name: "Colston Loveland",
    pos: "TE",
    adp: 38.9
  },
  {
    name: "Jeremiyah Love",
    pos: "RB",
    adp: 39.1
  },
  {
    name: "Breece Hall",
    pos: "RB",
    adp: 40.2
  }
];


// ------------------------------------------------------------
// NAME NORMALIZATION
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


// ------------------------------------------------------------
// OPPORTUNITY RECORD LOOKUP
// ------------------------------------------------------------

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


// ------------------------------------------------------------
// CONTEXT RECORD LOOKUP
// ------------------------------------------------------------

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


// ------------------------------------------------------------
// CONTEXT PROFILE LOOKUP
//
// Only explicitly profiled Context is allowed into SAGE.
// ------------------------------------------------------------

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


// ------------------------------------------------------------
// ATTACH BOARD ADP TO OPPORTUNITY RECORD
// ------------------------------------------------------------

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


// ------------------------------------------------------------
// BUILD OPPORTUNITY POOL
// ------------------------------------------------------------

function buildOpportunityPool(
  opportunityCache,
  players
) {
  return players
    .map(function(player) {
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
    })
    .filter(Boolean);
}


// ------------------------------------------------------------
// ONE PLAYER — FULL SAGE READ
// ------------------------------------------------------------

function buildPlayerValidation(
  opportunityCache,
  contextCache,
  player,
  currentPool,
  nextTurnPool
) {
  const rawRecord =
    getOpportunityRecord(
      opportunityCache,
      player
    );

  const contextRecord =
    getContextRecord(
      contextCache,
      player
    );

  const contextProfile =
    getProductionContextProfile(
      contextCache,
      player
    );

  if (!rawRecord) {
    return {
      player:
        player,

      status:
        "missing-opportunity-intelligence",

      opportunityProfile:
        null,

      marketProfile:
        buildDraftMarketProfile({
          adp:
            player.adp,

          currentPick:
            VALIDATION_STATE.currentPick,

          nextUserPick:
            VALIDATION_STATE.nextUserPick
        }),

      scarcityProfile:
        null,

      contextStatus:
        contextRecord
          ? contextRecord.contextStatus
          : "not-in-context-cache",

      contextProfile:
        contextProfile,

      sage:
        null
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


  const marketProfile =
    buildDraftMarketProfile({
      adp:
        player.adp,

      currentPick:
        VALIDATION_STATE.currentPick,

      nextUserPick:
        VALIDATION_STATE.nextUserPick
    });


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
    player:
      player,

    status:
      "ok",

    opportunityProfile:
      opportunityProfile,

    marketProfile:
      marketProfile,

    scarcityProfile:
      scarcityProfile,

    contextStatus:
      contextRecord
        ? contextRecord.contextStatus
        : "not-in-context-cache",

    contextProfile:
      contextProfile,

    sage:
      sage
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
                  'No cached Context Intelligence data found for key "latest". Run refresh-context-intel first.'
              },
              null,
              2
            )
        };
      }


      const currentPool =
        buildOpportunityPool(
          opportunityCache,
          CANDIDATES
        );


      const nextTurnPool =
        buildOpportunityPool(
          opportunityCache,
          NEXT_TURN_POOL
        );


      const missingCandidates =
        CANDIDATES
          .filter(function(player) {
            return !getOpportunityRecord(
              opportunityCache,
              player
            );
          })
          .map(function(player) {
            return {
              name:
                player.name,

              pos:
                player.pos,

              adp:
                player.adp,

              key:
                playerKey(
                  player
                )
            };
          });


      const missingNextTurn =
        NEXT_TURN_POOL
          .filter(function(player) {
            return !getOpportunityRecord(
              opportunityCache,
              player
            );
          })
          .map(function(player) {
            return {
              name:
                player.name,

              pos:
                player.pos,

              adp:
                player.adp,

              key:
                playerKey(
                  player
                )
            };
          });


      const results =
        CANDIDATES.map(
          function(player) {
            return buildPlayerValidation(
              opportunityCache,
              contextCache,
              player,
              currentPool,
              nextTurnPool
            );
          }
        );


      const contextProfiledCandidates =
        results
          .filter(function(result) {
            return (
              result.contextStatus ===
              "context-profiled"
            );
          })
          .map(function(result) {
            return {
              name:
                result.player.name,

              pos:
                result.player.pos,

              contextProfile:
                result.contextProfile
            };
          });


      return {
        statusCode:
          200,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              validation:
                "SAGE Pick 13 — Context Integrated",

              opportunityComputedAt:
                opportunityCache.computedAt ||
                null,

              contextComputedAt:
                contextCache.computedAt ||
                null,

              contextPhase:
                contextCache.phase ||
                null,

              state:
                VALIDATION_STATE,

              humanBenchmark: {
                pick12:
                  "Ashton Jeanty",

                pick13:
                  "Chase Brown"
              },

              contextSummary: {
                available:
                  true,

                productionSource:
                  "context-intel/latest",

                totalContextPopulation:
                  contextCache.populationCount ||
                  null,

                totalContextProfiled:
                  contextCache.contextProfiledCount ||
                  0,

                profiledCandidatesInThisDecision:
                  contextProfiledCandidates
              },

              candidateCount:
                CANDIDATES.length,

              candidateOpportunityMatches:
                currentPool.length,

              nextTurnCount:
                NEXT_TURN_POOL.length,

              nextTurnOpportunityMatches:
                nextTurnPool.length,

              missingCandidates:
                missingCandidates,

              missingNextTurn:
                missingNextTurn,

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
                "SAGE Context-integrated pick validation failed",

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

module.exports.playerKey =
  playerKey;

module.exports.getOpportunityRecord =
  getOpportunityRecord;

module.exports.getContextRecord =
  getContextRecord;

module.exports.getProductionContextProfile =
  getProductionContextProfile;

module.exports.attachAdp =
  attachAdp;

module.exports.buildOpportunityPool =
  buildOpportunityPool;

module.exports.buildPlayerValidation =
  buildPlayerValidation;

module.exports.VALIDATION_STATE =
  VALIDATION_STATE;

module.exports.CANDIDATES =
  CANDIDATES;

module.exports.NEXT_TURN_POOL =
  NEXT_TURN_POOL;
