const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════════
// VERIFY-SESSION
//
// WHY THIS FILE EXISTS: oauth-callback.js sets sanctum_session as an
// HttpOnly cookie (deliberately — see oauth-callback.js's COOKIE
// signing notes). HttpOnly means client-side JavaScript on auction.html,
// tiers.html, etc. CANNOT read the cookie's value via document.cookie —
// that's the whole point of HttpOnly, it stops a successful XSS from
// stealing the session. But it also means those pages have no way to
// check "is this person logged in and what do they have access to"
// without asking a server-side function to do it for them.
//
// This function is that ask. The browser automatically attaches
// sanctum_session to same-origin fetch() calls (cookies aren't blocked
// from being SENT by HttpOnly, only from being READ by JS) — so a page
// can call fetch('/.netlify/functions/verify-session', {credentials:
// 'same-origin'}) and this function reads the cookie server-side, where
// HttpOnly doesn't apply, verifies it, and hands back ONLY the resulting
// access flags. The raw cookie value, the signing secret, and the
// session payload's internals never get exposed to the page's JS.
//
// SHARED LOGIC, NOT SHARED IMPORT: the verifySession() function below is
// intentionally a byte-for-byte copy of the one in oauth-callback.js,
// not an import of it. oauth-callback.js exports a `_test` block for its
// own isolated test suite — that block is test-only scaffolding, not a
// production API, and importing production logic through it would mean
// a future test-focused refactor could silently break this function.
// Keeping an independent copy here, each covered by its own test suite,
// avoids that coupling. If verifySession's logic ever changes, update
// it in BOTH files — this is a deliberate, documented duplication of a
// small, stable, already-tested function, not an oversight.
// ═══════════════════════════════════════════════════════════════════════

const COOKIE_NAME = "sanctum_session";

function base64urlDecode(str) {
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
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

// Parses a raw `Cookie` request header (e.g. "a=1; sanctum_session=xyz; b=2")
// and extracts one named cookie's value. Netlify Functions hand the whole
// header through as a single string — there's no built-in cookie parser
// in this runtime, so this is a small, deliberately permissive parser:
// trims whitespace around each pair, and is tolerant of cookies appearing
// in any order or with extra unrelated cookies present.
function extractCookie(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const parts = cookieHeader.split(";");
  for (let i = 0; i < parts.length; i++) {
    const [rawKey, ...rawVal] = parts[i].split("=");
    if (!rawKey) continue;
    if (rawKey.trim() === name) {
      return rawVal.join("=").trim(); // session values never contain '=' themselves, but join defensively in case a future payload shape does
    }
  }
  return null;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Content-Type": "application/json",
};

// ── Handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // Read-only check — GET is the right verb, and this keeps the
  // endpoint trivially cacheable-by-intent (even though we don't
  // actually set cache headers here, since session state can change
  // at any moment and a stale cached "yes" would be a real problem).
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const secret = process.env.COOKIE_SIGNING_SECRET;

  // Fails closed, same convention as oauth-callback.js: if the server
  // itself isn't configured correctly, nobody gets treated as having
  // access just because we couldn't check.
  if (!secret) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ fullAccess: false }),
    };
  }

  const cookieHeader = event.headers.cookie || event.headers.Cookie || "";
  const rawSession = extractCookie(cookieHeader, COOKIE_NAME);
  const payload = verifySession(rawSession, secret);

  // No valid session at all (missing, expired, tampered, wrong secret —
  // verifySession() collapses all of these to null, same as it always
  // has) — both flags fail closed to false. The calling page's existing
  // passcode-gate fallback takes over from here; this endpoint's job
  // ends at "no", not at explaining why.
  if (!payload) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ fullAccess: false }),
    };
  }

  // Defensive defaults: if an older session payload shape somehow ever
  // reached this function (e.g. a cookie issued by a stale deployed
  // version of oauth-callback.js mid-rollout), missing flags read as
  // false rather than throwing or evaluating to truthy/undefined.
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      fullAccess: payload.fullAccess === true,
    }),
  };
};

// Exported for isolated testing only — not used by the handler itself.
module.exports._test = {
  verifySession,
  extractCookie,
  base64urlDecode,
};
