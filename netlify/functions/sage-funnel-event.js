"use strict";

const { connectLambda } = require("@netlify/blobs");
const { recordSageFunnelEvent } = require("./_sage-funnel-analytics.js");

const CLIENT_STAGES = new Set(["sage_view", "sage_launch"]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "https://theinnersanctum.xyz",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return response(204, {});
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed." });

  connectLambda(event);

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return response(400, { error: "Invalid JSON." });
  }

  const stage = String(body.stage || "");
  if (!CLIENT_STAGES.has(stage)) return response(40, { error: "Invalid client stage." });

  const visitorId = String(body.visitorId || "").slice(0, 100);
  const eventId = String(body.eventId || "").slice(0, 100);
  if (!visitorId || !eventId) return response(400, { error: "visitorId and eventId are required." });

  try {
    const result = await recordSageFunnelEvent({
      stage,
      subject: visitorId,
      onceKey: `${visitorId}:${eventId}`,
      metadata: { placement: body.placement || "sage" }
    });
    return response(202, { accepted: true, recorded: result.recorded });
  } catch (error) {
    console.error("SAGE funnel client event failed:", error);
    return response(202, { accepted: true, recorded: false });
  }
};
