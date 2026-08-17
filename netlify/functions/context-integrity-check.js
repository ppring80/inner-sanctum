// netlify/functions/context-integrity-check.js
//
// SAGE CONTEXT INTELLIGENCE — RELEASE INTEGRITY CHECK
//
// PURPOSE:
// Validate that Context evidence still matches the live player/team
// identities in context-intel/latest before release.
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
//
// WARNINGS:
//
// Players missing from player-data.js remain visible separately.
// They do not automatically fail this integrity check unless they
// have active Context evidence that cannot be validated.

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
// NORMALIZATION
// ------------------------------------------------------------

function normalizeTeam(team) {
  return String(
    team || ""
  )
    .trim()
    .toUpperCase();
}


// ------------------------------------------------------------
// BUILD INTEGRITY REPORT
// ------------------------------------------------------------

function buildIntegrityReport(
  contextCache,
  evidenceRegistry
) {
  const records =
    contextCache &&
    contextCache.records
      ? contextCache.records
      : {};

  const registry =
    evidenceRegistry ||
    {};

  const teamMismatches =
    [];

  const identityMismatches =
    [];

  const profiledPlayersMissingTeam =
    [];

  const evidenceOutsidePopulation =
    [];

  const evidenceMissingExpectedTeam =
    [];

  const profiledWithoutEvidence =
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

    const liveRecord =
      records[key] ||
      null;


    // Evidence exists but player is outside current top-256 population.
    if (!liveRecord) {
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
    // PLAYER-ID CHECK
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
      identityMismatches.push({
        key:
          key,

        longName:
          liveRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          evidenceRecord.pos ||
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
    // EXPECTED TEAM CHECK
    // --------------------------------------------------------

    const expectedTeam =
      normalizeTeam(
        evidenceRecord.expectedTeam
      );

    const liveTeam =
      normalizeTeam(
        liveRecord.team
      );


    if (!expectedTeam) {
      evidenceMissingExpectedTeam.push({
        key:
          key,

        longName:
          liveRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          evidenceRecord.pos ||
          null,

        liveTeam:
          liveTeam ||
          null
      });
    }


    else if (
      liveTeam &&
      expectedTeam !==
      liveTeam
    ) {
      teamMismatches.push({
        key:
          key,

        longName:
          liveRecord.longName ||
          evidenceRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          evidenceRecord.pos ||
          null,

        playerID:
          liveRecord.playerID ||
          evidenceRecord.playerID ||
          null,

        expectedTeam:
          expectedTeam,

        liveTeam:
          liveTeam
      });
    }


    // --------------------------------------------------------
    // PROFILED PLAYER MUST HAVE LIVE TEAM
    // --------------------------------------------------------

    if (
      liveRecord.contextStatus ===
        "context-profiled" &&
      !liveTeam
    ) {
      profiledPlayersMissingTeam.push({
        key:
          key,

        playerID:
          liveRecord.playerID ||
          null,

        longName:
          liveRecord.longName ||
          null,

        pos:
          liveRecord.pos ||
          null
      });
    }
  });


  // ----------------------------------------------------------
  // CHECK CACHE FOR PROFILED PLAYERS WITHOUT REGISTRY EVIDENCE
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
          record.team ||
          null
      });
    }
  });


  // ----------------------------------------------------------
  // MISSING PLAYER-DATA WARNINGS
  // ----------------------------------------------------------

  const missingPlayerData =
    Array.isArray(
      contextCache &&
      contextCache.missingPlayerData
    )
      ? contextCache.missingPlayerData
      : [];


  // ----------------------------------------------------------
  // RELEASE DECISION
  // ----------------------------------------------------------

  const hardFailureCount =
    teamMismatches.length +
    identityMismatches.length +
    profiledPlayersMissingTeam.length +
    profiledWithoutEvidence.length;


  const releaseReady =
    hardFailureCount ===
    0;


  return {
    check:
      "SAGE Context Integrity",

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
    // HARD RELEASE GATES
    // --------------------------------------------------------

    releaseReady:
      releaseReady,

    hardFailureCount:
      hardFailureCount,

    teamMismatchCount:
      teamMismatches.length,

    teamMismatches:
      teamMismatches,

    identityMismatchCount:
      identityMismatches.length,

    identityMismatches:
      identityMismatches,

    profiledPlayerMissingTeamCount:
      profiledPlayersMissingTeam.length,

    profiledPlayersMissingTeam:
      profiledPlayersMissingTeam,

    profiledWithoutEvidenceCount:
      profiledWithoutEvidence.length,

    profiledWithoutEvidence:
      profiledWithoutEvidence,


    // --------------------------------------------------------
    // WARNINGS / REVIEW ITEMS
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


      const contextCache =
        await store.get(
          "latest",
          {
            type:
              "json"
          }
        );


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


      const report =
        buildIntegrityReport(
          contextCache,
          evidenceRegistry
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
// PURE EXPORT
// ------------------------------------------------------------

module.exports.normalizeTeam =
  normalizeTeam;

module.exports.buildIntegrityReport =
  buildIntegrityReport;
