"use strict";
const { connectLambda, getStore } = require("@netlify/blobs");
const { verifyJob, executeReview } = require("./_super-sage-shadow-llm.js");
exports.handler = async event => {
  const signature = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "x-rookie-signature");
  if (process.env.SUPER_SAGE_REVIEWER_PEEPHOLE !== "true" || event.httpMethod !== "POST" || !verifyJob(event.body, signature && signature[1], process.env.ANTHROPIC_API_KEY)) return { statusCode: 401 };
  const { decisionId, ownerHash, mode } = JSON.parse(event.body);
  connectLambda(event);
  // A redelivery cannot repeat provider spend: executeReview atomically reserves
  // the decision/version and global daily budget before any provider request.
  if (mode === 'role-stream-diagnostic-post244') {
    await require('./_rookie-stream-diagnostic').executeDiagnostic({ store: getStore({ name: 'super-sage-shadow-lab' }), decisionId, ownerHash, apiKey: process.env.ANTHROPIC_API_KEY });
    return { statusCode: 200 };
  }
  if (mode != null) return { statusCode: 400 };
  await executeReview({ store: getStore({ name: "super-sage-shadow-lab" }), decisionId, ownerHash, apiKey: process.env.ANTHROPIC_API_KEY });
  return { statusCode: 200 };
};
