"use strict";

const { connectLambda, getStore } = require("@netlify/blobs");
const { resolveCurrentNFLWeek } = require("./_current-nfl-week.js");
const { buildCurrentEvidencePacket } = require("./_sage-current-evidence.js");
const { collectSources } = require("./_newswire-sources.js");

const STORE_NAME = "sage-current-evidence";
const NFL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WSH"];
const TRUSTED_HOSTS = new Set(["www.nfl.com","nfl.com","www.espn.com","espn.com","www.cbssports.com","cbssports.com"]);
const INJURY_RE = /injur|ruled out|questionable|doubtful|practice|concussion|hamstring|ankle|knee|shoulder|reserve|\bIR\b/i;
const ROLE_RE = /workload|starter|starting|snap|target|carry|carries|route|role|depth chart|committee/i;

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function teamFromStory(item) {
  const haystack = (text(item.title) + " " + text(item.description)).toUpperCase();
  return NFL_TEAMS.find((team) => new RegExp("\\b" + team + "\\b").test(haystack)) || null;
}

function normalizeCandidateStories(items, now = Date.now()) {
  const evidence = [];
  for (const item of items || []) {
    let url;
    try { url = new URL(item.link); } catch (_) { continue; }
    if (url.protocol !== "https:" || !TRUSTED_HOSTS.has(url.hostname)) continue;

    const publishedMs = Date.parse(item.publishedAt || item.pubDate || "");
    if (!Number.isFinite(publishedMs) || publishedMs > now + 300000 || now - publishedMs > 3 * 86400000) continue;

    const title = text(item.title);
    const description = text(item.description);
    const combined = title + " " + description;
    const type = INJURY_RE.test(combined)
      ? "INJURY_STATUS"
      : ROLE_RE.test(combined)
        ? "PLAYER_ROLE"
        : null;
    if (!type) continue;

    evidence.push({
      type,
      sourceTier: url.hostname.includes("nfl.com") ? "primary" : "trusted-reporting",
      source: item.sourceLabel || url.hostname,
      sourceUrl: url.href,
      claim: title,
      observedAt: new Date(publishedMs).toISOString(),
      season: 2026,
      week: resolveCurrentNFLWeek(new Date(now)),
      team: teamFromStory(item),
      player: null,
      metric: type === "INJURY_STATUS" ? "reported_status" : "reported_role",
      value: null,
      unit: null,
      sample: null,
      contradicts: false,
      note: description ? description.slice(0, 500) : null
    });
  }
  return evidence;
}

function validateCoverageSeed(seed) {
  if (!seed || typeof seed !== "object" || !Array.isArray(seed.evidence)) {
    return { accepted: [], rejected: [{ reason: "coverage seed missing/invalid" }] };
  }
  const accepted = [];
  const rejected = [];
  for (const item of seed.evidence) {
    try {
      const packet = buildCurrentEvidencePacket([item], { now: seed.generatedAt || new Date().toISOString() });
      if (packet.readyForReasoning) accepted.push(packet.evidence[0]);
      else rejected.push({ item, reason: packet.stale.length ? "stale" : "contradictory" });
    } catch (error) {
      rejected.push({ item, reason: error.message });
    }
  }
  return { accepted, rejected };
}

exports.handler = async function(event) {
  connectLambda(event);
  const now = new Date();
  const week = resolveCurrentNFLWeek(now);
  const season = now.getFullYear();

  try {
    // Reuse the existing, bounded SAGE Newswire source collector for fast-moving
    // injury/role evidence. It already limits sources and avoids arbitrary crawling.
    const collected = await collectSources();
    const fastMoving = normalizeCandidateStories(collected.items, now.getTime());

    // Structural scheme/personnel evidence is not guessed here. It is supplied by
    // a separately curated seed/import until a licensed/stable machine-readable
    // source is wired. This prevents scraping HTML tables into silent "facts".
    const store = getStore({ name: STORE_NAME });
    const importSeed = await store.get("structural-import", { type: "json" });
    const structural = validateCoverageSeed(importSeed);

    const allCandidates = [...structural.accepted, ...fastMoving];
    const accepted = [];
    const rejected = [...structural.rejected];

    for (const item of allCandidates) {
      try {
        const packet = buildCurrentEvidencePacket([item], { now: now.toISOString() });
        if (packet.readyForReasoning) accepted.push(packet.evidence[0]);
        else rejected.push({ item, reason: packet.stale.length ? "stale" : "contradictory" });
      } catch (error) {
        rejected.push({ item, reason: error.message });
      }
    }

    const key = `week:${season}:${week}`;
    const payload = {
      version: 1,
      evidenceType: "super-sage-current-evidence",
      season,
      week,
      generatedAt: now.toISOString(),
      teamsExpected: 32,
      teamsRepresented: [...new Set(accepted.map((x) => x.team).filter(Boolean))].sort(),
      accepted,
      rejected,
      collectionErrors: collected.errors || [],
      structuralImportPresent: Boolean(importSeed),
      note: "Evidence cache only. No Weekly SAGE rank/score mutation."
    };

    // Fail closed: never overwrite a known-good cache with an empty harvest.
    if (!accepted.length) {
      return { statusCode: 422, body: JSON.stringify({ cached: false, key, reason: "No evidence passed validation." }) };
    }

    await store.setJSON(key, payload);
    return { statusCode: 200, body: JSON.stringify({ cached: true, key, accepted: accepted.length, rejected: rejected.length, teamsRepresented: payload.teamsRepresented.length }) };
  } catch (error) {
    console.error("SUPER_SAGE_EVIDENCE_REFRESH_FAILED", error);
    return { statusCode: 502, body: JSON.stringify({ cached: false, error: error.message }) };
  }
};

exports.normalizeCandidateStories = normalizeCandidateStories;
exports.validateCoverageSeed = validateCoverageSeed;
