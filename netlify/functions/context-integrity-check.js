// netlify/functions/context-integrity-check.js
//
// SAGE CONTEXT INTELLIGENCE — RELEASE INTEGRITY CHECK v2.1
//
// PURPOSE:
// Validate that Context evidence and cached Context records still match
// the CURRENT live player/team data before release.
//
// READ-ONLY.
// DOES NOT write to Netlify Blobs.
// DOES NOT modify Context evidence.
// DOES NOT modify SAGE.
//
// RELEASE GATES:
//
//   teamMismatchCount === 0
//   identityMismatchCount === 0
//   profiledPlayerMissingTeamCount === 0
//   profiledWithoutEvidenceCount === 0
//   liveTeamMismatchCount === 0
//   cacheVsLiveTeamMismatchCount === 0
//   liveIdentityMismatchCount === 0
//   profiledPlayerMissingLiveDataCount === 0
//
// TEAM NORMALIZATION:
//
// Inner Sanctum canonical team code:
//   WSH -> WAS
//
// This matches the normalization already used by adp.js and
// refresh-context-intel.js.
//
// WARNINGS:
//
// Players present in ADP but absent from live player-data remain visible
// separately.
//
// Those can legitimately include:
// - free agents
// - reserve / unusual roster status
// - other market-relevant players without an active team assignment
//
// They do NOT automatically fail the integrity check unless active
// Context evidence cannot be safely validated.

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
// SITE ORIGIN
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
// NORMALIZATION
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
// TEAM NORMALIZATION
//
// Inner Sanctum canonical convention:
//
//   Tank01 / some sources: WSH
//   Inner Sanctum:          WAS
//
// All team comparisons must pass through this function.
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
// CURRENT LIVE PLAYER DATA
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
// BUILD LIVE PLAYER MAP
//
// player-data.js is keyed by Tank01 player ID.
//
// Convert to:
//
// normalizedName|POS -> {
//   playerID,
//   longName,
//   pos,
//   team
// }
//
// Team is normalized before entering this map.
// ------------------------------------------------------------

function buildLivePlayerMap(
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
      ![
        "QB",
        "RB",
        "WR",
        "TE"
      ].includes(pos)
    ) {
      return;
    }

    const key =
      playerKey(
        player.longName,
        pos
      );

    map[key] = {
      playerID:
        sourcePlayerID
          ? String(
              sourcePlayerID
            )
          : null,

      longName:
        player.longName,

      pos:
        pos,

      team:
        normalizeTeam(
          player.team
        ) || null
    };
  });

  return map;
}


// ------------------------------------------------------------
// BUILD INTEGRITY REPORT
// ------------------------------------------------------------

function buildIntegrityReport(
  contextCache,
  evidenceRegistry,
  livePlayerMap
) {
  const records =
    contextCache &&
    contextCache.records
      ? contextCache.records
      : {};

  const registry =
    evidenceRegistry ||
    {};

  const liveMap =
    livePlayerMap ||
    {};


  const teamMismatches =
    [];

  const identityMismatches =
    [];

  const profiledPlayersMissingTeam =
    [];

  const profiledWithoutEvidence =
    [];

  const evidenceOutsidePopulation =
    [];

  const evidenceMissingExpectedTeam =
    [];


  const liveTeamMismatches =
    [];

  const cacheVsLiveTeamMismatches =
    [];

  const liveIdentityMismatches =
    [];

  const profiledPlayerMissingLiveData =
    [];


  // ----------------------------------------------------------
  // CHECK ALL REGISTERED EVIDENCE
  // ----------------------------------------------------------

  Object.keys(
    registry
  ).forEach(function(key) {
    const evidenceRecord =
      registry[key] ||
      {};

    const cachedRecord =
      records[key] ||
      null;

    const liveRecord =
      liveMap[key] ||
      null;


    // --------------------------------------------------------
    // EVIDENCE OUTSIDE CURRENT ADP POPULATION
    // --------------------------------------------------------

    if (!cachedRecord) {
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
          null,

        expectedTeam:
          evidenceRecord.expectedTeam ||
          null
      });

      return;
    }


    // --------------------------------------------------------
    // EVIDENCE ID vs CACHED CONTEXT ID
    // --------------------------------------------------------

    if (
      evidenceRecord.playerID &&
      cachedRecord.playerID &&
      String(
        evidenceRecord.playerID
      ) !==
      String(
        cachedRecord.playerID
      )
    ) {
      identityMismatches.push({
        key:
          key,

        longName:
          cachedRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          cachedRecord.pos ||
          evidenceRecord.pos ||
          null,

        evidencePlayerID:
          String(
            evidenceRecord.playerID
          ),

        cachedPlayerID:
          String(
            cachedRecord.playerID
          )
      });
    }


    // --------------------------------------------------------
    // EXPECTED TEAM vs CACHED CONTEXT TEAM
    // --------------------------------------------------------

    const expectedTeam =
      normalizeTeam(
        evidenceRecord.expectedTeam
      );

    const cachedTeam =
      normalizeTeam(
        cachedRecord.team
      );


    if (!expectedTeam) {
      evidenceMissingExpectedTeam.push({
        key:
          key,

        longName:
          cachedRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          cachedRecord.pos ||
          evidenceRecord.pos ||
          null,

        cachedTeam:
          cachedTeam ||
          null
      });
    }

    else if (
      cachedTeam &&
      expectedTeam !==
      cachedTeam
    ) {
      teamMismatches.push({
        key:
          key,

        longName:
          cachedRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          cachedRecord.pos ||
          evidenceRecord.pos ||
          null,

        playerID:
          cachedRecord.playerID ||
          evidenceRecord.playerID ||
          null,

        expectedTeam:
          expectedTeam,

        cachedTeam:
          cachedTeam
      });
    }


    // --------------------------------------------------------
    // PROFILED PLAYER MUST HAVE CACHED TEAM
    // --------------------------------------------------------

    if (
      cachedRecord.contextStatus ===
        "context-profiled" &&
      !cachedTeam
    ) {
      profiledPlayersMissingTeam.push({
        key:
          key,

        playerID:
          cachedRecord.playerID ||
          null,

        longName:
          cachedRecord.longName ||
          null,

        pos:
          cachedRecord.pos ||
          null
      });
    }


    // --------------------------------------------------------
    // CURRENT LIVE PLAYER DATA CHECK
    // --------------------------------------------------------

    if (
      cachedRecord.contextStatus ===
        "context-profiled" &&
      !liveRecord
    ) {
      profiledPlayerMissingLiveData.push({
        key:
          key,

        playerID:
          cachedRecord.playerID ||
          evidenceRecord.playerID ||
          null,

        longName:
          cachedRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          cachedRecord.pos ||
          evidenceRecord.pos ||
          null,

        expectedTeam:
          expectedTeam ||
          null,

        cachedTeam:
          cachedTeam ||
          null
      });

      return;
    }


    if (!liveRecord) {
      return;
    }


    const liveTeam =
      normalizeTeam(
        liveRecord.team
      );


    // --------------------------------------------------------
    // EVIDENCE ID vs CURRENT LIVE ID
    // --------------------------------------------------------

    if (
      evidenceRecord.playerID &&
      liveRecord.playerID &&
      String(
        evidenceRecord.playerID
      ) !==
      String(
        liveRecord.playerID
      )
    ) {
      liveIdentityMismatches.push({
        key:
          key,

        longName:
          liveRecord.longName ||
          cachedRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          cachedRecord.pos ||
          null,

        evidencePlayerID:
          String(
            evidenceRecord.playerID
          ),

        livePlayerID:
          String(
            liveRecord.playerID
          )
      });
    }


    // --------------------------------------------------------
    // EXPECTED TEAM vs CURRENT LIVE TEAM
    //
    // All three values are canonicalized before comparison.
    // --------------------------------------------------------

    if (
      expectedTeam &&
      liveTeam &&
      expectedTeam !==
      liveTeam
    ) {
      liveTeamMismatches.push({
        key:
          key,

        playerID:
          liveRecord.playerID ||
          cachedRecord.playerID ||
          evidenceRecord.playerID ||
          null,

        longName:
          liveRecord.longName ||
          cachedRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          cachedRecord.pos ||
          null,

        expectedTeam:
          expectedTeam,

        liveTeam:
          liveTeam
      });
    }


    // --------------------------------------------------------
    // CACHED TEAM vs CURRENT LIVE TEAM
    //
    // Detects a player move after the last Context refresh.
    // --------------------------------------------------------

    if (
      cachedTeam &&
      liveTeam &&
      cachedTeam !==
      liveTeam
    ) {
      cacheVsLiveTeamMismatches.push({
        key:
          key,

        playerID:
          liveRecord.playerID ||
          cachedRecord.playerID ||
          null,

        longName:
          liveRecord.longName ||
          cachedRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          cachedRecord.pos ||
          null,

        cachedTeam:
          cachedTeam,

        liveTeam:
          liveTeam
      });
    }
  });


  // ----------------------------------------------------------
  // PROFILED CACHE RECORD WITHOUT EVIDENCE REGISTRY ENTRY
  // ----------------------------------------------------------

  Object.keys(
    records
  ).forEach(function(key) {
    const record =
      records[key];

    if (
      record &&
      record.contextStatus ===
        "context-profiled" &&
      !registry[key]
    ) {
      profiledWithoutEvidence.push({
        key:
          key,

        playerID:
          record.playerID ||
          null,

        longName:
          record.longName ||
          null,

        pos:
          record.pos ||
          null,

        team:
          normalizeTeam(
            record.team
          ) || null
      });
    }
  });


  // ----------------------------------------------------------
  // ADP-RELEVANT PLAYERS WITHOUT CURRENT PLAYER-DATA MATCH
  //
  // WARNING ONLY.
  //
  // A player may legitimately remain fantasy-market relevant while
  // currently unsigned or in an unusual roster state.
  // ----------------------------------------------------------

  const missingPlayerData =
    Array.isArray(
      contextCache &&
      contextCache.missingPlayerData
    )
      ? contextCache.missingPlayerData
      : [];


  // ----------------------------------------------------------
  // HARD RELEASE FAILURE COUNT
  // ----------------------------------------------------------

  const hardFailureCount =
    teamMismatches.length +
    identityMismatches.length +
    profiledPlayersMissingTeam.length +
    profiledWithoutEvidence.length +
    liveTeamMismatches.length +
    cacheVsLiveTeamMismatches.length +
    liveIdentityMismatches.length +
    profiledPlayerMissingLiveData.length;


  const releaseReady =
    hardFailureCount ===
    0;


  return {
    check:
      "SAGE Context Integrity",

    version:
      "v2.1-live-team-normalized",

    contextPhase:
      contextCache &&
      contextCache.phase
        ? contextCache.phase
        : null,

    contextComputedAt:
      contextCache &&
      contextCache.computedAt
        ? contextCache.computedAt
        : null,

    livePlayerDataCheckedAt:
      new Date()
        .toISOString(),

    populationCount:
      contextCache &&
      contextCache.populationCount
        ? contextCache.populationCount
        : Object.keys(
            records
          ).length,

    evidenceRegistryCount:
      Object.keys(
        registry
      ).length,

    contextProfiledCount:
      contextCache &&
      Number.isFinite(
        Number(
          contextCache.contextProfiledCount
        )
      )
        ? Number(
            contextCache.contextProfiledCount
          )
        : Object.values(
            records
          ).filter(function(record) {
            return (
              record &&
              record.contextStatus ===
                "context-profiled"
            );
          }).length,


    // --------------------------------------------------------
    // RELEASE RESULT
    // --------------------------------------------------------

    releaseReady:
      releaseReady,

    hardFailureCount:
      hardFailureCount,


    // --------------------------------------------------------
    // EVIDENCE vs CACHED CONTEXT
    // --------------------------------------------------------

    teamMismatchCount:
      teamMismatches.length,

    teamMismatches:
      teamMismatches,

    identityMismatchCount:
      identityMismatches.length,

    identityMismatches:
      identityMismatches,


    // --------------------------------------------------------
    // EVIDENCE / CACHE vs CURRENT LIVE PLAYER DATA
    // --------------------------------------------------------

    liveTeamMismatchCount:
      liveTeamMismatches.length,

    liveTeamMismatches:
      liveTeamMismatches,

    cacheVsLiveTeamMismatchCount:
      cacheVsLiveTeamMismatches.length,

    cacheVsLiveTeamMismatches:
      cacheVsLiveTeamMismatches,

    liveIdentityMismatchCount:
      liveIdentityMismatches.length,

    liveIdentityMismatches:
      liveIdentityMismatches,

    profiledPlayerMissingLiveDataCount:
      profiledPlayerMissingLiveData.length,

    profiledPlayerMissingLiveData:
      profiledPlayerMissingLiveData,


    // --------------------------------------------------------
    // PROFILE COMPLETENESS
    // --------------------------------------------------------

    profiledPlayerMissingTeamCount:
      profiledPlayersMissingTeam.length,

    profiledPlayersMissingTeam:
      profiledPlayersMissingTeam,

    profiledWithoutEvidenceCount:
      profiledWithoutEvidence.length,

    profiledWithoutEvidence:
      profiledWithoutEvidence,


    // --------------------------------------------------------
    // WARNINGS
    // --------------------------------------------------------

    evidenceMissingExpectedTeamCount:
      evidenceMissingExpectedTeam.length,

    evidenceMissingExpectedTeam:
      evidenceMissingExpectedTeam,

    evidenceOutsidePopulationCount:
      evidenceOutsidePopulation.length,

    evidenceOutsidePopulation:
      evidenceOutsidePopulation,

    missingPlayerDataCount:
      missingPlayerData.length,

    missingPlayerData:
      missingPlayerData
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
      const store =
        getStore({
          name:
            "context-intel"
        });


      const [
        contextCache,
        playerData
      ] =
        await Promise.all([
          store.get(
            "latest",
            {
              type:
                "json"
            }
          ),

          readCurrentPlayerData()
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


      const evidenceRegistry =
        getAllContextEvidence();


      const livePlayerMap =
        buildLivePlayerMap(
          playerData
        );


      const report =
        buildIntegrityReport(
          contextCache,
          evidenceRegistry,
          livePlayerMap
        );


      return {
        statusCode:
          report.releaseReady
            ? 200
            : 409,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            report,
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
                "Context integrity check failed",

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
// PURE EXPORTS
// ------------------------------------------------------------

module.exports.siteOrigin =
  siteOrigin;

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.normalizePosition =
  normalizePosition;

module.exports.playerKey =
  playerKey;

module.exports.normalizeTeam =
  normalizeTeam;

module.exports.fetchJson =
  fetchJson;

module.exports.readCurrentPlayerData =
  readCurrentPlayerData;

module.exports.buildLivePlayerMap =
  buildLivePlayerMap;

module.exports.buildIntegrityReport =
  buildIntegrityReport;
