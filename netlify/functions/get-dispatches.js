const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════
// GET DISPATCHES — public read endpoint for dispatches.html
//
// Simple by design: reads whatever generate-camp-watch.js most
// recently cached and returns it as-is. No Tank01 or Anthropic calls
// happen here — this is a fast Blobs read, safe to call on every
// dispatches.html page load without worrying about API budget or
// latency, same relationship refresh-player-data.js has with
// chat.js's getLiveNFLContext().
//
// If nothing has been generated yet (e.g. first deploy, before the
// first scheduled run has fired), returns an empty dispatches array
// with a hasData:false flag rather than erroring — dispatches.html
// uses that to fall back to a "Camp Watch is warming up" message
// instead of a broken page.
// ═══════════════════════════════════════

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  try {
    const store = getStore({ name: "camp-watch" });
    const cached = await store.get("dispatches", { type: "json" });

    if (!cached) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ hasData: false, dispatches: [] })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        hasData: true,
        updatedAt: cached.updatedAt,
        dispatches: cached.dispatches
      })
    };
  } catch (e) {
    console.log("get-dispatches read failed:", e.message);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ hasData: false, dispatches: [] })
    };
  }
};
