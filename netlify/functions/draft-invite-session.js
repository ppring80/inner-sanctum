const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════════
// DRAFT-INVITE-SESSION
//
// P0 fix (Draft Command SAGE recommendations 403ing for passcode-gate
// customers): sage-recommend.js now requires a real, server-verified
// session (see its hasFullAcolyteAccess()) -- correct for its original
// purpose (blocking anonymous/preview access to paid SAGE data), but the
// Draft passcode gate in draft.html was always a client-side-only,
// sessionStorage UX gate with no server component at all, so passcode
// customers never had anything server-verifiable to send.
//
// This endpoint is that missing server component -- but deliberately
// NARROW in scope, per explicit design requirement:
//   - validates the passcode SERVER-SIDE against DRAFT_INVITE_PASSCODE
//     only (never a hardcoded fallback -- see the fail-closed check
//     below)
//   - on success, mints a SEPARATE signed cookie (draft_sage_session),
//     never sanctum_session -- this never touches, mints, or implies
//     Founding Acolyte / fullAccess in any way
//   - the resulting session is scoped (payload.scope ===
//     "draft_sage_access") so that even sage-recommend.js's own check
//     for it (see hasDraftSageAccess() there) cannot be satisfied by a
//     differently-scoped signed payload, and no other endpoint in this
//     codebase reads this cookie name at all
//
// SHARED LOGIC, NOT SHARED IMPORT: signSession()/base64urlEncode() below
// are intentionally independent copies of the ones in oauth-callback.js,
// matching that file's own documented reasoning for why verify-session.js
// keeps its own copy rather than importing production logic through a
// test-only export block. Each copy is covered by its own test suite.
// ═══════════════════════════════════════════════════════════════════════

const COOKIE_NAME = "draft_sage_session";
const SCOPE = "draft_sage_access";
const TTL_SECONDS = 60 * 60 * 8; // 8 hours -- long enough for one live draft night

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function base64urlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

// Isolated specifically so a future per-IP/per-window attempt counter
// (e.g. via the same Netlify Blobs store pattern used elsewhere in this
// codebase) can wrap this one call without touching request parsing,
// cookie signing, or response shaping -- structured for brute-force
// protection to be added cleanly, per explicit design requirement, not
// implementing rate-limiting itself yet.
//
// Equal-length check before timingSafeEqual matches the exact pattern
// verify-session.js's own verifySession() already uses for its
// signature comparison -- timingSafeEqual throws on mismatched buffer
// lengths, so length is checked first (a minor, already-accepted
// information leak in this codebase, far smaller than leaking exact
// mismatch position via a naive === comparison).
function validateDraftInvitePasscode(candidate, configured) {
  if (typeof candidate !== "string" || !candidate) return false;
  const candidateBuf = Buffer.from(candidate);
  const configuredBuf = Buffer.from(configured);
  if (candidateBuf.length !== configuredBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, configuredBuf);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "POST only" })
    };
  }

  const signingSecret = process.env.COOKIE_SIGNING_SECRET;
  const expectedPasscode = process.env.DRAFT_INVITE_PASSCODE;

  // Fails closed, matching verify-session.js's own convention exactly:
  // if the server itself isn't fully configured, nobody is granted
  // access just because a check couldn't be performed. No fallback
  // passcode of any kind exists in this file.
  if (!signingSecret || !expectedPasscode) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Draft invite access is not configured." })
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid request body." })
    };
  }

  if (!validateDraftInvitePasscode(body.passcode, expectedPasscode)) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid invite passcode." })
    };
  }

  const payload = {
    scope: SCOPE,
    exp: Date.now() + TTL_SECONDS * 1000
  };
  const session = signSession(payload, signingSecret);
  const cookie = `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`;

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Set-Cookie": cookie },
    body: JSON.stringify({ ok: true })
  };
};

// Exported for isolated testing only -- not used by the handler's own
// control flow above.
module.exports._test = {
  validateDraftInvitePasscode,
  signSession,
  base64urlEncode,
  COOKIE_NAME,
  SCOPE,
  TTL_SECONDS
};
