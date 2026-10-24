"use strict";

// Used only by the two entry points in the isolated deployment artifact.
const { oauthConfiguration } = require("../netlify/functions/_sage-oauth-config");
const CREDENTIAL_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CONNECTION_STRING)$/i;
const PLATFORM_RUNTIME_KEYS = new Set(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]);
function assertIsolated(env, event) {
  const config = oauthConfiguration(env);
  if (env.SAGE_ACCEPTANCE_MODE !== "isolated") throw new Error("Acceptance mode required");
  const forbidden = Object.keys(env).filter(key => env[key] && CREDENTIAL_NAME.test(key) && !PLATFORM_RUNTIME_KEYS.has(key));
  // Report names only; retain the exact rejection predicate and exceptions above.
  if (forbidden.length) throw new Error(
    "Acceptance credential preflight failed (values withheld); rejected variable names: " +
    JSON.stringify(forbidden.sort())
  );
  if (event && event.headers?.["x-nf-site-id"] !== env.SAGE_ACCEPTANCE_SITE_ID) {
    throw new Error("Acceptance invocation site mismatch");
  }
  // Explicit/global Blobs credentials must never override Netlify's invocation context.
  if (env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext) {
    const encoded = globalThis.netlifyBlobsContext || env.NETLIFY_BLOBS_CONTEXT;
    let context;
    try { context = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); }
    catch { throw new Error("Invalid Blobs context"); }
    if (context.siteID !== env.SAGE_ACCEPTANCE_SITE_ID) throw new Error("Acceptance storage identity mismatch");
  }
  return config;
}
module.exports = { assertIsolated };
