// netlify/functions/sage-schedule-intelligence-data.js
//
// ═══════════════════════════════════════════════════════════════════════
// EMERGENCY HOTFIX (Tank01 PRO API quota exhausted at 100%)
// ═══════════════════════════════════════════════════════════════════════
//
// This file previously performed a large synchronous rebuild of
// Schedule Intelligence -- archived roster collection, player metadata
// resolution, and per-player historical game-log collection -- all
// directly against the Tank01 API on every request. That design both
// caused production HTTP 502s (too much synchronous work for one
// Netlify Function invocation) and, more urgently right now, is
// capable of making an unbounded number of Tank01 calls.
//
// This hotfix removes ALL of that. This file now:
//
//   - makes ZERO Tank01 API calls, under any code path, ever
//   - never imports or calls any Tank01-calling helper (directly or
//     transitively) -- specifically, it does NOT require
//     weekly-sage-schedule.js, since that module's buildWeeklySchedule()
//     itself calls Tank01's getNFLGamesForWeek
//   - never performs any historical backfill, roster collection,
//     player metadata resolution, or game-log collection
//   - never auto-refreshes or auto-rebuilds anything
//   - always responds immediately with a safe, explicit
//     "unavailable" payload
//
// A resumable, Netlify-Blob-backed rebuild architecture is planned
// separately and deliberately NOT introduced here -- this file does
// not read or write any Blobs store, since no such cache currently
// exists in this codebase for Schedule Intelligence to read (verified
// directly: nothing in the current production code populates one).
// Inventing a new caching layer as part of an emergency stop-the-
// bleeding fix would itself be a scope expansion this hotfix
// intentionally avoids. Once a real Blob-backed cache exists, this
// read path can be pointed at it in a separate, deliberate change.
//
// Every customer-facing consumer of this endpoint (Draft, Player
// Profile, Weekly SAGE) must treat `available: false` as a normal,
// expected state, not an error condition -- Schedule Intelligence is
// an additive, optional signal, never a required one.
// ═══════════════════════════════════════════════════════════════════════

function jsonResponse(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        "no-store"
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

// The exact safe payload specified for this hotfix. Kept as a
// function (not a static constant) only so `checkedAt` reflects the
// actual request time -- this adds no new state, no new architecture,
// and no Tank01 access of any kind.
function buildUnavailableResponse() {
  return {
    evidenceType:
      "sage-schedule-intelligence",

    available:
      false,

    trustedForProduction:
      false,

    status:
      "disabled-pending-cache",

    reason:
      "Schedule Intelligence historical rebuild is disabled to protect Tank01 API quota.",

    checkedAt:
      new Date().toISOString()
  };
}

exports.handler =
  async function (
    event
  ) {
    // GET-only, matching this endpoint's existing read-only contract.
    // No Tank01 API key check here at all -- this file never touches
    // Tank01 under any circumstance, so that check no longer applies.
    if (
      event.httpMethod &&
      event.httpMethod !==
        "GET"
    ) {
      return jsonResponse(
        405,
        {
          error:
            "Method not allowed."
        }
      );
    }

    // No historical rebuild, no cache read, no Tank01 call of any
    // kind, regardless of query parameters supplied. This is the
    // entire behavior of this file for now, by design.
    return jsonResponse(
      200,
      buildUnavailableResponse()
    );
  };
