// netlify/functions/diagnostic-weekly-sage-player-games.js
//
// WEEKLY SAGE — GET NFL GAMES FOR PLAYER RESPONSE-SHAPE DIAGNOSTIC
//
// PURPOSE:
// Inspect the real Tank01 getNFLGamesForPlayer response so we can
// normalize player production correctly without guessing.
//
// No SAGE logic.
// No writes.
// No ranking changes.
// No weekly.html changes.
//
// Example:
// /.netlify/functions/diagnostic-weekly-sage-player-games
//   ?season=2025&playerID=4430807
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

function tank01Headers() {
  return {
    "Content-Type": "application/json",
    "x-rapidapi-host": TANK01_HOST,
    "x-rapidapi-key": process.env.TANK01_API_KEY
  };
}

async function tank01Fetch(
  endpoint,
  params
) {
  const query =
    new URLSearchParams(
      params || {}
    ).toString();

  const url =
    `https://${TANK01_HOST}/${endpoint}` +
    (query ? `?${query}` : "");

  const response =
    await fetch(url, {
      method: "GET",
      headers: tank01Headers()
    });

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

function describe(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length
    };
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    return {
      type: "object",
      keys: Object.keys(value)
    };
  }

  return {
    type:
      value === null
        ? "null"
        : typeof value
  };
}

function sampleArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.slice(0, 3);
}

exports.handler =
  async function (event) {
    if (
      !process.env.TANK01_API_KEY
    ) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify({
            error:
              "TANK01_API_KEY is not configured."
          })
      };
    }

    const query =
      event.queryStringParameters ||
      {};

    const playerID =
      String(
        query.playerID ||
        "4430807"
      );

    const season =
      String(
        query.season ||
        "2025"
      );

    try {
      const result =
        await tank01Fetch(
          "getNFLGamesForPlayer",
          {
            playerID,
            season
          }
        );

      const data =
        result.data;

      const body =
        data &&
        Object.prototype.hasOwnProperty.call(
          data,
          "body"
        )
          ? data.body
          : null;

      const output = {
        diagnostic:
          "Weekly SAGE Player Games Response Shape",

        request: {
          endpoint:
            "getNFLGamesForPlayer",
          playerID,
          season
        },

        http: {
          status:
            result.status,
          ok:
            result.ok
        },

        response: {
          root:
            describe(data),

          body:
            describe(body),

          bodySample:
            sampleArray(body)
        }
      };

      /*
        If body is an object rather than an array, show the structure
        of its immediate children and a small sample of any arrays.

        This lets us determine whether Tank01 nests games under
        playerStats, games, gameStats, etc. without dumping huge
        responses or logging credentials.
      */
      if (
        body &&
        !Array.isArray(body) &&
        typeof body === "object"
      ) {
        output.response.bodyChildren = {};

        for (
          const key of Object.keys(body)
        ) {
          output.response
            .bodyChildren[key] = {
              description:
                describe(
                  body[key]
                ),

              sample:
                Array.isArray(
                  body[key]
                )
                  ? body[key]
                      .slice(0, 2)
                  : null
            };
        }
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type":
            "application/json",
          "Cache-Control":
            "no-store"
        },
        body:
          JSON.stringify(
            output,
            null,
            2
          )
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type":
            "application/json",
          "Cache-Control":
            "no-store"
        },
        body:
          JSON.stringify(
            {
              error:
                error.message
            },
            null,
            2
          )
      };
    }
  };
