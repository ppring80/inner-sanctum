// netlify/functions/refresh-context-intel.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 1 POPULATION REFRESH
//
// PURPOSE:
// Build and cache the production Context Intelligence population.
//
// Population rule:
//   Current live PPR ADP
//   → QB / RB / WR / TE only
//   → sort by overall ADP
//   → top 256 players
//
// Why 256:
// Inner Sanctum supports leagues up to 16 teams × 16 roster spots.
// 16 × 16 = 256 maximum drafted players.
//
// IMPORTANT:
// - 256 is a POPULATION SIZE, not a hand-maintained player list.
// - K and DEF do not consume Context population slots.
// - Current ADP comes through the EXISTING deployed adp.js endpoint.
// - Live team / experience / injury comes through the EXISTING
//   deployed player-data.js endpoint.
// - No coaching-change, QB-change, offensive-line, role-change,
//   or rookie-impact conclusions are created in Phase 1.
// - No fake Opportunity history is created for rookies.
// - No SAGE recommendation logic is touched.
//
// CACHE:
// Netlify Blobs store: "context-intel"
// key: "latest"
//
// MANUAL PHASE-1 REFRESH:
// GET /.netlify/functions/refresh-context-intel?run=validation
//
// The literal run=validation gate is intentional so an ordinary request
// cannot accidentally trigger the paid ADP fetch + Blob write.
//
// PHASE 1.1 PLUMBING FIX:
// The first implementation attempted to invoke adp.js and player-data.js
// handlers directly with synthetic Lambda events.
//
// player-data.js depends on real Netlify request infrastructure, so that
// synthetic invocation produced:
//   "The first argument must be of type string ... Received undefined"
//
// This version instead consumes the SAME canonical deployed endpoints
// over HTTP. We therefore still have:
//
//   ONE adp.js implementation
//   ONE player-data.js implementation
//
// Context does not duplicate either data-source implementation.

const {
  getStore,
  connectLambda
} = require("@netlify/blobs");


const CONTEXT_POPULATION_SIZE = 256;

const CONTEXT_POSITIONS = new Set([
  "QB",
  "RB",
  "WR",
  "TE"
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};


// ------------------------------------------------------------
// CANONICAL SITE ORIGIN
//
// Netlify normally supplies process.env.URL for the production site.
// Keep the public production URL as a safe fallback.
//
// We deliberately call our existing public Netlify functions rather
// than attempting to synthesize Lambda events internally.
// ------------------------------------------------------------

function siteOrigin() {
  const configured =
    String(
      process.env.URL ||
      "https://theinnersanctum.xyz"
    )
      .trim()
      .replace(/\/+$/, "");

  return configured;
}


// ------------------------------------------------------------
// PLAYER IDENTITY
//
// Same normalization convention already used elsewhere in the
// Opportunity / shared-player-data pipeline.
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
  const value =
    String(pos || "")
      .trim()
      .toUpperCase();

  if (value === "PK") {
    return "K";
  }

  if (value === "DST") {
    return "DEF";
  }

  return value;
}


function playerKey(name, pos) {
  return (
    normalizePlayerName(name) +
    "|" +
    normalizePosition(pos)
  );
}


// ------------------------------------------------------------
// SAFE JSON FETCH
// ------------------------------------------------------------

async function fetchJson(url, label) {
  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          "Accept":
            "application/json"
        }
      }
    );

  if (!response.ok) {
    let detail = "";

    try {
      detail =
        await response.text();
    } catch (e) {
      detail = "";
    }

    throw new Error(
      `${label} failed with status ${response.status}` +
      (
        detail
          ? `: ${detail}`
          : ""
      )
    );
  }

  try {
    return await response.json();
  } catch (e) {
    throw new Error(
      `${label} returned invalid JSON`
    );
  }
}


// ------------------------------------------------------------
// READ CURRENT ADP THROUGH EXISTING DEPLOYED adp.js
//
// PPR is deliberate for the Phase-1 production cache.
//
// Context facts themselves are scoring-independent. PPR is being used
// here only to define the current 256-player market population.
// ------------------------------------------------------------

async function readCurrentAdp() {
  const url =
    siteOrigin() +
    "/.netlify/functions/adp?scoring=ppr";

  const data =
    await fetchJson(
      url,
      "adp.js"
    );

  if (
    !data ||
    !Array.isArray(
      data.players
    )
  ) {
    throw new Error(
      "adp.js returned no players array"
    );
  }

  return data;
}


// ------------------------------------------------------------
// READ CURRENT PLAYER DATA THROUGH EXISTING DEPLOYED
// player-data.js
// ------------------------------------------------------------

async function readCurrentPlayerData() {
  const url =
    siteOrigin() +
    "/.netlify/functions/player-data";

  const data =
    await fetchJson(
      url,
      "player-data.js"
    );

  if (
    !data ||
    !data.players
  ) {
    throw new Error(
      "player-data.js returned no players object"
    );
  }

  return data;
}


// ------------------------------------------------------------
// ADP POPULATION
//
// Filter FIRST, then sort, then take 256.
//
// K / DEF do not consume Context population slots.
//
// Invalid / placeholder ADP values naturally fall to the end.
// ------------------------------------------------------------

function buildAdpPopulation(
  adpData
) {
  const players =
    adpData &&
    Array.isArray(
      adpData.players
    )
      ? adpData.players
      : [];

  return players
    .map(function(player) {
      const pos =
        normalizePosition(
          player.position ||
          player.pos
        );

      const adp =
        Number(
          player.adp
        );

      if (
        !CONTEXT_POSITIONS.has(
          pos
        )
      ) {
        return null;
      }

      if (
        !player.name
      ) {
        return null;
      }

      return {
        name:
          player.name,

        pos:
          pos,

        adp:
          Number.isFinite(adp)
            ? adp
            : 999
      };
    })
    .filter(Boolean)
    .sort(function(a, b) {
      if (
        a.adp !==
        b.adp
      ) {
        return (
          a.adp -
          b.adp
        );
      }

      return (
        a.name.localeCompare(
          b.name
        )
      );
    })
    .slice(
      0,
      CONTEXT_POPULATION_SIZE
    )
    .map(function(player, index) {
      return {
        name:
          player.name,

        pos:
          player.pos,

        adp:
          player.adp,

        marketRank:
          index + 1
      };
    });
}


// ------------------------------------------------------------
// PLAYER-DATA LOOKUP MAP
//
// player-data.js returns Tank01 player records keyed by Tank01 IDs.
//
// Convert them to our established:
//
//   normalizedName|POS
//
// identity convention.
// ------------------------------------------------------------

function buildPlayerDataMap(
  playerData
) {
  const rawPlayers =
    playerData &&
    playerData.players
      ? playerData.players
      : {};

  const map = {};

  Object.values(
    rawPlayers
  ).forEach(function(player) {
    if (
      !player ||
      !player.longName
    ) {
      return;
    }

    const pos =
      normalizePosition(
        player.pos
      );

    if (
      !CONTEXT_POSITIONS.has(
        pos
      )
    ) {
      return;
    }

    const key =
      playerKey(
        player.longName,
        pos
      );

    map[key] =
      player;
  });

  return map;
}


// ------------------------------------------------------------
// BASELINE CONTEXT RECORD
//
// Phase 1 records FACTS only.
//
// A missing value stays null / empty rather than being interpreted.
//
// Example:
// - exp === "R" allows us to identify a rookie.
// - It does NOT allow us to claim that rookie has High/Moderate impact.
//
// Those judgments belong to later Context evidence phases.
// ------------------------------------------------------------

function buildBaselineRecord(
  marketPlayer,
  livePlayer
) {
  const experience =
    livePlayer &&
    livePlayer.exp !==
      undefined &&
    livePlayer.exp !==
      null
      ? String(
          livePlayer.exp
        )
      : null;

  const isRookie =
    experience === "R";

  const injury =
    livePlayer &&
    livePlayer.injury
      ? livePlayer.injury
      : {};

  return {
    playerID:
      livePlayer &&
      livePlayer.playerID
        ? String(
            livePlayer.playerID
          )
        : null,

    longName:
      marketPlayer.name,

    pos:
      marketPlayer.pos,

    adp:
      marketPlayer.adp,

    marketRank:
      marketPlayer.marketRank,

    team:
      livePlayer &&
      livePlayer.team
        ? livePlayer.team
        : null,

    experience:
      experience,

    isRookie:
      isRookie,

    injury: {
      designation:
        injury.designation ||
        "",

      description:
        injury.description ||
        ""
    },

    contextStatus:
      "baseline-only",

    contextProfile:
      null,

    evidence: {
      environmentChange:
        null,

      roleOpportunity:
        null,

      rookieImpact:
        null,

      contextConfidence:
        null
    }
  };
}


// ------------------------------------------------------------
// BUILD COMPLETE PHASE-1 CACHE
// ------------------------------------------------------------

function buildContextCache(
  adpData,
  playerData,
  computedAt
) {
  const population =
    buildAdpPopulation(
      adpData
    );

  const playerMap =
    buildPlayerDataMap(
      playerData
    );

  const records = {};

  const missingPlayerData =
    [];

  population.forEach(
    function(marketPlayer) {
      const key =
        playerKey(
          marketPlayer.name,
          marketPlayer.pos
        );

      const livePlayer =
        playerMap[key] ||
        null;

      if (
        !livePlayer
      ) {
        missingPlayerData.push({
          key:
            key,

          name:
            marketPlayer.name,

          pos:
            marketPlayer.pos,

          adp:
            marketPlayer.adp,

          marketRank:
            marketPlayer.marketRank
        });
      }

      records[key] =
        buildBaselineRecord(
          marketPlayer,
          livePlayer
        );
    }
  );

  return {
    schemaVersion:
      1,

    phase:
      "context-phase-1",

    computedAt:
      computedAt,

    populationRule: {
      source:
        "current-live-adp",

      scoring:
        "ppr",

      positions: [
        "QB",
        "RB",
        "WR",
        "TE"
      ],

      maxPopulation:
        CONTEXT_POPULATION_SIZE,

      productBasis:
        "16 teams x 16 roster spots"
    },

    sources: {
      adp:
        adpData &&
        adpData.meta
          ? adpData.meta
          : {
              source:
                "adp.js"
            },

      playerData: {
        source:
          "player-data.js"
      }
    },

    populationCount:
      population.length,

    matchedPlayerDataCount:
      population.length -
      missingPlayerData.length,

    missingPlayerDataCount:
      missingPlayerData.length,

    missingPlayerData:
      missingPlayerData,

    records:
      records
  };
}


// ------------------------------------------------------------
// SMALL VALIDATION VIEW
//
// Return a compact sample rather than dumping all 256 records.
//
// Includes:
// - first 10 players by current market rank
// - A.J. Brown if present
// - Ashton Jeanty if present
// - Chase Brown if present
// - Jeremiyah Love if present
// ------------------------------------------------------------

function buildValidationView(
  cache
) {
  const records =
    cache &&
    cache.records
      ? cache.records
      : {};

  const entries =
    Object.entries(
      records
    );

  const selected =
    {};

  entries
    .slice()
    .sort(function(a, b) {
      return (
        a[1].marketRank -
        b[1].marketRank
      );
    })
    .slice(
      0,
      10
    )
    .forEach(function(entry) {
      selected[
        entry[0]
      ] =
        entry[1];
    });

  const namesToInclude =
    [
      "A.J. Brown",
      "Ashton Jeanty",
      "Chase Brown",
      "Jeremiyah Love"
    ];

  namesToInclude.forEach(
    function(name) {
      entries.forEach(
        function(entry) {
          if (
            normalizePlayerName(
              entry[1].longName
            ) ===
            normalizePlayerName(
              name
            )
          ) {
            selected[
              entry[0]
            ] =
              entry[1];
          }
        }
      );
    }
  );

  return {
    phase:
      cache.phase,

    computedAt:
      cache.computedAt,

    populationRule:
      cache.populationRule,

    sources:
      cache.sources,

    populationCount:
      cache.populationCount,

    matchedPlayerDataCount:
      cache.matchedPlayerDataCount,

    missingPlayerDataCount:
      cache.missingPlayerDataCount,

    missingPlayerData:
      cache.missingPlayerData,

    validationSampleCount:
      Object.keys(
        selected
      ).length,

    records:
      selected
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

    const params =
      event.queryStringParameters ||
      {};

    if (
      params.run !==
      "validation"
    ) {
      return {
        statusCode:
          400,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              error:
                "Refresh not executed. Use ?run=validation for the Phase-1 manual refresh."
            },
            null,
            2
          )
      };
    }

    try {
      const [
        adpData,
        playerData
      ] =
        await Promise.all([
          readCurrentAdp(),
          readCurrentPlayerData()
        ]);

      const computedAt =
        new Date()
          .toISOString();

      const cache =
        buildContextCache(
          adpData,
          playerData,
          computedAt
        );

      // Safety gate:
      //
      // Do not write a partial population cache.
      if (
        cache.populationCount !==
        CONTEXT_POPULATION_SIZE
      ) {
        return {
          statusCode:
            500,

          headers:
            CORS_HEADERS,

          body:
            JSON.stringify(
              {
                error:
                  "Context population did not reach 256 players.",

                populationCount:
                  cache.populationCount,

                expected:
                  CONTEXT_POPULATION_SIZE,

                detail:
                  "No Blob write was performed."
              },
              null,
              2
            )
        };
      }

      const store =
        getStore({
          name:
            "context-intel"
        });

      await store.setJSON(
        "latest",
        cache
      );

      return {
        statusCode:
          200,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            buildValidationView(
              cache
            ),
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
                "Context Intelligence Phase-1 refresh failed",

              detail:
                e.message
            },
            null,
            2
          )
      };
    }
  };


// ------------------------------------------------------------
// PURE EXPORTS FOR TESTING
// ------------------------------------------------------------

module.exports.CONTEXT_POPULATION_SIZE =
  CONTEXT_POPULATION_SIZE;

module.exports.CONTEXT_POSITIONS =
  CONTEXT_POSITIONS;

module.exports.siteOrigin =
  siteOrigin;

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.normalizePosition =
  normalizePosition;

module.exports.playerKey =
  playerKey;

module.exports.fetchJson =
  fetchJson;

module.exports.readCurrentAdp =
  readCurrentAdp;

module.exports.readCurrentPlayerData =
  readCurrentPlayerData;

module.exports.buildAdpPopulation =
  buildAdpPopulation;

module.exports.buildPlayerDataMap =
  buildPlayerDataMap;

module.exports.buildBaselineRecord =
  buildBaselineRecord;

module.exports.buildContextCache =
  buildContextCache;

module.exports.buildValidationView =
  buildValidationView;
