const { getStore, connectLambda } = require("@netlify/blobs");

// ═══════════════════════════════════════
// LIST GIVEAWAY CODES (admin-only)
//
// Quick status check — see which of your giveaway codes have been
// claimed, by whom (account ID/email), and when. Useful for
// confirming all 3 winners actually redeemed before you close out
// the giveaway, or for tracking multiple campaigns over time.
//
// ACCESS: same GIVEAWAY_ADMIN_KEY pattern as generate-giveaway-codes.js.
//
// USAGE:
//   https://theinnersanctum.xyz/.netlify/functions/list-giveaway-codes?key=<GIVEAWAY_ADMIN_KEY>
//   Optionally filter: &campaign=aug2026-launch
// ═══════════════════════════════════════

const STORE_NAME = "giveaway-codes";
const CODE_KEY_PREFIX = "code:";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8"
};

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const params = event.queryStringParameters || {};
  const providedKey = params.key;
  const expectedKey = process.env.GIVEAWAY_ADMIN_KEY;
  if (!expectedKey || providedKey !== expectedKey) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Unauthorized"
    };
  }

  const campaignFilter = params.campaign || null;

  try {
    const store = getStore({ name: STORE_NAME });
    const listing = await store.list({ prefix: CODE_KEY_PREFIX });
    const records = [];

    for (const blob of listing.blobs || []) {
      const record = await store.get(blob.key, { type: "json" });
      if (!record) continue;
      if (campaignFilter && record.campaign !== campaignFilter) continue;
      records.push(record);
    }

    records.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    const claimedCount = records.filter((r) => r.status === "claimed").length;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        {
          total: records.length,
          claimed: claimedCount,
          unclaimed: records.length - claimedCount,
          codes: records
        },
        null,
        2
      )
    };
  } catch (err) {
    console.log("list-giveaway-codes error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
