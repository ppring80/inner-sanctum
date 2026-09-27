"use strict";

// ═══════════════════════════════════════════════════════════════════════
// THE INNER SANCTUM — CONNECTION HANDOFF (Phase 1, mobile league-connect)
// ═══════════════════════════════════════════════════════════════════════
//
// PURPOSE
// -------
// Lets a customer who connected a league on one device (typically a computer
// with the Connect extension) bring the FINISHED, sanitized LeagueConnection
// record to another device (Android phone, iPhone, iPad) without any provider
// credentials. Provider-neutral: CBS and ESPN use exactly the same transport,
// and a future provider (for example Yahoo) only needs to be added to
// HANDOFF_PROVIDERS.
//
// OPERATIONS (POST only, JSON body)
// ---------------------------------
//   { action: "create", record }  -> { success, code, expiresAt }
//   { action: "claim",  code }    -> { success, record }
//
// SECURITY MODEL
// --------------
// - `code` is a 256-bit random secret (base64url, 43 chars). It is the only
//   bearer credential. It is never stored: the Blob key is SHA-256(code).
// - One-time claim: the stored entry is atomically replaced with a tombstone
//   using the entry's ETag (onlyIfMatch), so two concurrent claims cannot both
//   succeed; the entry is then deleted. The tombstone holds no league data.
// - Expiry: HANDOFF_TTL_MS (10 minutes). Expired entries are deleted on read.
// - Unknown, expired and already-used codes all return the same 410 response,
//   so the endpoint is not an oracle.
// - Malformed codes are rejected before any storage access.
// - Guessing is bounded twice: by the 2^256 code space, and by a per-client
//   failed-claim limit (FAILED_CLAIM_LIMIT per RATE_WINDOW_MS, keyed by a hash
//   of the client IP; raw IPs are never stored). Creates are rate-limited too.
// - Records are validated (supported provider, leagueId, teamId, roster array)
//   and credential-like keys are stripped recursively BEFORE storage. The
//   blocked set is the union of league-connection.js and league-snapshot.js
//   plus handoff-specific keys (ChatGPT linkToken and variants). Matching is
//   case-insensitive and ignores "_" / "-" so "Link_Token" is also stripped.
// - The ChatGPT linkToken is never part of a LeagueConnection record (it is
//   kept in separate browser storage) and is stripped here regardless.
// - No provider password, cookie, SWID, espn_s2 or session value is accepted,
//   stored or returned.
// - Request body is capped at MAX_BODY_BYTES; nesting depth is capped.
// ═══════════════════════════════════════════════════════════════════════

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "connection-handoffs";
const LIMIT_STORE_NAME = "connection-handoff-limits";

const HANDOFF_PROVIDERS = new Set(["cbs", "espn"]);
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const CODE_BYTES = 32;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_BYTES = 750000;
const MAX_DEPTH = 64;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const FAILED_CLAIM_LIMIT = 20;
const CREATE_LIMIT = 30;

const EXPIRED_OR_USED_MESSAGE =
  "This link has expired or was already used. On your computer, choose Send to my phone to get a new one.";

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["https://theinnersanctum.xyz", "https://www.theinnersanctum.xyz"];

// Union of league-connection.js BLOCKED_KEYS and league-snapshot.js
// BLOCKED_KEYS (neither file is modified), plus handoff-specific keys.
// tests/connection-handoff.test.js asserts every key from both source lists
// is covered, so the lists cannot silently drift apart.
const BLOCKED_KEY_NAMES = [
  // league-connection.js
  "password", "pass", "passwd", "cookie", "cookies", "token",
  "accessToken", "access_token", "refreshToken", "refresh_token",
  "authorization", "Authorization", "espn_s2", "espnS2", "SWID",
  "swid", "session", "sessionId", "session_id", "cbsToken", "cbsSession",
  // league-snapshot.js additions
  "oauthToken", "oauth_token", "clientSecret", "client_secret", "apiKey", "api_key",
  // handoff-specific
  "linkToken", "link_token", "chatgptLinkToken", "chatgptLink", "syncToken",
  "writeToken", "readToken", "handoffCode", "code", "secret", "credentials",
  "credential", "bearer", "idToken", "id_token", "setCookie", "set-cookie"
];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_-]/g, "");
}

const BLOCKED_KEYS = new Set(BLOCKED_KEY_NAMES.map(normalizeKey));

function isBlockedKey(key) {
  return BLOCKED_KEYS.has(normalizeKey(key));
}

function sanitizeRecord(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw Object.assign(new Error("League data is nested too deeply."), { statusCode: 400 });
  }
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeRecord(item, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  Object.keys(value).forEach((key) => {
    if (isBlockedKey(key)) return;
    out[key] = sanitizeRecord(value[key], depth + 1);
  });
  return out;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "A league connection record is required.";
  }
  if (!HANDOFF_PROVIDERS.has(record.provider)) {
    return "This league provider cannot be sent to another device yet.";
  }
  if (!hasValue(record.leagueId)) return "The league connection is missing its league.";
  if (!hasValue(record.teamId)) return "The league connection is missing its team.";
  if (!Array.isArray(record.roster)) return "The league connection is missing its roster.";
  return null;
}

function newCode() {
  return crypto.randomBytes(CODE_BYTES).toString("base64url");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    },
    body: JSON.stringify(body)
  };
}

function headerValue(event, name) {
  const headers = event.headers || {};
  const lower = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return key ? String(headers[key]) : "";
}

function clientKey(event) {
  const ip =
    headerValue(event, "x-nf-client-connection-ip") ||
    headerValue(event, "x-forwarded-for").split(",")[0].trim() ||
    "unknown";
  return crypto.createHash("sha256").update("handoff-rate:" + ip, "utf8").digest("hex");
}

function windowKey(kind, event, now) {
  const windowStart = Math.floor(now / RATE_WINDOW_MS);
  return kind + ":" + windowStart + ":" + clientKey(event);
}

async function readCount(store, key) {
  const entry = await store.get(key, { type: "json" });
  return entry && Number.isFinite(entry.count) ? entry.count : 0;
}

async function increment(store, key) {
  const count = await readCount(store, key);
  await store.setJSON(key, { count: count + 1 });
  return count + 1;
}

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : String(event.body || "");
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw Object.assign(new Error("That league is too large to send."), { statusCode: 413 });
  }
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (err) {
    throw Object.assign(new Error("The request could not be read."), { statusCode: 400 });
  }
}

async function handleCreate(payload, event, store, limits, now) {
  const createKey = windowKey("create", event, now);
  if ((await readCount(limits, createKey)) >= CREATE_LIMIT) {
    return jsonResponse(429, { success: false, error: "Too many links were created. Please wait a few minutes and try again." });
  }

  const record = sanitizeRecord(payload.record);
  const problem = validateRecord(record);
  if (problem) return jsonResponse(400, { success: false, error: problem });

  const code = newCode();
  const expiresAt = new Date(now + HANDOFF_TTL_MS).toISOString();
  await store.setJSON(hashCode(code), {
    version: 1,
    provider: record.provider,
    record,
    createdAt: new Date(now).toISOString(),
    expiresAt
  }, { onlyIfNew: true });
  await increment(limits, createKey);

  return jsonResponse(200, { success: true, code, expiresAt });
}

async function handleClaim(payload, event, store, limits, now) {
  const failKey = windowKey("claim-fail", event, now);
  if ((await readCount(limits, failKey)) >= FAILED_CLAIM_LIMIT) {
    return jsonResponse(429, { success: false, error: "Too many attempts. Please wait a few minutes and try again." });
  }

  const code = typeof payload.code === "string" ? payload.code : "";
  if (!CODE_PATTERN.test(code)) {
    await increment(limits, failKey);
    return jsonResponse(400, { success: false, error: "This link is not valid. On your computer, choose Send to my phone to get a new one." });
  }

  const key = hashCode(code);
  const found = await store.getWithMetadata(key, { type: "json" });
  const entry = found && found.data;

  if (!entry || !entry.record || entry.claimedAt) {
    await increment(limits, failKey);
    return jsonResponse(410, { success: false, error: EXPIRED_OR_USED_MESSAGE });
  }

  if (Date.parse(entry.expiresAt) <= now) {
    await store.delete(key);
    await increment(limits, failKey);
    return jsonResponse(410, { success: false, error: EXPIRED_OR_USED_MESSAGE });
  }

  // One-time claim: replace the entry with a data-free tombstone only if it is
  // still exactly the entry we read. A concurrent claim loses the race.
  if (found.etag) {
    const result = await store.setJSON(key, { claimedAt: new Date(now).toISOString() }, { onlyIfMatch: found.etag });
    if (!result || result.modified !== true) {
      return jsonResponse(410, { success: false, error: EXPIRED_OR_USED_MESSAGE });
    }
  }
  await store.delete(key);

  // Re-sanitize on the way out as defense in depth.
  const record = sanitizeRecord(entry.record);
  const problem = validateRecord(record);
  if (problem) return jsonResponse(410, { success: false, error: EXPIRED_OR_USED_MESSAGE });

  return jsonResponse(200, { success: true, record });
}

exports.handler = async function (event) {
  connectLambda(event);

  const origin = headerValue(event, "origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return jsonResponse(403, { success: false, error: "Origin not allowed." });
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { success: false, error: "Method not allowed." });
  }

  const now = Date.now();
  try {
    const payload = parseBody(event);
    const store = getStore({ name: STORE_NAME });
    const limits = getStore({ name: LIMIT_STORE_NAME });

    if (payload.action === "create") return await handleCreate(payload, event, store, limits, now);
    if (payload.action === "claim") return await handleClaim(payload, event, store, limits, now);
    return jsonResponse(400, { success: false, error: "Unknown action." });
  } catch (err) {
    if (err && err.statusCode) {
      return jsonResponse(err.statusCode, { success: false, error: err.message });
    }
    return jsonResponse(500, { success: false, error: "Something went wrong. Please try again." });
  }
};

// Exposed for tests only.
exports._internals = {
  BLOCKED_KEY_NAMES,
  HANDOFF_PROVIDERS,
  HANDOFF_TTL_MS,
  MAX_BODY_BYTES,
  FAILED_CLAIM_LIMIT,
  CREATE_LIMIT,
  CODE_PATTERN,
  hashCode,
  isBlockedKey,
  sanitizeRecord,
  validateRecord
};
