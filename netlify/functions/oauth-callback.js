const crypto = require("crypto");
const https = require("https");

// ── Config ──────────────────────────────────────────────────────────────
// Fill in with real Patreon tier IDs (campaign's entitled_tiers.id values)
// before each respective gate can ever grant access. Left empty = fails
// closed for that tier — same convention as the original ACOLYTE_TIER_IDS.
//
// THREE separate tier buckets, because they grant DIFFERENT things:
//   - ACOLYTE_TIER_IDS:    Founding Acolyte ($7.99/mo) — full platform access
//   - SEASON_PASS_TIER_IDS: Season Pass ($19.99 charge-upfront tier) — full
//                            platform access, IDENTICAL to Acolyte, but
//                            hard-capped at SEASON_PASS_CUTOFF below
//                            regardless of whether the Patreon tier itself
//                            has been unpublished/retired yet.
//   - DRAFT_DAY_TIER_IDS:  Draft Day Pass ($9.99 charge-upfront tier) —
//                            Auction War Room ONLY. Deliberately narrower
//                            than the other two — does NOT unlock
//                            tiers.html, weekly.html, sanctum.html, etc.
const ACOLYTE_TIER_IDS = [];
const SEASON_PASS_TIER_IDS = [];
const DRAFT_DAY_TIER_IDS = [];

// Hard calendar cutoff for Season Pass, independent of Patreon's own tier
// state. Decided 2026-06-27: Season Pass is sold as "full 2026 season
// access," which has no natural expiration in Patreon's data model (no
// such thing as a one-time charge that auto-revokes). This is the
// authoritative end date — covers the Super Bowl with margin and isn't
// tied to the NFL's own schedule ever shifting.
//
// This check happens at OAuth-login time (see isSeasonPassActive below),
// not just baked into the session's exp field. That matters: it blocks
// the entitlement from ever being (re)granted on a fresh login after the
// cutoff, even if you forget to unpublish the Season Pass tier in
// Patreon itself. It is a backup to manual tier retirement, not a
// replacement for it — still unpublish the tier when the season ends.
const SEASON_PASS_CUTOFF = new Date("2027-02-28T23:59:59Z");

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

function isDraftDayPass(entitledTierIds) {
  return hasTier(entitledTierIds, DRAFT_DAY_TIER_IDS);
}

// Season Pass requires BOTH the Patreon tier entitlement AND that today
// is on or before the hard cutoff. `now` is passed in (rather than read
// internally via `new Date()`) specifically so this stays a pure,
// deterministic function for testing — tests can pass any reference
// date and get a reproducible answer without mocking the system clock.
function isSeasonPassActive(entitledTierIds, now) {
  if (!hasTier(entitledTierIds, SEASON_PASS_TIER_IDS)) return false;
  return now <= SEASON_PASS_CUTOFF;
}

// ── Session payload shape ────────────────────────────────────────────────
// Replaces the old flat `acolyte: boolean` with explicit per-capability
// flags, since the three tiers no longer all grant the same thing:
//   - fullAccess:    true for Founding Acolyte OR an active (non-expired)
//                    Season Pass. Gates everything Acolyte-only today
//                    (tiers.html, weekly.html, sanctum.html, auction.html).
//   - auctionAccess: true if fullAccess is true, OR if the user holds a
//                    Draft Day Pass. Gates auction.html specifically.
// Kept as two flags (not one tier-name string) so every existing gate
// check stays a simple boolean read — `payload.fullAccess` or
// `payload.auctionAccess` — with no string-matching logic needed on the
// page side.
function buildSessionPayload(entitledTierIds, now) {
  const fullAccess = isAcolyte(entitledTierIds) || isSeasonPassActive(entitledTierIds, now);
  const draftDay = isDraftDayPass(entitledTierIds);
  return {
    fullAccess,
    auctionAccess: fullAccess || draftDay,
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
  isDraftDayPass,
  isSeasonPassActive,
  buildSessionPayload,
  base64urlEncode,
  base64urlDecode,
  SEASON_PASS_CUTOFF,
};
