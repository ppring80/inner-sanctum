// netlify/functions/refresh-weekly-sage-defense.js
//
// WEEKLY SAGE — SHARED WEEKLY DEFENSE CACHE WRITER
//
// Scheduled/manual cache writer for one completed week's defensive
// evidence. The provider build now runs IN PROCESS through the internal
// buildWeeklyDefense() export; it no longer self-fetches a public HTTP
// endpoint that can trigger the multi-call Tank01 build.
//
// Provider cost per build remains exactly bounded:
//   1 x getNFLGamesForWeek
//   + 1 x getNFLBoxScore per completed game
//
// Only complete evidence is written to Netlify Blobs. A failed or
// incomplete build leaves any known-good existing cache untouched.

const { connectLambda, getStore } = require("@netlify/blobs");
const {
  buildWeeklyDefense
} = require("./weekly-sage-defense-week.js");

const DEFAULT_SEASON_TYPE = "reg";
const STORE_NAME = "weekly-sage-defense";

/*
  Tuesday production boundary.

  The first Tuesday pipeline after 2026 Week 1 is September 15, 2026.
  UPDATE firstWeek2PipelineTuesday for future NFL seasons.
*/
function getCurrentNFLWeek() {
  const firstWeek2PipelineTuesday =
    new Date("2026-09-15T00:00:00Z");
  const now = new Date();

  if (now < firstWeek2PipelineTuesday) {
    return 1;
  }

  const diffDays = Math.floor(
    (now - firstWeek2PipelineTuesday) /
      (1000 * 60 * 60 * 24)
  );

  return Math.max(
    2,
    Math.min(18, Math.floor(diffDays / 7) + 2)
  );
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function validateCompleteDefense(
  evidence,
  { season, week, seasonType }
) {
  const problems = [];

  if (!evidence || typeof evidence !== "object") {
    problems.push("Defense build did not return an object.");
    return problems;
  }

  if (evidence.evidenceType !== "weekly-sage-defense-week") {
    problems.push(
      `Unexpected evidenceType: ${evidence.evidenceType}`
    );
  }

  if (String(evidence.season) !== String(season)) {
    problems.push(
      `Season mismatch: requested ${season}, got ${evidence.season}`
    );
  }

  if (Number(evidence.week) !== Number(week)) {
    problems.push(
      `Week mismatch: requested ${week}, got ${evidence.week}`
    );
  }

  if (evidence.seasonType !== seasonType) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${evidence.seasonType}`
    );
  }

  if (!evidence.schedule || typeof evidence.schedule !== "object") {
    problems.push("schedule is missing.");
  }

  if (
    !evidence.defenses ||
    typeof evidence.defenses !== "object" ||
    Array.isArray(evidence.defenses)
  ) {
    problems.push("defenses is missing or invalid.");
  }

  if (!Array.isArray(evidence.gameResults)) {
    problems.push("gameResults is not an array.");
  }

  if (
    evidence.schedule &&
    Number(evidence.schedule.completedGames) !==
      Number(evidence.schedule.processedGames)
  ) {
    problems.push(
      `Not all completed games were processed: ${evidence.schedule.processedGames} of ${evidence.schedule.completedGames}.`
    );
  }

  if (Array.isArray(evidence.gameResults)) {
    const failedGames = evidence.gameResults.filter(function (game) {
      return !game || game.status !== "processed";
    });

    if (failedGames.length > 0) {
      problems.push(
        `${failedGames.length} game result(s) were not processed successfully.`
      );
    }
  }

  return problems;
}

exports.handler = async function (event) {
  connectLambda(event);

  if (event.httpMethod && event.httpMethod !== "GET") {
    return jsonResponse(405, {
      error: "Method not allowed."
    });
  }

  const query = event.queryStringParameters || {};
  const season = String(
    query.season || new Date().getFullYear()
  );
  const currentWeek = getCurrentNFLWeek();

  // Explicit historical/manual week wins. Scheduled execution caches
  // the week that completed immediately before the upcoming SAGE week.
  const week = query.week
    ? Number(query.week)
    : currentWeek - 1;

  const seasonType = String(
    query.seasonType || DEFAULT_SEASON_TYPE
  )
    .trim()
    .toLowerCase();

  if (
    !Number.isInteger(week) ||
    week < 1 ||
    week > 18
  ) {
    return jsonResponse(400, {
      error: "week must be an integer from 1 through 18.",
      resolvedDefenseWeek: week,
      currentNFLWeek: currentWeek,
      automaticWeekResolution: !query.week
    });
  }

  if (!["reg", "pre", "post", "all"].includes(seasonType)) {
    return jsonResponse(400, {
      error: "seasonType must be reg, pre, post, or all."
    });
  }

  const key = `week:${season}:${week}:${seasonType}`;

  try {
    // Provider work is internal-only. No HTTP self-fetch and no public
    // multi-call Tank01 builder surface.
    const evidence = await buildWeeklyDefense({
      season,
      week,
      seasonType
    });

    const problems = validateCompleteDefense(evidence, {
      season,
      week,
      seasonType
    });

    if (problems.length > 0) {
      console.error(
        `refresh-weekly-sage-defense: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
      );

      return jsonResponse(422, {
        cached: false,
        season,
        week,
        seasonType,
        blobStore: STORE_NAME,
        blobKey: key,
        error:
          "Weekly SAGE defensive evidence was incomplete; existing cache (if any) was left untouched.",
        problems
      });
    }

    const store = getStore({ name: STORE_NAME });
    await store.setJSON(key, evidence);

    console.log(
      `refresh-weekly-sage-defense: cached ${key} -- ${evidence.schedule.processedGames} completed game(s) processed.`
    );

    return jsonResponse(200, {
      cached: true,
      season,
      week,
      seasonType,
      generatedAt: evidence.generatedAt || null,
      gamesReturned: evidence.schedule.gamesReturned,
      completedGames: evidence.schedule.completedGames,
      processedGames: evidence.schedule.processedGames,
      defensesReturned: Object.keys(evidence.defenses).length,
      blobStore: STORE_NAME,
      blobKey: key
    });
  } catch (error) {
    console.error(
      `refresh-weekly-sage-defense failed for ${key}:`,
      error
    );

    return jsonResponse(502, {
      cached: false,
      season,
      week,
      seasonType,
      blobStore: STORE_NAME,
      blobKey: key,
      error:
        "Could not build and cache Weekly SAGE defensive evidence.",
      detail:
        error && error.message
          ? error.message
          : String(error)
    });
  }
};
