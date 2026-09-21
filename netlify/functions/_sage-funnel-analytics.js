"use strict";

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const STORE_NAME = "sage-funnel";
const ALLOWED_STAGES = new Set([
  "sage_view",
  "sage_launch",
  "oauth_opened",
  "oauth_approved",
  "token_issued",
  "first_tool_call"
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function cleanMetadata(metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const allowed = ["placement", "tool", "linkedLeague", "clientId"];
  return Object.fromEntries(
    allowed
      .filter(key => source[key] !== undefined && source[key] !== null)
      .map(key => [key, String(source[key]).slice(0, 120)])
  );
}

async function recordSageFunnelEvent({ stage, subject, metadata, onceKey }) {
  if (!ALLOWED_STAGES.has(stage)) return { recorded: false, reason: "invalid_stage" };

  const store = getStore({ name: STORE_NAME });
  const subjectHash = subject ? sha256(subject) : null;

  if (onceKey) {
    const markerKey = `once:${stage}:${sha256(onceKey)}`;
    const existing = await store.get(markerKey, { type: "json" }).catch(() => null);
    if (existing) return { recorded: false, reason: "duplicate" };
    await store.setJSON(markerKey, { stage, recordedAt: new Date().toISOString() });
  }

  const timestamp = new Date();
  const day = timestamp.toISOString().slice(0, 10);
  const key = `event:${day}:${stage}:${timestamp.getTime()}:${crypto.randomBytes(6).toString("hex")}`;
  await store.setJSON(key, {
    stage,
    occurredAt: timestamp.toISOString(),
    subjectHash,
    metadata: cleanMetadata(metadata)
  });

  return { recorded: true };
}

module.exports = {
  ALLOWED_STAGES,
  STORE_NAME,
  recordSageFunnelEvent,
  sha256
};
