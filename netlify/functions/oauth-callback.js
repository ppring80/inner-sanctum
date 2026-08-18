const crypto = require("crypto");
const https = require("https");

// ── Config ──────────────────────────────────────────────────────────────
//
// SINGLE TIER, BY DESIGN:
// Founding Acolyte is the current paid Inner Sanctum membership tier.
//
const ACOLYTE_TIER_IDS = ["28845597"];

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "sanctum_session";

// ── RETURN PATH HANDLING ────────────────────────────────────────────────

const ALLOWED_RETURN_PATHS = [
  "/sanctum",
  "/auction",
  "/tiers",
];

function sanitizeReturnPath(state) {
  if (
    typeof state === "string" &&
    ALLOWED_RETURN_PATHS.includes(state)
  ) {
    return state;
  }

  return "/sanctum";
}

// ── Cookie signing ──────────────────────────────────────────────────────

function base64urlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str) {
  return Buffer.from(
    str
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function signSession(payload, secret) {
  const encodedPayload =
    base64urlEncode(
      JSON.stringify(payload)
    );

  const signature = crypto
    .createHmac(
      "sha256",
      secret
    )
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${encodedPayload}.${signature}`;
}

function verifySession(cookie, secret) {
  try {
    if (
      !cookie ||
      typeof cookie !== "string" ||
      !cookie.includes(".")
    ) {
      return null;
    }

    const [
      encodedPayload,
      signature,
    ] = cookie.split(".");

    if (
      !encodedPayload ||
      !signature
    ) {
      return null;
    }

    const expectedSignature = crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(encodedPayload)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const sigBuf =
      Buffer.from(signature);

    const expectedBuf =
      Buffer.from(
        expectedSignature
      );

    if (
      sigBuf.length !==
        expectedBuf.length ||
      !crypto.timingSafeEqual(
        sigBuf,
        expectedBuf
      )
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        base64urlDecode(
          encodedPayload
        )
      );

    if (
      !payload.exp ||
      Date.now() > payload.exp
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ── Tiny HTTPS helper ───────────────────────────────────────────────────

function httpsRequest(
  options,
  body
) {
  return new Promise(
    (resolve, reject) => {
      const req = https.request(
        options,
        (res) => {
          let data = "";

          res.on(
            "data",
            (chunk) => {
              data += chunk;
            }
          );

          res.on(
            "end",
            () => {
              try {
                resolve({
                  status:
                    res.statusCode,

                  json:
                    JSON.parse(
                      data
                    ),
                });
              } catch {
                resolve({
                  status:
                    res.statusCode,

                  json: null,

                  raw:
                    data,
                });
              }
            }
          );
        }
      );

      req.on(
        "error",
        reject
      );

      if (body) {
        req.write(body);
      }

      req.end();
    }
  );
}

// ── Patreon OAuth ───────────────────────────────────────────────────────

async function exchangeCodeForToken(
  code
) {
  const params =
    new URLSearchParams({
      code,

      grant_type:
        "authorization_code",

      client_id:
        process.env
          .PATREON_CLIENT_ID,

      client_secret:
        process.env
          .PATREON_CLIENT_SECRET,

      redirect_uri:
        process.env
          .PATREON_REDIRECT_URI,
    }).toString();

  return httpsRequest(
    {
      hostname:
        "www.patreon.com",

      path:
        "/api/oauth2/token",

      method:
        "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",

        "Content-Length":
          Buffer.byteLength(
            params
          ),
      },
    },

    params
  );
}

async function fetchIdentity(
  accessToken
) {
  return httpsRequest({
    hostname:
      "www.patreon.com",

    path:
      "/api/oauth2/v2/identity" +
      "?include=memberships.currently_entitled_tiers" +
      "&fields%5Bmember%5D=patron_status",

    method:
      "GET",

    headers: {
      Authorization:
        `Bearer ${accessToken}`,
    },
  });
}

// ── Patreon membership diagnostics ─────────────────────────────────────
//
// TEMPORARY.
//
// We deliberately DO NOT log:
// - email addresses
// - Patreon access tokens
// - client secrets
// - cookie signing secret
// - signed session cookie
//
// We only log membership status and tier IDs so we can verify the
// entitlement decision.

function getMembershipDiagnostics(
  identityJson
) {
  if (
    !identityJson ||
    !Array.isArray(
      identityJson.included
    )
  ) {
    return [];
  }

  return identityJson.included
    .filter(
      (item) =>
        item &&
        item.type === "member"
    )
    .map(
      (member, index) => {
        const tiers =
          (
            member.relationships &&
            member.relationships
              .currently_entitled_tiers &&
            Array.isArray(
              member.relationships
                .currently_entitled_tiers
                .data
            ) &&
            member.relationships
              .currently_entitled_tiers
              .data
          ) ||
          [];

        return {
          index:
            index + 1,

          memberId:
            member.id ||
            null,

          patronStatus:
            (
              member.attributes &&
              member.attributes
                .patron_status
            ) ||
            null,

          entitledTierIds:
            tiers.map(
              (tier) =>
                String(
                  tier.id
                )
            ),
        };
      }
    );
}

// ── Entitlement logic ───────────────────────────────────────────────────
//
// IMPORTANT FIX — AUGUST 2026
//
// Patreon may return MULTIPLE `member` records for one authenticated
// Patreon user when that person belongs to multiple creators.
//
// Previous behavior:
//
//   const member = included.find(item => item.type === "member")
//
// That selected the first Patreon membership returned and ignored all
// others.
//
// Evan Galbreath exposed the defect:
// - another Patreon creator membership returned tier 3115740 first
// - Inner Sanctum membership returned tier 28845597
// - old logic extracted only 3115740
// - fullAccess incorrectly became false
//
// Correct behavior:
//
//   1. inspect ALL member records
//   2. keep only active_patron memberships
//   3. collect ALL currently entitled tier IDs
//   4. de-duplicate the IDs
//   5. grant Inner Sanctum access if ANY ID matches the configured
//      Founding Acolyte tier
//
// Other Patreon creators still cannot grant Inner Sanctum access because
// only our configured tier ID 28845597 satisfies isAcolyte().

function extractEntitledTierIds(
  identityJson
) {
  if (
    !identityJson ||
    !Array.isArray(
      identityJson.included
    )
  ) {
    return [];
  }

  const tierIds =
    identityJson.included
      .filter(
        (item) =>
          item &&
          item.type === "member"
      )
      .filter(
        (member) =>
          member.attributes &&
          member.attributes
            .patron_status ===
            "active_patron"
      )
      .flatMap(
        (member) => {
          const tiers =
            (
              member.relationships &&
              member.relationships
                .currently_entitled_tiers &&
              Array.isArray(
                member.relationships
                  .currently_entitled_tiers
                  .data
              ) &&
              member.relationships
                .currently_entitled_tiers
                .data
            ) ||
            [];

          return tiers.map(
            (tier) =>
              String(
                tier.id
              )
          );
        }
      );

  return [
    ...new Set(
      tierIds
    ),
  ];
}

function hasTier(
  entitledTierIds,
  tierIdBucket
) {
  if (
    !Array.isArray(
      tierIdBucket
    ) ||
    tierIdBucket.length === 0
  ) {
    return false;
  }

  return entitledTierIds.some(
    (id) =>
      tierIdBucket.includes(
        String(id)
      )
  );
}

function isAcolyte(
  entitledTierIds
) {
  return hasTier(
    entitledTierIds,
    ACOLYTE_TIER_IDS
  );
}

function logPatreonDiagnostics(
  identityJson,
  entitledTierIds,
  returnPath
) {
  const memberships =
    getMembershipDiagnostics(
      identityJson
    );

  const acolyteFound =
    isAcolyte(
      entitledTierIds
    );

  console.log(
    "[PATREON AUTH DIAGNOSTIC]",
    JSON.stringify({
      returnPath,

      memberRecordCount:
        memberships.length,

      memberships,

      extractedEntitledTierIds:
        entitledTierIds,

      configuredAcolyteTierIds:
        ACOLYTE_TIER_IDS,

      acolyteTierFound:
        acolyteFound,

      resultingFullAccess:
        acolyteFound,
    })
  );
}

// ── Session payload ─────────────────────────────────────────────────────

function buildSessionPayload(
  entitledTierIds,
  now
) {
  return {
    fullAccess:
      isAcolyte(
        entitledTierIds
      ),

    exp:
      now.getTime() +
      SESSION_DURATION_MS,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────

exports.handler =
  async (event) => {
    const rawState =
      event.queryStringParameters &&
      event.queryStringParameters
        .state;

    const returnPath =
      sanitizeReturnPath(
        rawState
      );

    const redirectTo = (
      query,
      extraHeaders = {}
    ) => ({
      statusCode: 302,

      headers: {
        Location:
          `${returnPath}${query}`,

        ...extraHeaders,
      },
    });

    const code =
      event.queryStringParameters &&
      event.queryStringParameters
        .code;

    if (!code) {
      return redirectTo(
        "?auth_error=missing_code"
      );
    }

    let tokenResp;

    try {
      tokenResp =
        await exchangeCodeForToken(
          code
        );
    } catch {
      console.error(
        "[PATREON AUTH DIAGNOSTIC] token exchange request failed"
      );

      return redirectTo(
        "?auth_error=token_exchange_failed"
      );
    }

    if (
      !tokenResp.json ||
      !tokenResp.json
        .access_token
    ) {
      console.error(
        "[PATREON AUTH DIAGNOSTIC] token exchange returned no access token",
        JSON.stringify({
          status:
            tokenResp.status,
        })
      );

      return redirectTo(
        "?auth_error=token_exchange_failed"
      );
    }

    let identityResp;

    try {
      identityResp =
        await fetchIdentity(
          tokenResp.json
            .access_token
        );
    } catch {
      console.error(
        "[PATREON AUTH DIAGNOSTIC] identity request failed"
      );

      return redirectTo(
        "?auth_error=identity_fetch_failed"
      );
    }

    const entitledTierIds =
      extractEntitledTierIds(
        identityResp.json
      );

    // Temporary safe diagnostics.
    logPatreonDiagnostics(
      identityResp.json,
      entitledTierIds,
      returnPath
    );

    const secret =
      process.env
        .COOKIE_SIGNING_SECRET;

    if (!secret) {
      console.error(
        "[PATREON AUTH DIAGNOSTIC] COOKIE_SIGNING_SECRET missing"
      );

      return redirectTo(
        "?auth_error=server_misconfigured"
      );
    }

    const payload =
      buildSessionPayload(
        entitledTierIds,
        new Date()
      );

    const session =
      signSession(
        payload,
        secret
      );

    const cookieHeader =
      `${COOKIE_NAME}=${session}; ` +
      `Path=/; ` +
      `Max-Age=${Math.floor(
        SESSION_DURATION_MS /
        1000
      )}; ` +
      `HttpOnly; ` +
      `Secure; ` +
      `SameSite=Lax`;

    return redirectTo(
      "?auth=success",
      {
        "Set-Cookie":
          cookieHeader,
      }
    );
  };

// Exported for isolated testing only.
module.exports._test = {
  signSession,
  verifySession,

  extractEntitledTierIds,
  hasTier,
  isAcolyte,

  buildSessionPayload,

  base64urlEncode,
  base64urlDecode,

  sanitizeReturnPath,

  getMembershipDiagnostics,
};
