"use strict";

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const GRAPH_ORIGIN = "https://graph.instagram.com";
const RECEIPT_STORE = "instagram-publishing";
const MAX_CAPTION_LENGTH = 2200;
const MAX_IMAGES = 10;

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function response(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function configuredValue(name) {
  return String(process.env[name] || "").trim();
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function allowedMediaHosts() {
  const configured = configuredValue("INSTAGRAM_MEDIA_HOSTS");
  return new Set(
    (configured || "theinnersanctum.xyz,www.theinnersanctum.xyz")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "invalid_json_body";
  }
  if (payload.confirmPublish !== true) return "publish_confirmation_required";
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(payload.idempotencyKey || ""))) {
    return "invalid_idempotency_key";
  }
  if (typeof payload.caption !== "string" || payload.caption.length > MAX_CAPTION_LENGTH) {
    return "invalid_caption";
  }
  if (!Array.isArray(payload.imageUrls) || payload.imageUrls.length < 1 || payload.imageUrls.length > MAX_IMAGES) {
    return "invalid_image_urls";
  }

  const hosts = allowedMediaHosts();
  for (const value of payload.imageUrls) {
    try {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || !hosts.has(url.hostname.toLowerCase())) {
        return "unapproved_image_host";
      }
    } catch (_) {
      return "invalid_image_url";
    }
  }
  return null;
}

async function graphRequest(fetchImpl, path, accessToken, options = {}) {
  const method = options.method || "GET";
  const url = new URL(`${GRAPH_ORIGIN}/${path.replace(/^\//, "")}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, String(value));
    }
  }

  const request = {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  if (options.form) {
    request.headers["Content-Type"] = "application/x-www-form-urlencoded";
    request.body = new URLSearchParams(
      Object.entries(options.form).map(([key, value]) => [key, String(value)])
    ).toString();
  }

  const upstream = await fetchImpl(url.toString(), request);
  let payload = null;
  try {
    payload = await upstream.json();
  } catch (_) {
    payload = null;
  }
  if (!upstream.ok || !payload) {
    const error = new Error("Instagram publishing request failed");
    error.status = upstream.status;
    error.upstreamCode = payload && payload.error ? Number(payload.error.code) || null : null;
    throw error;
  }
  return payload;
}

async function createContainer(fetchImpl, accountId, accessToken, form) {
  const payload = await graphRequest(fetchImpl, `${encodeURIComponent(accountId)}/media`, accessToken, {
    method: "POST",
    form,
  });
  if (!payload.id) throw new Error("Instagram did not return a container id");
  return String(payload.id);
}

async function waitUntilReady(fetchImpl, containerId, accessToken, waitImpl) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const payload = await graphRequest(fetchImpl, encodeURIComponent(containerId), accessToken, {
      query: { fields: "status_code" },
    });
    if (payload.status_code === "FINISHED") return;
    if (["ERROR", "EXPIRED"].includes(payload.status_code)) {
      const error = new Error("Instagram container processing failed");
      error.status = 502;
      throw error;
    }
    await waitImpl(1000);
  }
  const error = new Error("Instagram container processing timed out");
  error.status = 504;
  throw error;
}

async function publishInstagramPost({ fetchImpl, waitImpl, accountId, accessToken, caption, imageUrls }) {
  let creationId;
  if (imageUrls.length === 1) {
    creationId = await createContainer(fetchImpl, accountId, accessToken, {
      image_url: imageUrls[0],
      caption,
    });
  } else {
    const children = [];
    for (const imageUrl of imageUrls) {
      children.push(
        await createContainer(fetchImpl, accountId, accessToken, {
          image_url: imageUrl,
          is_carousel_item: "true",
        })
      );
    }
    creationId = await createContainer(fetchImpl, accountId, accessToken, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
  }

  await waitUntilReady(fetchImpl, creationId, accessToken, waitImpl);
  const published = await graphRequest(
    fetchImpl,
    `${encodeURIComponent(accountId)}/media_publish`,
    accessToken,
    { method: "POST", form: { creation_id: creationId } }
  );
  if (!published.id) throw new Error("Instagram did not return a published media id");
  return { creationId, mediaId: String(published.id) };
}

async function handler(event = {}, dependencies = {}) {
  if (String(event.httpMethod || "").toUpperCase() !== "POST") {
    return response(405, { ok: false, error: "method_not_allowed" });
  }

  const expectedKey = configuredValue("INSTAGRAM_PUBLISH_KEY");
  const suppliedKey = event.headers && (event.headers["x-instagram-publish-key"] || event.headers["X-Instagram-Publish-Key"]);
  if (!expectedKey || !secureEqual(suppliedKey, expectedKey)) {
    return response(401, { ok: false, error: "unauthorized" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "");
  } catch (_) {
    return response(400, { ok: false, error: "invalid_json_body" });
  }
  const validationError = validatePayload(payload);
  if (validationError) return response(400, { ok: false, error: validationError });

  const accountId = configuredValue("INSTAGRAM_ACCOUNT_ID");
  const accessToken = configuredValue("INSTAGRAM_ACCESS_TOKEN");
  if (!accountId || !accessToken) {
    return response(503, { ok: false, error: "instagram_connection_not_configured" });
  }

  const fetchImpl = dependencies.fetch || fetch;
  const waitImpl = dependencies.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let store = dependencies.store;
  if (!store) {
    connectLambda(event);
    store = getStore({ name: RECEIPT_STORE });
  }
  const receiptKey = `receipt-${payload.idempotencyKey}.json`;
  const existing = await store.get(receiptKey, { type: "json" });
  if (existing && existing.mediaId) {
    return response(200, { ok: true, duplicate: true, mediaId: existing.mediaId });
  }

  try {
    const published = await publishInstagramPost({
      fetchImpl,
      waitImpl,
      accountId,
      accessToken,
      caption: payload.caption,
      imageUrls: payload.imageUrls,
    });
    await store.setJSON(receiptKey, {
      mediaId: published.mediaId,
      creationId: published.creationId,
      publishedAt: new Date().toISOString(),
    });
    return response(200, { ok: true, duplicate: false, mediaId: published.mediaId });
  } catch (error) {
    return response(502, {
      ok: false,
      error: "instagram_publish_failed",
      upstreamStatus: Number.isFinite(Number(error && error.status)) ? Number(error.status) : null,
      upstreamCode: Number.isFinite(Number(error && error.upstreamCode)) ? Number(error.upstreamCode) : null,
    });
  }
}

exports.handler = handler;
exports.validatePayload = validatePayload;
exports.publishInstagramPost = publishInstagramPost;
