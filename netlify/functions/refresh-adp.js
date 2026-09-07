// netlify/functions/refresh-adp.js
//
// INNER SANCTUM — SCHEDULED TANK01 ADP CACHE WRITER
//
// Fetch Tank01 ADP on a controlled schedule and persist validated
// response bodies to Netlify Blobs. Customer-facing adp.js reads this
// cache only, so customer traffic cannot trigger Tank01 ADP work.
//
// Provider cost per scheduled run: 3 x getNFLADP (PPR, halfPPR, standard).
// Store: draft-adp
// Keys: scoring:ppr, scoring:half-ppr, scoring:standard

const { connectLambda, getStore } = require("@netlify/blobs");

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const STORE_NAME = "draft-adp";

const SCORING_VARIANTS = [
  { scoring: "ppr", adpType: "PPR" },
  { scoring: "half-ppr", adpType: "halfPPR" },
  { scoring: "standard", adpType: "standard" }
];

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body, null, 2)
  };
}

async function fetchTank01Adp(adpType) {
  const apiKey = process.env.TANK01_API_KEY;
  if (!apiKey) throw new Error("TANK01_API_KEY is not configured.");

  const url = `https://${TANK01_HOST}/getNFLADP?adpType=${encodeURIComponent(adpType)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": TANK01_HOST
    }
  });

  let json = null;
  try {
    json = await response.json();
  } catch (error) {
    json = null;
  }

  if (!response.ok) {
    throw new Error(`Tank01 getNFLADP failed with HTTP ${response.status}.`);
  }

  if (!json || !json.body || !Array.isArray(json.body.adpList) || json.body.adpList.length === 0) {
    throw new Error(`Tank01 getNFLADP returned no adpList for ${adpType}.`);
  }

  return json.body;
}

exports.handler = async function (event) {
  connectLambda(event);
  const generatedAt = new Date().toISOString();

  try {
    // Validate every scoring variant before touching known-good cache.
    const fetched = [];
    for (const variant of SCORING_VARIANTS) {
      const body = await fetchTank01Adp(variant.adpType);
      fetched.push({
        scoring: variant.scoring,
        adpType: variant.adpType,
        body
      });
    }

    const store = getStore({ name: STORE_NAME });
    for (const item of fetched) {
      await store.setJSON(`scoring:${item.scoring}`, {
        generatedAt,
        source: "Tank01",
        scoring: item.scoring,
        adpType: item.adpType,
        playerCount: item.body.adpList.length,
        body: item.body
      });
    }

    console.log(`refresh-adp: cached ${fetched.length} scoring variants at ${generatedAt}.`);

    return jsonResponse(200, {
      cached: true,
      generatedAt,
      blobStore: STORE_NAME,
      variants: fetched.map(function (item) {
        return {
          scoring: item.scoring,
          adpType: item.adpType,
          playerCount: item.body.adpList.length,
          blobKey: `scoring:${item.scoring}`
        };
      })
    });
  } catch (error) {
    console.error("refresh-adp failed; existing cache left untouched:", error);
    return jsonResponse(502, {
      cached: false,
      blobStore: STORE_NAME,
      error: "Could not refresh Tank01 ADP cache; existing cache was left untouched.",
      detail: error && error.message ? error.message : String(error)
    });
  }
};
