// netlify/functions/league-snapshot.js
//
// ═══════════════════════════════════════════════════════════════════════
// THE INNER SANCTUM — LEAGUE SNAPSHOT BRIDGE
// ═══════════════════════════════════════════════════════════════════════
//
// PURPOSE
// -------
// Persist a sanitized fantasy-league snapshot so Inner Sanctum's
// server-side tools — including ChatGPT MCP tools — can access the
// connected league without needing browser localStorage.
//
// CUSTOMER EXPERIENCE
// -------------------
// The customer should never need to see or manually manage the link
// token created by this endpoint.
//
// Intended flow:
//
//   Connect League
//        ↓
//   LeagueConnection localStorage
//        ↓
//   "Use with ChatGPT"
//        ↓
//   POST sanitized snapshot here
//        ↓
//   random capability token generated
//        ↓
//   browser stores token locally
//        ↓
//   ChatGPT MCP can use the same linked snapshot
//
// SECURITY MODEL
// --------------
// Inner Sanctum currently does not require customer accounts.
//
// Therefore this V1 uses a high-entropy random capability token as the
// authorization secret for one stored league snapshot.
//
// IMPORTANT:
//   - The raw token is NEVER used as the Netlify Blob key.
//   - The Blob key is SHA-256(token).
//   - The raw token is returned only to the caller that creates/updates
//     the link and should be retained only in safe Inner Sanctum client
//     state.
//   - Provider passwords, cookies, OAuth credentials, session tokens,
//     CBS tokens, ESPN credentials, authorization headers, etc. are
//     stripped recursively before persistence.
//
// SUPPORTED OPERATIONS
// --------------------
//
// POST
//   Create or update a linked league snapshot.
//
//   Create:
//     {
//       snapshot: { ... }
//     }
//
//   Update existing link:
//     {
//       linkToken: "...",
//       snapshot: { ... }
//     }
//
// GET
//   Retrieve a linked league snapshot.
//
//   Token may be supplied by:
//
//     Authorization: Bearer <token>
//
//   or:
//
//     ?linkToken=<token>
//
// DELETE
//   Revoke a linked league snapshot.
//
//   Same token rules as GET.
//
// OPTIONS
//   CORS preflight.
//
// BLOB STORE
// ----------
// Store:
//   league-snapshots
//
// Key:
//   sha256:<SHA-256 of raw capability token>
//
// Netlify Lambda compatibility requires:
//
//   connectLambda(event)
//
// before:
//
//   getStore()
//
// ═══════════════════════════════════════════════════════════════════════

"use strict";

const crypto = require("crypto");

const {
  connectLambda,
  getStore
} = require("@netlify/blobs");

const STORE_NAME =
  "league-snapshots";

const SCHEMA_VERSION =
  1;

const MAX_BODY_BYTES =
  750000;

const LINK_TOKEN_BYTES =
  32;

const ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS
        .split(",")
        .map(function (origin) {
          return origin.trim();
        })
        .filter(Boolean)
    : [
        "https://theinnersanctum.xyz"
      ];

const SUPPORTED_PROVIDERS =
  new Set([
    "cbs",
    "espn",
    "sleeper",
    "yahoo"
  ]);

const BLOCKED_KEYS =
  new Set([
    "password",
    "pass",
    "passwd",

    "cookie",
    "cookies",

    "token",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",

    "authorization",
    "Authorization",

    "espn_s2",
    "espnS2",

    "SWID",
    "swid",

    "session",
    "sessionId",
    "session_id",

    "cbsToken",
    "cbsSession",

    "oauthToken",
    "oauth_token",

    "clientSecret",
    "client_secret",

    "apiKey",
    "api_key"
  ]);

/*
  -----------------------------------------------------------------------
  RESPONSE HELPERS
  -----------------------------------------------------------------------
*/

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

      ...extraHeaders
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

function getOrigin(event) {
  return (
    event.headers?.origin ||
    event.headers?.Origin ||
    ""
  );
}

function isAllowedOrigin(origin) {
  /*
    Empty Origin is allowed for server-to-server requests.

    Browser cross-origin requests must match an explicitly allowed
    Inner Sanctum origin.
  */

  if (!origin) {
    return true;
  }

  return ALLOWED_ORIGINS.some(
    function (allowedOrigin) {
      return (
        origin ===
          allowedOrigin ||
        origin.startsWith(
          allowedOrigin
        )
      );
    }
  );
}

function corsHeaders(origin) {
  if (
    origin &&
    isAllowedOrigin(origin)
  ) {
    return {
      "Access-Control-Allow-Origin":
        origin,

      "Access-Control-Allow-Methods":
        "GET, POST, DELETE, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",

      "Vary":
        "Origin"
    };
  }

  return {};
}

/*
  -----------------------------------------------------------------------
  TOKEN HELPERS
  -----------------------------------------------------------------------
*/

function generateLinkToken() {
  /*
    32 random bytes = 256 bits of entropy.

    base64url keeps the token compact and URL-safe.
  */

  return crypto
    .randomBytes(
      LINK_TOKEN_BYTES
    )
    .toString(
      "base64url"
    );
}

function normalizeToken(token) {
  if (
    typeof token !==
      "string"
  ) {
    return "";
  }

  return token.trim();
}

function isValidToken(token) {
  /*
    A 32-byte base64url token is normally 43 characters.

    Keep the validation slightly flexible so a future implementation
    can change token length without breaking old links.
  */

  return (
    typeof token ===
      "string" &&
    /^[A-Za-z0-9_-]{40,128}$/.test(
      token
    )
  );
}

function hashToken(token) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      token,
      "utf8"
    )
    .digest(
      "hex"
    );
}

function blobKeyForToken(
  token
) {
  return (
    "sha256:" +
    hashToken(token)
  );
}

function getBearerToken(event) {
  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";

  if (
    typeof authorization !==
      "string"
  ) {
    return "";
  }

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  if (!match) {
    return "";
  }

  return normalizeToken(
    match[1]
  );
}

function getRequestToken(
  event,
  payload = null
) {
  const bearerToken =
    getBearerToken(event);

  if (bearerToken) {
    return bearerToken;
  }

  const queryToken =
    normalizeToken(
      event
        .queryStringParameters
        ?.linkToken
    );

  if (queryToken) {
    return queryToken;
  }

  const bodyToken =
    normalizeToken(
      payload?.linkToken
    );

  if (bodyToken) {
    return bodyToken;
  }

  return "";
}

/*
  -----------------------------------------------------------------------
  BODY / SANITIZATION
  -----------------------------------------------------------------------
*/

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
      "League snapshot payload is too large."
    );
  }

  return JSON.parse(
    event.body
  );
}

function sanitizeValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      sanitizeValue
    );
  }

  if (
    typeof value !==
      "object"
  ) {
    return value;
  }

  const output = {};

  Object.keys(value).forEach(
    function (key) {
      if (
        BLOCKED_KEYS.has(
          key
        )
      ) {
        return;
      }

      output[key] =
        sanitizeValue(
          value[key]
        );
    }
  );

  return output;
}

/*
  -----------------------------------------------------------------------
  NORMALIZATION
  -----------------------------------------------------------------------
*/

function safeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value)
      .trim();

  return text || null;
}

function safeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function normalizeProvider(
  value
) {
  const provider =
    safeString(value);

  if (!provider) {
    return null;
  }

  return provider
    .toLowerCase();
}

function normalizeScoringFormat(
  value
) {
  const scoring =
    safeString(value);

  if (!scoring) {
    return null;
  }

  const lower =
    scoring.toLowerCase();

  if (
    lower === "ppr" ||
    lower === "full ppr" ||
    lower === "full-ppr" ||
    lower === "full"
  ) {
    return "ppr";
  }

  if (
    lower === "half" ||
    lower === "half ppr" ||
    lower === "half-ppr" ||
    lower === "0.5 ppr" ||
    lower === ".5 ppr"
  ) {
    return "half";
  }

  if (
    lower === "standard" ||
    lower === "non-ppr" ||
    lower === "non ppr"
  ) {
    return "standard";
  }

  /*
    Preserve provider-specific formats if the connector has richer
    scoring classification that Inner Sanctum may later support.
  */

  return lower;
}

/*
  -----------------------------------------------------------------------
  SNAPSHOT VALIDATION
  -----------------------------------------------------------------------
*/

function validateSnapshotInput(
  snapshot
) {
  const problems = [];

  if (
    !snapshot ||
    typeof snapshot !==
      "object" ||
    Array.isArray(snapshot)
  ) {
    return [
      "snapshot must be an object."
    ];
  }

  const provider =
    normalizeProvider(
      snapshot.provider ||
      snapshot.meta?.provider
    );

  if (!provider) {
    problems.push(
      "provider is required."
    );
  } else if (
    !SUPPORTED_PROVIDERS.has(
      provider
    )
  ) {
    problems.push(
      `Unsupported provider: ${provider}`
    );
  }

  const leagueId =
    safeString(
      snapshot.leagueId ||
      snapshot.league?.id
    );

  const leagueName =
    safeString(
      snapshot.leagueName ||
      snapshot.league?.name
    );

  const teamId =
    safeString(
      snapshot.teamId ||
      snapshot.team?.id
    );

  const teamName =
    safeString(
      snapshot.teamName ||
      snapshot.team?.name
    );

  if (!leagueId) {
    problems.push(
      "league ID is required."
    );
  }

  if (!leagueName) {
    problems.push(
      "league name is required."
    );
  }

  if (!teamId) {
    problems.push(
      "team ID is required."
    );
  }

  if (!teamName) {
    problems.push(
      "team name is required."
    );
  }

  if (
    !Array.isArray(
      snapshot.roster
    )
  ) {
    problems.push(
      "roster must be an array."
    );
  }

  if (
    Array.isArray(
      snapshot.roster
    ) &&
    snapshot.roster.length ===
      0
  ) {
    problems.push(
      "roster cannot be empty."
    );
  }

  return problems;
}

/*
  -----------------------------------------------------------------------
  CANONICAL SNAPSHOT
  -----------------------------------------------------------------------

  We intentionally preserve provider-normalized settings and roster data
  rather than reducing everything to a tiny common denominator.

  Tool #4 will need:

    - roster identity
    - player positions
    - roster status
    - lineup requirements
    - scoring format
    - schedule / matchup context
    - provider / league / fantasy-team identity

  Provider adapters can continue to normalize more deeply elsewhere.
*/

function buildCanonicalSnapshot(
  rawSnapshot,
  existingSnapshot = null
) {
  const sanitized =
    sanitizeValue(
      rawSnapshot
    );

  const provider =
    normalizeProvider(
      sanitized.provider ||
      sanitized.meta?.provider
    );

  const leagueSource =
    sanitized.league &&
    typeof sanitized.league ===
      "object"
      ? sanitized.league
      : {};

  const teamSource =
    sanitized.team &&
    typeof sanitized.team ===
      "object"
      ? sanitized.team
      : {};

  const scoringFormat =
    normalizeScoringFormat(
      sanitized.scoringFormat ||
      sanitized.settings
        ?.scoringProfile
        ?.format ||
      sanitized.meta
        ?.dataQuality
        ?.scoringFormat
    );

  const now =
    new Date()
      .toISOString();

  const capturedSyncedAt =
    safeString(
      sanitized.syncedAt ||
      sanitized.meta
        ?.capturedAt
    );

  return {
    schemaVersion:
      SCHEMA_VERSION,

    provider,

    league: {
      id:
        safeString(
          sanitized.leagueId ||
          leagueSource.id
        ),

      name:
        safeString(
          sanitized.leagueName ||
          leagueSource.name
        ),

      season:
        safeNumber(
          sanitized.season ??
          leagueSource.season
        ),

      teamCount:
        safeNumber(
          sanitized.teamCount ??
          leagueSource.teamCount
        ),

      divisionCount:
        safeNumber(
          sanitized.divisionCount ??
          leagueSource.divisionCount
        )
    },

    team: {
      id:
        safeString(
          sanitized.teamId ||
          teamSource.id
        ),

      name:
        safeString(
          sanitized.teamName ||
          teamSource.name
        ),

      division:
        safeString(
          teamSource.division
        ),

      wins:
        safeNumber(
          teamSource.wins
        ),

      losses:
        safeNumber(
          teamSource.losses
        ),

      ties:
        safeNumber(
          teamSource.ties
        ),

      rank:
        safeNumber(
          teamSource.rank
        ),

      pointsFor:
        safeNumber(
          teamSource.pointsFor
        ),

      pointsAgainst:
        safeNumber(
          teamSource.pointsAgainst
        )
    },

    scoringFormat,

    connectionMode:
      safeString(
        sanitized.connectionMode ||
        sanitized.meta
          ?.connectionMode
      ),

    readOnly:
      sanitized.readOnly !==
        false,

    roster:
      Array.isArray(
        sanitized.roster
      )
        ? sanitized.roster
        : [],

    standings:
      Array.isArray(
        sanitized.standings
      )
        ? sanitized.standings
        : [],

    schedule:
      Array.isArray(
        sanitized.schedule
      )
        ? sanitized.schedule
        : [],

    matchup:
      sanitized.matchup &&
      typeof sanitized.matchup ===
        "object"
        ? sanitized.matchup
        : null,

    settings:
      sanitized.settings &&
      typeof sanitized.settings ===
        "object"
        ? sanitized.settings
        : null,

    meta:
      sanitized.meta &&
      typeof sanitized.meta ===
        "object"
        ? sanitized.meta
        : null,

    connectedAt:
      safeString(
        existingSnapshot
          ?.connectedAt ||
        sanitized.connectedAt
      ) ||
      now,

    syncedAt:
      capturedSyncedAt ||
      now,

    storedAt:
      now,

    lastAccessedAt:
      existingSnapshot
        ?.lastAccessedAt ||
      null
  };
}

/*
  -----------------------------------------------------------------------
  SAFE RESPONSE SUMMARY
  -----------------------------------------------------------------------
*/

function buildSnapshotSummary(
  snapshot
) {
  return {
    provider:
      snapshot.provider,

    league: {
      id:
        snapshot.league
          ?.id ??
        null,

      name:
        snapshot.league
          ?.name ??
        null,

      season:
        snapshot.league
          ?.season ??
        null,

      teamCount:
        snapshot.league
          ?.teamCount ??
        null
    },

    team: {
      id:
        snapshot.team
          ?.id ??
        null,

      name:
        snapshot.team
          ?.name ??
        null
    },

    scoringFormat:
      snapshot.scoringFormat ??
      null,

    rosterCount:
      Array.isArray(
        snapshot.roster
      )
        ? snapshot.roster.length
        : 0,

    connectionMode:
      snapshot.connectionMode ??
      null,

    readOnly:
      snapshot.readOnly !==
        false,

    connectedAt:
      snapshot.connectedAt ??
      null,

    syncedAt:
      snapshot.syncedAt ??
      null,

    storedAt:
      snapshot.storedAt ??
      null
  };
}

/*
  -----------------------------------------------------------------------
  HANDLER
  -----------------------------------------------------------------------
*/

exports.handler =
  async function (
    event
  ) {
    /*
      Required for Netlify Blobs with the classic Lambda-compatible
      exports.handler runtime.
    */

    connectLambda(event);

    const origin =
      getOrigin(event);

    const headers =
      corsHeaders(origin);

    /*
      Browser cross-origin calls must come from an allowed site.

      Empty Origin remains valid for server-side Inner Sanctum calls,
      including chatgpt-mcp.js.
    */

    if (
      origin &&
      !isAllowedOrigin(origin)
    ) {
      return jsonResponse(
        403,
        {
          success:
            false,

          error:
            "Origin not allowed."
        }
      );
    }

    /*
      CORS preflight.
    */

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      return {
        statusCode:
          204,

        headers,

        body:
          ""
      };
    }

    const store =
      getStore({
        name:
          STORE_NAME
      });

    /*
      ================================================================
      POST — CREATE OR UPDATE
      ================================================================
    */

    if (
      event.httpMethod ===
      "POST"
    ) {
      let payload;

      try {
        payload =
          parseBody(event);
      } catch (error) {
        return jsonResponse(
          400,
          {
            success:
              false,

            error:
              error?.message ||
              "Invalid JSON body."
          },
          headers
        );
      }

      const rawSnapshot =
        payload?.snapshot;

      const problems =
        validateSnapshotInput(
          rawSnapshot
        );

      if (
        problems.length >
        0
      ) {
        return jsonResponse(
          400,
          {
            success:
              false,

            error:
              "League snapshot validation failed.",

            problems
          },
          headers
        );
      }

      /*
        If the caller supplies an existing valid token, update the
        existing link. Otherwise create a new link.

        This keeps the browser experience simple:

          first click:
            create

          future sync:
            send same locally remembered token and overwrite snapshot
      */

      let linkToken =
        getRequestToken(
          event,
          payload
        );

      let created =
        false;

      let existingSnapshot =
        null;

      if (linkToken) {
        if (
          !isValidToken(
            linkToken
          )
        ) {
          return jsonResponse(
            400,
            {
              success:
                false,

              error:
                "Invalid league link token."
            },
            headers
          );
        }

        const existingKey =
          blobKeyForToken(
            linkToken
          );

        existingSnapshot =
          // Fix (BlobsConsistencyError, production): this runtime
          // does not provide the uncachedEdgeURL that @netlify/blobs
          // requires for consistency: "strong" reads, which made this
          // read throw immediately. Uses Netlify Blobs' own default
          // (eventual) consistency instead -- no environment
          // configuration invented, no other behavior changed.
          await store.get(
            existingKey,
            {
              type:
                "json"
            }
          );

        /*
          Do not allow possession of an arbitrary token-shaped value to
          silently create a record.

          If an update token was supplied, that link must already exist.
        */

        if (!existingSnapshot) {
          return jsonResponse(
            404,
            {
              success:
                false,

              error:
                "Linked league snapshot was not found. Create a new ChatGPT link."
            },
            headers
          );
        }
      } else {
        linkToken =
          generateLinkToken();

        created =
          true;
      }

      const blobKey =
        blobKeyForToken(
          linkToken
        );

      const canonicalSnapshot =
        buildCanonicalSnapshot(
          rawSnapshot,
          existingSnapshot
        );

      try {
        await store.setJSON(
          blobKey,
          canonicalSnapshot
        );

        console.log(
          "LEAGUE SNAPSHOT SAVED",
          JSON.stringify({
            provider:
              canonicalSnapshot
                .provider,

            leagueId:
              canonicalSnapshot
                .league
                ?.id ||
              null,

            teamId:
              canonicalSnapshot
                .team
                ?.id ||
              null,

            rosterCount:
              canonicalSnapshot
                .roster
                .length,

            created,

            storedAt:
              canonicalSnapshot
                .storedAt
          })
        );

        return jsonResponse(
          created
            ? 201
            : 200,
          {
            success:
              true,

            created,

            linked:
              true,

            /*
              Raw token is returned because the browser needs to remember
              it. It is never logged and never stored inside the snapshot.

              Customer-facing UI should NOT display this token.
            */

            linkToken,

            summary:
              buildSnapshotSummary(
                canonicalSnapshot
              )
          },
          headers
        );
      } catch (error) {
        console.error(
          "league-snapshot POST failed:",
          error
        );

        return jsonResponse(
          500,
          {
            success:
              false,

            error:
              "Could not save the linked league snapshot."
          },
          headers
        );
      }
    }

    /*
      ================================================================
      GET — READ LINKED SNAPSHOT
      ================================================================
    */

    if (
      event.httpMethod ===
      "GET"
    ) {
      const linkToken =
        getRequestToken(
          event
        );

      if (
        !isValidToken(
          linkToken
        )
      ) {
        return jsonResponse(
          401,
          {
            success:
              false,

            error:
              "Valid league link token required."
          },
          headers
        );
      }

      const blobKey =
        blobKeyForToken(
          linkToken
        );

      try {
        const snapshot =
          // Fix (BlobsConsistencyError, production): see the same
          // note above -- consistency: "strong" is unsupported in
          // this runtime and is removed here too, falling back to
          // Netlify Blobs' default (eventual) consistency only.
          await store.get(
            blobKey,
            {
              type:
                "json"
            }
          );

        if (!snapshot) {
          return jsonResponse(
            404,
            {
              success:
                false,

              error:
                "Linked league snapshot was not found."
            },
            headers
          );
        }

        return jsonResponse(
          200,
          {
            success:
              true,

            linked:
              true,

            snapshot
          },
          headers
        );
      } catch (error) {
        console.error(
          "league-snapshot GET failed:",
          error
        );

        return jsonResponse(
          500,
          {
            success:
              false,

            error:
              "Could not read the linked league snapshot."
          },
          headers
        );
      }
    }

    /*
      ================================================================
      DELETE — REVOKE LINK
      ================================================================
    */

    if (
      event.httpMethod ===
      "DELETE"
    ) {
      let payload = null;

      /*
        DELETE does not require a body, but support one so the browser
        can use the same request shape as POST if convenient.
      */

      if (event.body) {
        try {
          payload =
            parseBody(event);
        } catch (error) {
          return jsonResponse(
            400,
            {
              success:
                false,

              error:
                error?.message ||
                "Invalid JSON body."
            },
            headers
          );
        }
      }

      const linkToken =
        getRequestToken(
          event,
          payload
        );

      if (
        !isValidToken(
          linkToken
        )
      ) {
        return jsonResponse(
          401,
          {
            success:
              false,

            error:
              "Valid league link token required."
          },
          headers
        );
      }

      const blobKey =
        blobKeyForToken(
          linkToken
        );

      try {
        const existing =
          // Fix (BlobsConsistencyError, production): see the same
          // note above -- consistency: "strong" is unsupported in
          // this runtime and is removed here too, falling back to
          // Netlify Blobs' default (eventual) consistency only.
          await store.get(
            blobKey,
            {
              type:
                "json"
            }
          );

        if (!existing) {
          /*
            Treat already-revoked as successful.

            This makes unlink idempotent and keeps the customer-facing
            interaction simple.
          */

          return jsonResponse(
            200,
            {
              success:
                true,

              linked:
                false,

              revoked:
                false,

              note:
                "League link was already absent."
            },
            headers
          );
        }

        await store.delete(
          blobKey
        );

        console.log(
          "LEAGUE SNAPSHOT REVOKED",
          JSON.stringify({
            provider:
              existing.provider ||
              null,

            leagueId:
              existing.league
                ?.id ||
              null,

            teamId:
              existing.team
                ?.id ||
              null
          })
        );

        return jsonResponse(
          200,
          {
            success:
              true,

            linked:
              false,

            revoked:
              true
          },
          headers
        );
      } catch (error) {
        console.error(
          "league-snapshot DELETE failed:",
          error
        );

        return jsonResponse(
          500,
          {
            success:
              false,

            error:
              "Could not revoke the linked league snapshot."
          },
          headers
        );
      }
    }

    return jsonResponse(
      405,
      {
        success:
          false,

        error:
          "Method not allowed."
      },
      headers
    );
  };
