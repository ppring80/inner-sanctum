"use strict";

const crypto = require("crypto");

function response(statusCode, error) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ error }, null, 2)
  };
}

function getHeader(headers, name) {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers || {}).find(
    (candidate) => String(candidate).toLowerCase() === wanted
  );
  return key ? String(headers[key] || "") : "";
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestToken(event) {
  const authorization = getHeader(event && event.headers, "authorization");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer
    ? bearer[1].trim()
    : getHeader(event && event.headers, "x-tank01-refresh-token").trim();
}

// Lambda-compatible scheduled invocations historically omitted httpMethod.
// Current Netlify cron / "Run now" invocations may instead arrive as a POST
// with the platform's documented next_run timestamp in the JSON body.
function isNetlifyScheduledInvocation(event = {}) {
  if (!event.httpMethod) return true;
  if (String(event.httpMethod).toUpperCase() !== "POST") return false;

  let body = event.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      return false;
    }
  }

  return Boolean(
    body &&
      typeof body === "object" &&
      typeof body.next_run === "string" &&
      Number.isFinite(Date.parse(body.next_run))
  );
}

// Every manual HTTP refresh requires a separate secret; the Tank01 API key is
// never accepted. Netlify scheduler invocations remain tokenless by design.
function requireTank01RefreshAuthorization(event = {}) {
  if (isNetlifyScheduledInvocation(event)) return null;

  const expected = process.env.TANK01_REFRESH_TOKEN;
  if (!expected) return response(503, "Tank01 manual refreshes are disabled.");
  if (!sameSecret(requestToken(event), expected)) {
    return response(401, "Tank01 refresh authorization required.");
  }
  return null;
}

module.exports = {
  isNetlifyScheduledInvocation,
  requireTank01RefreshAuthorization
};
