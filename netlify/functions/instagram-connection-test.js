"use strict";

// Read-only Instagram connection check.
//
// This function intentionally supports only a profile lookup. It cannot create
// media containers, publish content, modify the account, or expose credentials.

const GRAPH_ORIGIN = "https://graph.instagram.com";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function configuredValue(name) {
  return String(process.env[name] || "").trim();
}

async function lookupInstagramAccount(fetchImpl, accountId, accessToken) {
  const url = new URL(`${GRAPH_ORIGIN}/${encodeURIComponent(accountId)}`);
  url.searchParams.set("fields", "id,username");

  const upstream = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  let payload = null;
  try {
    payload = await upstream.json();
  } catch (_) {
    payload = null;
  }

  if (!upstream.ok) {
    const upstreamCode =
      payload && payload.error && Number.isFinite(Number(payload.error.code))
        ? Number(payload.error.code)
        : null;

    const error = new Error("Instagram rejected the read-only account lookup");
    error.status = upstream.status;
    error.upstreamCode = upstreamCode;
    throw error;
  }

  if (!payload || !payload.id || !payload.username) {
    const error = new Error("Instagram returned an incomplete account profile");
    error.status = 502;
    error.upstreamCode = null;
    throw error;
  }

  return {
    id: String(payload.id),
    username: String(payload.username),
  };
}

async function handler(event = {}, dependencies = {}) {
  const method = String(event.httpMethod || "GET").toUpperCase();
  if (method !== "GET") {
    return response(405, {
      ok: false,
      error: "method_not_allowed",
    });
  }

  const accessToken = configuredValue("INSTAGRAM_ACCESS_TOKEN");
  const accountId = configuredValue("INSTAGRAM_ACCOUNT_ID");

  if (!accessToken || !accountId) {
    return response(503, {
      ok: false,
      error: "instagram_connection_not_configured",
    });
  }

  const fetchImpl = dependencies.fetch || fetch;

  try {
    const account = await lookupInstagramAccount(
      fetchImpl,
      accountId,
      accessToken
    );

    if (account.id !== accountId) {
      return response(502, {
        ok: false,
        error: "instagram_account_id_mismatch",
      });
    }

    return response(200, {
      ok: true,
      connection: "verified",
      account,
      capabilitiesTested: ["profile_read"],
      publishingAttempted: false,
    });
  } catch (error) {
    return response(502, {
      ok: false,
      error: "instagram_connection_check_failed",
      upstreamStatus: Number.isFinite(Number(error && error.status))
        ? Number(error.status)
        : null,
      upstreamCode: Number.isFinite(Number(error && error.upstreamCode))
        ? Number(error.upstreamCode)
        : null,
    });
  }
}

exports.handler = handler;
exports.lookupInstagramAccount = lookupInstagramAccount;
