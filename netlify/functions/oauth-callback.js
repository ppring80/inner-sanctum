const crypto = require("crypto");
const https = require("https");

// ── Config ──────────────────────────────────────────────────────────────
// Fill in with real Patreon tier IDs (campaign's entitled_tiers.id values)
// before this gate can ever grant access. Left empty = fails closed.
const ACOLYTE_TIER_IDS = [];

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

function isAcolyte(entitledTierIds) {
  if (!Array.isArray(ACOLYTE_TIER_IDS) || ACOLYTE_TIER_IDS.length === 0) {
    return false; // fail closed — no tier IDs configured yet
  }
  return entitledTierIds.some((id) => ACOLYTE_TIER_IDS.includes(id));
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
  const acolyte = isAcolyte(entitledTierIds);

  const secret = process.env.COOKIE_SIGNING_SECRET;
  if (!secret) {
    return redirectTo("/sanctum.html?auth_error=server_misconfigured");
  }

  const session = signSession(
    { acolyte, exp: Date.now() + SESSION_DURATION_MS },
    secret
  );

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
  isAcolyte,
  base64urlEncode,
  base64urlDecode,
};
