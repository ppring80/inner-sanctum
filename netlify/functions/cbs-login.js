// ═══════════════════════════════════════════════════════════════════════
// CBS-LOGIN
//
// WHY THIS FILE EXISTS: CBS Sports never built a modern developer program
// for Fantasy — the "Fantasy Platform Development Center" (developer.
// cbssports.com) launched in 2012 and is now officially deprecated. There
// is no OAuth flow, no self-service app registration, and no supported
// way to get read access to a league's data. The only known working path
// — used by the small number of community tools that still integrate
// with CBS fantasy leagues — is to authenticate the same way the CBS
// Sports website itself does, and pull an API token out of the resulting
// page.
//
// REQUEST SHAPE — confirmed against a real, still-functioning open-source
// implementation (geoffharcourt/cbs_fantasy_sports_api_token_fetcher,
// MIT licensed), not guessed from documentation:
//   POST https://www.cbssports.com/login
//   body (form-encoded): { userid, password, xurl }
//   where xurl = "https://<leagueName>.cbssports.com/"
// The response is an ordinary HTML page (not JSON) that embeds the API
// token in an inline script tag as `var token = "...";` — this function
// extracts that with a regex, the same approach the reference
// implementation uses, because CBS gives no structured alternative.
//
// WHY THIS IS A SERVER-SIDE FUNCTION, NOT A BROWSER CALL: two reasons,
// both harder requirements than the usual CORS-dodge other proxy
// functions in this repo exist for —
//   1. cbssports.com does not send CORS headers permitting cross-origin
//      requests from theinnersanctum.xyz, so a direct browser fetch()
//      would be blocked regardless.
//   2. Even if it weren't blocked, this request carries the visitor's
//      real CBS Sports PASSWORD in the request body. That must never
//      transit through, or be visible in, our own client-side JS or
//      browser devtools network tab pointed at a THIRD PARTY domain —
//      routing it through our own server keeps the credential inside a
//      single first-party request the visitor already trusts us with
//      (same trust boundary as typing it into our form at all).
//
// WHAT THIS FUNCTION DOES NOT DO: it does not store the username or
// password anywhere — not in logs, not in a database, not in memory
// beyond the single request. It makes one outbound POST, extracts the
// token from the response, and returns ONLY the token and league name to
// the caller. The token itself is what gets stored client-side (in
// LeagueConnection's localStorage entry, alongside ESPN's cookie-based
// connections) for use on later CBS API calls — same pattern already
// used for ESPN's espn_s2/SWID.
//
// KNOWN FRAGILITY (this is the honest tradeoff of using a deprecated,
// unsupported system): CBS could change their login page's markup, rate-
// limit or CAPTCHA-gate this endpoint, or shut off the legacy API
// entirely at any time, without notice, since none of this is a
// supported integration path. If this function starts failing broadly,
// that is the most likely cause — check whether the reference
// implementation (linked above) still works before assuming a bug here.
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

const CBS_LOGIN_URL = "https://www.cbssports.com/login";
const TOKEN_REGEX = /var token = "(.+?)"/;

async function fetchCbsToken({ leagueName, username, password }) {
  const xurl = `https://${leagueName}.cbssports.com/`;

  const body = new URLSearchParams({
    userid: username,
    password: password,
    xurl: xurl
  });

  const response = await fetch(CBS_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // A plain, real-browser-looking User-Agent — some sites serve a
      // different (or blocked) response to obvious script/bot traffic.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    },
    body: body.toString()
  });

  const html = await response.text();
  const match = html.match(TOKEN_REGEX);

  if (!match || !match[1]) {
    // Most likely cause: wrong username/password, or a league name that
    // doesn't match an actual CBS league URL. Less likely but possible:
    // CBS changed their login page markup and this regex no longer
    // matches anything (see KNOWN FRAGILITY note above).
    return { token: null };
  }

  return { token: match[1] };
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

  const { leagueName, username, password } = payload;

  if (!leagueName || !username || !password) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "leagueName, username, and password are all required" })
    };
  }

  try {
    const { token } = await fetchCbsToken({ leagueName, username, password });

    if (!token) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Could not retrieve a CBS token — check your username, password, and league name."
        })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, token, leagueName })
    };
  } catch (err) {
    // Deliberately never log `payload` here — it contains the visitor's
    // real CBS password. Only the error message is logged.
    console.log("cbs-login handler error:", err.message);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Could not reach CBS Sports — their login system may be unavailable or changed. Try again shortly." })
    };
  }
};
