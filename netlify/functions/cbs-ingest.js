/*
  THE INNER SANCTUM — cbs-ingest.js
  -------------------------------------------
  CBS bookmarklet ingestion proof of concept.

  PURPOSE
  -------------------------------------------
  Prove that a browser-assisted CBS capture can POST a sanitized
  league payload from an authenticated CBS Fantasy page back to
  The Inner Sanctum.

  POC ONLY
  -------------------------------------------
  This version does NOT:

    - persist CBS league data
    - associate data with a user account
    - store CBS credentials
    - store cookies
    - store session tokens
    - modify CBS data
    - perform CBS transactions

  It validates the incoming payload and returns a safe summary.

  ENDPOINT
  -------------------------------------------
  /.netlify/functions/cbs-ingest
*/

"use strict";

const ALLOWED_ORIGIN_PATTERN =
  /^https:\/\/[^.]+\.football\.cbssports\.com$/i;

const MAX_BODY_BYTES =
  500000;

function jsonResponse(
  statusCode,
  body,
  extraHeaders = {}
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      ...extraHeaders,
    },

    body:
      JSON.stringify(body),
  };
}

function getOrigin(event) {
  return (
    event.headers?.origin ||
    event.headers?.Origin ||
    ""
  );
}

function corsHeaders(origin) {
  if (
    origin &&
    ALLOWED_ORIGIN_PATTERN.test(
      origin
    )
  ) {
    return {
      "Access-Control-Allow-Origin":
        origin,

      "Access-Control-Allow-Methods":
        "POST, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Vary":
        "Origin",
    };
  }

  return {};
}

function parseBody(event) {
  if (!event.body) {
    throw new Error(
      "Request body is empty."
    );
  }

  const bodyBytes =
    Buffer.byteLength(
      event.body,
      "utf8"
    );

  if (
    bodyBytes >
    MAX_BODY_BYTES
  ) {
    throw new Error(
      "CBS payload is too large."
    );
  }

  return JSON.parse(
    event.body
  );
}

function validateCapture(capture) {
  if (
    !capture ||
    typeof capture !==
      "object"
  ) {
    throw new Error(
      "CBS capture payload is missing."
    );
  }

  if (
    !capture.league ||
    typeof capture.league !==
      "object"
  ) {
    throw new Error(
      "CBS league identity is missing."
    );
  }

  if (
    !capture.league.id ||
    !capture.league.name
  ) {
    throw new Error(
      "CBS league ID or league name is missing."
    );
  }

  if (
    !capture.team ||
    typeof capture.team !==
      "object"
  ) {
    throw new Error(
      "CBS team identity is missing."
    );
  }

  if (
    !capture.team.id ||
    !capture.team.name
  ) {
    throw new Error(
      "CBS team ID or team name is missing."
    );
  }

  if (
    !Array.isArray(
      capture.roster
    )
  ) {
    throw new Error(
      "CBS roster is missing."
    );
  }

  if (
    capture.meta
      ?.provider &&
    capture.meta.provider !==
      "cbs"
  ) {
    throw new Error(
      "Payload provider is not CBS."
    );
  }

  if (
    capture.meta
      ?.dataQuality &&
    capture.meta.dataQuality
      .complete === false
  ) {
    throw new Error(
      "CBS capture reports incomplete league data."
    );
  }

  return true;
}

function buildSafeSummary(
  capture
) {
  return {
    provider:
      "cbs",

    league: {
      id:
        capture.league.id,

      name:
        capture.league.name,

      season:
        capture.league
          .season ??
        null,

      teamCount:
        capture.league
          .teamCount ??
        null,

      divisionCount:
        capture.league
          .divisionCount ??
        null,
    },

    team: {
      id:
        capture.team.id,

      name:
        capture.team.name,

      division:
        capture.team
          .division ??
        null,
    },

    counts: {
      roster:
        Array.isArray(
          capture.roster
        )
          ? capture.roster
              .length
          : 0,

      standings:
        Array.isArray(
          capture.standings
        )
          ? capture.standings
              .length
          : 0,

      schedule:
        Array.isArray(
          capture.schedule
        )
          ? capture.schedule
              .length
          : 0,

      scoringRules:
        Array.isArray(
          capture.settings
            ?.scoringRules
        )
          ? capture.settings
              .scoringRules
              .length
          : 0,
    },

    scoringFormat:
      capture.settings
        ?.scoringProfile
        ?.format ??
      null,

    connectorVersion:
      capture.meta
        ?.connectorVersion ??
      null,

    dataQuality:
      capture.meta
        ?.dataQuality ??
      null,
  };
}

exports.handler =
  async function (
    event,
    context
  ) {
    const origin =
      getOrigin(event);

    const headers =
      corsHeaders(origin);

    /*
      CORS preflight.
    */

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      if (
        !ALLOWED_ORIGIN_PATTERN.test(
          origin
        )
      ) {
        return jsonResponse(
          403,
          {
            success:
              false,

            error:
              "Origin not allowed.",
          }
        );
      }

      return {
        statusCode:
          204,

        headers,

        body:
          "",
      };
    }

    /*
      POST only.
    */

    if (
      event.httpMethod !==
      "POST"
    ) {
      return jsonResponse(
        405,
        {
          success:
            false,

          error:
            "Method not allowed.",
        },
        headers
      );
    }

    /*
      Require request to originate from a CBS Fantasy league page.

      This is not authentication by itself. It is simply a POC
      boundary so arbitrary websites cannot use this endpoint
      through normal browser CORS.
    */

    if (
      !origin ||
      !ALLOWED_ORIGIN_PATTERN.test(
        origin
      )
    ) {
      return jsonResponse(
        403,
        {
          success:
            false,

          error:
            "CBS Fantasy origin required.",
        }
      );
    }

    try {
      const payload =
        parseBody(event);

      const capture =
        payload.capture;

      validateCapture(
        capture
      );

      const summary =
        buildSafeSummary(
          capture
        );

      /*
        POC ONLY:

        We intentionally do NOT persist the capture yet.

        This endpoint merely proves:

          CBS authenticated browser
              ->
          sanitized capture
              ->
          Inner Sanctum Netlify Function
              ->
          successful validation
      */

      console.log(
        "CBS INGEST POC SUCCESS",
        JSON.stringify(
          summary
        )
      );

      return jsonResponse(
        200,
        {
          success:
            true,

          message:
            "CBS capture received and validated. No league data was persisted.",

          summary,
        },
        headers
      );
    } catch (error) {
      console.error(
        "CBS INGEST POC FAILED",
        error
      );

      return jsonResponse(
        400,
        {
          success:
            false,

          error:
            error?.message ||
            "Invalid CBS capture payload.",
        },
        headers
      );
    }
  };
