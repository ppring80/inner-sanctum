// netlify/functions/opportunity-scarcity-sample.js
//
// SAGE STEP 4 — TEMPORARY SCARCITY VALIDATION EXTRACTOR
//
// Read-only diagnostic endpoint.
// It DOES NOT calculate Opportunity Intelligence.
// It DOES NOT write to Netlify Blobs.
// It DOES NOT modify cached records.
//
// PURPOSE:
// Step 4 needs a compact Opportunity Intelligence sample for a group of
// players around a draft window without transferring the entire 437-player
// cache or each player's full _rawGames history.
//
// USAGE:
//
// /.netlify/functions/opportunity-scarcity-sample
//   ?players=Chase%20Brown|RB|17.4;James%20Cook|RB|17.7
//
// Each requested item is:
//   Player Name | Position | ADP
//
// Multiple players are separated by semicolons.
//
// RESPONSE:
// {
//   computedAt,
//   requestedCount,
//   matchedCount,
//   missing,
//   records: {
//      "chase brown|RB": {
//          longName,
//          pos,
//          adp,
//          opportunities,
//          rushing,
//          receiving,
//          signals
//      }
//   }
// }
//
// Only existing cached values are returned.
// No thresholds or new Opportunity calculations are introduced here.

const { getStore, connectLambda } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

// Must remain consistent with opportunity-intel.js and
// refresh-opportunity-intel.js.
function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRequestedPlayers(raw) {
  if (!raw) return [];

  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split("|");

      const name = (pieces[0] || "").trim();
      const pos = (pieces[1] || "").trim().toUpperCase();

      const parsedAdp =
        pieces.length >= 3 ? Number(pieces[2]) : null;

      const adp =
        Number.isFinite(parsedAdp) && parsedAdp > 0
          ? parsedAdp
          : null;

      return {
        name,
        pos,
        adp,
      };
    })
    .filter((p) => p.name && p.pos);
}

// Compact projection of an EXISTING Opportunity Intelligence record.
//
// Nothing is recalculated here.
// We intentionally omit _rawGames because Step 4 does not need the full
// game-by-game history for this scarcity comparison.
function compactOpportunityRecord(record, adp) {
  return {
    playerID: record.playerID || null,
    longName: record.longName || null,
    pos: record.pos || null,
    adp: adp,

    opportunities: record.opportunities || null,
    rushing: record.rushing || null,
    receiving: record.receiving || null,

    signals: Array.isArray(record.signals)
      ? record.signals
      : [],
  };
}

function buildScarcitySample(cached, requestedPlayers) {
  const records =
    cached && cached.records
      ? cached.records
      : {};

  const sample = {};
  const missing = [];

  requestedPlayers.forEach((player) => {
    const key =
      `${normalizePlayerName(player.name)}|${player.pos}`;

    const record = records[key];

    if (!record) {
      missing.push({
        name: player.name,
        pos: player.pos,
        adp: player.adp,
        key,
      });

      return;
    }

    sample[key] =
      compactOpportunityRecord(
        record,
        player.adp
      );
  });

  return {
    sample,
    missing,
  };
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "GET only",
      }),
    };
  }

  const params =
    event.queryStringParameters || {};

  const requestedPlayers =
    parseRequestedPlayers(params.players);

  if (!requestedPlayers.length) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        {
          error:
            "Missing players parameter.",
          usage:
            "players=Chase Brown|RB|17.4;James Cook|RB|17.7",
        },
        null,
        2
      ),
    };
  }

  // Safety guard. This endpoint is diagnostic, not a replacement
  // for the full Opportunity Intelligence read endpoint.
  if (requestedPlayers.length > 50) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        {
          error:
            "Maximum 50 requested players per scarcity sample.",
        },
        null,
        2
      ),
    };
  }

  try {
    const store =
      getStore({
        name: "opportunity-intel",
      });

    const cached =
      await store.get(
        "latest",
        {
          type: "json",
        }
      );

    if (!cached) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify(
          {
            error:
              'No cached Opportunity Intelligence data found for key "latest".',
          },
          null,
          2
        ),
      };
    }

    const result =
      buildScarcitySample(
        cached,
        requestedPlayers
      );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        {
          computedAt:
            cached.computedAt || null,

          requestedCount:
            requestedPlayers.length,

          matchedCount:
            Object.keys(
              result.sample
            ).length,

          missing:
            result.missing,

          records:
            result.sample,
        },
        null,
        2
      ),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        {
          error:
            "Opportunity Intelligence cache read failed",
          detail:
            e.message,
        },
        null,
        2
      ),
    };
  }
};

// Pure functions exported only so we can regression-test this
// diagnostic extractor without requiring live Netlify Blobs.
module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.parseRequestedPlayers =
  parseRequestedPlayers;

module.exports.compactOpportunityRecord =
  compactOpportunityRecord;

module.exports.buildScarcitySample =
  buildScarcitySample;
