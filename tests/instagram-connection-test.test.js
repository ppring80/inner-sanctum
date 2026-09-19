"use strict";

const assert = require("assert");
const {
  handler,
  lookupInstagramAccount,
} = require("../netlify/functions/instagram-connection-test.js");

const originalToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const originalAccountId = process.env.INSTAGRAM_ACCOUNT_ID;

function jsonResponse(ok, status, payload) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

(async () => {
  const secret = "private-instagram-token-never-return-this";
  const accountId = "17841416302710910";

  try {
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_ACCOUNT_ID;

    let result = await handler({ httpMethod: "GET" });
    assert.strictEqual(result.statusCode, 503);
    assert.strictEqual(
      JSON.parse(result.body).error,
      "instagram_connection_not_configured"
    );

    result = await handler({ httpMethod: "POST" });
    assert.strictEqual(result.statusCode, 405);

    process.env.INSTAGRAM_ACCESS_TOKEN = secret;
    process.env.INSTAGRAM_ACCOUNT_ID = accountId;

    let capturedUrl = "";
    let capturedOptions = null;
    const successfulFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return jsonResponse(true, 200, {
        id: accountId,
        username: "theinnersanctum.ff",
      });
    };

    result = await handler(
      { httpMethod: "GET" },
      { fetch: successfulFetch }
    );

    assert.strictEqual(result.statusCode, 200);
    const successBody = JSON.parse(result.body);
    assert.strictEqual(successBody.ok, true);
    assert.strictEqual(successBody.connection, "verified");
    assert.strictEqual(successBody.account.id, accountId);
    assert.strictEqual(successBody.account.username, "theinnersanctum.ff");
    assert.strictEqual(successBody.configuredAccountIdMatches, true);
    assert.strictEqual(successBody.publishingAttempted, false);
    assert.deepStrictEqual(successBody.capabilitiesTested, ["profile_read"]);
    assert.strictEqual(result.body.includes(secret), false);
    assert.strictEqual(capturedUrl.includes(secret), false);
    assert.strictEqual(capturedUrl.includes("fields=id%2Cusername"), true);
    assert.strictEqual(
      capturedOptions.headers.Authorization,
      `Bearer ${secret}`
    );

    const failedFetch = async () =>
      jsonResponse(false, 400, {
        error: {
          message: `Sensitive upstream detail ${secret}`,
          type: "OAuthException",
          code: 190,
        },
      });

    result = await handler(
      { httpMethod: "GET" },
      { fetch: failedFetch }
    );
    assert.strictEqual(result.statusCode, 502);
    const failureBody = JSON.parse(result.body);
    assert.strictEqual(failureBody.upstreamStatus, 400);
    assert.strictEqual(failureBody.upstreamCode, 190);
    assert.strictEqual(result.body.includes(secret), false);
    assert.strictEqual(result.body.includes("Sensitive upstream detail"), false);

    const mismatchFetch = async () =>
      jsonResponse(true, 200, {
        id: "different-account-id",
        username: "theinnersanctum.ff",
      });

    result = await handler(
      { httpMethod: "GET" },
      { fetch: mismatchFetch }
    );
    assert.strictEqual(result.statusCode, 200);
    const mismatchBody = JSON.parse(result.body);
    assert.strictEqual(mismatchBody.ok, true);
    assert.strictEqual(mismatchBody.connection, "verified");
    assert.strictEqual(mismatchBody.configuredAccountIdMatches, false);
    assert.strictEqual(mismatchBody.account.id, "different-account-id");
    assert.strictEqual(mismatchBody.account.username, "theinnersanctum.ff");

    const direct = await lookupInstagramAccount(
      successfulFetch,
      accountId,
      secret
    );
    assert.deepStrictEqual(direct, {
      id: accountId,
      username: "theinnersanctum.ff",
    });

    console.log("18 Instagram connection tests passed, 0 failed.");
  } finally {
    if (originalToken === undefined) delete process.env.INSTAGRAM_ACCESS_TOKEN;
    else process.env.INSTAGRAM_ACCESS_TOKEN = originalToken;

    if (originalAccountId === undefined) delete process.env.INSTAGRAM_ACCOUNT_ID;
    else process.env.INSTAGRAM_ACCOUNT_ID = originalAccountId;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
