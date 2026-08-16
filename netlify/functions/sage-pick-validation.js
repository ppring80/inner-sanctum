// netlify/functions/sage-pick-validation.js
//
// SAGE — PICK 13 VALIDATION ENDPOINT
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
//   Step 5 v2 — SAGE Synthesis
//
// CONTEXT NOTE:
// The Context calculation module exists, but there is not yet a production
// 256-player Context data/cache pipeline. Therefore this endpoint does NOT
// invent Context evidence for any player.
//
// That means:
//   - A.J. Brown's team/QB change is NOT manually injected here.
//   - Rookie/context assumptions are NOT manually injected here.
//   - Step 5 receives no Context evidence.
//
// This gives us a clean BASELINE validation using only production evidence
// that currently exists.
//
// Nothing is written to Netlify Blobs.
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
//   Picks 36 / 37
//
// We use pick 36 as the first deterministic next-pick boundary
// for the Step 3 market read.
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
//
// Taken from the Draft Command Center board at the frozen
// decision state.
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
//
// These are players surrounding the user's next turn at
// picks 36 / 37.
//
// This is NOT a claim that any specific player will survive.
// It is a market window used by Step 4 to measure comparable
// positional opportunity near the next turn.
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
//
// Must match Opportunity Intelligence key convention.
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


function opportunityKey(player) {
  return (
    normalizePlayerName(player.name) +
    "|" +
    String(player.pos || "").toUpperCase()
  );
}


// ------------------------------------------------------------
// ATTACH BOARD ADP TO A REAL OPPORTUNITY RECORD
//
// This creates a shallow diagnostic wrapper only.
// The cached Opportunity record itself is not mutated.
// ------------------------------------------------------------

function attachAdp(record, player) {
  if (!record) {
    return null;
  }

  return Object.assign(
    {},
    record,
    {
      adp: player.adp
    }
  );
}


// ------------------------------------------------------------
// FIND REAL CACHED RECORD
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

  return records[
    opportunityKey(player)
  ] || null;
}


// ------------------------------------------------------------
// BUILD A REAL POOL FROM THE CACHED OPPORTUNITY DATA
//
// Missing players remain visible in the diagnostic output,
// but are NOT turned into fake Opportunity records.
// ------------------------------------------------------------

function buildOpportunityPool(
  cached,
  players
) {
  return players
    .map((player) => {
      const record =
        getOpportunityRecord(
          cached,
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
// ONE PLAYER — FULL BASELINE SAGE READ
// ------------------------------------------------------------

function buildPlayerValidation(
  cached,
  player,
  currentPool,
  nextTurnPool
) {
  const rawRecord =
    getOpportunityRecord(
      cached,
      player
    );

  if (!rawRecord) {
    return {
      player: player,

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

      contextProfile:
        null,

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

  // IMPORTANT:
  // No production Context cache exists yet.
  //
  // We intentionally pass no Context profile rather than manually
  // manufacturing evidence for A.J. Brown, rookies, coaching changes, etc.
  const contextProfile =
    null;

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
    player: player,

    status:
      "ok",

    opportunityProfile:
      opportunityProfile,

    marketProfile:
      marketProfile,

    scarcityProfile:
      scarcityProfile,

    contextProfile:
      contextProfile,

    contextStatus:
      "not-production-sourced",

    sage:
      sage
  };
}


// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

exports.handler = async (event) => {
  connectLambda(event);

  if (
    event.httpMethod ===
    "OPTIONS"
  ) {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ""
    };
  }

  if (
    event.httpMethod !==
    "GET"
  ) {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error:
          "GET only"
      })
    };
  }

  try {
    const store =
      getStore({
        name:
          "opportunity-intel"
      });

    const cached =
      await store.get(
        "latest",
        {
          type:
            "json"
        }
      );

    if (!cached) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify(
          {
            error:
              'No cached Opportunity Intelligence data found for key "latest".'
          },
          null,
          2
        )
      };
    }

    const currentPool =
      buildOpportunityPool(
        cached,
        CANDIDATES
      );

    const nextTurnPool =
      buildOpportunityPool(
        cached,
        NEXT_TURN_POOL
      );

    const missingCandidates =
      CANDIDATES
        .filter((player) => {
          return !getOpportunityRecord(
            cached,
            player
          );
        })
        .map((player) => ({
          name:
            player.name,

          pos:
            player.pos,

          adp:
            player.adp,

          key:
            opportunityKey(
              player
            )
        }));

    const missingNextTurn =
      NEXT_TURN_POOL
        .filter((player) => {
          return !getOpportunityRecord(
            cached,
            player
          );
        })
        .map((player) => ({
          name:
            player.name,

          pos:
            player.pos,

          adp:
            player.adp,

          key:
            opportunityKey(
              player
            )
        }));

    const results =
      CANDIDATES.map(
        (player) =>
          buildPlayerValidation(
            cached,
            player,
            currentPool,
            nextTurnPool
          )
      );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,

      body: JSON.stringify(
        {
          validation:
            "SAGE Pick 13 Baseline",

          computedAt:
            cached.computedAt ||
            null,

          state:
            VALIDATION_STATE,

          humanBenchmark: {
            pick12:
              "Ashton Jeanty",

            pick13:
              "Chase Brown"
          },

          contextStatus: {
            available:
              false,

            reason:
              "Context calculation exists, but the production 256-player Context data/cache pipeline has not been built yet.",

            rule:
              "No manual Context evidence is injected into this baseline."
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
      statusCode: 500,
      headers: CORS_HEADERS,

      body: JSON.stringify(
        {
          error:
            "SAGE pick validation failed",

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
// PURE EXPORTS FOR OPTIONAL LATER TESTING
// ------------------------------------------------------------

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.opportunityKey =
  opportunityKey;

module.exports.attachAdp =
  attachAdp;

module.exports.getOpportunityRecord =
  getOpportunityRecord;

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
