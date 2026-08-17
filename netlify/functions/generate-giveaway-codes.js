const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

// ═══════════════════════════════════════
// GENERATE GIVEAWAY CODES (admin-only, run-once-per-giveaway)
//
// Creates a fixed number of single-use access codes for the Instagram
// giveaway and seeds them into Netlify Blobs, unclaimed. Each code
// is bound to whichever account redeems it FIRST — see
// redeem-giveaway-code.js for that half of the flow.
//
// This is NOT meant to be called by the public. It's a one-time admin
// action you trigger yourself from a browser after picking winners
// (or before, to have codes ready to DM out).
//
// ACCESS: same shared-secret pattern as spend-dashboard.js. Requires
// ?key=<value> matching the GIVEAWAY_ADMIN_KEY environment variable
// set in Netlify. Set that env var yourself before using this —
// see the note at the bottom of this file for a suggested value.
//
// USAGE:
//   https://theinnersanctum.xyz/.netlify/functions/generate-giveaway-codes?key=<GIVEAWAY_ADMIN_KEY>&count=3&campaign=aug2026-launch
//
// `count` (optional, default 3) — how many codes to generate this call.
// `campaign` (optional, default "default") — a label so you can run
// multiple giveaways over time without codes colliding or getting
// confused with each other in the store.
//
// The generated codes are shown ONLY ONCE, in this response. They are
// not retrievable in plaintext again afterward (the store only ever
// holds their hashed... actually no — for simplicity and since these
// are single-use low-value codes, they're stored in plaintext as the
// blob key itself, which is fine here: the key is never exposed
// through any public-facing endpoint, only through this admin call
// and the redeem endpoint's internal lookup). Copy them down
// immediately (e.g. paste into a note) before closing this tab.
// ═══════════════════════════════════════

const STORE_NAME = "giveaway-codes";
const CODE_PREFIX = "SANCTUM";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8"
};

// Generates a code like SANCTUM-7X9QM2VK — uppercase letters and
// digits only, no ambiguous characters (0/O, 1/I/L excluded) so it's
// easy to read aloud or type from a DM without transcription errors.
function generateCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0,O,1,I,L
  let suffix = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    suffix += alphabet[bytes[i] % alphabet.length];
  }
  return `${CODE_PREFIX}-${suffix}`;
}

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

  const count = Math.min(Math.max(parseInt(params.count, 10) || 3, 1), 20); // hard cap 20/call as a sanity guard
  const campaign = (params.campaign || "default").slice(0, 60);

  try {
    const store = getStore({ name: STORE_NAME });
    const generated = [];

    for (let i = 0; i < count; i++) {
      let code;
      let attempts = 0;
      // Extremely unlikely to collide (32^8 possibilities), but check
      // anyway and retry rather than risk silently overwriting an
      // existing unclaimed code.
      do {
        code = generateCode();
        attempts++;
      } while ((await store.get(`code:${code}`)) !== null && attempts < 5);

      const record = {
        code,
        campaign,
        status: "unclaimed",
        createdAt: new Date().toISOString(),
        claimedAt: null,
        claimedByAccountId: null,
        claimedByEmail: null
      };

      await store.setJSON(`code:${code}`, record);
      generated.push(code);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        {
          campaign,
          count: generated.length,
          codes: generated,
          note: "Copy these down now — this is the only time they're shown in plaintext. DM one to each winner individually rather than posting publicly."
        },
        null,
        2
      )
    };
  } catch (err) {
    console.log("generate-giveaway-codes error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// ─────────────────────────────────────
// SETUP REMINDER: before calling this function, add a new environment
// variable in Netlify (Site settings → Environment variables), same
// place you added SPEND_DASHBOARD_KEY:
//
//   Key:   GIVEAWAY_ADMIN_KEY
//   Value: pick your own random string, e.g. a long password
//
// Then redeploy if Netlify prompts you to, and visit the USAGE url
// above with your real key and campaign name filled in.
// ─────────────────────────────────────
