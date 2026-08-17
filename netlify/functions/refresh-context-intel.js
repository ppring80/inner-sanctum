// netlify/functions/refresh-context-intel.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 2B.1 PROFILE INTEGRATION + TEAM NORMALIZATION
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
// PHASE 1:
// - Dynamic top-256 population
// - Current ADP
// - Player identity
// - Team
// - Experience / rookie status
// - Injury envelope
//
// PHASE 2A:
// - context-evidence.js introduced the event-driven evidence registry.
//
// PHASE 2B:
// - Join registered Context evidence to the dynamic 256-player population.
// - Run that evidence through draft-context-profile.js.
// - Store the resulting Context Profile in context-intel/latest.
//
// PHASE 2B.1:
// - Canonicalize team abbreviations before writing Context records.
// - Inner Sanctum standard: WSH -> WAS.
// - Include Rachaad White in the small validation view.
//
// IMPORTANT:
// - Most of the 256 players will remain baseline-only.
// - No Context entry is manufactured when no material evidence exists.
// - Context does NOT alter Opportunity Intelligence.
// - Context does NOT manufacture NFL history for rookies.
// - Context does NOT change ADP.
// - Context does NOT decide whom to draft.
// - SAGE recommendation logic is untouched.
//
// CACHE:
// Netlify Blobs store: "context-intel"
// key: "latest"
//
// MANUAL VALIDATION REFRESH:
// GET /.netlify/functions/refresh-context-intel?run=validation
//
// EXPECTED INITIAL PROFILED PLAYERS:
//   A.J. Brown
//   Ashton Jeanty
//   Jeremiyah Love
//
// Everyone else remains baseline-only unless context-evidence.js
// contains an explicit evidence record for that player.

const {
  getStore,
  connectLambda
} = require("@netlify/blobs");

const {
  getContextEvidenceByKey,
  getAllContextEvidence
} = require("./context-evidence");

const {
  buildDraftContextProfile
} = require("./draft-context-profile");


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
// ------------------------------------------------------------

function siteOrigin() {
  return String(
    process.env.URL ||
    "https://theinnersanctum.xyz"
  )
    .trim()
    .replace(/\/+$/, "");
}


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


// ------------------------------------------------------------
// TEAM NORMALIZATION
//
// Inner Sanctum standardized on WAS rather than Tank01's WSH.
// Keep Context cache records aligned with adp.js / Draft Command Center.
// ------------------------------------------------------------

function normalizeTeam(team) {
  const value =
    String(team || "")
      .trim()
      .toUpperCase();

  if (value === "WSH") {
    return "WAS";
  }

  return value;
}


function playerKey(
  name,
  pos
) {
  return (
    normalizePlayerName(name) +
    "|" +
    normalizePosition(pos)
  );
}


// ------------------------------------------------------------
// SAFE JSON FETCH
// ------------------------------------------------------------

async function fetchJson(
  url,
  label
) {
  const response =
    await fetch(
      url,
      {
        method:
          "GET",

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
// READ CURRENT ADP
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
// READ CURRENT PLAYER DATA
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
// Filter first.
// Sort second.
// Take 256 third.
//
// K / DEF do not consume Context population slots.
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
    .map(function(
      player,
      index
    ) {
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
// player-data.js returns an object keyed by Tank01 player ID.
//
// Preserve that key so every matched Context record carries
// stable player identity.
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

  Object.entries(
    rawPlayers
  ).forEach(function(entry) {
    const sourcePlayerID =
      entry[0];

    const player =
      entry[1];

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
      Object.assign(
        {},
        player,
        {
          playerID:
            sourcePlayerID
              ? String(
                  sourcePlayerID
                )
              : (
                  player.playerID
                    ? String(
                        player.playerID
                      )
                    : null
                )
        }
      );
  });

  return map;
}


// ------------------------------------------------------------
// BASELINE FACT RECORD
//
// This is the Phase-1 foundation.
//
// It records facts but creates no Context conclusions.
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
    experience ===
      "R";

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
        ? normalizeTeam(
            livePlayer.team
          ) || null
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

    evidence:
      null,

    contextSources:
      []
  };
}


// ------------------------------------------------------------
// CONTEXT EVIDENCE IDENTITY CHECK
//
// Evidence is keyed by normalizedName|POS.
//
// The evidence registry may also carry a playerID.
//
// If BOTH IDs exist and disagree, we refuse to profile the player.
// We keep the baseline record and surface the mismatch.
//
// This is deliberately conservative.
// ------------------------------------------------------------

function evidenceIdentityMatches(
  baselineRecord,
  evidenceRecord
) {
  if (
    !baselineRecord ||
    !evidenceRecord
  ) {
    return true;
  }

  if (
    !baselineRecord.playerID ||
    !evidenceRecord.playerID
  ) {
    return true;
  }

  return (
    String(
      baselineRecord.playerID
    ) ===
    String(
      evidenceRecord.playerID
    )
  );
}


// ------------------------------------------------------------
// APPLY CONTEXT EVIDENCE
//
// Only players with explicit event-driven evidence are profiled.
//
// No evidence:
//   baseline-only
//
// Evidence + identity match:
//   context-profiled
//
// Evidence + identity mismatch:
//   evidence-identity-mismatch
// ------------------------------------------------------------

function applyContextEvidence(
  baselineRecord,
  evidenceRecord
) {
  if (
    !evidenceRecord
  ) {
    return baselineRecord;
  }

  if (
    !evidenceIdentityMatches(
      baselineRecord,
      evidenceRecord
    )
  ) {
    return Object.assign(
      {},
      baselineRecord,
      {
        contextStatus:
          "evidence-identity-mismatch",

        evidence: {
          expectedPlayerID:
            evidenceRecord.playerID ||
            null,

          actualPlayerID:
            baselineRecord.playerID ||
            null
        },

        contextSources:
          Array.isArray(
            evidenceRecord.sources
          )
            ? evidenceRecord.sources.slice()
            : []
      }
    );
  }

  const evidence =
    evidenceRecord.evidence ||
    {};

  const contextProfile =
    buildDraftContextProfile({
      playerID:
        baselineRecord.playerID,

      longName:
        baselineRecord.longName,

      pos:
        baselineRecord.pos,

      evidence:
        evidence
    });

  return Object.assign(
    {},
    baselineRecord,
    {
      contextStatus:
        "context-profiled",

      contextProfile:
        contextProfile,

      evidence:
        evidence,

      contextSources:
        Array.isArray(
          evidenceRecord.sources
        )
          ? evidenceRecord.sources.slice()
          : []
    }
  );
}


// ------------------------------------------------------------
// BUILD COMPLETE CONTEXT CACHE
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

  const evidenceIdentityMismatches =
    [];

  let contextProfiledCount =
    0;

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

      const baselineRecord =
        buildBaselineRecord(
          marketPlayer,
          livePlayer
        );

      const evidenceRecord =
        getContextEvidenceByKey(
          key
        );

      const finalRecord =
        applyContextEvidence(
          baselineRecord,
          evidenceRecord
        );

      if (
        finalRecord.contextStatus ===
        "context-profiled"
      ) {
        contextProfiledCount++;
      }

      if (
        finalRecord.contextStatus ===
        "evidence-identity-mismatch"
      ) {
        evidenceIdentityMismatches.push({
          key:
            key,

          name:
            marketPlayer.name,

          pos:
            marketPlayer.pos,

          marketPlayerID:
            baselineRecord.playerID,

          evidencePlayerID:
            evidenceRecord &&
            evidenceRecord.playerID
              ? String(
                  evidenceRecord.playerID
                )
              : null
        });
      }

      records[key] =
        finalRecord;
    }
  );

  const registry =
    getAllContextEvidence();

  const evidenceRegistryCount =
    Object.keys(
      registry || {}
    ).length;

  const evidenceOutsidePopulation =
    [];

  Object.keys(
    registry || {}
  ).forEach(function(key) {
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          records,
          key
        )
    ) {
      const evidenceRecord =
        registry[key] ||
        {};

      evidenceOutsidePopulation.push({
        key:
          key,

        playerID:
          evidenceRecord.playerID ||
          null,

        longName:
          evidenceRecord.longName ||
          null,

        pos:
          evidenceRecord.pos ||
          null
      });
    }
  });

  return {
    schemaVersion:
      2,

    phase:
      "context-phase-2b",

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
      },

      contextEvidence: {
        source:
          "context-evidence.js"
      },

      contextProfile: {
        source:
          "draft-context-profile.js"
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

    evidenceRegistryCount:
      evidenceRegistryCount,

    contextProfiledCount:
      contextProfiledCount,

    baselineOnlyCount:
      population.length -
      contextProfiledCount -
      evidenceIdentityMismatches.length,

    evidenceIdentityMismatchCount:
      evidenceIdentityMismatches.length,

    evidenceIdentityMismatches:
      evidenceIdentityMismatches,

    evidenceOutsidePopulationCount:
      evidenceOutsidePopulation.length,

    evidenceOutsidePopulation:
      evidenceOutsidePopulation,

    records:
      records
  };
}


// ------------------------------------------------------------
// SMALL VALIDATION VIEW
//
// Includes:
// - first 10 current ADP players
// - A.J. Brown
// - Ashton Jeanty
// - Chase Brown
// - Jeremiyah Love
// - Rachaad White
//
// Chase Brown intentionally acts as a control:
// he should remain baseline-only because Phase 2A did not create
// a material Context evidence record for him.
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
      "Jeremiyah Love",
      "Rachaad White"
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

    evidenceRegistryCount:
      cache.evidenceRegistryCount,

    contextProfiledCount:
      cache.contextProfiledCount,

    baselineOnlyCount:
      cache.baselineOnlyCount,

    evidenceIdentityMismatchCount:
      cache.evidenceIdentityMismatchCount,

    evidenceIdentityMismatches:
      cache.evidenceIdentityMismatches,

    evidenceOutsidePopulationCount:
      cache.evidenceOutsidePopulationCount,

    evidenceOutsidePopulation:
      cache.evidenceOutsidePopulation,

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
                "Refresh not executed. Use ?run=validation for the manual Context refresh."
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

      // --------------------------------------------------------
      // SAFETY GATE 1
      //
      // Never overwrite a good cache with a partial population.
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // SAFETY GATE 2
      //
      // Phase 2B validation should not silently write records when
      // the explicit evidence registry conflicts with player identity.
      //
      // If that ever happens, inspect it first.
      // --------------------------------------------------------

      if (
        cache.evidenceIdentityMismatchCount >
        0
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
                  "Context evidence identity mismatch detected.",

                mismatchCount:
                  cache.evidenceIdentityMismatchCount,

                mismatches:
                  cache.evidenceIdentityMismatches,

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
                "Context Intelligence Phase-2B refresh failed",

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

module.exports.normalizeTeam =
  normalizeTeam;

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

module.exports.evidenceIdentityMatches =
  evidenceIdentityMatches;

module.exports.applyContextEvidence =
  applyContextEvidence;

module.exports.buildContextCache =
  buildContextCache;

module.exports.buildValidationView =
  buildValidationView;
