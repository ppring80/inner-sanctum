"use strict";

// netlify/functions/super-sage-lineup.js
//
// Website Start/Sit (connected league and manual roster on weekly.html).
// Returns the SAME Super SAGE decision record ChatGPT MCP receives: identical
// Weekly SAGE request parameters, identical shared service, identical
// identity matcher. The page only presents the record.
//
// POST { season, week, scoring, teams, provider, roster: [{ name, position |
//        eligiblePositions[], team?, rosterStatus? }], slots: [{ slotLabel,
//        eligiblePositions[], count }] }
// -> 200 { status: "DECIDED", decisionId, record, evidenceStatus, customerAnswer, website }
// -> 200 { status: "UNAVAILABLE", reason, evidenceStatus }  (never a local fallback)
//
// Cache-only: Weekly SAGE rankings (customer path), the cached schedule and
// the opportunity cache. ZERO provider calls. No ledger writes.

const { connectLambda, getStore } = require("@netlify/blobs");
const { decideSharedLineup } = require("./_super-sage-lineup-service.js");
const { toWebsiteLineup, toCustomerAnswer } = require("./_super-sage-lineup-presenters.js");
const { readCachedWeeklySchedule } = require("./_weekly-sage-schedule-cache.js");

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const SCORINGS = new Set(["ppr", "half", "standard"]);
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const DEFAULT_TEAMS = 12;

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

// Identical to chatgpt-mcp.js buildWeeklyRankingsUrl (parity is tested).
function buildWeeklyRankingsUrl({ baseUrl, season, week, scoring, teams = DEFAULT_TEAMS }) {
  const params = new URLSearchParams({ season: String(season), week: String(week), seasonType: "reg", scoring, teams: String(teams) });
  return `${baseUrl}/.netlify/functions/weekly-sage-rankings?${params.toString()}`;
}

function baseUrlFor(event) {
  const headers = (event && event.headers) || {};
  const host = headers["x-forwarded-host"] || headers.host;
  if (host) return `${headers["x-forwarded-proto"] || "https"}://${host}`;
  return process.env.URL || "https://theinnersanctum.xyz";
}

function validate(body) {
  const season = Number(body.season), week = Number(body.week);
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 22) return "season and week are required.";
  if (!SCORINGS.has(String(body.scoring || "").toLowerCase())) return "scoring must be ppr, half or standard.";
  if (!Array.isArray(body.roster) || !body.roster.length || body.roster.length > 60) return "roster must list 1-60 players.";
  if (!Array.isArray(body.slots) || !body.slots.length || body.slots.length > 20) return "slots are required.";
  for (const s of body.slots) {
    const eligible = Array.isArray(s.eligiblePositions) ? s.eligiblePositions.map((p) => String(p).toUpperCase()) : [];
    if (!s.slotLabel || !eligible.length || !eligible.every((p) => POSITIONS.has(p)) || !(Number(s.count) >= 1 && Number(s.count) <= 10)) return "invalid slot definition.";
  }
  return null;
}

async function handler(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (error) { return reply(400, { error: "Invalid JSON." }); }
  const invalid = validate(body);
  if (invalid) return reply(400, { error: invalid });

  try { (deps.connectLambda || connectLambda)(event); } catch (error) { /* Blobs context unavailable: readers below degrade explicitly. */ }
  const season = Number(body.season), week = Number(body.week), scoring = String(body.scoring).toLowerCase();
  const teams = Number(body.teams) >= 4 && Number(body.teams) <= 32 ? Number(body.teams) : DEFAULT_TEAMS;

  let rankings = null, rankingsError = null;
  try {
    const response = await (deps.fetch || fetch)(buildWeeklyRankingsUrl({ baseUrl: baseUrlFor(event), season, week, scoring, teams }), { headers: { Accept: "application/json" } });
    if (!response.ok) rankingsError = `Weekly SAGE responded ${response.status}.`;
    else rankings = await response.json();
  } catch (error) { rankingsError = `Weekly SAGE request failed: ${error.message}`; }

  let schedule = null, scheduleError = null;
  try { schedule = await (deps.readSchedule || readCachedWeeklySchedule)({ season, week, seasonType: "reg" }); } catch (error) { scheduleError = error.message; }
  let opportunityStore = null;
  try { opportunityStore = (deps.getStore || getStore)({ name: "opportunity-intel" }); } catch (error) { opportunityStore = null; }

  const roster = body.roster.map((p) => ({
    name: String(p.name || "").slice(0, 80),
    eligiblePositions: (Array.isArray(p.eligiblePositions) && p.eligiblePositions.length ? p.eligiblePositions : [p.position]).map((x) => String(x || "").toUpperCase()).filter((x) => POSITIONS.has(x)),
    team: p.team ? String(p.team).toUpperCase().slice(0, 4) : null,
    rosterStatus: p.rosterStatus ? String(p.rosterStatus).slice(0, 24) : null
  })).filter((p) => p.name && p.eligiblePositions.length);
  const slots = body.slots.map((s) => ({ slotLabel: String(s.slotLabel).slice(0, 16), eligiblePositions: s.eligiblePositions.map((p) => String(p).toUpperCase()), count: Number(s.count) }));

  const result = await decideSharedLineup({ rankings, rankingsError, roster, provider: body.provider || null, slots, season, week, scoring, schedule, scheduleError, opportunityStore, now: deps.now ? deps.now() : new Date() });
  if (result.status !== "DECIDED") return reply(200, { status: result.status, reason: result.reason, evidenceStatus: result.evidenceStatus });
  return reply(200, {
    status: "DECIDED",
    decisionId: result.record.decisionId,
    record: result.record,
    evidenceStatus: result.evidenceStatus,
    kickoff: result.kickoff,
    customerAnswer: toCustomerAnswer(result.record, result.evidenceStatus),
    website: toWebsiteLineup(result.record)
  });
}

exports.handler = (event) => handler(event);
exports._test = { handler, buildWeeklyRankingsUrl, validate };
