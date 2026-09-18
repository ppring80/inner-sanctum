"use strict";

const assert = require("assert");
const {
  requireTank01RefreshAuthorization
} = require("../netlify/functions/_tank01-refresh-guard.js");

const previous = process.env.TANK01_REFRESH_TOKEN;

try {
  delete process.env.TANK01_REFRESH_TOKEN;
  assert.strictEqual(requireTank01RefreshAuthorization({}), null);

  let result = requireTank01RefreshAuthorization({ httpMethod: "GET", headers: {} });
  assert.strictEqual(result.statusCode, 503);

  process.env.TANK01_REFRESH_TOKEN = "separate-refresh-secret";
  result = requireTank01RefreshAuthorization({ httpMethod: "GET", headers: {} });
  assert.strictEqual(result.statusCode, 401);

  result = requireTank01RefreshAuthorization({
    httpMethod: "GET",
    headers: { Authorization: "Bearer separate-refresh-secret" }
  });
  assert.strictEqual(result, null);

  result = requireTank01RefreshAuthorization({
    httpMethod: "GET",
    headers: { "X-Tank01-Refresh-Token": "separate-refresh-secret" }
  });
  assert.strictEqual(result, null);

  console.log("5 Tank01 refresh guard tests passed, 0 failed.");
} finally {
  if (previous === undefined) delete process.env.TANK01_REFRESH_TOKEN;
  else process.env.TANK01_REFRESH_TOKEN = previous;
}
