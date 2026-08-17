const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════
// REDEEM GIVEAWAY CODE (public-facing) — Aug 17 2026 email-bound
// redemption design
//
// Call this from the giveaway-code path on sanctum.html's gate (the
// canonical redemption page — see sanctum.html's redeemGiveawayCode()
// for the client side of this flow).
//
// Expects a POST with JSON body:
//   { "code": "SANCTUM-7X9QM2VK", "email": "winner@example.com" }
//
// WHY EMAIL, AND WHY THIS DESIGN (Aug 17 2026 design inspection):
// Inner Sanctum has NO account system of any kind — access is granted
// entirely via a signed, stateless session cookie (see oauth-callback.js),
// never a persisted user/account record. That means a giveaway code
// string is the ONLY credential that can exist here; there's no
// account identity to bind it to. Requiring the SAME email on any
// later redemption of an already-claimed code is a deliberate,
// explicitly-scoped compromise: it is NOT real authentication (anyone
// who has both the code and the email could still get in) — it exists
// specifically to solve DURABILITY (a winner losing their cookie after
// 30 days, switching devices, or clearing cookies must have a way back
// in) without pretending this is more secure than it is. See the
// giveaway redemption design report for the full reasoning; this is
// the smallest practical compromise given no account identity exists,
// not a first step toward building one.
//
// On a NEW (unclaimed) code: email is REQUIRED. The code is marked
// claimed, the email is stored, and — unlike the original version of
// this function — a real signed sanctum_session cookie is issued
// immediately, using the EXACT same format, secret, and signing scheme
// as oauth-callback.js's Patreon login path. verify-session.js needs
// no changes at all: it doesn't care how a session cookie was created,
// only that it verifies against COOKIE_SIGNING_SECRET (see
// verify-session.js's own header comment on why its verifySession() is
// a deliberate duplicate of oauth-callback.js's, not a shared import —
// this file's copy is the same established pattern, a third instance
// of it, not a new one).
//
// On an ALREADY-CLAIMED code: if the submitted email matches
// (case-insensitively) the email stored at first claim, access is
// restored — a fresh cookie is issued, nothing else changes. If the
// email does NOT match, the request is rejected. This is what makes
// the code non-transferable in the casual sense: someone who only has
// the code string (e.g. it leaked or was shared) cannot get in without
// also knowing the exact email the original winner used.
//
// Does NOT read or require GIVEAWAY_ADMIN_KEY — that's the separate
// admin-only secret gating generate-giveaway-codes.js/
// list-giveaway-codes.js. This is a public endpoint by design; the
// giveaway code itself (plus, now, the matching email) is its only
// gate.
//
// Does NOT touch Patreon OAuth in any way — oauth-callback.js is
// completely unmodified. This is a second, independent way to obtain
// the exact same kind of session cookie, not a change to the first.
//
// NOTE ON CONCURRENCY: unchanged from the original version of this
// file — a get-then-set check, not true atomic compare-and-swap. With
// only 5 low-traffic codes and no realistic scenario of two people
// redeeming the exact same code in the same millisecond, this remains
// a non-concern in practice, not bank-grade locking.
// ═══════════════════════════════════════════════════════════════════

const STORE_NAME = "giveaway-codes";

// ── Identical to oauth-callback.js's session constants/signing logic.
// Deliberately duplicated, not imported — same rationale as
// verify-session.js's own copy (see that file's header comment): keeps
// this endpoint independently testable and decoupled from a future
// refactor of the Patreon login path. If the signing scheme ever
// changes, update oauth-callback.js, verify-session.js, AND this file
// together — three independent, matching copies, not an oversight. ──
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "sanctum_session";

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

function buildSessionCookieHeader(secret, now) {
  const payload = { fullAccess: true, exp: now.getTime() + SESSION_DURATION_MS };
  const session = signSession(payload, secret);
  return `${COOKIE_NAME}=${session}; Path=/; Max-Age=${Math.floor(
    SESSION_DURATION_MS / 1000
  )}; HttpOnly; Secure; SameSite=Lax`;
}

// Simple, deliberately non-strict format check — this is a UX
// sanity check (catch an obviously-empty or malformed value before
// bothering the store), not a security boundary. The store lookup
// itself is what actually determines validity.
function isPlausibleEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8"
};

function jsonResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({}, CORS_HEADERS, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed — use POST." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Invalid request. Please try again." });
  }

  const rawCode = (payload.code || "").trim().toUpperCase();
  const email = (payload.email || "").trim();

  if (!rawCode) {
    return jsonResponse(400, { error: "Please enter your giveaway code." });
  }

  // Every successful path below needs to issue a signed cookie — check
  // the signing secret is configured BEFORE touching the store at all,
  // so a misconfigured server never consumes a code it can't actually
  // grant access for. Same fail-closed convention as oauth-callback.js
  // and verify-session.js.
  const secret = process.env.COOKIE_SIGNING_SECRET;
  if (!secret) {
    console.log("redeem-giveaway-code: COOKIE_SIGNING_SECRET is not configured — failing closed.");
    return jsonResponse(500, { error: "Something went wrong on our end. Please try again in a moment." });
  }

  try {
    const store = getStore({ name: STORE_NAME });
    const key = `code:${rawCode}`;
    const record = await store.get(key, { type: "json" });

    if (!record) {
      return jsonResponse(404, { error: "Code not found. Double-check for typos." });
    }

    const now = new Date();
    const cookieHeader = buildSessionCookieHeader(secret, now);

    if (record.status === "claimed") {
      // ── Restoration path: already claimed. Only the matching email
      // gets a fresh cookie; anyone else is rejected. Never reveals the
      // stored email in the error — just that it doesn't match. ──
      const storedEmail = (record.claimedByEmail || "").toLowerCase();
      const submittedEmail = email.toLowerCase();

      if (!email || storedEmail !== submittedEmail) {
        return jsonResponse(403, {
          error: "This code is already linked to a different email address. If this is a mistake, reach out for help."
        });
      }

      const updated = Object.assign({}, record, { lastAccessedAt: now.toISOString() });
      await store.setJSON(key, updated);

      return jsonResponse(
        200,
        { success: true, code: rawCode, campaign: record.campaign, message: "Welcome back — access restored." },
        { "Set-Cookie": cookieHeader }
      );
    }

    // ── First claim: email is required. ──
    if (!email) {
      return jsonResponse(400, { error: "Please enter the email you'd like this code linked to." });
    }
    if (!isPlausibleEmail(email)) {
      return jsonResponse(400, { error: "That doesn't look like a valid email address. Please double-check it." });
    }

    const updated = Object.assign({}, record, {
      status: "claimed",
      claimedAt: now.toISOString(),
      claimedByEmail: email
    });

    await store.setJSON(key, updated);

    return jsonResponse(
      200,
      { success: true, code: rawCode, campaign: record.campaign, message: "Code redeemed — welcome to the Sanctum!" },
      { "Set-Cookie": cookieHeader }
    );
  } catch (err) {
    console.log("redeem-giveaway-code error:", err.message);
    return jsonResponse(500, { error: "Something went wrong redeeming the code. Try again." });
  }
};

// Exported for direct unit testing of the pure signing logic and the
// email-format check, independent of the live Blobs store.
module.exports._test = {
  signSession,
  base64urlEncode,
  buildSessionCookieHeader,
  isPlausibleEmail,
  SESSION_DURATION_MS,
  COOKIE_NAME
};
