
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

// ── RETURN PATH HANDLING (added — July 2026 #49 site review) ────────────
// PROBLEM FOUND: every redirect in this file previously hardcoded
// "/sanctum.html" as the destination, regardless of which gated page the
// user actually started their Patreon login from (auction.html, tiers.html,
// and sanctum.html all present the same "Login with Patreon" link). A
// user who clicked login from the Auction War Room would authenticate
// successfully and then land on Sanctum instead — functionally correct
// (their session cookie is set site-wide) but a confusing, silent
// detour away from what they were doing.
//
// SEPARATELY: the ?auth_error=... / ?auth=success query params this file
// already appended were never actually read by any front-end JS — dead
// parameters that told the user nothing. Fixed alongside this on the
// front-end pages themselves (see sanctum.html/auction.html/tiers.html's
// gate scripts) — this file's job is just to make sure the RIGHT page
// gets these params, now that something on the other end reads them.
//
// HOW IT WORKS: the Patreon "Login with Patreon" authorize link on each
// gated page now includes &state=<page-path> (e.g. state=/auction).
// Patreon's OAuth spec requires it to echo whatever `state` value was
// sent in the authorize request back unchanged in the callback — so
// this function reads event.queryStringParameters.state on the way back
// and uses it as the redirect destination instead of a hardcoded page.
//
// SECURITY NOTE: `state` is NEVER trusted as a literal redirect target
// — it's validated against a fixed allowlist of real gated pages before
// use. Without this, a maliciously crafted callback URL with an
// attacker-controlled `state` value could turn this endpoint into an
// open redirect. Anything not on the allowlist (missing, tampered, or
// simply a page that doesn't have this login flow) falls back to
// "/sanctum", the safe default this file always used before.
//
// Also fixes a smaller inconsistency: this file was redirecting to
// "/sanctum.html" while the site's own nav links and routing everywhere
// else use clean paths ("/sanctum", "/auction", "/tiers" — see any
// page's header nav). Switched to match that convention.
const ALLOWED_RETURN_PATHS = ["/sanctum", "/auction", "/tiers"];

function sanitizeReturnPath(state) {
  if (typeof state === "string" && ALLOWED_RETURN_PATHS.includes(state)) {
    return state;
  }
  return "/sanctum"; // safe default — same page every redirect used to hardcode
}

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
  // FIXED 2026-06-27: currently_entitled_tiers is a RELATIONSHIP on the
  // member resource, not a flat field — it must be requested via the
  // nested `include=memberships.currently_entitled_tiers` path, not
  // via fields[member]=...,currently_entitled_tiers (the previous,
  // incorrect version of this call). Confirmed against Patreon's own
  // patreon-wordpress plugin source and a third-party .NET client,
  // both of which use this exact `memberships.currently_entitled_tiers`
  // include path as the working pattern. The old version would have
  // silently returned an empty tiers relationship for every user,
  // even a real, fully-paid Acolyte — extractEntitledTierIds() below
  // reads member.relationships.currently_entitled_tiers.data, which
  // only ever gets populated via this corrected include path.
  return httpsRequest({
    hostname: "www.patreon.com",
    path: `/api/oauth2/v2/identity?include=memberships.currently_entitled_tiers&fields%5Bmember%5D=patron_status`,
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
  // returnPath is resolved ONCE at the top from whatever `state` Patreon
  // echoed back (or "/sanctum" if absent/invalid/tampered) — every
  // redirect below, success or failure, uses this same resolved path
  // instead of a hardcoded destination.
  const rawState = event.queryStringParameters && event.queryStringParameters.state;
  const returnPath = sanitizeReturnPath(rawState);

  const redirectTo = (query, extraHeaders = {}) => ({
    statusCode: 302,
    headers: { Location: `${returnPath}${query}`, ...extraHeaders },
  });

  const code = event.queryStringParameters && event.queryStringParameters.code;
  if (!code) {
    return redirectTo("?auth_error=missing_code");
  }

  let tokenResp;
  try {
    tokenResp = await exchangeCodeForToken(code);
  } catch {
    return redirectTo("?auth_error=token_exchange_failed");
  }

  if (!tokenResp.json || !tokenResp.json.access_token) {
    return redirectTo("?auth_error=token_exchange_failed");
  }

  let identityResp;
  try {
    identityResp = await fetchIdentity(tokenResp.json.access_token);
  } catch {
    return redirectTo("?auth_error=identity_fetch_failed");
  }

  const entitledTierIds = extractEntitledTierIds(identityResp.json);

  const secret = process.env.COOKIE_SIGNING_SECRET;
  if (!secret) {
    return redirectTo("?auth_error=server_misconfigured");
  }

  const payload = buildSessionPayload(entitledTierIds, new Date());
  const session = signSession(payload, secret);

  const cookieHeader = `${COOKIE_NAME}=${session}; Path=/; Max-Age=${Math.floor(
    SESSION_DURATION_MS / 1000
  )}; HttpOnly; Secure; SameSite=Lax`;

  return redirectTo("?auth=success", {
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
  sanitizeReturnPath,
};
