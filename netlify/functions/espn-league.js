// ═══════════════════════════════════════════════════════════════════════
// ESPN-LEAGUE
//
// WHY THIS FILE EXISTS: ESPN has no official public Fantasy API — no
// developer program, no app registration, no OAuth. The only known
// working path (used by the several actively-maintained community
// libraries for this, e.g. cwendt94/espn-api and the ffscrapr R package)
// is ESPN's own undocumented v3 endpoint, the same one fantasy.espn.com
// itself calls from the browser:
//
//   GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/
//       {season}/segments/0/leagues/{leagueId}?view=mTeam&view=mRoster&
//       view=mMatchup&view=mSettings
//
// AUTH MODEL — simpler than CBS, no login step at all:
//   - PUBLIC leagues: no auth needed, the GET above works as-is.
//   - PRIVATE leagues: the same GET, but with the visitor's own
//     espn_s2 and SWID browser cookies attached as a Cookie header.
//     These act like a session token ESPN already issued the visitor
//     when they logged into fantasy.espn.com themselves — we are not
//     obtaining or guessing credentials, only relaying values the
//     visitor copied from their own already-authenticated browser
//     session (see connect-league.html's ESPN form for how those are
//     collected, with a step-by-step guide for finding them).
//
// WHY THIS IS A SERVER-SIDE FUNCTION, NOT A BROWSER CALL: ESPN's API
// does not send CORS headers permitting requests from
// theinnersanctum.xyz, so a direct browser fetch() would be blocked
// regardless of auth. Routing through our own server also means a
// private league's espn_s2/SWID values transit through a single
// first-party request rather than being visible in a third-party
// network call from the browser's own devtools.
//
// WHAT THIS FUNCTION DOES NOT DO: store espn_s2/SWID anywhere server-
// side — they arrive in the request body, get used for exactly one
// outbound fetch to ESPN, and are never logged. The FRONT END is what
// persists them (in LeagueConnection's localStorage entry, same pattern
// as CBS's token was going to work before CBS was ruled out) — this
// function is stateless per request.
//
// SHAPE NOTE: ESPN's response is large and deeply nested. This function
// does NOT attempt to normalize it into the shared normalizeLeagueData()
// shape from provider-adapters.js yet — that adapter's normalizeEspnData()
// is still a placeholder built from best-guess field names. This
// function returns ESPN's raw JSON as-is; wiring it through the adapter
// (once real response shapes are confirmed against live data) is a
// follow-up step, not done here.
//
// KNOWN FRAGILITY: this is still an undocumented, unsupported endpoint.
// ESPN can change its shape or block it at any time with no notice —
// same category of risk as the CBS approach was, just without a CAPTCHA
// wall blocking it today. If this starts failing broadly, check whether
// the community libraries linked above still work before assuming a bug
// here.
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const ESPN_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
const VIEWS = ["mTeam", "mRoster", "mMatchup", "mSettings"];

async function fetchEspnLeague({ leagueId, season, espn_s2, swid }) {
  const viewParams = VIEWS.map(v => `view=${v}`).join("&");
  const url = `${ESPN_BASE_URL}/${season}/segments/0/leagues/${leagueId}?${viewParams}`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
  };

  // Only private leagues need the cookie header at all — a public
  // league request with no Cookie header works exactly the same as a
  // logged-out visitor browsing fantasy.espn.com.
  if (espn_s2 && swid) {
    headers["Cookie"] = `espn_s2=${espn_s2}; SWID=${swid}`;
  }

  const response = await fetch(url, { headers });

  if (response.status === 401 || response.status === 403) {
    return { error: "auth", status: response.status };
  }
  if (response.status === 404) {
    return { error: "not_found", status: response.status };
  }
  if (!response.ok) {
    return { error: "unknown", status: response.status };
  }

  const data = await response.json();
  return { data };
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  const { leagueId, season, espn_s2, swid } = payload;

  if (!leagueId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "leagueId is required" })
    };
  }

  const seasonYear = season || new Date().getFullYear();

  try {
    const result = await fetchEspnLeague({ leagueId, season: seasonYear, espn_s2, swid });

    if (result.error === "auth") {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "ESPN rejected this request — for a private league, double-check your espn_s2 and SWID values are current (they can expire if you log out of ESPN)."
        })
      };
    }
    if (result.error === "not_found") {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "League not found — check your League ID and season year." })
      };
    }
    if (result.error) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "ESPN returned an unexpected response (status " + result.status + "). Their API may be unavailable or changed." })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, league: result.data })
    };
  } catch (err) {
    console.log("espn-league handler error:", err.message);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Could not reach ESPN. Try again shortly." })
    };
  }
};
