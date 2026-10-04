"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — DECISION SOURCES
// ═══════════════════════════════════════════════════════════════════════
//
// The ONE place every consumer (ChatGPT/MCP, website endpoint) gathers the
// evidence the shared decision authority needs, so no consumer can decide with
// less than Inner Sanctum knows. Rankings are fetched by the caller's existing
// rankings path and passed in; observed opportunity is read here.
// ═══════════════════════════════════════════════════════════════════════

const { loadObservedOpportunity, STORE_NAME } = require("./_super-sage-opportunity-evidence.js");

async function loadDecisionInputs({ season, week, rankings, opportunityStore = null, getStore = null }) {
  let store = opportunityStore;
  if (!store && typeof getStore === "function") {
    try { store = getStore({ name: STORE_NAME }); } catch (error) { store = null; }
  }
  const opportunity = await loadObservedOpportunity({ season, week, store });
  return { rankings, opportunity };
}

module.exports = { loadDecisionInputs };
