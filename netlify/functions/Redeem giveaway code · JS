const { getStore, connectLambda } = require("@netlify/blobs");

// ═══════════════════════════════════════
// REDEEM GIVEAWAY CODE (public-facing)
//
// Call this from wherever a giveaway winner enters their code — a
// field on the signup/account page, or a small standalone form.
// A code only ever works ONCE: the first successful redemption binds
// it permanently to that account, so even if the winner posts the
// code publicly afterward, nobody else's redemption attempt succeeds.
//
// Expects a POST with JSON body:
//   { "code": "SANCTUM-7X9QM2VK", "accountId": "<your internal user id>", "email": "winner@example.com" }
//
// `accountId` should be whatever ID your signup flow already assigns
// (Patreon member ID, Netlify Identity user ID, etc.) — this function
// doesn't create accounts or grant access itself; it just records
// which account claimed which code. Wire the actual "grant free
// access" step into your existing signup/entitlement logic, keyed
// off a successful response from this endpoint.
//
// NOTE ON CONCURRENCY: this uses a get-then-set check, not a true
// atomic compare-and-swap. With only 3 low-traffic codes and no
// realistic scenario of two people redeeming the exact same code in
// the same millisecond, the race window here is not a practical
// concern — but it's worth knowing this isn't bank-grade locking if
// you ever scale this up to hundreds of codes redeemed concurrently.
// ═══════════════════════════════════════

const STORE_NAME = "giveaway-codes";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8"
};

function jsonResponse(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
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
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const rawCode = (payload.code || "").trim().toUpperCase();
  const accountId = (payload.accountId || "").trim();
  const email = (payload.email || "").trim();

  if (!rawCode) {
    return jsonResponse(400, { error: "Missing code." });
  }
  if (!accountId) {
    return jsonResponse(400, { error: "Missing accountId." });
  }

  try {
    const store = getStore({ name: STORE_NAME });
    const key = `code:${rawCode}`;
    const record = await store.get(key, { type: "json" });

    if (!record) {
      return jsonResponse(404, { error: "Code not found. Double-check for typos." });
    }

    if (record.status === "claimed") {
      // Don't leak WHO claimed it — just that it's gone.
      return jsonResponse(409, { error: "This code has already been redeemed." });
    }

    const updated = {
      ...record,
      status: "claimed",
      claimedAt: new Date().toISOString(),
      claimedByAccountId: accountId,
      claimedByEmail: email || null
    };

    await store.setJSON(key, updated);

    return jsonResponse(200, {
      success: true,
      code: rawCode,
      campaign: record.campaign,
      message: "Code redeemed successfully. Free access granted."
    });
  } catch (err) {
    console.log("redeem-giveaway-code error:", err.message);
    return jsonResponse(500, { error: "Something went wrong redeeming the code. Try again." });
  }
};
