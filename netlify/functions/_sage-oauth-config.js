"use strict";

const PRODUCTION_ORIGIN = "https://theinnersanctum.xyz";
const PRODUCTION_SITE_ID = "bbb5d8ad-ab10-4354-9fa4-211c4034c6fe";

// No request headers or Host-derived OAuth identities. Production has no override.
function oauthConfiguration(env = process.env) {
  let issuer = PRODUCTION_ORIGIN;
  if (env.SAGE_ACCEPTANCE_MODE === "isolated") {
    const siteId = env.SAGE_ACCEPTANCE_SITE_ID;
    const origin = env.SAGE_ACCEPTANCE_ORIGIN;
    if (!siteId || siteId === PRODUCTION_SITE_ID || env.SITE_ID !== siteId) {
      throw new Error("Acceptance site identity mismatch");
    }
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password ||
        !url.hostname.endsWith(".netlify.app") || url.hostname.includes("--") ||
        url.origin === PRODUCTION_ORIGIN || url.hostname === "delicate-dragon-447881.netlify.app") {
      throw new Error("Acceptance origin must be a separate stable Netlify site");
    }
    issuer = origin;
  } else if (env.SAGE_ACCEPTANCE_MODE || env.SAGE_ACCEPTANCE_ORIGIN || env.SAGE_ACCEPTANCE_SITE_ID) {
    throw new Error("Incomplete acceptance configuration");
  }
  return Object.freeze({ issuer, resource: `${issuer}/.netlify/functions/chatgpt-mcp`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource` });
}
module.exports = { oauthConfiguration, PRODUCTION_SITE_ID, PRODUCTION_ORIGIN };
