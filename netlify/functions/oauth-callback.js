const crypto = require("crypto");
const https = require("https");

// ── Config ──────────────────────────────────────────────────────────────
// Fill in with real Patreon tier IDs (campaign's entitled_tiers.id values)
// before access can ever be granted. Left empty = fails closed.
//
// SINGLE TIER, BY DESIGN (decided 2026-06-27): Draft Day Pass and Season
// Pass were originally meant to be one-time-feeling products, but
// Patreon's API confirmed there is no way to achieve true one-time
// billing for a new creator account in 2026 — no Shop-purchase
// visibility via API/webhooks, no charge-upfront/annual billing
// eligibility (account too new, $0 earnings history). Once both would
// have had to be recurring monthly tiers anyway, they offered no real
// value over just subscribing to Acolyte directly — Season Pass would
// have cost MORE than Acolyte for the same access, and Draft Day Pass
// would have cost nearly as much as Acolyte for one feature instead of
// everything. Collapsed to a single paid tier as the honest, simpler
// structure. See session notes for the full reasoning if this ever
// needs revisiting (e.g. if Patreon's billing options change, or the
// account becomes eligible for charge-upfront/annual billing later).
const ACOLYTE_TIER_IDS = ["28845597"]; // Founding Acolyte — confirmed via Patreon tier edit URL (patreon.com/membership/28845597), 2026-06-27

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "sanctum_session";

// ── Cookie signing (HMAC-SHA256, base64url payload + signature) ─────────
function base64urlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str) {
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function signSession(payload, secret) {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${encodedPayload}.${signature}`;
}

function verifySession(cookie, secret) {
  try {
    if (!cookie || typeof cookie !== "string" || !cookie.includes(".")) {
      return null;
    }
    const [encodedPayload, signature] = cookie.split(".");
    if (!encodedPayload || !signature) return null;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }

    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (!payload.exp || Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Tiny HTTPS POST/GET helper (no extra deps) ──────────────────────────
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, json: null, raw: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: process.env.PATREON_CLIENT_ID,
    client_secret: process.env.PATREON_CLIENT_SECRET,
    redirect_uri: process.env.PATREON_REDIRECT_URI,
  }).toString();

  return httpsRequest(
    {
      hostname: "www.patreon.com",
      path: "/api/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(params),
      },
    },
    params
  );
}

async function fetchIdentity(accessToken) {
  return httpsRequest({
    hostname: "www.patreon.com",
    path: `/api/oauth2/v2/identity?include=memberships&fields%5Buser%5D=email&fields%5Bmember%5D=patron_status,currently_entitled_tiers`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

// ── Pure decision logic (kept separate from network code, easy to test) ─
function extractEntitledTierIds(identityJson) {
  if (!identityJson || !identityJson.included) return [];
  const member = identityJson.included.find((item) => item.type === "member");
  if (!member) return [];
  if (member.attributes && member.attributes.patron_status !== "active_patron") {
    return [];
  }
  const tiers =
    (member.relationships &&
      member.relationships.currently_entitled_tiers &&
      member.relationships.currently_entitled_tiers.data) ||
    [];
  return tiers.map((t) => t.id);
}

// Generic helper: does this set of entitled tier IDs intersect a
// configured tier-ID bucket? Same fail-closed convention as before —
// an empty bucket always returns false, never silently "matches everything."
function hasTier(entitledTierIds, tierIdBucket) {
  if (!Array.isArray(tierIdBucket) || tierIdBucket.length === 0) {
    return false; // fail closed — no tier IDs configured yet
  }
  return entitledTierIds.some((id) => tierIdBucket.includes(id));
}

function isAcolyte(entitledTierIds) {
  return hasTier(entitledTierIds, ACOLYTE_TIER_IDS);
}

// ── Session payload shape ────────────────────────────────────────────────
// Single flag now that there's only one paid tier — fullAccess is true
// for Founding Acolyte, false otherwise. Kept as an object (not a bare
// boolean) for forward compatibility — if a second tier is ever
// reintroduced, the session shape can grow without every existing gate
// check needing to change its access pattern.
function buildSessionPayload(entitledTierIds, now) {
  return {
    fullAccess: isAcolyte(entitledTierIds),
    exp: now.getTime() + SESSION_DURATION_MS,
  };
}

// ── Handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const redirectTo = (path, extraHeaders = {}) => ({
    statusCode: 302,
    headers: { Location: path, ...extraHeaders },
  });

  const code = event.queryStringParameters && event.queryStringParameters.code;
  if (!code) {
    return redirectTo("/sanctum.html?auth_error=missing_code");
  }

  let tokenResp;
  try {
    tokenResp = await exchangeCodeForToken(code);
  } catch {
    return redirectTo("/sanctum.html?auth_error=token_exchange_failed");
  }

  if (!tokenResp.json || !tokenResp.json.access_token) {
    return redirectTo("/sanctum.html?auth_error=token_exchange_failed");
  }

  let identityResp;
  try {
    identityResp = await fetchIdentity(tokenResp.json.access_token);
  } catch {
    return redirectTo("/sanctum.html?auth_error=identity_fetch_failed");
  }

  const entitledTierIds = extractEntitledTierIds(identityResp.json);

  const secret = process.env.COOKIE_SIGNING_SECRET;
  if (!secret) {
    return redirectTo("/sanctum.html?auth_error=server_misconfigured");
  }

  const payload = buildSessionPayload(entitledTierIds, new Date());
  const session = signSession(payload, secret);

  const cookieHeader = `${COOKIE_NAME}=${session}; Path=/; Max-Age=${Math.floor(
    SESSION_DURATION_MS / 1000
  )}; HttpOnly; Secure; SameSite=Lax`;

  return redirectTo("/sanctum.html?auth=success", {
    "Set-Cookie": cookieHeader,
  });
};

// Exported for isolated testing only — not used by the handler itself.
module.exports._test = {
  signSession,
  verifySession,
  extractEntitledTierIds,
  hasTier,
  isAcolyte,
  buildSessionPayload,
  base64urlEncode,
  base64urlDecode,
};
