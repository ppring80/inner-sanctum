// ═══════════════════════════════════════════════════════════════════════
// ESPN-LEAGUE
//
// WHY THIS FILE EXISTS: ESPN has no official public Fantasy API — no
// developer program, no app registration, no OAuth. The known working
// path used by actively-maintained community libraries is ESPN's own
// undocumented v3 endpoint, the same one fantasy.espn.com itself calls:
//
//   GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/
//       {season}/segments/0/leagues/{leagueId}?view=mTeam&view=mRoster&
//       view=mMatchup&view=mSettings
//
// AUTH MODEL:
//   - PUBLIC leagues: no authentication is required.
//   - PRIVATE leagues: the same request is made with the visitor's own
//     espn_s2 and SWID browser-cookie values attached as a Cookie header.
//
//     These values represent a session ESPN already issued after the
//     customer authenticated directly with ESPN. Inner Sanctum does not
//     obtain, guess, or store an ESPN password.
//
// WHY THIS IS SERVER-SIDE:
// ESPN does not send CORS headers permitting theinnersanctum.xyz to call
// this endpoint directly from the browser. The Netlify function performs
// the ESPN request server-side and returns the result to Inner Sanctum.
//
// CREDENTIAL HANDLING:
// espn_s2 and SWID:
//   - arrive only in the current POST request;
//   - are used only for the outbound ESPN request;
//   - are never intentionally logged;
//   - are never stored by this function;
//   - are NOT persisted in LeagueConnection.
//
// connect-league.html clears its local credential variables after the
// request completes and persists only safe league-connection metadata
// and ESPN's returned league data.
//
// RESPONSE SHAPE:
// ESPN's response is large and deeply nested. This function intentionally
// returns ESPN's raw league JSON as-is. It does not normalize the response
// into provider-adapters.js's shared league shape.
//
// Real ESPN response shapes should be validated before relying on a
// normalizeEspnData() implementation for production decision logic.
//
// KNOWN FRAGILITY:
// This is an undocumented, unsupported ESPN endpoint. ESPN may change its
// response shape or access behavior without notice. If it begins failing
// broadly, first check whether maintained ESPN fantasy community libraries
// are experiencing the same breakage.
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["https://theinnersanctum.xyz"];

const ESPN_BASE_URL =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

const VIEWS = [
  "mTeam",
  "mRoster",
  "mMatchup",
  "mSettings"
];

/**
 * Return true only when the browser Origin exactly matches one of the
 * configured approved origins.
 *
 * An empty Origin is permitted because some direct/server-side requests
 * do not send the Origin header at all.
 */
function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Build CORS headers for the current request.
 *
 * Never return Access-Control-Allow-Origin: * for this endpoint because
 * private-league requests may contain ESPN session values.
 */
function buildCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Content-Type":
      "application/json",

    "Vary":
      "Origin"
  };

  if (
    origin &&
    ALLOWED_ORIGINS.includes(origin)
  ) {
    headers[
      "Access-Control-Allow-Origin"
    ] = origin;
  }

  return headers;
}

async function fetchEspnLeague({
  leagueId,
  season,
  espn_s2,
  swid
}) {
  const viewParams =
    VIEWS
      .map(
        (view) =>
          `view=${encodeURIComponent(view)}`
      )
      .join("&");

  const url =
    `${ESPN_BASE_URL}/` +
    `${encodeURIComponent(season)}/` +
    `segments/0/leagues/` +
    `${encodeURIComponent(leagueId)}` +
    `?${viewParams}`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 " +
      "(Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 " +
      "(KHTML, like Gecko) " +
      "Chrome/125.0 Safari/537.36"
  };

  // Public leagues do not need a Cookie header.
  //
  // Private leagues use both values together. We deliberately do not
  // send a partial credential header when only one value was supplied.
  if (espn_s2 && swid) {
    headers.Cookie =
      `espn_s2=${espn_s2}; SWID=${swid}`;
  }

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers:
          headers
      }
    );

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return {
      error:
        "auth",

      status:
        response.status
    };
  }

  if (
    response.status === 404
  ) {
    return {
      error:
        "not_found",

      status:
        response.status
    };
  }

  if (!response.ok) {
    return {
      error:
        "unknown",

      status:
        response.status
    };
  }

  const data =
    await response.json();

  return {
    data:
      data
  };
}

exports.handler =
  async function (event) {
    const origin =
      event.headers.origin ||
      event.headers.Origin ||
      "";

    const originAllowed =
      isOriginAllowed(
        origin
      );

    const corsHeaders =
      buildCorsHeaders(
        origin
      );

    if (!originAllowed) {
      console.log(
        `Blocked ESPN league request from unapproved origin: ${origin}`
      );

      return {
        statusCode:
          403,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Forbidden"
          })
      };
    }

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      return {
        statusCode:
          204,

        headers:
          corsHeaders,

        body:
          ""
      };
    }

    if (
      event.httpMethod !==
      "POST"
    ) {
      return {
        statusCode:
          405,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Method not allowed"
          })
      };
    }

    let payload;

    try {
      payload =
        JSON.parse(
          event.body ||
          "{}"
        );
    } catch (err) {
      return {
        statusCode:
          400,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Invalid JSON body"
          })
      };
    }

    const {
      leagueId,
      season,
      espn_s2,
      swid
    } = payload;

    if (!leagueId) {
      return {
        statusCode:
          400,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "leagueId is required"
          })
      };
    }

    /*
      If either private-session value is supplied, require both.

      This catches accidental half-configurations before sending a request
      ESPN is guaranteed to reject.
    */
    if (
      Boolean(espn_s2) !==
      Boolean(swid)
    ) {
      return {
        statusCode:
          400,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Private ESPN leagues require both espn_s2 and SWID."
          })
      };
    }

    const seasonYear =
      season ||
      new Date()
        .getFullYear();

    try {
      const result =
        await fetchEspnLeague({
          leagueId:
            leagueId,

          season:
            seasonYear,

          espn_s2:
            espn_s2,

          swid:
            swid
        });

      if (
        result.error ===
        "auth"
      ) {
        return {
          statusCode:
            401,

          headers:
            corsHeaders,

          body:
            JSON.stringify({
              error:
                "ESPN rejected this request — for a private league, " +
                "double-check that your espn_s2 and SWID values are current. " +
                "They can expire after you log out of ESPN."
            })
        };
      }

      if (
        result.error ===
        "not_found"
      ) {
        return {
          statusCode:
            404,

          headers:
            corsHeaders,

          body:
            JSON.stringify({
              error:
                "League not found — check your League ID and season year."
            })
        };
      }

      if (result.error) {
        return {
          statusCode:
            502,

          headers:
            corsHeaders,

          body:
            JSON.stringify({
              error:
                "ESPN returned an unexpected response " +
                `(status ${result.status}). ` +
                "Their fantasy endpoint may be unavailable or may have changed."
            })
        };
      }

      return {
        statusCode:
          200,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            success:
              true,

            league:
              result.data
          })
      };
    } catch (err) {
      /*
        Log only the error message. Never log the incoming payload because
        a private-league request may contain espn_s2 and SWID.
      */
      console.log(
        "espn-league handler error:",
        err &&
        err.message
          ? err.message
          : "unknown error"
      );

      return {
        statusCode:
          502,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Could not reach ESPN. Try again shortly."
          })
      };
    }
  };
