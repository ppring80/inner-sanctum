"use strict";

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const AUTH_STORE = "chatgpt-oauth";
const SNAPSHOT_STORE = "league-snapshots";

const ISSUER = "https://theinnersanctum.xyz";
const MCP_RESOURCE =
  "https://theinnersanctum.xyz/.netlify/functions/chatgpt-mcp";

const AUTHORIZATION_ENDPOINT =
  `${ISSUER}/.netlify/functions/chatgpt-oauth?action=authorize`;
const TOKEN_ENDPOINT =
  `${ISSUER}/.netlify/functions/chatgpt-oauth?action=token`;
const REGISTRATION_ENDPOINT =
  `${ISSUER}/.netlify/functions/chatgpt-oauth?action=register`;
const PROTECTED_RESOURCE_METADATA_ENDPOINT =
  `${ISSUER}/.netlify/functions/chatgpt-oauth?action=protected-resource`;
const AUTHORIZATION_SERVER_METADATA_ENDPOINT =
  `${ISSUER}/.netlify/functions/chatgpt-oauth?action=authorization-server`;

const SCOPE_LEAGUE_READ = "inner_sanctum.league.read";
const SCOPE_OFFLINE = "offline_access";
const SUPPORTED_SCOPES = new Set([
  SCOPE_LEAGUE_READ,
  SCOPE_OFFLINE
]);

const AUTH_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TRANSACTION_TTL_SECONDS = 10 * 60;
const CLIENT_TTL_SECONDS = 365 * 24 * 60 * 60;

const RANDOM_TOKEN_BYTES = 32;
const TRANSACTION_COOKIE = "is_oauth_tx";
const MAX_BODY_BYTES = 100000;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function htmlResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://chatgpt.com https://*.openai.com;",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders
    },
    body
  };
}

function redirectResponse(location, extraHeaders = {}) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body: ""
  };
}

function safeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function randomToken(bytes = RANDOM_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function sha256Base64Url(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("base64url");
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    left,
    right
  );
}

function blobKey(prefix, token) {
  return `${prefix}:${sha256(token)}`;
}

function snapshotBlobKey(linkToken) {
  return `sha256:${sha256(linkToken)}`;
}

function getQuery(event) {
  return event.queryStringParameters || {};
}

// Robust request-pathname detection (fix: Netlify .well-known rewrite
// support). Netlify's rewrite for /.well-known/oauth-protected-resource
// and /.well-known/oauth-authorization-server forwards the request to
// this function, but the intended ?action=... query parameter does not
// survive that rewrite. This reads the request's own pathname directly
// from the Netlify event instead, so those two exact discovery paths
// resolve correctly even with no action parameter present. Does not
// change, remove, or reorder any existing ?action= routing below --
// it only supplies a fallback value for `action` when the query
// parameter itself is absent.
function getRequestPath(event) {
  if (safeString(event.path)) {
    return safeString(event.path);
  }

  const rawUrl =
    safeString(event.rawUrl);

  if (!rawUrl) {
    return "";
  }

  try {
    return new URL(rawUrl).pathname;
  } catch (error) {
    return "";
  }
}

// Maps the two standard OAuth discovery paths to their existing
// ?action= equivalents. Matched by suffix so this is robust to
// whatever prefix Netlify's rewrite leaves in front of the path
// (the bare /.well-known/... path, or a function-prefixed variant)
// without needing to enumerate every possible exact prefix.
function detectWellKnownAction(path) {
  const value =
    safeString(path);

  if (!value) {
    return "";
  }

  if (value.endsWith("/oauth-protected-resource")) {
    return "protected-resource";
  }

  if (value.endsWith("/oauth-authorization-server")) {
    return "authorization-server";
  }

  return "";
}


function getHeader(event, name) {
  const headers =
    event.headers || {};

  return (
    headers[name.toLowerCase()] ||
    headers[name] ||
    ""
  );
}

function parseCookies(event) {
  const raw =
    safeString(
      getHeader(
        event,
        "cookie"
      )
    );

  const output = {};

  if (!raw) {
    return output;
  }

  raw
    .split(";")
    .forEach(
      (part) => {
        const index =
          part.indexOf("=");

        if (index < 0) {
          return;
        }

        const key =
          part
            .slice(
              0,
              index
            )
            .trim();

        const value =
          part
            .slice(
              index + 1
            )
            .trim();

        if (key) {
          output[key] =
            decodeURIComponent(
              value
            );
        }
      }
    );

  return output;
}

function setTransactionCookie(transactionId) {
  return (
    `${TRANSACTION_COOKIE}=${encodeURIComponent(transactionId)}; ` +
    "Path=/.netlify/functions/chatgpt-oauth; " +
    "HttpOnly; Secure; SameSite=Lax; Max-Age=600"
  );
}

function clearTransactionCookie() {
  return (
    `${TRANSACTION_COOKIE}=; ` +
    "Path=/.netlify/functions/chatgpt-oauth; " +
    "HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
}

function parseBody(event) {
  const raw =
    event.body || "";

  if (
    Buffer.byteLength(
      raw,
      "utf8"
    ) > MAX_BODY_BYTES
  ) {
    throw new Error(
      "Request body is too large."
    );
  }

  const contentType =
    safeString(
      getHeader(
        event,
        "content-type"
      )
    ).toLowerCase();

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    return raw
      ? JSON.parse(raw)
      : {};
  }

  const params =
    new URLSearchParams(
      raw
    );

  const body = {};

  for (
    const [
      key,
      value
    ] of params.entries()
  ) {
    body[key] =
      value;
  }

  return body;
}

function parseScopes(value) {
  const raw =
    safeString(value);

  if (!raw) {
    return [];
  }

  return [
    ...new Set(
      raw
        .split(/\s+/)
        .filter(Boolean)
    )
  ];
}

function validateScopes(value) {
  const scopes =
    parseScopes(value);

  if (
    !scopes.includes(
      SCOPE_LEAGUE_READ
    )
  ) {
    return {
      ok: false,
      error:
        "invalid_scope"
    };
  }

  const unsupported =
    scopes.filter(
      (scope) =>
        !SUPPORTED_SCOPES.has(
          scope
        )
    );

  if (
    unsupported.length
  ) {
    return {
      ok: false,
      error:
        "invalid_scope"
    };
  }

  return {
    ok: true,
    scopes
  };
}

function isHttpsUrl(value) {
  try {
    const url =
      new URL(
        value
      );

    return (
      url.protocol ===
      "https:"
    );
  } catch (error) {
    return false;
  }
}

function isAllowedRedirectUri(value) {
  try {
    const url =
      new URL(
        value
      );

    if (
      url.protocol ===
      "https:"
    ) {
      return true;
    }

    if (
      url.protocol ===
        "http:" &&
      (
        url.hostname ===
          "localhost" ||
        url.hostname ===
          "127.0.0.1"
      )
    ) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

function isValidPkceChallenge(value) {
  return (
    /^[A-Za-z0-9_-]{43,128}$/
      .test(
        safeString(
          value
        )
      )
  );
}

function isValidPkceVerifier(value) {
  return (
    /^[A-Za-z0-9._~-]{43,128}$/
      .test(
        safeString(
          value
        )
      )
  );
}

function validateResource(value) {
  return (
    safeString(
      value
    ) ===
    MCP_RESOURCE
  );
}

// Fix (BlobsConsistencyError, production): this runtime does not
// provide the uncachedEdgeURL that @netlify/blobs requires for
// consistency: "strong" reads, which made every read below throw
// immediately. Reads now use Netlify Blobs' own default (eventual)
// consistency instead -- no environment configuration is invented,
// and no other read/write behavior changes. See the deployment
// review for the accepted propagation-window tradeoff this implies
// for freshly-registered clients and freshly-issued authorization
// codes specifically.
async function getJson(
  store,
  key
) {
  return store.get(
    key,
    {
      type: "json"
    }
  );
}

async function saveRecord(
  store,
  key,
  record
) {
  await store.setJSON(
    key,
    record
  );
}

function isExpired(record) {
  return (
    !record ||
    Number(
      record.expiresAt ||
      0
    ) <= nowSeconds()
  );
}

async function getActiveRecord(
  store,
  key
) {
  const record =
    await getJson(
      store,
      key
    );

  if (!record) {
    return null;
  }

  if (
    isExpired(
      record
    )
  ) {
    await store
      .delete(
        key
      )
      .catch(
        () => {}
      );

    return null;
  }

  return record;
}

async function validateRegisteredClient(
  authStore,
  clientId,
  redirectUri
) {
  const id =
    safeString(
      clientId
    );

  const redirect =
    safeString(
      redirectUri
    );

  if (
    !id ||
    !redirect
  ) {
    return {
      ok: false,
      error:
        "invalid_client"
    };
  }

  const client =
    await getActiveRecord(
      authStore,
      blobKey(
        "client",
        id
      )
    );

  if (!client) {
    return {
      ok: false,
      error:
        "invalid_client"
    };
  }

  if (
    !Array.isArray(
      client.redirectUris
    ) ||
    !client.redirectUris
      .includes(
        redirect
      )
  ) {
    return {
      ok: false,
      error:
        "invalid_redirect_uri"
    };
  }

  return {
    ok: true,
    client
  };
}

function oauthErrorRedirect(
  redirectUri,
  state,
  error,
  description
) {
  const url =
    new URL(
      redirectUri
    );

  url.searchParams.set(
    "error",
    error
  );

  if (description) {
    url.searchParams.set(
      "error_description",
      description
    );
  }

  if (state) {
    url.searchParams.set(
      "state",
      state
    );
  }

  url.searchParams.set(
    "iss",
    ISSUER
  );

  return redirectResponse(
    url.toString(),
    {
      "Set-Cookie":
        clearTransactionCookie()
    }
  );
}

function protectedResourceMetadata() {
  return {
    resource:
      MCP_RESOURCE,

    authorization_servers: [
      ISSUER
    ],

    scopes_supported: [
      SCOPE_LEAGUE_READ
    ],

    bearer_methods_supported: [
      "header"
    ],

    resource_name:
      "Inner Sanctum ChatGPT MCP"
  };
}

function authorizationServerMetadata() {
  return {
    issuer:
      ISSUER,

    authorization_endpoint:
      AUTHORIZATION_ENDPOINT,

    token_endpoint:
      TOKEN_ENDPOINT,

    registration_endpoint:
      REGISTRATION_ENDPOINT,

    response_types_supported: [
      "code"
    ],

    grant_types_supported: [
      "authorization_code",
      "refresh_token"
    ],

    token_endpoint_auth_methods_supported: [
      "none"
    ],

    code_challenge_methods_supported: [
      "S256"
    ],

    scopes_supported: [
      SCOPE_LEAGUE_READ,
      SCOPE_OFFLINE
    ],

    authorization_response_iss_parameter_supported:
      true,

    service_documentation:
      `${ISSUER}/connect-league.html`
  };
}

function renderAuthorizationPage(
  transactionId
) {
  const escapedTx =
    JSON.stringify(
      transactionId
    );

  const storageKey =
    JSON.stringify(
      "innerSanctum_chatgptLeagueLinks"
    );

  const snapshotEndpoint =
    JSON.stringify(
      "/.netlify/functions/league-snapshot"
    );

  const approveEndpoint =
    JSON.stringify(
      "/.netlify/functions/chatgpt-oauth?action=approve"
    );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Inner Sanctum</title>
<style>
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  body {
    margin: 0;
    background: #f5f6f8;
    color: #17191c;
  }

  .wrap {
    max-width: 680px;
    margin: 0 auto;
    padding: 48px 20px;
  }

  .card {
    background: white;
    border: 1px solid #e4e7eb;
    border-radius: 18px;
    padding: 28px;
    box-shadow: 0 12px 36px rgba(0,0,0,.06);
  }

  h1 {
    margin: 0 0 8px;
    font-size: 28px;
    line-height: 1.2;
  }

  p {
    line-height: 1.55;
  }

  .muted {
    color: #616871;
  }

  .league {
    width: 100%;
    text-align: left;
    border: 1px solid #d8dde3;
    background: #fff;
    border-radius: 12px;
    padding: 14px 16px;
    margin: 10px 0;
    cursor: pointer;
  }

  .league.selected {
    outline: 3px solid #222;
  }

  .league strong,
  .league span {
    display: block;
  }

  .league span {
    margin-top: 4px;
    color: #616871;
    font-size: 14px;
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 22px;
  }

  button {
    font: inherit;
    border-radius: 10px;
    padding: 12px 18px;
    cursor: pointer;
  }

  #approve {
    border: 0;
    background: #17191c;
    color: white;
    font-weight: 700;
  }

  #approve:disabled {
    opacity: .45;
    cursor: not-allowed;
  }

  #deny {
    border: 1px solid #cfd4da;
    background: white;
  }

  .error {
    color: #a32121;
    background: #fff0f0;
    padding: 12px;
    border-radius: 10px;
    margin-top: 14px;
    display: none;
  }

  .ok {
    color: #24452c;
    background: #eef8f0;
    padding: 12px;
    border-radius: 10px;
    margin-top: 14px;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Authorize Inner Sanctum</h1>

    <p class="muted">
      Choose the linked fantasy league ChatGPT may read.
      Inner Sanctum will share the sanitized league snapshot only;
      provider passwords, cookies, and provider credentials are not
      sent to ChatGPT.
    </p>

    <div id="status" class="ok">
      Checking your linked leagues…
    </div>

    <div id="leagues"></div>

    <div
      id="error"
      class="error"
    ></div>

    <div class="actions">
      <button
        id="approve"
        disabled
      >
        Authorize ChatGPT
      </button>

      <button id="deny">
        Cancel
      </button>
    </div>
  </div>
</div>

<script>
(function () {
  "use strict";

  var transactionId =
    ${escapedTx};

  var storageKey =
    ${storageKey};

  var snapshotEndpoint =
    ${snapshotEndpoint};

  var approveEndpoint =
    ${approveEndpoint};

  var selected =
    null;

  var status =
    document.getElementById(
      "status"
    );

  var leagues =
    document.getElementById(
      "leagues"
    );

  var errorBox =
    document.getElementById(
      "error"
    );

  var approveButton =
    document.getElementById(
      "approve"
    );

  var denyButton =
    document.getElementById(
      "deny"
    );

  function showError(message) {
    errorBox.textContent =
      message;

    errorBox.style.display =
      "block";
  }

  function readLinks() {
    try {
      var raw =
        localStorage.getItem(
          storageKey
        );

      var parsed =
        raw
          ? JSON.parse(raw)
          : {};

      return (
        parsed &&
        typeof parsed ===
          "object"
      )
        ? parsed
        : {};
    } catch (error) {
      return {};
    }
  }

  async function loadSummary(
    provider,
    link
  ) {
    var response =
      await fetch(
        snapshotEndpoint,
        {
          method: "GET",

          headers: {
            Accept:
              "application/json",

            Authorization:
              "Bearer " +
              link.linkToken
          },

          credentials:
            "same-origin"
        }
      );

    if (!response.ok) {
      return null;
    }

    var data =
      await response.json();

    return (
      data &&
      data.snapshot
    )
      ? data.snapshot
      : null;
  }

  function choose(
    item,
    button
  ) {
    selected =
      item;

    Array.prototype
      .forEach.call(
        document.querySelectorAll(
          ".league"
        ),
        function (node) {
          node.classList.remove(
            "selected"
          );
        }
      );

    button.classList.add(
      "selected"
    );

    approveButton.disabled =
      false;
  }

  async function render() {
    var state =
      readLinks();

    var entries =
      Object.keys(
        state
      )
        .map(
          function (provider) {
            return {
              provider:
                provider,

              link:
                state[provider]
            };
          }
        )
        .filter(
          function (item) {
            return (
              item.link &&
              item.link.linkToken
            );
          }
        );

    if (!entries.length) {
      status.textContent =
        "No ChatGPT-ready league is linked in this browser.";

      showError(
        "Return to Inner Sanctum, connect a league, and click “Use with ChatGPT” first."
      );

      return;
    }

    status.textContent =
      "Select the league ChatGPT should use.";

    for (
      var i = 0;
      i < entries.length;
      i += 1
    ) {
      var item =
        entries[i];

      var snapshot =
        null;

      try {
        snapshot =
          await loadSummary(
            item.provider,
            item.link
          );
      } catch (error) {
        snapshot =
          null;
      }

      if (!snapshot) {
        continue;
      }

      var button =
        document.createElement(
          "button"
        );

      button.type =
        "button";

      button.className =
        "league";

      var leagueName =
        snapshot.league &&
        snapshot.league.name
          ? snapshot.league.name
          : (
              item.link.leagueId ||
              "Linked league"
            );

      var teamName =
        snapshot.team &&
        snapshot.team.name
          ? snapshot.team.name
          : (
              item.link.teamId ||
              "Fantasy team"
            );

      var title =
        document.createElement(
          "strong"
        );

      title.textContent =
        leagueName;

      var detail =
        document.createElement(
          "span"
        );

      detail.textContent =
        teamName +
        " · " +
        String(
          item.provider ||
          ""
        ).toUpperCase();

      button.appendChild(
        title
      );

      button.appendChild(
        detail
      );

      (
        function (
          chosenItem,
          chosenButton
        ) {
          chosenButton
            .addEventListener(
              "click",
              function () {
                choose(
                  chosenItem,
                  chosenButton
                );
              }
            );
        }
      )(
        item,
        button
      );

      leagues.appendChild(
        button
      );

      if (!selected) {
        choose(
          item,
          button
        );
      }
    }

    if (
      !leagues.children.length
    ) {
      status.textContent =
        "Your saved ChatGPT league link is no longer valid.";

      showError(
        "Return to Inner Sanctum and create the ChatGPT link again."
      );
    }
  }

  approveButton
    .addEventListener(
      "click",
      async function () {
        if (!selected) {
          return;
        }

        approveButton.disabled =
          true;

        errorBox.style.display =
          "none";

        try {
          var response =
            await fetch(
              approveEndpoint,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                credentials:
                  "same-origin",

                body:
                  JSON.stringify({
                    transactionId:
                      transactionId,

                    linkToken:
                      selected
                        .link
                        .linkToken,

                    decision:
                      "approve"
                  })
              }
            );

          var data =
            await response.json();

          if (
            !response.ok ||
            !data.redirectTo
          ) {
            throw new Error(
              data.error_description ||
              data.error ||
              "Authorization failed."
            );
          }

          window.location.assign(
            data.redirectTo
          );
        } catch (error) {
          approveButton.disabled =
            false;

          showError(
            error &&
            error.message
              ? error.message
              : "Authorization failed."
          );
        }
      }
    );

  denyButton
    .addEventListener(
      "click",
      async function () {
        denyButton.disabled =
          true;

        try {
          var response =
            await fetch(
              approveEndpoint,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                credentials:
                  "same-origin",

                body:
                  JSON.stringify({
                    transactionId:
                      transactionId,

                    decision:
                      "deny"
                  })
              }
            );

          var data =
            await response.json();

          if (
            data.redirectTo
          ) {
            window.location.assign(
              data.redirectTo
            );
          }
        } catch (error) {
          showError(
            "Could not cancel the authorization request."
          );
        }
      }
    );

  render();
})();
</script>
</body>
</html>`;
}

async function handleRegister(
  event,
  authStore
) {
  let body;

  try {
    body =
      parseBody(
        event
      );
  } catch (error) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_client_metadata",

        error_description:
          error.message
      }
    );
  }

  const redirectUris =
    Array.isArray(
      body.redirect_uris
    )
      ? body.redirect_uris
          .map(
            safeString
          )
          .filter(
            Boolean
          )
      : [];

  if (
    !redirectUris.length ||
    !redirectUris.every(
      isAllowedRedirectUri
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_redirect_uri",

        error_description:
          "At least one valid HTTPS or localhost redirect URI is required."
      }
    );
  }

  const tokenMethod =
    safeString(
      body.token_endpoint_auth_method ||
      "none"
    );

  if (
    tokenMethod !==
    "none"
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_client_metadata",

        error_description:
          "Inner Sanctum supports public OAuth clients with token_endpoint_auth_method=none."
      }
    );
  }

  const grantTypes =
    Array.isArray(
      body.grant_types
    )
      ? body.grant_types
          .map(
            safeString
          )
      : [
          "authorization_code",
          "refresh_token"
        ];

  if (
    !grantTypes.includes(
      "authorization_code"
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_client_metadata",

        error_description:
          "authorization_code grant is required."
      }
    );
  }

  const clientId =
    `isc_${randomToken(24)}`;

  const issuedAt =
    nowSeconds();

  const client = {
    clientId,

    clientName:
      safeString(
        body.client_name
      ) ||
      "MCP Client",

    redirectUris,

    tokenEndpointAuthMethod:
      "none",

    grantTypes,

    responseTypes: [
      "code"
    ],

    applicationType:
      safeString(
        body.application_type
      ) ||
      "web",

    issuedAt,

    expiresAt:
      issuedAt +
      CLIENT_TTL_SECONDS
  };

  await saveRecord(
    authStore,
    blobKey(
      "client",
      clientId
    ),
    client
  );

  return jsonResponse(
    201,
    {
      client_id:
        clientId,

      client_id_issued_at:
        issuedAt,

      redirect_uris:
        redirectUris,

      token_endpoint_auth_method:
        "none",

      grant_types:
        grantTypes,

      response_types: [
        "code"
      ]
    }
  );
}

async function handleAuthorize(
  event,
  authStore
) {
  const query =
    getQuery(
      event
    );

  const responseType =
    safeString(
      query.response_type
    );

  const clientId =
    safeString(
      query.client_id
    );

  const redirectUri =
    safeString(
      query.redirect_uri
    );

  const state =
    safeString(
      query.state
    );

  const resource =
    safeString(
      query.resource
    );

  const scope =
    safeString(
      query.scope ||
      SCOPE_LEAGUE_READ
    );

  const codeChallenge =
    safeString(
      query.code_challenge
    );

  const codeChallengeMethod =
    safeString(
      query.code_challenge_method
    );

  if (
    responseType !==
    "code"
  ) {
    return jsonResponse(
      400,
      {
        error:
          "unsupported_response_type",

        error_description:
          "Only response_type=code is supported."
      }
    );
  }

  const clientResult =
    await validateRegisteredClient(
      authStore,
      clientId,
      redirectUri
    );

  if (
    !clientResult.ok
  ) {
    return jsonResponse(
      400,
      {
        error:
          clientResult.error,

        error_description:
          "OAuth client or redirect URI is not registered."
      }
    );
  }

  if (
    !validateResource(
      resource
    )
  ) {
    return oauthErrorRedirect(
      redirectUri,
      state,
      "invalid_target",
      "The resource parameter must identify the Inner Sanctum MCP endpoint."
    );
  }

  const scopeResult =
    validateScopes(
      scope
    );

  if (
    !scopeResult.ok
  ) {
    return oauthErrorRedirect(
      redirectUri,
      state,
      scopeResult.error,
      "Unsupported OAuth scope."
    );
  }

  if (
    codeChallengeMethod !==
      "S256" ||
    !isValidPkceChallenge(
      codeChallenge
    )
  ) {
    return oauthErrorRedirect(
      redirectUri,
      state,
      "invalid_request",
      "PKCE using code_challenge_method=S256 is required."
    );
  }

  const transactionId =
    randomToken(
      24
    );

  const createdAt =
    nowSeconds();

  const transaction = {
    clientId,
    redirectUri,
    state,
    resource,

    scopes:
      scopeResult.scopes,

    codeChallenge,

    codeChallengeMethod:
      "S256",

    createdAt,

    expiresAt:
      createdAt +
      TRANSACTION_TTL_SECONDS
  };

  await saveRecord(
    authStore,
    blobKey(
      "transaction",
      transactionId
    ),
    transaction
  );

  return htmlResponse(
    200,
    renderAuthorizationPage(
      transactionId
    ),
    {
      "Set-Cookie":
        setTransactionCookie(
          transactionId
        )
    }
  );
}

async function handleApproval(
  event,
  authStore,
  snapshotStore
) {
  let body;

  try {
    body =
      parseBody(
        event
      );
  } catch (error) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          error.message
      }
    );
  }

  const transactionId =
    safeString(
      body.transactionId
    );

  const decision =
    safeString(
      body.decision
    );

  const cookies =
    parseCookies(
      event
    );

  const cookieTransactionId =
    safeString(
      cookies[
        TRANSACTION_COOKIE
      ]
    );

  if (
    !transactionId ||
    !cookieTransactionId ||
    !timingSafeEqualText(
      transactionId,
      cookieTransactionId
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          "Authorization transaction cookie does not match."
      }
    );
  }

  const transactionKey =
    blobKey(
      "transaction",
      transactionId
    );

  const transaction =
    await getActiveRecord(
      authStore,
      transactionKey
    );

  if (!transaction) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          "Authorization request expired or was already used."
      }
    );
  }

  if (
    decision !==
    "approve"
  ) {
    await authStore
      .delete(
        transactionKey
      )
      .catch(
        () => {}
      );

    const redirect =
      new URL(
        transaction.redirectUri
      );

    redirect.searchParams.set(
      "error",
      "access_denied"
    );

    if (
      transaction.state
    ) {
      redirect.searchParams.set(
        "state",
        transaction.state
      );
    }

    redirect.searchParams.set(
      "iss",
      ISSUER
    );

    return jsonResponse(
      200,
      {
        redirectTo:
          redirect.toString()
      },
      {
        "Set-Cookie":
          clearTransactionCookie()
      }
    );
  }

  const linkToken =
    safeString(
      body.linkToken
    );

  if (
    !/^[A-Za-z0-9_-]{40,128}$/
      .test(
        linkToken
      )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          "A valid Inner Sanctum league link is required."
      }
    );
  }

  const linkedSnapshotKey =
    snapshotBlobKey(
      linkToken
    );

  const snapshot =
    await getJson(
      snapshotStore,
      linkedSnapshotKey
    );

  if (!snapshot) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          "The selected Inner Sanctum league link no longer exists."
      }
    );
  }

  const code =
    randomToken();

  const issuedAt =
    nowSeconds();

  const codeRecord = {
    clientId:
      transaction.clientId,

    redirectUri:
      transaction.redirectUri,

    resource:
      transaction.resource,

    scopes:
      transaction.scopes,

    codeChallenge:
      transaction.codeChallenge,

    codeChallengeMethod:
      transaction.codeChallengeMethod,

    snapshotKey:
      linkedSnapshotKey,

    issuedAt,

    expiresAt:
      issuedAt +
      AUTH_CODE_TTL_SECONDS
  };

  await saveRecord(
    authStore,
    blobKey(
      "code",
      code
    ),
    codeRecord
  );

  await authStore
    .delete(
      transactionKey
    )
    .catch(
      () => {}
    );

  const redirect =
    new URL(
      transaction.redirectUri
    );

  redirect.searchParams.set(
    "code",
    code
  );

  if (
    transaction.state
  ) {
    redirect.searchParams.set(
      "state",
      transaction.state
    );
  }

  redirect.searchParams.set(
    "iss",
    ISSUER
  );

  return jsonResponse(
    200,
    {
      redirectTo:
        redirect.toString()
    },
    {
      "Set-Cookie":
        clearTransactionCookie()
    }
  );
}

async function issueTokenPair(
  authStore,
  snapshotStore,
  values
) {
  const snapshot =
    await getJson(
      snapshotStore,
      values.snapshotKey
    );

  if (!snapshot) {
    return null;
  }

  const accessToken =
    randomToken();

  const refreshToken =
    randomToken();

  const issuedAt =
    nowSeconds();

  const accessRecord = {
    tokenType:
      "access",

    clientId:
      values.clientId,

    resource:
      MCP_RESOURCE,

    scopes:
      values.scopes,

    snapshotKey:
      values.snapshotKey,

    issuedAt,

    expiresAt:
      issuedAt +
      ACCESS_TOKEN_TTL_SECONDS
  };

  const refreshRecord = {
    tokenType:
      "refresh",

    clientId:
      values.clientId,

    resource:
      MCP_RESOURCE,

    scopes:
      values.scopes,

    snapshotKey:
      values.snapshotKey,

    issuedAt,

    expiresAt:
      issuedAt +
      REFRESH_TOKEN_TTL_SECONDS
  };

  await Promise.all([
    saveRecord(
      authStore,
      blobKey(
        "access",
        accessToken
      ),
      accessRecord
    ),

    saveRecord(
      authStore,
      blobKey(
        "refresh",
        refreshToken
      ),
      refreshRecord
    )
  ]);

  return {
    access_token:
      accessToken,

    token_type:
      "Bearer",

    expires_in:
      ACCESS_TOKEN_TTL_SECONDS,

    refresh_token:
      refreshToken,

    scope:
      values.scopes.join(
        " "
      )
  };
}

async function handleAuthorizationCodeGrant(
  body,
  authStore,
  snapshotStore
) {
  const code =
    safeString(
      body.code
    );

  const clientId =
    safeString(
      body.client_id
    );

  const redirectUri =
    safeString(
      body.redirect_uri
    );

  const codeVerifier =
    safeString(
      body.code_verifier
    );

  const resource =
    safeString(
      body.resource
    );

  if (
    !code ||
    !clientId ||
    !redirectUri ||
    !codeVerifier ||
    !resource
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          "code, client_id, redirect_uri, code_verifier, and resource are required."
      }
    );
  }

  if (
    !validateResource(
      resource
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_target",

        error_description:
          "Invalid MCP resource."
      }
    );
  }

  if (
    !isValidPkceVerifier(
      codeVerifier
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "Invalid PKCE code_verifier."
      }
    );
  }

  const codeKey =
    blobKey(
      "code",
      code
    );

  const record =
    await getActiveRecord(
      authStore,
      codeKey
    );

  if (!record) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "Authorization code is invalid, expired, or already used."
      }
    );
  }

  if (
    !timingSafeEqualText(
      record.clientId,
      clientId
    ) ||
    !timingSafeEqualText(
      record.redirectUri,
      redirectUri
    ) ||
    !timingSafeEqualText(
      record.resource,
      resource
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "Authorization code binding does not match."
      }
    );
  }

  const computedChallenge =
    sha256Base64Url(
      codeVerifier
    );

  if (
    !timingSafeEqualText(
      computedChallenge,
      record.codeChallenge
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "PKCE verification failed."
      }
    );
  }

  await authStore.delete(
    codeKey
  );

  const pair =
    await issueTokenPair(
      authStore,
      snapshotStore,
      record
    );

  if (!pair) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "The linked Inner Sanctum league was revoked."
      }
    );
  }

  return jsonResponse(
    200,
    pair
  );
}

async function handleRefreshGrant(
  body,
  authStore,
  snapshotStore
) {
  const refreshToken =
    safeString(
      body.refresh_token
    );

  const clientId =
    safeString(
      body.client_id
    );

  const resource =
    safeString(
      body.resource
    );

  if (
    !refreshToken ||
    !clientId ||
    !resource
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          "refresh_token, client_id, and resource are required."
      }
    );
  }

  if (
    !validateResource(
      resource
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_target",

        error_description:
          "Invalid MCP resource."
      }
    );
  }

  const refreshKey =
    blobKey(
      "refresh",
      refreshToken
    );

  const record =
    await getActiveRecord(
      authStore,
      refreshKey
    );

  if (!record) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "Refresh token is invalid or expired."
      }
    );
  }

  if (
    !timingSafeEqualText(
      record.clientId,
      clientId
    ) ||
    !timingSafeEqualText(
      record.resource,
      resource
    )
  ) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "Refresh token binding does not match."
      }
    );
  }

  await authStore.delete(
    refreshKey
  );

  const pair =
    await issueTokenPair(
      authStore,
      snapshotStore,
      record
    );

  if (!pair) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_grant",

        error_description:
          "The linked Inner Sanctum league was revoked."
      }
    );
  }

  return jsonResponse(
    200,
    pair
  );
}

async function handleToken(
  event,
  authStore,
  snapshotStore
) {
  let body;

  try {
    body =
      parseBody(
        event
      );
  } catch (error) {
    return jsonResponse(
      400,
      {
        error:
          "invalid_request",

        error_description:
          error.message
      }
    );
  }

  const grantType =
    safeString(
      body.grant_type
    );

  if (
    grantType ===
    "authorization_code"
  ) {
    return handleAuthorizationCodeGrant(
      body,
      authStore,
      snapshotStore
    );
  }

  if (
    grantType ===
    "refresh_token"
  ) {
    return handleRefreshGrant(
      body,
      authStore,
      snapshotStore
    );
  }

  return jsonResponse(
    400,
    {
      error:
        "unsupported_grant_type",

      error_description:
        "Supported grants are authorization_code and refresh_token."
    }
  );
}

exports.handler =
  async function handler(event) {
    connectLambda(
      event
    );

    const authStore =
      getStore({
        name:
          AUTH_STORE
      });

    const snapshotStore =
      getStore({
        name:
          SNAPSHOT_STORE
      });

    const queryAction =
      safeString(
        getQuery(
          event
        ).action
      );

    // Fix: falls back to detecting the standard OAuth discovery path
    // directly from the request when the ?action= query parameter did
    // not survive Netlify's .well-known rewrite. If queryAction is
    // present, it is used exactly as before -- this fallback only
    // ever applies when it is empty.
    const action =
      queryAction ||
      detectWellKnownAction(
        getRequestPath(
          event
        )
      );

    const method =
      safeString(
        event.httpMethod
      ).toUpperCase();

    try {
      if (
        method ===
          "GET" &&
        action ===
          "protected-resource"
      ) {
        return jsonResponse(
          200,
          protectedResourceMetadata()
        );
      }

      if (
        method ===
          "GET" &&
        action ===
          "authorization-server"
      ) {
        return jsonResponse(
          200,
          authorizationServerMetadata()
        );
      }

      if (
        method ===
          "POST" &&
        action ===
          "register"
      ) {
        return handleRegister(
          event,
          authStore
        );
      }

      if (
        method ===
          "GET" &&
        action ===
          "authorize"
      ) {
        return handleAuthorize(
          event,
          authStore
        );
      }

      if (
        method ===
          "POST" &&
        action ===
          "approve"
      ) {
        return handleApproval(
          event,
          authStore,
          snapshotStore
        );
      }

      if (
        method ===
          "POST" &&
        action ===
          "token"
      ) {
        return handleToken(
          event,
          authStore,
          snapshotStore
        );
      }

      return jsonResponse(
        404,
        {
          error:
            "not_found",

          error_description:
            "Unknown Inner Sanctum OAuth endpoint."
        }
      );
    } catch (error) {
      console.error(
        "Inner Sanctum ChatGPT OAuth error:",
        error
      );

      return jsonResponse(
        500,
        {
          error:
            "server_error",

          error_description:
            "Inner Sanctum authorization is temporarily unavailable."
        }
      );
    }
  };

exports.oauth = {
  ISSUER,
  MCP_RESOURCE,
  PROTECTED_RESOURCE_METADATA_ENDPOINT,
  AUTHORIZATION_SERVER_METADATA_ENDPOINT,
  SCOPE_LEAGUE_READ,
  blobKey,
  snapshotBlobKey
};
